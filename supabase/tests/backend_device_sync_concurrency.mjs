import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isolatedConnection } from "../scripts/check-backend-baseline.mjs";
import { PsqlSession } from "./backend_lock_order.mjs";

const quote = (value) => `'${value.replaceAll("'", "''")}'`;

async function connect(env, psqlPath) {
  const session = new PsqlSession(env, psqlPath);
  try {
    await session.ok(`SET timezone='UTC'; SET statement_timeout='8s'; SET lock_timeout='6s';
      SET idle_in_transaction_session_timeout='15s'; SET deadlock_timeout='100ms';
      DO $$ BEGIN
        IF current_database()<>'aquafeed_backend_test'
          OR inet_server_addr() NOT IN (inet '127.0.0.1', inet '::1')
          OR NOT EXISTS (SELECT 1 FROM backend_test.provenance p JOIN pg_database d ON d.oid=p.database_oid
            WHERE p.singleton AND d.datname=current_database() AND p.migration_fixtures_cleaned)
        THEN RAISE EXCEPTION 'fresh disposable baseline required'; END IF;
      END $$;`);
    [session.pid] = await session.ok("SELECT to_jsonb(pg_backend_pid());");
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
}

async function waitForBlockingLock(holder, waiter) {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const [blocked] = await holder.ok(
      `SELECT to_jsonb(${holder.pid}=ANY(pg_blocking_pids(${waiter.pid})));\n`,
    );
    if (blocked) return;
    await new Promise(setImmediate);
  }
  throw new Error("Expected aggregate sync lock overlap did not occur.");
}

function getResult(result) {
  assert.equal(result.state, "00000");
  assert.equal(result.rows.length, 1);
  return JSON.parse(result.rows[0]);
}

export async function runDeviceSyncConcurrency({
  databaseUrl,
  psqlPath = "psql",
}) {
  const env = {
    ...isolatedConnection(databaseUrl),
    PGAPPNAME: `aquafeed-t08-${randomUUID()}`,
  };
  const device = quote(randomUUID());
  const installation = quote(randomUUID());
  const boot = randomUUID();
  const request = quote(randomUUID());
  const key = quote(randomUUID());
  const manual = `SELECT public.art31_create_manual_feed(${device},${installation},${request},${key},
    '[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":25}},{"nozzle_number":2,"dose":{"mode":"grams","amount_g":40}}]'::jsonb,5);`;
  const lockDevice = `SELECT to_jsonb(1) FROM public.devices WHERE device_id=${device} FOR UPDATE;`;
  const lockAccess = `SELECT to_jsonb(1) FROM public.device_access
    WHERE device_id=${device} AND installation_id=${installation} FOR SHARE;`;
  const sample = {
    sequence: 1,
    measured_at: new Date().toISOString(),
    time_quality: "rtc",
    do_mg_l: 5.8,
    do_quality: "valid",
    feed_remaining_g: 20_000,
    feed_percent: 100,
    feed_quality: "valid",
    calibration_revision: 1,
  };
  const sync = () => {
    const payload = {
      protocol_major: 2,
      request_id: randomUUID(),
      boot_id: boot,
      live_sequence: 2,
      capabilities_revision: 5,
      clock: { quality: "rtc", uncertainty_ms: 0 },
      actuator: { state: "idle", active_sequence_id: null },
      configuration: {
        applied_revision: null,
        last_attempt_revision: null,
        last_attempt_status: null,
        error_code: null,
      },
      latest_sample: {
        ...sample,
        sequence: 2,
        measured_at: new Date().toISOString(),
      },
      backlog_samples: [],
      event_keys: [],
      scheduled_events_json: "[]",
      manual_events_json: "[]",
    };
    return `SET LOCAL ROLE service_role;
      SELECT public.backend_sync_device(${device},repeat('a',64),${quote(JSON.stringify(payload))}::jsonb);`;
  };
  let a,
    b,
    owned = false;
  let stage = "connect";
  try {
    a = await connect(env, psqlPath);
    b = await connect(env, psqlPath);
    stage = "fixture setup";
    await a.ok(`BEGIN;
      INSERT INTO auth.users(id,is_anonymous) VALUES(${installation},true);
      INSERT INTO public.devices(device_id,model,firmware_version,protocol_major,is_simulated,capabilities_revision,capabilities)
        SELECT ${device},'T08 disposable overlap',firmware_version,protocol_major,true,capabilities_revision,
          capabilities||'{"independent_telemetry_v1":false}'::jsonb
        FROM public.devices WHERE device_id='22222222-2222-4222-8222-222222222222'
          AND is_simulated AND capabilities_revision=5 AND capabilities->>'feed_capacity_g'='20000';
      INSERT INTO private.device_credentials(device_id,credential_verifier) VALUES(${device},decode(repeat('a',64),'hex'));
      INSERT INTO public.device_state(device_id) VALUES(${device});
      INSERT INTO public.device_access(device_id,installation_id,status) VALUES(${device},${installation},'active');
      COMMIT;`);
    owned = true;
    const [seed] = await a.ok(
      `SELECT public.art27_sync_telemetry(${device},repeat('a',64),${quote(boot)},1,${quote(JSON.stringify(sample))}::jsonb,'[]'::jsonb);`,
    );
    assert.equal(seed.status, "ok");

    stage = "manual admission overlap";
    await a.ok(`BEGIN; ${lockAccess} ${lockDevice}`);
    await b.ok("BEGIN;");
    let pending = b.query(sync(), { allowError: true });
    pending.catch(() => {});
    await waitForBlockingLock(a, b);
    const [admitted] = await a.ok(manual);
    assert.equal(admitted.status, "created");
    const sequence = admitted.command.sequence_id;
    await a.ok("COMMIT;");
    const uploaded = getResult(await pending);
    assert.equal(uploaded.command.sequence_id, sequence);
    assert.deepEqual(uploaded.acknowledged_samples, [
      { boot_id: boot, sequence: 2 },
    ]);
    await b.ok("SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;");

    stage = "uncertain reconciliation overlap";
    await a.ok(`BEGIN; ${lockAccess} ${lockDevice}
      UPDATE public.feed_sequences SET delivered_at=clock_timestamp()-interval '2 minutes',
        start_before=clock_timestamp()-interval '1 minute' WHERE device_id=${device};
      UPDATE public.feed_steps SET start_before=clock_timestamp()-interval '1 minute'
        WHERE device_id=${device} AND step_index=1;`);
    await b.ok("BEGIN;");
    pending = b.query(sync(), { allowError: true });
    pending.catch(() => {});
    await waitForBlockingLock(a, b);
    const [reconciled] = await a.ok(manual);
    assert.equal(reconciled.command.sequence_id, sequence);
    assert.equal(reconciled.command.status, "unknown");
    assert.equal(reconciled.command.safety_lockout, true);
    await a.ok("SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;");
    assert.equal(getResult(await pending).command.sequence_id, sequence);
    await b.ok("SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;");

    stage = "revocation overlap";
    await a.ok(`BEGIN; ${lockDevice}`);
    await b.ok("BEGIN;");
    pending = b.query(
      `SELECT public.art38_revoke_device_access(${device},${installation});`,
      { allowError: true },
    );
    pending.catch(() => {});
    await waitForBlockingLock(a, b);
    const [beforeRevocation] = await a.ok(sync());
    assert.equal(beforeRevocation.command.sequence_id, sequence);
    await a.ok("SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;");
    assert.equal(getResult(await pending).status, "revoked");
    const [denied] = await b.ok(manual);
    assert.equal(denied.status, "not_active");
    await b.ok("SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;");

    stage = "stable final facts";
    const [facts] = await a.ok(`SELECT jsonb_build_object(
      'sequences',(SELECT jsonb_agg(sequence_id) FROM public.feed_sequences WHERE device_id=${device}),
      'steps',(SELECT jsonb_agg(status ORDER BY step_index) FROM public.feed_steps WHERE device_id=${device}),
      'samples',(SELECT count(*) FROM public.device_telemetry WHERE device_id=${device}),
      'alerts',(SELECT count(*) FROM public.alert_events WHERE device_id=${device}),
      'access',(SELECT status FROM public.device_access WHERE device_id=${device}));`);
    assert.deepEqual(
      {
        ...facts,
        sequences: facts.sequences?.length,
        sameSequence: facts.sequences?.[0] === sequence,
      },
      {
        sequences: 1,
        sameSequence: true,
        steps: ["queued", "queued"],
        samples: 1,
        alerts: 0,
        access: "active",
      },
    );
    stage = "idle sessions";
    for (const [reader, other] of [
      [a, b],
      [b, a],
    ]) {
      const [idle] =
        await reader.ok(`SELECT to_jsonb(state='idle' AND xact_start IS NULL)
        FROM pg_stat_activity WHERE pid=${other.pid};`);
      assert.equal(idle, true);
    }
  } catch {
    throw new Error(
      `Atomic sync overlap failed at ${stage} (session states ${a?.lastState ?? "unknown"}/${b?.lastState ?? "unknown"}).`,
    );
  } finally {
    try {
      if (a && !a.broken) await a.ok("ROLLBACK;");
      if (b) await b.close();
      if (owned) {
        const cleanup = await connect(env, psqlPath);
        try {
          await cleanup.ok(`BEGIN;
            DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.alert_events WHERE device_id=${device})
              THEN RAISE EXCEPTION 'unexpected committed alert evidence'; END IF; END $$;
            DELETE FROM realtime.messages WHERE topic='device:'||${device}||':updates';
            DELETE FROM public.device_state WHERE device_id=${device};
            DELETE FROM public.device_execution_reservations WHERE device_id=${device};
            DELETE FROM public.feed_steps WHERE device_id=${device};
            DELETE FROM public.feed_sequence_targets WHERE device_id=${device};
            DELETE FROM public.feed_sequences WHERE device_id=${device};
            DELETE FROM public.device_access WHERE device_id=${device};
            DELETE FROM public.device_telemetry WHERE device_id=${device};
            DELETE FROM private.device_credentials WHERE device_id=${device};
            DELETE FROM public.device_resource_versions WHERE device_id=${device};
            DELETE FROM public.devices WHERE device_id=${device};
            DELETE FROM auth.users WHERE id=${installation};
            COMMIT;`);
        } finally {
          await cleanup.close();
        }
      }
    } finally {
      if (a) await a.close();
    }
  }
  console.log(
    "PASS backend_device_sync_concurrency: manual admission, uncertain reconciliation, revocation and cleanup",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [flag, variable] = process.argv.slice(2);
  if (
    process.argv.length !== 4 ||
    flag !== "--database-url-env" ||
    !/^[A-Z_][A-Z0-9_]*$/.test(variable)
  ) {
    console.error(
      "Usage: node supabase/tests/backend_device_sync_concurrency.mjs --database-url-env VARIABLE",
    );
    process.exitCode = 1;
  } else {
    runDeviceSyncConcurrency({
      databaseUrl: process.env[variable],
      psqlPath: process.env.PSQL_PATH,
    }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
