import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isolatedConnection } from "../scripts/check-backend-baseline.mjs";
import { PsqlSession } from "./backend_lock_order.mjs";

const intervals = [15, 30, 60, 3600, 28_800];
const viewerScenarios = [1, 5, 20];
const historyBatchSize = 100;
const historyBatches = 4;
const historyDay = "2026-10-25";
const historyStart = Date.parse(historyDay + "T04:00:00Z");
const profileTemplate = "22222222-2222-4222-8222-222222222222";
const verifier = "b".repeat(64);
const initialSequence = 1000;
const updatedInterval = 7200;

const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const json = (value) => quote(JSON.stringify(value)) + "::jsonb";
const uuid = (value) => quote(value) + "::uuid";
const roundMs = (value) => Number(value.toFixed(3));

function rpc(session, name, args) {
  return session
    .ok(
      `SET LOCAL ROLE service_role; SELECT public.${name}(${args.join(",")}); RESET ROLE;`,
    )
    .then(([result]) => result);
}

function observation(boot_id, sequence, measured_at, metric = "do") {
  return {
    metric,
    boot_id,
    sequence,
    measured_at,
    captured_at: null,
    time_quality: "synced",
    quality: "valid",
    do_mg_l: metric === "do" ? 5.8 : null,
    feed_remaining_g: metric === "feed" ? 20_000 : null,
    feed_percent: metric === "feed" ? 100 : null,
    calibration_revision: metric === "feed" ? 1 : null,
  };
}

function syncPayload(
  boot_id,
  live_sequence,
  configuration,
  live,
  backlog = [],
) {
  return {
    protocol_major: 2,
    request_id: randomUUID(),
    boot_id,
    live_sequence,
    capabilities_revision: 5,
    clock: { quality: "synced", uncertainty_ms: 0 },
    actuator: { state: "idle", active_sequence_id: null },
    configuration,
    latest_sample: null,
    backlog_samples: [],
    event_keys: [],
    scheduled_events_json: "[]",
    manual_events_json: "[]",
    metric_telemetry: { live, backlog },
  };
}

function appliedReport(revision, interval) {
  return {
    applied_revision: revision,
    last_attempt_revision: revision,
    last_attempt_status: "applied",
    error_code: null,
    oxygen_report_interval_seconds: interval,
  };
}

function writeConfiguration(session, feeder, interval, base) {
  return rpc(session, "art33_write_configuration", [
    uuid(feeder.id),
    uuid(feeder.installation),
    uuid(randomUUID()),
    base,
    json({
      timezone: "Asia/Manila",
      monitoring_limits: { do_low_mg_l: 4, do_high_mg_l: 8 },
      low_feed_threshold_pct: 20,
      oxygen_report_interval_seconds: interval,
      schedules: [],
    }),
  ]);
}

function sync(session, feeder, payload) {
  return rpc(session, "backend_sync_device", [
    uuid(feeder.id),
    quote(verifier),
    json(payload),
  ]);
}

function snapshot(session, feeder, installation = feeder.installation) {
  return rpc(session, "backend_metric_snapshot", [
    uuid(feeder.id),
    uuid(installation),
    uuid(randomUUID()),
  ]);
}

function assertAck(result, samples) {
  assert.equal(result.status, "ok");
  assert.deepEqual(
    result.acknowledged_metrics,
    samples.map(({ metric, boot_id, sequence }) => ({
      metric,
      boot_id,
      sequence,
    })),
  );
}

async function counts(session, feeder) {
  const [result] = await session.ok(
    `SELECT jsonb_build_object(
      'observations',(SELECT count(*) FROM public.device_metric_observations WHERE device_id=${uuid(feeder.id)}),
      'broadcasts',(SELECT count(*) FROM realtime.messages
        WHERE topic=${topic(feeder.id)} AND private AND event='resource_update'));`,
  );
  return result;
}

async function seedFeeder(session, feeder, now) {
  const id = uuid(feeder.id);
  const installation = uuid(feeder.installation);
  await session.ok(
    `INSERT INTO auth.users(id,is_anonymous) VALUES(${installation},true);
     INSERT INTO public.devices(device_id,model,firmware_version,protocol_major,is_simulated,capabilities_revision,capabilities)
       SELECT ${id},'T11 disposable feeder',firmware_version,protocol_major,true,capabilities_revision,
         capabilities||'{"independent_telemetry_v1":true}'::jsonb
       FROM public.devices WHERE device_id=${uuid(profileTemplate)}
         AND is_simulated AND protocol_major=2 AND capabilities_revision=5 AND capabilities->>'feed_capacity_g'='20000';
     INSERT INTO private.device_credentials(device_id,credential_verifier) VALUES(${id},decode(${quote(verifier)},'hex'));
     INSERT INTO public.device_state(device_id) VALUES(${id});
     INSERT INTO public.device_access(device_id,installation_id,status) VALUES(${id},${installation},'active');`,
  );
  const edit = await writeConfiguration(session, feeder, feeder.interval, 0);
  assert.equal(edit.status, "ok");
  assert.equal(edit.receipt.revision, 1);
  const report = appliedReport(1, feeder.interval);
  const live = {
    do: observation(
      feeder.boot,
      initialSequence,
      new Date(now - 1000).toISOString(),
    ),
    feed: observation(
      feeder.boot,
      initialSequence,
      new Date(now - 2000).toISOString(),
      "feed",
    ),
  };
  assertAck(
    await sync(
      session,
      feeder,
      syncPayload(feeder.boot, initialSequence, report, live),
    ),
    [live.do, live.feed],
  );

  for (let batch = 0; batch < historyBatches; batch++) {
    const samples = Array.from({ length: historyBatchSize }, (_, offset) => {
      const sequence = batch * historyBatchSize + offset + 1;
      return observation(
        feeder.boot,
        sequence,
        new Date(historyStart + sequence * 1000).toISOString(),
      );
    });
    const payload = syncPayload(
      feeder.boot,
      initialSequence,
      report,
      { do: null, feed: null },
      samples,
    );
    const before = await counts(session, feeder);
    const received = await sync(session, feeder, payload);
    assertAck(received, samples);
    const after = await counts(session, feeder);
    assert.deepEqual(after, {
      observations: before.observations + historyBatchSize,
      broadcasts: before.broadcasts + 1,
    });
    if (batch === historyBatches - 1) {
      const replay = await sync(session, feeder, payload);
      assertAck(replay, samples);
      const replayCounts = await counts(session, feeder);
      // Each authenticated sync refreshes contact, including immutable retries.
      assert.deepEqual(replayCounts, {
        observations: after.observations,
        broadcasts: after.broadcasts + 1,
      });
      assert.deepEqual(replay.revisions, {
        ...received.revisions,
        contact: received.revisions.contact + 1,
      });
    }
  }
  const state = await snapshot(session, feeder);
  assert.equal(state.status, "ok");
  assert.equal(state.device_id, feeder.id);
  assert.equal(
    state.configuration.applied_snapshot.oxygen_report_interval_seconds,
    feeder.interval,
  );
  assert.equal(state.resources.do.latest.observation.sequence, initialSequence);
  assert.equal(
    state.resources.feed.latest.observation.sequence,
    initialSequence,
  );
  assert.ok(
    Date.parse(state.resources.do.latest.observed_at) >
      Date.parse(state.resources.feed.latest.observed_at),
  );

  const firstPage = await rpc(session, "backend_metric_history", [
    id,
    installation,
    quote(historyDay) + "::date",
    "'do'",
  ]);
  assert.equal(firstPage.status, "ok");
  assert.equal(firstPage.observations.length, 50);
  assert.ok(firstPage.next);
  const nextPage = await rpc(session, "backend_metric_history", [
    id,
    installation,
    quote(historyDay) + "::date",
    "'do'",
    quote(firstPage.next.time) + "::timestamptz",
    quote(firstPage.next.identity),
  ]);
  assert.equal(nextPage.status, "ok");
  assert.equal(nextPage.observations.length, 50);
  const identities = [...firstPage.observations, ...nextPage.observations].map(
    (row) => {
      assert.equal(row.observation.boot_id, feeder.boot);
      return row.stable_identity;
    },
  );
  assert.equal(new Set(identities).size, 100);
}

function topic(id) {
  return quote("device:" + id + ":updates");
}

async function visibleTopicMessages(session, feeder, installation) {
  const [count] = await session.ok(
    `SET LOCAL ROLE authenticated;
     SET LOCAL request.jwt.claim.sub=${quote(installation)};
     SET LOCAL realtime.topic=${topic(feeder.id)};
     SELECT to_jsonb(count(*)) FROM realtime.messages WHERE topic=${topic(feeder.id)};
     RESET ROLE; SET LOCAL realtime.topic='';`,
  );
  return count;
}

async function verifyMembership(session, feeder, unrelated) {
  const [visible] = await session.ok(
    `SET LOCAL ROLE authenticated;
     SET LOCAL request.jwt.claim.sub=${quote(feeder.installation)};
     SELECT jsonb_build_object(
       'current',(SELECT count(*) FROM public.device_metric_current WHERE device_id=${uuid(feeder.id)}),
       'unrelated',(SELECT count(*) FROM public.device_metric_current WHERE device_id=${uuid(unrelated.id)}));
     RESET ROLE;`,
  );
  assert.deepEqual(visible, { current: 2, unrelated: 0 });
  assert.equal(
    (await snapshot(session, unrelated, feeder.installation)).status,
    "not_active",
  );
  assert.ok(
    (await visibleTopicMessages(session, feeder, feeder.installation)) > 0,
  );
  assert.equal(
    await visibleTopicMessages(session, unrelated, feeder.installation),
    0,
  );
}

async function verifyRevocation(session, { feeder, installation }) {
  assert.equal((await snapshot(session, feeder, installation)).status, "ok");
  assert.ok((await visibleTopicMessages(session, feeder, installation)) > 0);
  const revoked = await rpc(session, "art38_revoke_device_access", [
    uuid(feeder.id),
    uuid(installation),
  ]);
  assert.equal(revoked.status, "revoked");
  assert.equal(
    (await snapshot(session, feeder, installation)).status,
    "not_active",
  );
  assert.equal(await visibleTopicMessages(session, feeder, installation), 0);
  assert.equal((await snapshot(session, feeder)).status, "ok");
}

async function createViewers(session, feeders) {
  const viewers = Array.from(
    { length: viewerScenarios.at(-1) },
    (_, index) => ({
      installation: randomUUID(),
      feeder: feeders[index % feeders.length],
    }),
  );
  const users = viewers.map(
    ({ installation }) => `(${uuid(installation)},true)`,
  );
  const memberships = viewers.map(
    ({ feeder, installation }) =>
      `(${uuid(feeder.id)},${uuid(installation)},'active')`,
  );
  await session.ok(
    `INSERT INTO auth.users(id,is_anonymous) VALUES ${users.join(",")};
     INSERT INTO public.device_access(device_id,installation_id,status) VALUES ${memberships.join(",")};`,
  );
  return viewers;
}

async function exerciseEditAndFault(session, feeder, now) {
  const interval = updatedInterval;
  const edit = await writeConfiguration(session, feeder, interval, 1);
  assert.equal(edit.status, "ok");
  assert.equal(edit.receipt.revision, 2);
  const pending = await snapshot(session, feeder);
  assert.equal(
    pending.configuration.desired_snapshot.oxygen_report_interval_seconds,
    interval,
  );
  assert.equal(
    pending.configuration.applied_snapshot.oxygen_report_interval_seconds,
    feeder.interval,
  );
  assert.equal(
    (await writeConfiguration(session, feeder, 60, 1)).status,
    "conflict",
  );

  const next = observation(
    feeder.boot,
    initialSequence + 1,
    new Date(now - 250).toISOString(),
  );
  const live = { do: next, feed: null };
  const badPayload = syncPayload(
    feeder.boot,
    initialSequence + 1,
    appliedReport(2, 60),
    live,
  );
  const before = await counts(session, feeder);
  await session.ok("SAVEPOINT invalid_report;");
  const failed = await session.query(
    "SET LOCAL ROLE service_role; SELECT public.backend_sync_device(" +
      [uuid(feeder.id), quote(verifier), json(badPayload)].join(",") +
      ");",
    { allowError: true },
  );
  await session.ok(
    "ROLLBACK TO SAVEPOINT invalid_report; RELEASE SAVEPOINT invalid_report; RESET ROLE;",
  );
  assert.equal(failed.state, "P8C02");
  assert.deepEqual(await counts(session, feeder), before);
  assert.deepEqual(
    (await snapshot(session, feeder)).revisions,
    pending.revisions,
  );

  // Substitute a publisher INSERT failure only in this uncommitted fixture.
  await session.ok(
    "CREATE FUNCTION pg_temp.t11_reject_hint() RETURNS trigger LANGUAGE plpgsql AS $$" +
      " BEGIN RAISE EXCEPTION 'T11_TEST_HINT_LOST'; END $$;" +
      " CREATE TRIGGER t11_reject_hint BEFORE INSERT ON realtime.messages FOR EACH ROW" +
      " EXECUTE FUNCTION pg_temp.t11_reject_hint();",
  );
  assertAck(
    await sync(
      session,
      feeder,
      syncPayload(
        feeder.boot,
        initialSequence + 1,
        appliedReport(2, interval),
        live,
      ),
    ),
    [next],
  );
  await session.ok("DROP TRIGGER t11_reject_hint ON realtime.messages;");
  assert.deepEqual(await counts(session, feeder), {
    observations: before.observations + 1,
    broadcasts: before.broadcasts,
  });
  const recovered = await snapshot(session, feeder);
  assert.equal(
    recovered.configuration.applied_snapshot.oxygen_report_interval_seconds,
    interval,
  );
  assert.equal(
    recovered.resources.do.latest.observation.sequence,
    initialSequence + 1,
  );
  assert.equal(
    recovered.resources.feed.latest.observation.sequence,
    initialSequence,
  );
  assert.ok(recovered.revisions.do > pending.revisions.do);
  return {
    failedSyncWrites: 0,
    lostHintObservationsRecovered: 1,
    fixtureHintFailures: 1,
  };
}

async function simulateViewers(session, viewers) {
  const run = async (eager) => {
    const started = performance.now();
    let calls = 0;
    for (const { feeder, installation } of viewers) {
      const args = [uuid(feeder.id), uuid(installation)];
      const state = await snapshot(session, feeder, installation);
      assert.equal(state.status, "ok");
      assert.equal(state.device_id, feeder.id);
      assert.equal(state.resources.do.latest.observation.boot_id, feeder.boot);
      calls++;
      if (eager) {
        const requests = [
          [
            "backend_metric_do_graph",
            [...args, uuid(randomUUID()), "'1h'", 12],
          ],
          ["backend_history_page", [...args, "null", "null", "'all'", "'all'"]],
          ["art33_read_configuration", args],
          ["art33_next_applied_occurrence", args],
        ];
        for (const [name, parameters] of requests) {
          assert.equal((await rpc(session, name, parameters)).status, "ok");
          calls++;
        }
      }
    }
    return {
      calls,
      wallMs: roundMs(performance.now() - started),
      unexpectedErrors: 0,
    };
  };
  return {
    logicalViewers: viewers.length,
    selectedFeeders: new Set(viewers.map(({ feeder }) => feeder.id)).size,
    physicalConnections: 1,
    eagerFiveResourceRefresh: await run(true),
    targetedOxygenRefresh: await run(false),
  };
}

async function explain(session, sql) {
  const result = await session.query(
    "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql,
  );
  assert.equal(result.state, "00000");
  const [report] = JSON.parse(result.rows.join("\n"));
  const planNodes = new Set();
  const indexes = new Set();
  const visit = (node) => {
    planNodes.add(node["Node Type"]);
    if (node["Index Name"]) indexes.add(node["Index Name"]);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(report.Plan);
  return {
    rows: report.Plan["Actual Rows"],
    planningMs: report["Planning Time"],
    executionMs: report["Execution Time"],
    nodeTypes: [...planNodes],
    indexes: [...indexes],
    sharedHitBlocks: report.Plan["Shared Hit Blocks"] ?? 0,
    sharedReadBlocks: report.Plan["Shared Read Blocks"] ?? 0,
  };
}

export async function runFiveFeederLoad({ databaseUrl, psqlPath = "psql" }) {
  const env = {
    ...isolatedConnection(databaseUrl),
    PGAPPNAME: "aquafeed-t11-" + randomUUID(),
  };
  const session = new PsqlSession(env, psqlPath);
  const feeders = intervals.map((interval) => ({
    id: randomUUID(),
    installation: randomUUID(),
    boot: randomUUID(),
    interval,
  }));
  const now = Date.now();
  let stage = "disposable provenance";
  try {
    await session.ok(
      "BEGIN; SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='3s';" +
        " SET LOCAL idle_in_transaction_session_timeout='20s';" +
        " DO $$ BEGIN IF current_database()<>'aquafeed_backend_test' OR current_user<>'postgres'" +
        " OR NOT EXISTS (SELECT 1 FROM backend_test.provenance p JOIN pg_database d ON d.oid=p.database_oid" +
        " WHERE p.singleton AND d.datname=current_database() AND p.migration_fixtures_created AND p.migration_fixtures_cleaned)" +
        " THEN RAISE EXCEPTION 'fresh disposable baseline required'; END IF; END $$;",
    );
    stage = "five feeder writes, replay and pagination";
    for (const feeder of feeders) await seedFeeder(session, feeder, now);
    stage = "cross-device reads and private topic isolation";
    for (const [index, feeder] of feeders.entries())
      await verifyMembership(
        session,
        feeder,
        feeders[(index + 1) % feeders.length],
      );
    stage = "configuration conflict, sync rollback and missed hint recovery";
    const fault = await exerciseEditAndFault(session, feeders[0], now);
    stage = "local query-plan capture";
    const first = feeders[0];
    const plans = {
      metricSnapshotRpc: await explain(
        session,
        "SELECT public.backend_metric_snapshot(" +
          [uuid(first.id), uuid(first.installation), uuid(randomUUID())].join(
            ",",
          ) +
          ")",
      ),
      representativeMetricHistoryLookup: await explain(
        session,
        "SELECT sample_sequence FROM public.device_metric_observations" +
          " WHERE device_id=" +
          uuid(first.id) +
          " AND metric='do' AND observed_at IS NOT NULL" +
          " ORDER BY observed_at DESC LIMIT 50",
      ),
    };
    assert.equal(plans.metricSnapshotRpc.rows, 1);
    assert.equal(plans.representativeMetricHistoryLookup.rows, 50);

    stage = "logical viewer workloads";
    const viewers = await createViewers(session, feeders);
    const scenarios = [];
    for (const count of viewerScenarios) {
      const result = await simulateViewers(session, viewers.slice(0, count));
      assert.equal(result.eagerFiveResourceRefresh.calls, count * 5);
      assert.equal(result.targetedOxygenRefresh.calls, count);
      scenarios.push(result);
    }

    stage = "membership revocation";
    await verifyRevocation(session, viewers[0]);

    stage = "durable fixture counts and lag";
    const perFeeder = [];
    for (const [index, feeder] of feeders.entries()) {
      const count = await counts(session, feeder);
      assert.equal(
        count.observations,
        historyBatchSize * historyBatches + 2 + (index === 0 ? 1 : 0),
      );
      perFeeder.push({
        feeder: index + 1,
        appliedIntervalSeconds: index === 0 ? updatedInterval : feeder.interval,
        ...count,
      });
    }
    const ids = feeders.map(({ id }) => uuid(id)).join(",");
    const [facts] = await session.ok(
      `SELECT jsonb_build_object(
        'physicalConnections',(SELECT count(*) FROM pg_stat_activity WHERE application_name=${quote(env.PGAPPNAME)}),
        'maximumLiveReceiptLagMs',(SELECT round(max(extract(epoch FROM received_at-observed_at)*1000),3)
          FROM public.device_metric_observations WHERE device_id IN (${ids}) AND first_live_sequence IS NOT NULL),
        'backlogReceiptLagSeconds',(SELECT round(min(extract(epoch FROM received_at-observed_at)),3)
          FROM public.device_metric_observations WHERE device_id IN (${ids}) AND first_live_sequence IS NULL));`,
    );
    assert.equal(facts.physicalConnections, 1);
    assert.ok(facts.maximumLiveReceiptLagMs >= 0);
    assert.ok(facts.backlogReceiptLagSeconds > 60);

    stage = "rollback verification";
    await session.ok("SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;");
    const installations = [...feeders, ...viewers]
      .map(({ installation }) => uuid(installation))
      .join(",");
    const topics = feeders.map(({ id }) => topic(id)).join(",");
    const [remaining] = await session.ok(
      `SELECT jsonb_build_object(
         'devices',(SELECT count(*) FROM public.devices WHERE device_id IN (${ids})),
         'installations',(SELECT count(*) FROM auth.users WHERE id IN (${installations})),
         'messages',(SELECT count(*) FROM realtime.messages WHERE topic IN (${topics})));
      `,
    );
    assert.deepEqual(remaining, { devices: 0, installations: 0, messages: 0 });
    return {
      status: "PASS",
      workload:
        "distinct synthetic viewer installations, one sequential PostgreSQL session and one refresh wave per mode; eager runs first",
      broadcast: "SQL fixture publisher inserts, not native socket deliveries",
      configuredIntervalsSeconds: intervals,
      plans,
      scenarios,
      perFeeder,
      facts: {
        ...facts,
        observations: perFeeder.reduce(
          (total, feeder) => total + feeder.observations,
          0,
        ),
        fixtureBroadcasts: perFeeder.reduce(
          (total, feeder) => total + feeder.broadcasts,
          0,
        ),
        verifiedAcknowledgements:
          feeders.length * (2 + (historyBatches + 1) * historyBatchSize) + 1,
      },
      fault: { ...fault, revokedViewerDenied: 1 },
    };
  } catch {
    throw new Error(
      "Five-feeder workload failed at " +
        stage +
        " (SQLSTATE " +
        (session.lastState ?? "unknown") +
        ").",
    );
  } finally {
    await session.close();
  }
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
      "Usage: node supabase/tests/backend_five_feeder_load.mjs --database-url-env VARIABLE",
    );
    process.exitCode = 1;
  } else {
    runFiveFeederLoad({
      databaseUrl: process.env[variable],
      psqlPath: process.env.PSQL_PATH,
    })
      .then((summary) => console.log(JSON.stringify(summary, null, 2)))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
