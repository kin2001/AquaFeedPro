// Actual handler and shared validators; only the network client is substituted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const device = "22222222-2222-4222-8222-222222222222";
const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/examples/v2/metric-280-sync-valid.json", import.meta.url)));
let handler;
let profile = { capabilities_revision: 1, capabilities: { independent_telemetry_v1: true, feed_capacity_g: 20000 } };
let profileError = null;
let rpcError = null;
let ackOverride;
let desiredConfiguration = null;
let calls = [];
const client = {
  from(table) {
    assert.equal(table, "devices");
    return {
      select(columns) {
        assert.equal(columns, "capabilities,capabilities_revision");
        return { eq(column, id) {
          assert.equal(column, "device_id"); assert.equal(id, device);
          return { async single() { return { data: profile, error: profileError }; } };
        } };
      },
    };
  },
  async rpc(name, args) {
    calls.push({ name, args });
    if (name === "art38_authenticate_device") return { data: device, error: null };
    if (name === "backend_sync_metrics") {
      if (rpcError) return { data: null, error: { code: rpcError } };
      const envelope = args.p_metric_telemetry;
      const observations = [...Object.values(envelope.live).filter(Boolean), ...envelope.backlog];
      return { data: { status: "ok", acknowledged_metrics: ackOverride ?? observations.map(({ metric, boot_id, sequence }) => ({ metric, boot_id, sequence })), revisions: { do: 1, feed: 1, history: 1, contact: 1 } }, error: null };
    }
    if (name === "art27_sync_telemetry") return { data: { status: "ok", acknowledged_samples: [] }, error: null };
    if (name === "art33_device_configuration_report") return { data: { status: "ok", desired_configuration: desiredConfiguration }, error: null };
    if (name === "art31_sync_manual_feed") return { data: { status: "ok", server_time: "2026-11-13T01:00:03Z", acknowledged_events: [], command: null, next_sync_after_ms: 30000 }, error: null };
    assert.fail(`unexpected RPC ${name}`);
  },
};
globalThis.__metricClient = client;
globalThis.Deno = { env: { get: () => "offline-placeholder" }, serve(value) { handler = value; } };
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("npm:@supabase/supabase-js@")) return { url: "offline:metric-client", shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === "offline:metric-client") return { format: "module", shortCircuit: true, source: "export const createClient = () => globalThis.__metricClient;" };
  return next(url, context);
} });
await import("../functions/device-api/index.ts");
assert.equal(typeof handler, "function");
async function invoke(body, expected, code, headers = {}, rejectBeforeBusiness = true) {
  calls = [];
  const response = await handler(new Request("https://offline.invalid/device-api/v2/sync", { method: "POST", headers: { authorization: "Bearer sanitized-device-fixture", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  if (code) assert.equal(result.error.code, code);
  if (rejectBeforeBusiness && expected !== 200 && !rpcError && ackOverride === undefined) assert.equal(calls.some(({ name }) => name !== "art38_authenticate_device"), false, "reject whole sync before any business RPC");
  return result;
}
const result = await invoke(fixture, 200);
assert.equal(result.acknowledged_metrics.length, 2, "metric-qualified ACKs returned");
assert.deepEqual(result.acknowledged_samples, []);
assert.equal(calls.filter(({ name }) => name === "backend_sync_metrics").length, 1);
assert.equal(calls.some(({ name }) => name === "art27_sync_telemetry"), false);
assert.equal(calls.find(({ name }) => name === "backend_sync_metrics").args.p_device_id, device);
assert.equal(calls.filter(({ name }) => name === "art31_sync_manual_feed").length, 1, "no command retry");

for (const capabilities of [{}, { independent_telemetry_v1: false }, { independent_telemetry_v1: "true" }]) {
  profile = { ...profile, capabilities };
  await invoke(fixture, 422, "CAPABILITY_MISMATCH", { "x-contract-version": "2.8.0", "x-independent-telemetry": "true" });
}
profile = { capabilities_revision: 1, capabilities: { independent_telemetry_v1: true, feed_capacity_g: 20000 } };
const missingInterval = { ...fixture.configuration };
delete missingInterval.oxygen_report_interval_seconds;
await invoke({ ...fixture, configuration: missingInterval }, 422, "VALIDATION_FAILED");
for (const patch of [
  { latest_sample: {} }, { backlog_samples: [{}] }, { actuator: { state: "idle", active_sequence_id: fixture.boot_id, fault_code: null } },
  { events: [{}] }, { capabilities_revision: 2 }, { clock: { quality: "synced", uncertainty_ms: "0" } },
  { metric_telemetry: { ...fixture.metric_telemetry, live: { ...fixture.metric_telemetry.live, do: { ...fixture.metric_telemetry.live.do, sequence: 99 } } } },
  { metric_telemetry: { ...fixture.metric_telemetry, backlog: Array.from({ length: 99 }, (_, sequence) => ({ ...fixture.metric_telemetry.live.do, sequence })) } },
  { configuration: { ...fixture.configuration, oxygen_report_interval_seconds: 28800 } },
]) await invoke({ ...fixture, ...patch }, 422);
// Values over capacity are accepted for durable RPC error normalization, not silently clamped.
await invoke({ ...fixture, metric_telemetry: { ...fixture.metric_telemetry, live: { do: null, feed: { ...fixture.metric_telemetry.live.feed, feed_remaining_g: 21000 } } } }, 200);
profileError = { code: "offline" };
await invoke(fixture, 503, "SERVICE_UNAVAILABLE");
profileError = null;
for (const capacity of ["20000", -1, 0]) {
  profile.capabilities.feed_capacity_g = capacity;
  await invoke(fixture, 503, "SERVICE_UNAVAILABLE");
}
profile.capabilities.feed_capacity_g = 20000;
await invoke({ ...fixture, firmware_version: "x".repeat(262144) }, 413, "PAYLOAD_TOO_LARGE");
for (const [sqlstate, status, code] of [["23505", 409, "IDEMPOTENCY_CONFLICT"], ["22023", 422, "VALIDATION_FAILED"], ["XX000", 503, "SERVICE_UNAVAILABLE"]]) {
  rpcError = sqlstate;
  await invoke(fixture, status, code);
  assert.equal(calls.filter(({ name }) => name === "backend_sync_metrics").length, 1);
  assert.equal(calls.some(({ name }) => name === "art31_sync_manual_feed"), false);
}
rpcError = null;
for (const invalidAcks of [
  [{ metric: "do", boot_id: fixture.boot_id, sequence: 999 }],
  [{ metric: "do", boot_id: fixture.boot_id, sequence: "100" }, { metric: "feed", boot_id: fixture.boot_id, sequence: 100 }],
  [{ metric: "do", boot_id: fixture.boot_id, sequence: 100 }, { metric: "do", boot_id: fixture.boot_id, sequence: 100 }],
  [{ metric: "do", boot_id: fixture.boot_id, sequence: 100, extra: true }, { metric: "feed", boot_id: fixture.boot_id, sequence: 100 }],
]) {
  ackOverride = invalidAcks;
  await invoke(fixture, 503, "SERVICE_UNAVAILABLE");
  assert.equal(calls.some(({ name }) => name === "art31_sync_manual_feed"), false, "bad telemetry ACK prevents command delivery");
}
ackOverride = undefined;
const legacy = { ...fixture, configuration: { ...fixture.configuration } };
delete legacy.metric_telemetry;
delete legacy.configuration.oxygen_report_interval_seconds;
const old = await invoke(legacy, 200);
assert.equal(Object.hasOwn(old, "acknowledged_metrics"), false, "legacy response unchanged");
assert.equal(calls.some(({ name }) => name === "art27_sync_telemetry"), true);

// F1: pending legacy producer output must be projected to the negotiated null-key shape.
const pending = { revision: 1, based_on_revision: 0, timezone: "Asia/Manila", monitoring_limits: { do_low_mg_l: 4, do_high_mg_l: 8 }, low_feed_threshold_pct: 20, schedules: [] };
const definitions = JSON.parse(readFileSync(new URL("../../contracts/schemas/v2.schema.json", import.meta.url))).$defs;
for (const snapshot of [pending, { ...pending, oxygen_report_interval_seconds: null }]) {
  desiredConfiguration = snapshot;
  const response = await invoke(fixture, 200);
  assert.deepEqual(response.desired_configuration, { ...pending, oxygen_report_interval_seconds: null });
  for (const key of definitions.ConfigurationValues280.required) assert.ok(Object.hasOwn(response.desired_configuration, key), `negotiated required configuration key ${key}`);
  assert.equal(calls.filter(({ name }) => name === "art31_sync_manual_feed").length, 1);
}
assert.equal(Object.hasOwn(pending, "oxygen_report_interval_seconds"), false, "projection cannot mutate stored producer result");
desiredConfiguration = pending;
assert.deepEqual((await invoke(legacy, 200)).desired_configuration, pending, "legacy response remains exactly legacy-shaped");
for (const unsupported of [15, 28800, "30", false, []]) {
  desiredConfiguration = { ...pending, oxygen_report_interval_seconds: unsupported };
  await invoke(fixture, 503, "SERVICE_UNAVAILABLE", {}, false);
}
desiredConfiguration = { ...pending, oxygen_report_interval_seconds: null };
await invoke(legacy, 503, "SERVICE_UNAVAILABLE", {}, false);
desiredConfiguration = null;
assert.equal((await invoke(fixture, 200)).desired_configuration, null);

// F2: reject malformed enum types on both callers before *any* business RPC.
const runEvent = JSON.parse(readFileSync(new URL("../../contracts/fixtures/examples/v2/sync-replay-records-valid.json", import.meta.url))).events[0];
for (const body of [fixture, legacy]) {
  await invoke({ ...body, events: [runEvent] }, 200);
  for (const field of ["event_type", "outcome_status", "time_quality", "measurement_quality"]) {
    const event = { ...runEvent, [field]: [runEvent[field]] };
    if (field === "measurement_quality") {
      event[field] = ["unavailable"];
      event.measured_dispensed_g = null;
    }
    await invoke({ ...body, events: [event] }, 422, "VALIDATION_FAILED");
  }
  for (const malformed of [
    { clock: { quality: ["synced"], uncertainty_ms: 0 } },
    { actuator: { state: ["idle"], active_sequence_id: null, fault_code: null } },
    { configuration: { ...body.configuration, applied_revision: 1, last_attempt_revision: 1, last_attempt_status: ["applied"] } },
  ]) await invoke({ ...body, ...malformed }, 422, "VALIDATION_FAILED");
}
// Inherited open-envelope compatibility: trace fields must never reach RPC business args.
const legacyJournal = JSON.parse(readFileSync(new URL("../../contracts/fixtures/examples/v2/sync-replay-records-valid.json", import.meta.url)));
const cleanLegacy = { ...legacy, latest_sample: { ...legacyJournal.latest_sample, sequence: legacy.live_sequence }, backlog_samples: legacyJournal.backlog_samples, events: [runEvent] };
const traceOpen = body => ({ ...body, tracking_hint: "ignored", clock: { ...body.clock, tracking_hint: "ignored" }, actuator: { ...body.actuator, tracking_hint: "ignored" }, configuration: { ...body.configuration, tracking_hint: "ignored" }, latest_sample: body.latest_sample === null ? null : { ...body.latest_sample, tracking_hint: "ignored" }, backlog_samples: body.backlog_samples.map(sample => ({ ...sample, tracking_hint: "ignored" })), events: body.events.map(event => ({ ...event, tracking_hint: "ignored", requested_dose: { ...event.requested_dose, label: "ignored" }, maintenance_resolution: event.maintenance_resolution === null ? null : { ...event.maintenance_resolution, tracking_hint: "ignored" } })) });
const maintenance = { ...runEvent, event_type: "maintenance_acknowledged", outcome_status: "unknown", measured_dispensed_g: null, measurement_quality: "unavailable", estimated_dispensed_g: null, lockout_cleared: true, maintenance_resolution: { resolution_at: runEvent.device_at, resolution_reason: "Synthetic fixture check" } };
for (const clean of [cleanLegacy, { ...fixture, events: [runEvent] }, { ...cleanLegacy, events: [maintenance] }]) {
  await invoke(clean, 200);
  const cleanCalls = JSON.parse(JSON.stringify(calls));
  await invoke(traceOpen(clean), 200);
  assert.deepEqual(calls, cleanCalls, "additive facts never change telemetry/config/feed RPC args or their order");
}
for (const patch of [
  { operation: "dispense" },
  { latest_sample: { ...cleanLegacy.latest_sample, sequence: "100" } },
  { events: [{ ...maintenance, maintenance_resolution: { ...maintenance.maintenance_resolution, resolution_reason: 42 } }] },
  { backlog_samples: [{ ...cleanLegacy.backlog_samples[0], do_quality: ["valid"] }] },
  { events: [{ ...runEvent, nozzle_number: 3 }] },
  { events: [{ ...runEvent, requested_dose: { ...runEvent.requested_dose, fixed_portion_id: "contradictory" } }] },
  { configuration: { ...legacy.configuration, oxygen_report_interval_seconds: null } },
  { latest_sample: { ...cleanLegacy.latest_sample, captured_at: null } },
]) await invoke({ ...traceOpen(cleanLegacy), ...patch }, 422, "VALIDATION_FAILED");
for (const envelope of [
  { ...fixture.metric_telemetry, tracking_hint: "closed" },
  { ...fixture.metric_telemetry, live: { ...fixture.metric_telemetry.live, tracking_hint: null } },
  { ...fixture.metric_telemetry, live: { ...fixture.metric_telemetry.live, do: { ...fixture.metric_telemetry.live.do, tracking_hint: "closed" } } },
]) await invoke({ ...traceOpen(fixture), metric_telemetry: envelope }, 422, "VALIDATION_FAILED");
const continuation = JSON.parse(readFileSync(new URL("../../contracts/fixtures/examples/v2/run-event-continuation-valid.json", import.meta.url)));
await invoke({ ...fixture, events: [continuation] }, 200);
await invoke({ ...fixture, events: [{ ...continuation, continuation_evidence: { ...continuation.continuation_evidence, tracking_hint: "closed" } }] }, 422, "VALIDATION_FAILED");
console.log("PASS actual metric sync handler: verified profile, whole payload, byte/count caps, ACK identity, RPC errors, no command retry, legacy compatibility (offline client only; no SQL proof)");
