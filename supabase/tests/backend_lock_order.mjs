import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isolatedConnection } from "../scripts/check-backend-baseline.mjs";

// Never print arbitrary exception messages, SQL, identities or JSON returned by RPCs.
export function lockOrderDiagnostic(
  error,
  { phase, stage, manualState, telemetryState },
) {
  const phases = ["initial", "old", "new", "revoke", "cleanup"];
  const stages = [
    "connect",
    "save-definition",
    "install-old",
    "restore-forward",
    "setup",
    "setup-sample",
    "overlap-prefix",
    "overlap-barrier",
    "manual-admission",
    "manual-commit",
    "overlap-results",
    "telemetry-retry",
    "manual-retry",
    "retry-facts",
    "metadata-overlap",
    "reconciliation",
    "revoke-overlap",
    "fixture-cleanup",
    "idle-check",
    "restoration",
  ];
  const statuses = [
    "created",
    "existing",
    "ok",
    "updated",
    "revoked",
    "not_active",
    "unknown",
    "not_started",
    "safety_lockout",
  ];
  const scalar = (value) =>
    typeof value === "boolean" ||
    (Number.isInteger(value) && value >= 0 && value <= 100) ||
    statuses.includes(value);
  const facts = (value) => {
    if (scalar(value)) return value;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return "suppressed";
    return Object.fromEntries(
      [
        "sequences",
        "steps",
        "reservations",
        "delivered",
        "events",
        "lockout",
        "settling",
        "alerts",
        "revoked",
        "audit",
      ]
        .filter((key) => Object.hasOwn(value, key))
        .map((key) => [
          key,
          scalar(value[key])
            ? value[key]
            : Array.isArray(value[key]) &&
                value[key].length <= 2 &&
                value[key].every(scalar)
              ? value[key]
              : "suppressed",
        ]),
    );
  };
  const state = (value) => (/^[0-9A-Z]{5}$/.test(value) ? value : "unknown");
  const assertion = error?.code === "ERR_ASSERTION";
  return `FAIL backend_lock_order: phase=${phases.includes(phase) ? phase : "unknown"} stage=${stages.includes(stage) ? stage : "unknown"} kind=${assertion ? "assertion" : "client-or-sql"} manual_sqlstate=${state(manualState)} telemetry_sqlstate=${state(telemetryState)}${assertion ? ` expected=${JSON.stringify(facts(error.expected))} actual=${JSON.stringify(facts(error.actual))}` : ""}`;
}

// Two persistent clients; stdout is a private SQL-result channel, never a log.
export class PsqlSession {
  constructor(env, psqlPath = "psql") {
    this.buffer = "";
    this.serial = 0;
    this.pending = null;
    this.child = childProcess.spawn(
      psqlPath,
      [
        "-X",
        "--no-password",
        "-qAt",
        "-P",
        "pager=off",
        "-v",
        "ON_ERROR_STOP=0",
        "-v",
        "VERBOSITY=sqlstate",
      ],
      { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let stderr = "";
    this.child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-16_384);
      const states = [
        ...stderr.matchAll(
          /(?:^|\n)(?:ERROR|FATAL):\s+([0-9A-Z]{5})(?=\r?\n|$)/g,
        ),
      ];
      if (states.length) this.lastState = states.at(-1)[1];
    });
    this.closed = new Promise((resolve) => this.child.once("close", resolve));
    this.child.once("error", () =>
      this.fail("Unable to start isolated psql client."),
    );
    this.child.once("close", () =>
      this.fail("Isolated psql client closed unexpectedly."),
    );
    this.child.stdin.on("error", () =>
      this.fail("Isolated psql input failed."),
    );
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      if (this.buffer.length > 131_072)
        return this.fail("Isolated psql output exceeded limit.");
      let end;
      while ((end = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, end).replace(/\r$/, "");
        this.buffer = this.buffer.slice(end + 1);
        const pending = this.pending;
        if (!pending) continue;
        const marker = line.match(/^__t02_(\d+)__ ([0-9A-Z]{5})$/);
        if (marker && Number(marker[1]) === pending.serial) {
          clearTimeout(pending.timer);
          this.pending = null;
          this.lastState = marker[2];
          pending.resolve({ state: marker[2], rows: pending.rows });
        } else if (line) {
          pending.size = (pending.size || 0) + line.length;
          if (pending.size > 131_072)
            return this.fail("Isolated psql output exceeded limit.");
          pending.rows.push(line);
        }
      }
    });
  }

  fail(message) {
    this.broken = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(message));
      this.pending = null;
    }
    this.child.kill();
  }

  query(sql, { allowError = false } = {}) {
    if (this.pending || this.broken)
      return Promise.reject(new Error("Isolated psql session is not ready."));
    return new Promise((resolve, reject) => {
      const serial = ++this.serial;
      const timer = setTimeout(
        () => this.fail("Isolated psql query deadline exceeded."),
        12_000,
      );
      this.pending = { serial, timer, resolve, reject, rows: [] };
      this.child.stdin.write(
        // pg_get_functiondef has no outer semicolon. Execute the buffer before echoing SQLSTATE.
        `\\set ON_ERROR_STOP ${allowError ? "off" : "on"}\n${sql}${sql.trimEnd().endsWith(";") ? "" : "\n;"}\n\\echo __t02_${serial}__ :SQLSTATE\n`,
      );
    });
  }

  async ok(sql) {
    const result = await this.query(sql);
    if (result.state !== "00000")
      throw new Error(`Isolated SQL failed (${result.state}).`);
    return result.rows.map((row) => JSON.parse(row));
  }

  async close() {
    if (!this.broken && !this.pending) this.child.stdin.end("ROLLBACK;\n\\q\n");
    else this.child.kill();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        this.child.kill();
        reject(new Error("Isolated psql shutdown deadline exceeded."));
      }, 2_000);
    });
    try {
      await Promise.race([this.closed, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}

const q = (value) => `'${value.replaceAll("'", "''")}'`;
const telemetrySignature =
  "public.art27_sync_telemetry(uuid,text,uuid,bigint,jsonb,jsonb)";

async function guard(session) {
  // URL validation is not proof against a tunnel: require fresh-bootstrap provenance too.
  await session.ok(`DO $$ BEGIN
    IF current_database()<>'aquafeed_backend_test'
      OR NOT EXISTS (SELECT 1 FROM backend_test.provenance p JOIN pg_database d ON d.oid=p.database_oid
        WHERE p.singleton AND d.datname=current_database() AND p.migration_fixtures_cleaned)
    THEN RAISE EXCEPTION 'fresh disposable baseline required'; END IF;
  END $$;`);
}

async function connect(env, psqlPath) {
  const session = new PsqlSession(env, psqlPath);
  try {
    await session.ok(`SET statement_timeout='8s'; SET lock_timeout='6s';
      SET idle_in_transaction_session_timeout='15s'; SET deadlock_timeout='100ms';`);
    await guard(session);
    const [pid] = await session.ok("SELECT to_jsonb(pg_backend_pid());");
    session.pid = pid;
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}

async function untilBlocked(holder, waiter) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const [blocked] = await holder.ok(
      `SELECT to_jsonb(${holder.pid}=ANY(pg_blocking_pids(${waiter.pid})));`,
    );
    if (blocked) return;
    // Poll the actual lock barrier, not a guessed race delay.
    await new Promise(setImmediate);
  }
  throw new Error("Expected database lock barrier was not reached.");
}

function fixture() {
  return {
    device: randomUUID(),
    installation: randomUUID(),
    boot: randomUUID(),
    request: randomUUID(),
    key: randomUUID(),
    targets:
      '[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":25}},{"nozzle_number":2,"dose":{"mode":"grams","amount_g":40}}]',
  };
}

function manual(f) {
  return `SELECT public.art31_create_manual_feed(${q(f.device)},${q(f.installation)},${q(f.request)},${q(f.key)},${q(f.targets)}::jsonb,5);`;
}

function telemetry(f) {
  return `SELECT public.art27_sync_telemetry(${q(f.device)},repeat('a',64),${q(f.boot)},2,${q(f.sample)}::jsonb,'[]'::jsonb);`;
}

async function setup(a, f) {
  a.stage = "setup";
  await a.ok(`BEGIN;
    INSERT INTO auth.users(id,email) VALUES(${q(f.installation)},'backend-t02@invalid.example');
    INSERT INTO public.devices(device_id,model,firmware_version,protocol_major,is_simulated,capabilities_revision,capabilities)
      SELECT ${q(f.device)},'T02 disposable fixture',firmware_version,protocol_major,true,capabilities_revision,capabilities
      FROM public.devices WHERE device_id='22222222-2222-4222-8222-222222222222'
        AND is_simulated AND capabilities_revision=5 AND capabilities->>'feed_capacity_g'='20000';
    INSERT INTO private.device_credentials(device_id,credential_verifier) VALUES(${q(f.device)},decode(repeat('a',64),'hex'));
    INSERT INTO public.device_access(device_id,installation_id,status) VALUES(${q(f.device)},${q(f.installation)},'active');
    INSERT INTO public.device_state(device_id) VALUES(${q(f.device)});
    COMMIT;`);
  f.sample = JSON.stringify({
    sequence: 2,
    measured_at: new Date().toISOString(),
    time_quality: "rtc",
    do_mg_l: 5.8,
    do_quality: "valid",
    feed_remaining_g: 20_000,
    feed_percent: 100,
    feed_quality: "valid",
    calibration_revision: 1,
  });
  a.stage = "setup-sample";
  const [initial] =
    await a.ok(`SELECT public.art27_sync_telemetry(${q(f.device)},repeat('a',64),${q(f.boot)},1,
    (${q(f.sample)}::jsonb || '{"sequence":1}'::jsonb),'[]'::jsonb);`);
  assert.equal(initial.status, "ok");
}

async function cleanup(a, f) {
  a.stage = "fixture-cleanup";
  // Only random task-owned rows. An unexpected immutable alert preserves evidence and fails closed.
  await a.ok(`BEGIN;
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.alert_events WHERE device_id=${q(f.device)})
      THEN RAISE EXCEPTION 'unexpected committed alert evidence'; END IF; END $$;
    DELETE FROM public.device_state WHERE device_id=${q(f.device)};
    DELETE FROM public.device_execution_reservations WHERE device_id=${q(f.device)};
    DELETE FROM public.device_events WHERE device_id=${q(f.device)};
    DELETE FROM public.feed_steps WHERE device_id=${q(f.device)};
    DELETE FROM public.feed_sequence_targets WHERE device_id=${q(f.device)};
    DELETE FROM public.feed_sequences WHERE device_id=${q(f.device)};
    DELETE FROM public.device_access WHERE device_id=${q(f.device)};
    DELETE FROM public.device_telemetry WHERE device_id=${q(f.device)};
    DELETE FROM private.device_credentials WHERE device_id=${q(f.device)};
    DELETE FROM private.security_audit_events WHERE device_id=${q(f.device)};
    DELETE FROM private.device_alert_state WHERE device_id=${q(f.device)};
    UPDATE public.devices SET desired_revision=NULL,applied_revision=NULL,last_attempt_revision=NULL WHERE device_id=${q(f.device)};
    DELETE FROM public.device_config_revisions WHERE device_id=${q(f.device)};
    DELETE FROM public.devices WHERE device_id=${q(f.device)};
    DELETE FROM auth.users WHERE id=${q(f.installation)};
    COMMIT;`);
}

async function overlap(a, b, f, expectDeadlock) {
  a.stage = "overlap-prefix";
  await a.ok(
    `BEGIN; SELECT 1 FROM public.device_access WHERE device_id=${q(f.device)} AND installation_id=${q(f.installation)} FOR SHARE;`,
  );
  await a.ok(
    `SELECT 1 FROM public.devices WHERE device_id=${q(f.device)} FOR UPDATE;`,
  );
  // B runs the REAL telemetry RPC. Old telemetry holds S while waiting for A's D.
  const pending = b.query(telemetry(f), { allowError: true });
  // Attach a rejection handler immediately so a failed barrier cannot leak a rejection.
  pending.catch(() => {});
  a.stage = "overlap-barrier";
  await untilBlocked(a, b);
  a.stage = "manual-admission";
  const admitted = await a.query(manual(f), { allowError: true });
  a.admissionState = admitted.state;
  a.stage = "manual-commit";
  await a.ok(admitted.state === "00000" ? "COMMIT;" : "ROLLBACK;");
  const uploaded = await pending;
  a.stage = "overlap-results";
  const states = [admitted.state, uploaded.state];
  if (expectDeadlock) {
    assert.ok(
      states.includes("40P01"),
      "OLD telemetry must reproduce the device/state deadlock",
    );
    assert.ok(states.every((state) => ["00000", "40P01"].includes(state)));
    console.log(
      "RED observed: old telemetry device/state inversion -> SQLSTATE 40P01",
    );
  } else {
    assert.deepEqual(
      states,
      ["00000", "00000"],
      "forward functions must complete without deadlock/timeouts",
    );
    assert.ok(
      ["created", "existing"].includes(JSON.parse(admitted.rows.at(-1)).status),
    );
    assert.equal(JSON.parse(uploaded.rows.at(-1)).status, "ok");
    console.log(
      "GREEN observed: real telemetry and manual admission both complete",
    );
  }
  a.stage = "telemetry-retry";
  const [uploadRetry] = await a.ok(telemetry(f));
  const [uploadReplay] = await a.ok(telemetry(f));
  assert.equal(uploadRetry.status, "ok");
  assert.equal(uploadReplay.status, "ok");
  const [samples] = await a.ok(
    `SELECT to_jsonb(count(*)) FROM public.device_telemetry WHERE device_id=${q(f.device)};`,
  );
  assert.equal(
    samples,
    2,
    "telemetry retries must not duplicate immutable samples",
  );
  // A database retry must reuse the same identity, never admit another sequence.
  a.stage = "manual-retry";
  const [retry] = await a.ok(manual(f));
  assert.ok(["created", "existing"].includes(retry.status));
  const [replay] = await a.ok(manual(f));
  assert.equal(replay.status, "existing");
  a.stage = "retry-facts";
  const [facts] = await a.ok(`SELECT jsonb_build_object(
    'sequences',(SELECT count(*) FROM public.feed_sequences WHERE device_id=${q(f.device)}),
    'steps',(SELECT jsonb_agg(nozzle_number ORDER BY step_index) FROM public.feed_steps WHERE device_id=${q(f.device)}),
    'reservations',(SELECT count(*) FROM public.device_execution_reservations WHERE device_id=${q(f.device)} AND phase='active'),
    'delivered',(SELECT count(*) FROM public.feed_sequences WHERE device_id=${q(f.device)} AND delivered_at IS NOT NULL),
    'events',(SELECT count(*) FROM public.device_events WHERE device_id=${q(f.device)}),
    'lockout',(SELECT safety_lockout FROM public.device_state WHERE device_id=${q(f.device)}));`);
  assert.deepEqual(facts, {
    sequences: 1,
    steps: [1, 2],
    reservations: 1,
    delivered: 0,
    events: 0,
    lockout: false,
  });
}

async function accessOverlap(a, b, f) {
  a.stage = "metadata-overlap";
  await a.ok(
    `BEGIN; SELECT 1 FROM public.device_access WHERE device_id=${q(f.device)} AND installation_id=${q(f.installation)} FOR UPDATE;`,
  );
  const pending = b.query(manual(f));
  pending.catch(() => {});
  await untilBlocked(a, b);
  const [metadata] = await a.ok(
    `SELECT public.art102_update_device_metadata(${q(f.device)},${q(f.installation)},'T02 disposable',NULL,1);`,
  );
  assert.equal(metadata.status, "updated");
  await a.ok("COMMIT;");
  const result = await pending;
  assert.equal(result.state, "00000");
  assert.equal(JSON.parse(result.rows.at(-1)).status, "existing");
  console.log(
    "GREEN observed: access-first metadata and manual admission do not invert A/D",
  );
}

async function revokeOverlap(a, b, f) {
  a.stage = "revoke-overlap";
  const snapshot =
    '{"timezone":"Asia/Manila","monitoring_limits":{"do_low_mg_l":4,"do_high_mg_l":8},"low_feed_threshold_pct":20,"schedules":[]}';
  const [written] = await a.ok(
    `SELECT public.art33_write_configuration(${q(f.device)},${q(f.installation)},${q(randomUUID())},0,${q(snapshot)}::jsonb);`,
  );
  assert.equal(written.status, "ok");
  const [applied] = await a.ok(
    `SELECT public.art33_device_configuration_report(${q(f.device)},repeat('a',64),1,1,'applied',NULL);`,
  );
  assert.equal(applied.status, "ok");
  await a.ok(
    `BEGIN; SELECT 1 FROM public.devices WHERE device_id=${q(f.device)} FOR UPDATE;`,
  );
  const pending = b.query(
    `SELECT public.art38_revoke_device_access(${q(f.device)},${q(f.installation)});`,
    { allowError: true },
  );
  pending.catch(() => {});
  await untilBlocked(a, b);
  const [pushLock] = await a.ok(
    `SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_locks WHERE pid=${b.pid} AND locktype='advisory' AND granted));`,
  );
  assert.equal(
    pushLock,
    false,
    "revoke must wait on D BEFORE acquiring push G, not through the audit FK after G",
  );
  f.sample = JSON.stringify({ ...JSON.parse(f.sample), do_mg_l: 2 });
  try {
    const [uploaded] = await a.ok(telemetry(f));
    assert.equal(uploaded.status, "ok");
    const [crossing] = await a.ok(
      `SELECT to_jsonb(count(*)) FROM public.alert_events WHERE device_id=${q(f.device)} AND alert_kind='do_low';`,
    );
    assert.equal(
      crossing,
      1,
      "real threshold crossing must reach the push-enqueue trigger",
    );
  } finally {
    await a.ok("ROLLBACK;");
  }
  const revoked = await pending;
  assert.equal(revoked.state, "00000");
  assert.equal(JSON.parse(revoked.rows.at(-1)).status, "revoked");
  const [facts] = await a.ok(`SELECT jsonb_build_object(
    'alerts',(SELECT count(*) FROM public.alert_events WHERE device_id=${q(f.device)}),
    'revoked',(SELECT status='revoked' AND revoked_at IS NOT NULL FROM public.device_access WHERE device_id=${q(f.device)}),
    'audit',(SELECT count(*) FROM private.security_audit_events WHERE device_id=${q(f.device)} AND event_type='access_revoked'));`);
  assert.deepEqual(facts, { alerts: 0, revoked: true, audit: 1 });
  const [denied] = await a.ok(manual(f));
  assert.equal(denied.status, "not_active");
  console.log(
    "GREEN observed: real revoke and threshold-crossing/push trigger complete; alert rolls back, access/audit persist",
  );
}

async function reconciliation(a, f) {
  a.stage = "reconciliation";
  // Roll back this synthetic timeout, including its immutable alert. Never deliver an actuator command.
  await a.ok("BEGIN;");
  try {
    await a.ok(`UPDATE public.feed_sequences SET delivered_at=clock_timestamp()-interval '2 minutes',
      start_before=clock_timestamp()-interval '1 minute' WHERE device_id=${q(f.device)};
      UPDATE public.feed_steps SET start_before=clock_timestamp()-interval '1 minute' WHERE device_id=${q(f.device)} AND step_index=1;`);
    const [result] = await a.ok(manual(f));
    assert.equal(result.status, "existing");
    assert.equal(result.command.status, "unknown");
    assert.equal(result.command.safety_lockout, true);
    const [facts] = await a.ok(`SELECT jsonb_build_object(
      'lockout',(SELECT safety_lockout FROM public.device_state WHERE device_id=${q(f.device)}),
      'steps',(SELECT jsonb_agg(status ORDER BY step_index) FROM public.feed_steps WHERE device_id=${q(f.device)}),
      'settling',(SELECT count(*) FROM public.device_execution_reservations WHERE device_id=${q(f.device)} AND phase='settling'),
      'alerts',(SELECT count(*) FROM public.alert_events WHERE device_id=${q(f.device)} AND alert_kind='feeding_unknown'));`);
    assert.deepEqual(facts, {
      lockout: true,
      steps: ["unknown", "not_started"],
      settling: 1,
      alerts: 1,
    });
    const other = { ...f, request: randomUUID(), key: randomUUID() };
    const [blocked] = await a.ok(manual(other));
    assert.equal(blocked.status, "safety_lockout");
    await a.ok("SET CONSTRAINTS ALL IMMEDIATE;");
  } finally {
    await a.ok("ROLLBACK;");
  }
  console.log(
    "GREEN observed: reconciliation/feeding-alert lockout, no nozzle 2 start or uncertain retry",
  );
}

export async function runLockOrder({ databaseUrl, psqlPath = "psql" }) {
  const env = {
    ...isolatedConnection(databaseUrl),
    PGAPPNAME: `aquafeed-t02-${randomUUID()}`,
  };
  let a, b, definition;
  let phase = "initial";
  const diagnostic = (error, stage = a?.stage || "connect") =>
    lockOrderDiagnostic(error, {
      phase,
      stage,
      manualState: a?.admissionState ?? a?.lastState,
      telemetryState: b?.lastState,
    });
  const fixtures = [];
  try {
    a = await connect(env, psqlPath);
    b = await connect(env, psqlPath);
    a.stage = "save-definition";
    [definition] = await a.ok(
      `SELECT to_jsonb(pg_get_functiondef(${q(telemetrySignature)}::regprocedure));`,
    );
    const source = await readFile(
      new URL(
        "../migrations/20261015060257_art97_inventory_profile_durability.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const old = source.match(
      /create or replace function public\.art27_sync_telemetry\([\s\S]*?\n\$\$;/,
    )?.[0];
    assert.ok(old, "immutable OLD telemetry definition must be available");
    // Definition replacement is deliberately confined to the fresh disposable CI database.
    console.log("RUN backend_lock_order: isolated OLD telemetry control");
    a.stage = "install-old";
    await a.ok(old);
    for (phase of ["old", "new"]) {
      a.admissionState = undefined;
      console.log(
        `RUN backend_lock_order: ${phase} setup/telemetry-admission overlap`,
      );
      if (phase === "new") {
        a.stage = "restore-forward";
        await a.ok(definition);
      }
      const f = fixture();
      fixtures.push(f);
      await setup(a, f);
      await overlap(a, b, f, phase === "old");
      if (phase === "new") {
        console.log("RUN backend_lock_order: forward access/metadata overlap");
        await accessOverlap(a, b, f);
        console.log("RUN backend_lock_order: forward uncertain reconciliation");
        await reconciliation(a, f);
      }
      await cleanup(a, f);
      fixtures.pop();
    }
    phase = "revoke";
    a.admissionState = undefined;
    console.log(
      "RUN backend_lock_order: forward revoke/threshold-crossing overlap",
    );
    const revokedFixture = fixture();
    fixtures.push(revokedFixture);
    await setup(a, revokedFixture);
    await revokeOverlap(a, b, revokedFixture);
    await cleanup(a, revokedFixture);
    fixtures.pop();
    a.stage = "idle-check";
    const [idle] = await a.ok(
      `SELECT to_jsonb(state='idle' AND xact_start IS NULL) FROM pg_stat_activity WHERE pid=${b.pid};`,
    );
    assert.equal(idle, true, "telemetry session must not leak a transaction");
    const [otherIdle] = await b.ok(
      `SELECT to_jsonb(state='idle' AND xact_start IS NULL) FROM pg_stat_activity WHERE pid=${a.pid};`,
    );
    assert.equal(otherIdle, true, "manual session must not leak a transaction");
  } catch (error) {
    console.error(diagnostic(error));
    throw error;
  } finally {
    try {
      // Closing B releases all locks before restoration/fixture cleanup, even on a failed barrier.
      let shutdownFailed = false;
      if (b)
        await b.close().catch(() => {
          shutdownFailed = true;
        });
      if (a?.pending || a?.broken) {
        await a.close().catch(() => {
          shutdownFailed = true;
        });
        a = undefined;
      }
      if (definition) {
        a ??= await connect(env, psqlPath);
        try {
          await a.ok("ROLLBACK;");
          await a.ok(definition);
          for (const f of fixtures) await cleanup(a, f);
        } finally {
          await a.close();
        }
      } else if (a) await a.close();
      if (shutdownFailed)
        throw new Error("Isolated psql shutdown could not be verified.");
    } catch (error) {
      console.error(diagnostic(error, "restoration"));
      throw error;
    }
  }
  console.log(
    "PASS backend_lock_order: OLD RED / forward GREEN, idempotency, safety, no open transactions",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (
    args.length !== 2 ||
    args[0] !== "--database-url-env" ||
    !/^[A-Z_][A-Z0-9_]*$/.test(args[1])
  ) {
    console.error(
      "Usage: node supabase/tests/backend_lock_order.mjs --database-url-env LOCAL_TEST_DATABASE_URL",
    );
    process.exitCode = 1;
  } else {
    runLockOrder({
      databaseUrl: process.env[args[1]],
      psqlPath: process.env.PSQL_PATH || "psql",
    }).catch(() => {
      console.error(
        "FAIL backend_lock_order: isolated regression failed; no SQL, credentials or raw results logged.",
      );
      process.exitCode = 1;
    });
  }
}
