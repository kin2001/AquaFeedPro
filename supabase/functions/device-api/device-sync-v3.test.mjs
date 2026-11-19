import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const indexUrl = new URL("./index.ts", import.meta.url);
const source = readFileSync(indexUrl, "utf8");

function extractFunction(src, name) {
  const pattern = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`);
  const match = pattern.exec(src);
  if (!match) throw new Error(`${name} not defined`);
  const braceStart = src.indexOf("{", match.index);
  if (braceStart < 0) throw new Error(`${name} not defined`);
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let j = braceStart; j < src.length; j++) {
    const ch = src[j];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(match.index, j + 1);
    }
  }
  throw new Error(`${name} not defined`);
}

function extractConstArray(src, name) {
  const pattern = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=`);
  const match = pattern.exec(src);
  if (!match) throw new Error(`${name} not defined`);
  const bracketStart = src.indexOf("[", match.index);
  const semi = src.indexOf(";", bracketStart);
  return src.slice(match.index, semi + 1);
}

// RED gate: throws "buildDeviceSyncPayload not defined" before implementation.
const runKeysSrc = extractConstArray(source, "RUN_EVENT_KEYS");
const normalizedSrc = extractFunction(source, "normalizedRunEvent");
const buildSrc = extractFunction(source, "buildDeviceSyncPayload");
const mapSrc = extractFunction(source, "mapSyncError");

function stubRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

// Load production TS through Node's type stripping so annotations,
// `as` casts and `!` assertions work. Fake RPC ports only: no DB,
// no network, no secrets, no Deno.
const helperPath = join(tmpdir(), `v3-helpers-${Date.now()}.ts`);
writeFileSync(
  helperPath,
  `export function record(value: unknown) {\n  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;\n}\n${runKeysSrc}\n${normalizedSrc}\n${buildSrc}\n${mapSrc}\nexport { normalizedRunEvent };\n`,
  "utf8",
);
let helpers;
try {
  helpers = await import(pathToFileURL(helperPath).href);
} finally {
  try {
    unlinkSync(helperPath);
  } catch {}
}
const { normalizedRunEvent, buildDeviceSyncPayload, mapSyncError } = helpers;
assert.equal(typeof stubRecord({}), "object");

// --- structural cutover: one atomic RPC, lossless batches only ---
assert.ok(
  source.includes("backend_sync_device"),
  "edge routes through backend_sync_device",
);
for (const legacy of [
  "art27_sync_telemetry",
  "backend_sync_metrics",
  "art33_device_configuration_report",
  "backend_device_configuration_report",
  "art33_record_scheduled_events",
  "art31_sync_manual_feed",
]) {
  assert.ok(
    !source.includes(`"${legacy}"`),
    `legacy RPC ${legacy} is gone from edge`,
  );
}
assert.ok(source.includes("scheduled_events_json"), "projects scheduled batch");
assert.ok(source.includes("manual_events_json"), "projects manual batch");
assert.ok(source.includes("event_keys"), "projects event_keys");

// --- fixture ---
const boot = "11111111-1111-4111-8111-111111111111";
const seqA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const seqB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function baseEvent(overrides) {
  return {
    sequence_id: seqA,
    event_sequence: 1,
    event_type: "completed",
    outcome_status: "completed",
    source: "manual",
    device_at: "2026-11-14T01:00:00Z",
    time_quality: "synced",
    command_id: seqB,
    schedule_id: null,
    configuration_revision: null,
    occurrence_local_date: null,
    requested_dose: { mode: "grams", amount_g: 5 },
    estimated_dispensed_g: 5,
    measured_dispensed_g: 5,
    measurement_quality: "valid",
    reason_code: null,
    maintenance_resolution: null,
    lockout_cleared: false,
    nozzle_number: 1,
    step_index: 1,
    ...overrides,
  };
}
const scheduledFish = baseEvent({
  source: "scheduled",
  command_id: null,
  schedule_id: seqB,
  configuration_revision: 3,
  occurrence_local_date: "2026-11-14",
  reason_code: "🐟 valid",
});
const manualEvent = baseEvent({});
const body = {
  protocol_major: 2,
  request_id: "22222222-2222-4222-8222-222222222222",
  boot_id: boot,
  live_sequence: 7,
  firmware_version: "9.9.9",
  capabilities_revision: 4,
  clock: { quality: "synced", uncertainty_ms: 10 },
  actuator: { state: "idle", active_sequence_id: null, fault_code: "E99" },
  configuration: {
    applied_revision: 1,
    last_attempt_revision: null,
    last_attempt_status: null,
    error_code: null,
  },
  latest_sample: null,
  backlog_samples: [],
  events: [scheduledFish, manualEvent],
};

// --- buildDeviceSyncPayload: lossless projection, omissions, no coercion ---
const { p_sync } = buildDeviceSyncPayload(body);
assert.equal(typeof p_sync, "object");
assert.ok(!("events" in p_sync), "forbid full events");
assert.ok(!("firmware_version" in p_sync), "omit firmware_version");
assert.equal(p_sync.actuator.fault_code, undefined, "omit actuator.fault_code");
assert.deepEqual(
  Object.keys(p_sync).sort(),
  [
    "actuator",
    "backlog_samples",
    "boot_id",
    "capabilities_revision",
    "clock",
    "configuration",
    "event_keys",
    "latest_sample",
    "live_sequence",
    "manual_events_json",
    "protocol_major",
    "request_id",
    "scheduled_events_json",
  ].sort(),
  "p_sync carries only the v3 DTO",
);
assert.equal(p_sync.request_id, body.request_id, "preserve request id verbatim");
assert.deepEqual(p_sync.actuator, {
  state: "idle",
  active_sequence_id: null,
});
assert.equal(p_sync.event_keys.length, 2);
for (const key of p_sync.event_keys) {
  assert.deepEqual(
    Object.keys(key).sort(),
    [
      "source",
      "sequence_id",
      "event_sequence",
      "schedule_id",
      "configuration_revision",
      "occurrence_local_date",
      "nozzle_number",
      "step_index",
    ].sort(),
    "event_keys are closed 8-key objects",
  );
}
assert.equal(p_sync.event_keys[0].source, "scheduled");
assert.equal(p_sync.event_keys[1].source, "manual");
// verbatim: no case folding, no coercion
const upper = baseEvent({ sequence_id: seqA.toUpperCase() });
const { p_sync: upperSync } = buildDeviceSyncPayload({ ...body, events: [upper] });
assert.equal(
  upperSync.event_keys[0].sequence_id,
  seqA.toUpperCase(),
  "never coerce payload strings",
);
const scheduledBatch = JSON.parse(p_sync.scheduled_events_json);
const manualBatch = JSON.parse(p_sync.manual_events_json);
assert.equal(scheduledBatch.length, 1);
assert.equal(manualBatch.length, 1);
assert.equal(scheduledBatch[0].reason_code, "🐟 valid");
assert.deepEqual(
  scheduledBatch[0],
  normalizedRunEvent(scheduledFish),
  "scheduled batch is the normalized family",
);
assert.deepEqual(
  manualBatch[0],
  normalizedRunEvent(manualEvent),
  "manual batch is the normalized family",
);
// empty families stay canonical "[]"
const { p_sync: emptySync } = buildDeviceSyncPayload({ ...body, events: [] });
assert.equal(emptySync.scheduled_events_json, "[]");
assert.equal(emptySync.manual_events_json, "[]");
assert.deepEqual(emptySync.event_keys, []);
// metric passthrough keeps the extra key verbatim
const metricBody = {
  ...body,
  metric_telemetry: { live: { do: null, feed: null }, backlog: [] },
};
const { p_sync: metricSync } = buildDeviceSyncPayload(metricBody);
assert.deepEqual(metricSync.metric_telemetry, metricBody.metric_telemetry);

// --- unicode: NUL + lone surrogate double-escape, fish unchanged ---
const nulEvent = baseEvent({ reason_code: "\u0000" });
const loneEvent = baseEvent({ reason_code: "lone \uD800 surrogate" });
const { p_sync: uniSync } = buildDeviceSyncPayload({
  ...body,
  events: [nulEvent, loneEvent, scheduledFish],
});
assert.ok(
  uniSync.scheduled_events_json.includes("🐟"),
  "valid fish stays unescaped",
);
assert.ok(
  uniSync.manual_events_json.includes("\\u0000"),
  "NUL projects to ASCII escape inside the batch text",
);
assert.ok(
  uniSync.manual_events_json.includes("\\ud800") ||
    uniSync.manual_events_json.includes("\\uD800"),
  "lone surrogate projects to ASCII escape inside the batch text",
);
const outer = JSON.stringify(uniSync);
assert.ok(
  outer.includes("\\\\u0000"),
  "inner NUL escape arrives double-escaped in outer JSON",
);
const roundTrip = JSON.parse(uniSync.manual_events_json);
assert.equal(roundTrip[0].reason_code, "\u0000");
assert.equal(roundTrip[1].reason_code, "lone \uD800 surrogate");
assert.equal(JSON.parse(uniSync.scheduled_events_json)[0].reason_code, "🐟 valid");
// combining marks, U+2028, literal backslash-u, sub-ms, +00:00 stay exact
const tricky = baseEvent({
  reason_code: "é \\u1234",
  device_at: "2026-11-14T01:00:00.123456789+00:00",
});
const { p_sync: trickySync } = buildDeviceSyncPayload({
  ...body,
  events: [tricky],
});
assert.equal(JSON.parse(trickySync.manual_events_json)[0].reason_code, "é \\u1234");
assert.equal(
  JSON.parse(trickySync.manual_events_json)[0].device_at,
  "2026-11-14T01:00:00.123456789+00:00",
);

// --- mapSyncError: preserve 409/422, stage 503 copies with retry flags ---
assert.deepEqual(mapSyncError("23505"), {
  status: 409,
  code: "IDEMPOTENCY_CONFLICT",
  message: "A device event identity was reused with different content.",
  retryable: false,
});
assert.equal(mapSyncError("22023").status, 422);
assert.deepEqual(mapSyncError("P8A01"), {
  status: 401,
  code: "AUTH_REQUIRED",
  message: "A valid device credential is required.",
  retryable: false,
});
assert.deepEqual(mapSyncError("P8C01"), {
  status: 409,
  code: "CONFIG_CONFLICT",
  message: "The configuration acknowledgement is stale.",
  retryable: false,
});
assert.deepEqual(mapSyncError("P8S01"), {
  status: 409,
  code: "DEVICE_BUSY",
  message: "A scheduled sequence collided with an active device operation.",
  retryable: false,
});
assert.equal(mapSyncError("P8S02").status, 422);
// decode failures map to existing stage-specific retryable 503 copies
assert.deepEqual(mapSyncError("P8D01"), {
  status: 503,
  code: "SERVICE_UNAVAILABLE",
  message: "Scheduled feeding history could not be safely recorded.",
  retryable: true,
});
assert.deepEqual(mapSyncError("P8D02"), {
  status: 503,
  code: "SERVICE_UNAVAILABLE",
  message: "Device sync could not be safely recorded.",
  retryable: true,
});
assert.deepEqual(mapSyncError("P8C02"), {
  status: 503,
  code: "SERVICE_UNAVAILABLE",
  message: "The device configuration could not be safely acknowledged.",
  retryable: true,
});
// priority: earlier stages never surface as decode codes
assert.notEqual(mapSyncError("23505").code, "SERVICE_UNAVAILABLE");
assert.equal(mapSyncError("P8T01").retryable, true);
assert.ok(
  mapSyncError("P8T01").message.includes("telemetry"),
  "telemetry copy keeps its message",
);
// unknown / output failures stay retryable 503 without leaking internals
assert.deepEqual(mapSyncError("P8O01").retryable, true);
assert.equal(mapSyncError("P8O01").status, 503);
assert.equal(mapSyncError("XX_UNKNOWN").status, 503);

console.log("PASS device sync v3 edge cutover (fake RPC ports only)");
