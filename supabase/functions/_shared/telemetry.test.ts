import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as telemetry from "./telemetry.ts";

// Removing capability, identity, quality, or count checks must break these cases.
const fixtures = new URL("../../../contracts/fixtures/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", fixtures), "utf8"),
);
const api = telemetry as Record<string, (...args: unknown[]) => unknown>;
assert.equal(
  typeof api.validMetricObservation,
  "function",
  "independent observation validator is implemented",
);
assert.equal(
  typeof api.validOxygenReportInterval,
  "function",
  "interval validator is implemented",
);
for (const entry of manifest.fixtures.filter(
  (entry: { name: string }) =>
    entry.name.startsWith("metric-280-") ||
    entry.name.startsWith("interval-280-"),
)) {
  const value = JSON.parse(readFileSync(new URL(entry.file, fixtures), "utf8"));
  const validate =
    entry.schema === "MetricObservation"
      ? api.validMetricObservation
      : api.validOxygenReportInterval;
  if (
    entry.schema === "MetricObservation" ||
    entry.schema === "OxygenReportInterval"
  ) {
    assert.equal(validate(value), entry.expect === "valid", entry.name);
  } else if (entry.schema === "MetricReadObservation") {
    assert.equal(
      api.validMetricReadObservation(value),
      entry.expect === "valid",
      entry.name,
    );
  } else if (entry.schema === "MetricSnapshot") {
    assert.equal(
      Object.entries(value.resources).every(
        ([metric, resource]) =>
          api.validMetricResource(resource) &&
          (!(resource as { latest?: { observation: { metric: string } } })
            .latest ||
            (resource as { latest: { observation: { metric: string } } }).latest
              .observation.metric === metric),
      ),
      entry.expect === "valid",
      entry.name,
    );
  } else if (entry.schema === "MetricTelemetry") {
    assert.equal(
      api.validMetricTelemetryBatch(
        "11111111-1111-4111-8111-111111111111",
        100,
        value,
      ),
      entry.expect === "valid",
      entry.name,
    );
  } else if (entry.schema === "DeviceSyncRequest280") {
    assert.equal(
      api.validSyncTelemetry(value, { independent_telemetry_v1: true }),
      entry.expect === "valid",
      entry.name,
    );
  }
}
for (const value of [
  NaN,
  Infinity,
  -Infinity,
  undefined,
  null,
  true,
  "30",
  {},
  [],
]) {
  assert.equal(
    api.validOxygenReportInterval(value),
    false,
    `reject interval ${String(value)}`,
  );
}
const boot = "11111111-1111-4111-8111-111111111111";
const observation = {
  metric: "do",
  boot_id: boot,
  sequence: 100,
  measured_at: "2026-11-13T01:00:00Z",
  captured_at: "2026-11-13T01:00:01Z",
  time_quality: "synced",
  quality: "valid",
  do_mg_l: 5.8,
  feed_remaining_g: null,
  feed_percent: null,
  calibration_revision: null,
};
const readObservation = {
  observation,
  stable_identity: `metric:do:${boot}:100`,
  observed_at: observation.measured_at,
  time_basis: "measured",
  received_at: observation.captured_at,
};
assert.equal(api.validMetricReadObservation(readObservation), true);
for (const basis of ["measured", "captured", "unknown"]) {
  for (const quality of ["valid", "error", "unavailable", "uncalibrated"]) {
    const latest = {
      ...readObservation,
      observation: {
        ...observation,
        quality,
        do_mg_l: quality === "valid" ? 5.8 : null,
      },
      time_basis: basis,
      observed_at:
        basis === "unknown"
          ? null
          : basis === "measured"
            ? observation.measured_at
            : observation.captured_at,
    };
    const resource = {
      latest,
      quality,
      time_basis: basis,
      age_seconds: basis === "unknown" ? null : 3,
    };
    assert.equal(
      api.validMetricResource(resource),
      true,
      `${basis}/${quality} agreeing summary`,
    );
    assert.equal(
      api.validMetricResource({
        ...resource,
        quality: quality === "valid" ? "error" : "valid",
      }),
      false,
    );
    assert.equal(
      api.validMetricResource({
        ...resource,
        time_basis: basis === "unknown" ? "measured" : "unknown",
      }),
      false,
    );
    if (basis === "unknown")
      assert.equal(
        api.validMetricResource({ ...resource, age_seconds: 1 }),
        false,
      );
  }
}
assert.equal(
  api.validMetricResource({
    latest: null,
    quality: "unavailable",
    time_basis: "unknown",
    age_seconds: null,
  }),
  true,
);
assert.equal(
  api.validMetricResource({
    latest: null,
    quality: "valid",
    time_basis: "unknown",
    age_seconds: null,
  }),
  false,
);
assert.equal(
  api.validMetricReadObservation({
    ...readObservation,
    observed_at: "2026-11-13T01:00:00.000000Z",
  }),
  true,
  "equivalent precision is the same instant",
);
assert.equal(
  api.validMetricReadObservation({
    ...readObservation,
    observed_at: "2026-11-13T01:00:00.000001Z",
  }),
  false,
  "do not truncate clock equality to milliseconds",
);
const envelope = {
  live: { do: observation, feed: null },
  backlog: [] as unknown[],
};
assert.equal(api.validMetricTelemetryBatch(boot, 100, envelope), true);
assert.equal(
  api.validMetricObservation({ ...observation, sequence: 101 }),
  true,
  "same value new identity is valid",
);
for (const key of Object.keys(observation)) {
  const missing = { ...observation } as Record<string, unknown>;
  delete missing[key];
  assert.equal(api.validMetricObservation(missing), false, `required ${key}`);
}
for (const patch of [
  { do_mg_l: NaN },
  { sequence: -1 },
  { sequence: 1.5 },
  { sequence: Number.MAX_SAFE_INTEGER + 1 },
  { measured_at: "2026-02-30T00:00:00Z" },
  { captured_at: "2026-11-13T01:00:00+00:00" },
  { quality: "error" },
  { calibration_revision: 2 },
  { feed_percent: 20 },
  { extra: true },
])
  assert.equal(
    api.validMetricObservation({ ...observation, ...patch }),
    false,
    JSON.stringify(patch),
  );
const backlog = Array.from({ length: 99 }, (_, sequence) => ({
  ...observation,
  sequence,
}));
assert.equal(
  api.validMetricTelemetryBatch(boot, 100, { ...envelope, backlog }),
  true,
  "100 total",
);
assert.equal(
  api.validMetricTelemetryBatch(boot, 100, {
    ...envelope,
    backlog: [...backlog, { ...observation, sequence: 101 }],
  }),
  false,
  "101 total",
);
assert.equal(
  api.validMetricTelemetryBatch(boot, 101, envelope),
  false,
  "bind live sequence",
);
assert.equal(
  api.validMetricTelemetryBatch(
    "22222222-2222-4222-8222-222222222222",
    100,
    envelope,
  ),
  false,
  "bind live boot",
);
assert.equal(
  api.validMetricTelemetryBatch(boot, 100, {
    live: { do: null, feed: observation },
    backlog: [],
  }),
  false,
  "bind live metric",
);
assert.equal(
  api.validMetricTelemetryBatch(boot, 100, {
    ...envelope,
    backlog: [{ ...observation, measured_at: "2026-11-13T02:00:00Z" }],
  }),
  false,
  "same identity cannot relabel cached time within a batch",
);
assert.equal(
  api.validMetricTelemetryBatch(boot, 100, {
    live: { do: null, feed: null },
    backlog: [
      { ...observation, sequence: 1 },
      { ...observation, sequence: 2 },
    ],
  }),
  true,
  "do not dedup values",
);
assert.equal(
  api.validMetricTelemetryBatch(boot, 100, {
    live: { do: null, feed: null },
    backlog: [],
  }),
  true,
  "absent observations do not claim a sensor error",
);
const body = {
  boot_id: boot,
  live_sequence: 100,
  latest_sample: null,
  backlog_samples: [],
  metric_telemetry: envelope,
};
assert.equal(
  api.validSyncTelemetry(body, { independent_telemetry_v1: true }),
  true,
);
for (const capabilities of [
  {},
  { independent_telemetry_v1: false },
  { independent_telemetry_v1: "true" },
  null,
]) {
  assert.equal(
    api.validSyncTelemetry(body, capabilities),
    false,
    "only verified true capability enables envelope",
  );
}
assert.equal(
  api.validSyncTelemetry(
    { ...body, latest_sample: {} },
    { independent_telemetry_v1: true },
  ),
  false,
);
assert.equal(
  api.validSyncTelemetry(
    { ...body, backlog_samples: [{}] },
    { independent_telemetry_v1: true },
  ),
  false,
);
const legacy = JSON.parse(
  readFileSync(
    new URL("examples/v2/sync-invalid-clock-valid.json", fixtures),
    "utf8",
  ),
);
assert.equal(api.validSyncTelemetry(legacy, {}), true, "old device unchanged");
assert.equal(
  api.validSyncTelemetry(legacy, { independent_telemetry_v1: true }),
  true,
  "capable devices can still send legacy data",
);
const oldSnapshot = {
  timezone: "Asia/Manila",
  monitoring_limits: { do_low_mg_l: 3, do_high_mg_l: 8 },
  low_feed_threshold_pct: 20,
  schedules: [],
};
const nextSnapshot = { ...oldSnapshot, oxygen_report_interval_seconds: 30 };
assert.equal(
  api.reportingConfigurationError("2.8.0", true, oldSnapshot, nextSnapshot),
  null,
);
assert.equal(
  api.reportingConfigurationError(undefined, true, nextSnapshot, oldSnapshot),
  "CONFIG_UPGRADE_REQUIRED",
  "old app cannot strip new field",
);
assert.equal(
  api.reportingConfigurationError("2.8.0", false, oldSnapshot, nextSnapshot),
  "CAPABILITY_MISMATCH",
);
assert.equal(
  api.reportingConfigurationError("2.8.0", true, nextSnapshot, oldSnapshot),
  "INVALID_INPUT",
);
assert.equal(
  api.reportingConfigurationError("2.8.0", true, oldSnapshot, {
    ...nextSnapshot,
    oxygen_report_interval_seconds: 31,
  }),
  "INVALID_INPUT",
);
for (const key of Object.keys(oldSnapshot)) {
  const stripped = { ...nextSnapshot } as Record<string, unknown>;
  delete stripped[key];
  assert.equal(
    api.reportingConfigurationError("2.8.0", true, oldSnapshot, stripped),
    "INVALID_INPUT",
    `new app must retain ${key}`,
  );
}
assert.equal(
  api.reportingConfigurationError(undefined, false, oldSnapshot, oldSnapshot),
  null,
  "old app old device unchanged",
);
assert.equal(
  api.reportingConfigurationError("2.8.0", false, oldSnapshot, {
    ...nextSnapshot,
    oxygen_report_interval_seconds: null,
  }),
  null,
  "nullable unconfigured value is not an interval edit",
);
assert.equal(
  api.reportingConfigurationError("2.8.0", false, nextSnapshot, {
    ...nextSnapshot,
    oxygen_report_interval_seconds: null,
  }),
  "CAPABILITY_MISMATCH",
  "incapable profile cannot clear an existing configured interval",
);
assert.equal(
  api.reportingConfigurationError("2.9.0", true, oldSnapshot, oldSnapshot),
  "INVALID_INPUT",
  "unknown version cannot silently downgrade",
);
assert.equal(
  api.validSyncTelemetry(
    { ...legacy, live_sequence: String(legacy.live_sequence) },
    {},
  ),
  false,
  "legacy sequence is not coerced",
);
console.log(
  `PASS independent telemetry runtime, capability and configuration negotiation (${fileURLToPath(import.meta.url)})`,
);
