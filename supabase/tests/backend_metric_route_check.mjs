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
    if (name === "art33_device_configuration_report") return { data: { status: "ok", desired_configuration: null }, error: null };
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
async function invoke(body, expected, code, headers = {}) {
  calls = [];
  const response = await handler(new Request("https://offline.invalid/device-api/v2/sync", { method: "POST", headers: { authorization: "Bearer sanitized-device-fixture", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  if (code) assert.equal(result.error.code, code);
  if (expected !== 200 && !rpcError && ackOverride === undefined) assert.equal(calls.some(({ name }) => name !== "art38_authenticate_device"), false, "reject whole sync before any business RPC");
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
console.log("PASS actual metric sync handler: verified profile, whole payload, byte/count caps, ACK identity, RPC errors, no command retry, legacy compatibility (offline client only; no SQL proof)");
