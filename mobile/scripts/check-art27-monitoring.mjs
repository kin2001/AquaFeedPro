import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

import {
  normalizeUtcTimestamp,
  sameDeviceRequestScope,
} from "../src/lib/device-access-state.ts";

const repo = new URL("../../", import.meta.url);
const homeSource = await readFile(
  new URL("../src/app/(tabs)/index.tsx", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  homeSource,
  /\bfloating=|<Fab\b/,
  "Home has one labeled in-flow feeding action, not a competing floating action",
);
assert.match(
  homeSource,
  /<Text[^>]*>\{contactText\}<\/Text>/,
  "actual contact status is visible, not only an accessibility label",
);
assert.ok(
  homeSource.indexOf('label="Next feeding"') <
    homeSource.indexOf(">\n          Feed now"),
  "feeding action follows oxygen and monitoring metrics",
);
const deviceDetailsSource =
  (await readFile(
    new URL("../src/lib/feeder-settings.tsx", import.meta.url),
    "utf8",
  )) +
  (await readFile(
    new URL("../src/app/settings/[field].tsx", import.meta.url),
    "utf8",
  ));
const saveSettingsSource = deviceDetailsSource.slice(
  deviceDetailsSource.indexOf("const saveMonitoringSettings"),
  deviceDetailsSource.indexOf("const checkMonitoringSettings"),
);
const deviceApiSource = await readFile(
  new URL("../../supabase/functions/device-api/index.ts", import.meta.url),
  "utf8",
);

async function loadPureTypeScript(path, globals = {}) {
  let source = await readFile(new URL(path, repo), "utf8");
  source = source.replace(/^import(?: type)? .*?;\s*$/gm, "");
  const javascript = ts.transpile(source, {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  });
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    require: () => ({}),
    normalizeUtcTimestamp,
    crypto: { randomUUID: () => "99999999-9999-4999-8999-999999999999" },
    ...globals,
  });
  return exports;
}

const monitoring = await loadPureTypeScript("mobile/src/lib/monitoring.ts");
const telemetry = await loadPureTypeScript(
  "supabase/functions/_shared/telemetry.ts",
);

assert.equal(
  monitoring.monitoringSettingsRecoveryStatus(false, true, false, "applied"),
  "unverified",
  "a confirmed save with a failed current-state refresh stays blocked",
);
assert.equal(
  monitoring.monitoringSettingsRecoveryStatus(true, false, false, "applied"),
  "unverified",
  "unreadable local pending storage cannot be treated as no pending request",
);
assert.equal(
  monitoring.monitoringSettingsRecoveryStatus(true, true, false, "applied"),
  "resolved",
  "a successful current-state and pending-status refresh unlocks editing",
);
assert.equal(
  monitoring.monitoringSettingsRecoveryStatus(true, true, false, "pending"),
  "pending",
  "a refreshed pending revision remains blocked",
);
assert.match(
  deviceDetailsSource,
  /checked\.state \?\?\s*\(await readConfiguration\(/,
  "status recovery fetches current configuration when no local request is available",
);
assert.match(
  deviceDetailsSource,
  /activeSettings\.recoveryStatus !== "resolved"[\s\S]*?Refresh settings status/,
  "unverified settings expose a working refresh action",
);
assert.doesNotMatch(
  saveSettingsSource,
  /loadPendingWrite\([\s\S]*?\.catch\(\(\) => null\)/,
  "unreadable pending storage is not collapsed into a clear state",
);

const requestId = "77777777-7777-4777-8777-777777777777";
const deviceId = "11111111-1111-4111-8111-111111111111";
const bootId = "22222222-2222-4222-8222-222222222222";
const utc = "2026-10-09T05:00:00.000Z";
const offset = "2026-10-09T05:00:00+00:00";
const sampleValues = {
  measured_at: utc,
  time_quality: "rtc",
  do_mg_l: 5.8,
  do_quality: "valid",
  feed_remaining_g: 20000,
  feed_percent: 100,
  feed_quality: "valid",
  calibration_revision: 2,
};

const live = { ...sampleValues, sequence: 100 };
const backlog = Array.from({ length: 99 }, (_, sequence) => ({
  ...sampleValues,
  boot_id: bootId,
  sequence,
}));
assert.equal(
  telemetry.validLiveTelemetrySample(live, 100),
  true,
  "valid live sample and values pass independently",
);
assert.equal(
  telemetry.validHistoricalTelemetrySample(backlog[0]),
  true,
  "valid historical identity and values pass independently",
);
assert.equal(
  telemetry.validTelemetryBatch(bootId, 100, live, backlog),
  true,
  "latest counts toward the 100-record batch cap",
);
assert.equal(
  telemetry.validTelemetryBatch(bootId, 100, live, [
    ...backlog,
    { ...backlog[0], sequence: 99 },
  ]),
  false,
  "101 records exceed the total cap",
);
assert.equal(
  telemetry.validTelemetryBatch(bootId, 100, live, [
    { ...backlog[0], sequence: 100 },
  ]),
  false,
  "duplicate live and backlog identity is rejected",
);
assert.equal(
  telemetry.validLiveTelemetrySample({ ...live, sequence: 99 }, 100),
  false,
  "live sequence mismatch is rejected",
);
assert.equal(
  telemetry.validHistoricalTelemetrySample({
    ...backlog[0],
    do_quality: "error",
  }),
  false,
  "a failed sensor cannot carry a measurement value",
);
const invalidTime = {
  ...sampleValues,
  sequence: 101,
  measured_at: null,
  time_quality: "invalid",
  do_mg_l: null,
  do_quality: "unavailable",
  feed_remaining_g: null,
  feed_percent: null,
  feed_quality: "unavailable",
  calibration_revision: null,
};
assert.equal(
  telemetry.validLiveTelemetrySample(invalidTime, 101),
  true,
  "invalid clock retains unavailable values and no timestamp",
);
const rows = telemetry.telemetryRows({
  boot_id: bootId,
  live_sequence: 100,
  latest_sample: live,
  backlog_samples: [backlog[0]],
});
assert.equal(rows.length, 2);
assert.equal(rows[0].live_sequence, 100);
assert.equal(
  rows[1].live_sequence,
  null,
  "historical replay has no live sequence authority",
);

const snapshot = {
  request_id: requestId,
  device_id: deviceId,
  server_time: offset,
  profile: {
    firmware_version: "sim-2.0.0",
    protocol_major: 2,
    capabilities_revision: 3,
    capabilities: {
      do_monitoring: true,
      feed_remaining_monitoring: true,
      feed_capacity_g: 20000,
    },
    is_simulated: true,
  },
  contact: { authenticated_at: offset, age_seconds: 2, freshness: "fresh" },
  configuration: {
    desired_revision: 4,
    applied_revision: 4,
    pending_revision: null,
    last_attempt_status: "applied",
    error_code: null,
  },
  latest_sample: {
    boot_id: bootId,
    sequence: 100,
    live_sequence: 100,
    measured_at: offset,
    time_quality: "rtc",
    do_mg_l: 5.8,
    do_quality: "valid",
    feed_remaining_g: 20000,
    feed_percent: 100,
    feed_quality: "valid",
    calibration_revision: 2,
    received_at: offset,
    sample_age_seconds: 1,
    ingestion_age_seconds: 1,
    do_freshness: "fresh",
    feed_freshness: "fresh",
  },
  display_policy: {
    kind: "planning_display_policy",
    device_offline_after_seconds: 45,
    metric_outdated_after_seconds: 30,
    foreground_refresh_after_seconds: 15,
  },
};
const normalizedSnapshot = monitoring.normalizeMonitoringRpcTimestamps(
  snapshot,
  "snapshot",
);
assert.equal(
  normalizedSnapshot.server_time,
  utc,
  "RPC +00:00 values normalize to the UTC wire form",
);
assert.equal(normalizedSnapshot.latest_sample.received_at, utc);
assert.ok(
  monitoring.parseMonitoringSnapshot(normalizedSnapshot, requestId, deviceId),
  "normalized snapshot passes runtime DTO validation",
);
const invalidCapacitySnapshot = monitoring.parseMonitoringSnapshot(
  {
    ...normalizedSnapshot,
    profile: {
      ...normalizedSnapshot.profile,
      capabilities: {
        ...normalizedSnapshot.profile.capabilities,
        feed_capacity_g: 0,
      },
    },
  },
  requestId,
  deviceId,
);
assert.ok(invalidCapacitySnapshot);
assert.equal(
  invalidCapacitySnapshot.profile.capabilities.feed_capacity_g,
  null,
);
assert.equal(invalidCapacitySnapshot.latest_sample.feed_quality, "error");
assert.equal(invalidCapacitySnapshot.latest_sample.feed_remaining_g, null);
assert.equal(invalidCapacitySnapshot.latest_sample.feed_percent, null);
assert.equal(invalidCapacitySnapshot.latest_sample.do_quality, "valid");
assert.equal(invalidCapacitySnapshot.latest_sample.do_mg_l, 5.8);
assert.equal(
  monitoring.feedCapacityForDisplay(invalidCapacitySnapshot, 20000),
  null,
  "an invalid current capacity must not restore stale cached capacity",
);
const outOfCapacitySnapshot = monitoring.parseMonitoringSnapshot(
  {
    ...normalizedSnapshot,
    latest_sample: {
      ...normalizedSnapshot.latest_sample,
      feed_remaining_g: 20001,
    },
  },
  requestId,
  deviceId,
);
assert.ok(outOfCapacitySnapshot);
assert.equal(outOfCapacitySnapshot.latest_sample.feed_quality, "error");
assert.equal(outOfCapacitySnapshot.latest_sample.feed_remaining_g, null);
assert.equal(outOfCapacitySnapshot.latest_sample.feed_percent, null);
assert.equal(outOfCapacitySnapshot.latest_sample.do_quality, "valid");
assert.equal(outOfCapacitySnapshot.latest_sample.do_mg_l, 5.8);
assert.equal(
  monitoring.parseMonitoringSnapshot(
    {
      ...normalizedSnapshot,
      device_id: "33333333-3333-4333-8333-333333333333",
    },
    requestId,
    deviceId,
  ),
  null,
  "cross-device response is rejected",
);
const sensorless = {
  ...normalizedSnapshot,
  profile: {
    ...normalizedSnapshot.profile,
    capabilities: {
      do_monitoring: false,
      feed_remaining_monitoring: false,
      feed_capacity_g: null,
    },
  },
  latest_sample: null,
};
assert.equal(
  monitoring.feedCapacityForDisplay(sensorless, 20000),
  null,
  "an explicit unknown capacity in the current snapshot does not restore a stale cached capacity",
);
assert.equal(
  monitoring.feedCapacityForDisplay(null, 20000),
  20000,
  "cached capacity is used before any monitoring snapshot is available",
);
assert.ok(
  monitoring.parseMonitoringSnapshot(sensorless, requestId, deviceId),
  "no-sensor is valid independently of contact state",
);

const graph = {
  request_id: requestId,
  device_id: deviceId,
  server_time: offset,
  window: "1h",
  window_start: "2026-10-09T04:00:00+00:00",
  window_end: offset,
  requested_count: 2,
  returned_count: 2,
  sample_count: 1,
  valid_sample_count: 1,
  invalid_time_sample_count: 2,
  gap_count: 1,
  samples: [
    {
      bucket_start: "2026-10-09T04:00:00+00:00",
      bucket_end: "2026-10-09T04:30:00+00:00",
      measured_at: offset,
      received_at: offset,
      do_mg_l: 5.8,
      do_quality: "valid",
      gap_reason: null,
      sample_count: 1,
    },
    {
      bucket_start: "2026-10-09T04:30:00+00:00",
      bucket_end: offset,
      measured_at: null,
      received_at: null,
      do_mg_l: null,
      do_quality: null,
      gap_reason: "no_sample",
      sample_count: 0,
    },
  ],
  display_policy: snapshot.display_policy,
};
const normalizedGraph = monitoring.normalizeMonitoringRpcTimestamps(
  graph,
  "graph",
);
assert.ok(
  monitoring.parseDoGraph(normalizedGraph, requestId, deviceId, "1h"),
  "valid points, visible gaps, invalid-time count, and +00:00 RPC timestamps pass",
);
assert.equal(
  monitoring.parseDoGraph(
    { ...normalizedGraph, gap_count: 0 },
    requestId,
    deviceId,
    "1h",
  ),
  null,
  "graph gap totals must match buckets",
);
assert.equal(
  monitoring.parseDoGraph(
    {
      ...normalizedGraph,
      samples: Array.from({ length: 101 }, () => normalizedGraph.samples[0]),
      requested_count: 101,
      returned_count: 101,
      gap_count: 0,
    },
    requestId,
    deviceId,
    "1h",
  ),
  null,
  "graph render input is capped at 100 points",
);
assert.equal(
  monitoring.graphForWindow(normalizedGraph, "24h"),
  null,
  "a failed 24H refresh cannot render cached 1H data as 24H",
);
assert.equal(monitoring.graphForWindow(normalizedGraph, "1h"), normalizedGraph);
assert.equal(
  monitoring.freshnessAfterElapsed("fresh", 2, 28, 30),
  "stale",
  "a cached reading ages while polling is failing",
);
assert.equal(
  monitoring.freshnessAfterElapsed("fresh", null, 0, 30),
  "unknown",
  "unknown age cannot claim freshness",
);
assert.equal(
  monitoring.freshnessAfterElapsed("stale", 0, 0, 30),
  "stale",
  "a stale reading cannot be rejuvenated by a device clock change",
);
assert.match(
  homeSource,
  /performance\.now\(\)/,
  "Home measures cache age with the monotonic clock",
);
assert.doesNotMatch(
  homeSource,
  /Date\.now\(\)/,
  "device wall-clock changes cannot reset Home cache age",
);
assert.match(
  homeSource,
  /if \(state === "active" && isCurrent\(\)\) \{\s*setMonotonicNowMs\(performance\.now\(\)\);\s*void load\(\);/s,
  "resuming the app refreshes cache age immediately",
);
const scopeGuard =
  homeSource.match(/const isCurrent = \(\) =>([\s\S]*?);/)?.[1] ?? "";
assert.ok(
  scopeGuard.includes("sameDeviceRequestScope") &&
    scopeGuard.includes("scopeRef.current") &&
    scopeGuard.includes("requestedWindowRef.current"),
  "stale device, access, installation, or graph-window requests are ignored",
);
assert.match(
  homeSource,
  /clearInterval\(poll\).*clearInterval\(clock\).*appState\.remove\(\).*removeChannel\(channel\)/s,
  "poll timers and scoped listeners are disposed",
);
const syncSource = deviceApiSource.slice(
  deviceApiSource.indexOf("async function syncManualFeed"),
);
const telemetryWrite = syncSource.indexOf('admin.rpc("art27_sync_telemetry"');
const configurationWrite = syncSource.indexOf(
  'admin.rpc("art33_device_configuration_report"',
);
const commandWrite = syncSource.indexOf('admin.rpc("art31_sync_manual_feed"');
assert.ok(
  telemetryWrite >= 0 &&
    telemetryWrite < configurationWrite &&
    configurationWrite < commandWrite,
  "telemetry must validate and persist before config or feed command reservation",
);
assert.match(syncSource, /telemetry\.error\.code === "23505" \? 409/);
assert.match(syncSource, /telemetry\.error\.code === "22023" \? 422/);
const shapeFor = (values) =>
  monitoring.buildDoGraphShape(
    values.map((value) =>
      value === null
        ? normalizedGraph.samples[1]
        : { ...normalizedGraph.samples[0], do_mg_l: value },
    ),
    300,
    144,
    10,
  );
const gapped = shapeFor([5.8, null, 6]);
assert.equal(
  gapped.paths.length,
  0,
  "a line never joins valid points across an unavailable interval",
);
assert.equal(
  gapped.dots.length,
  2,
  "an isolated reading stays visible as a dot",
);
assert.equal(gapped.areas.length, 0, "isolated readings have no hatched area");
const splitAreas = shapeFor([5, 6, null, 7, 7.5, 3]);
assert.equal(splitAreas.paths.length, 2);
assert.equal(splitAreas.areas.length, 2);
assert.equal(
  splitAreas.areas[0],
  splitAreas.paths[0] + " L60 144 L0 144 Z",
  "the first area closes at its own endpoints before the missing interval",
);
assert.equal(
  splitAreas.areas[1],
  splitAreas.paths[1] + " L300 144 L180 144 Z",
  "the next area starts after the gap instead of shading across it",
);
assert.equal(shapeFor([null, null, null]).areas.length, 0);
assert.equal(shapeFor([]).areas.length, 0);
const zeroArea = shapeFor([0, 0]);
assert.equal(
  zeroArea.areas[0],
  zeroArea.paths[0] + " L300 144 L0 144 Z",
  "zero readings close on the baseline without inventing a visible area",
);
const [curve] = shapeFor([5, 5, 9, 9, 2, 2.1, 8, 0, 10, 10, 4]).paths;
const numbers = curve.match(/-?\d+(?:\.\d+)?/g).map(Number);
for (let index = 2, fromY = numbers[1]; index < numbers.length; index += 6) {
  const [, control1Y, , control2Y, , toY] = numbers.slice(index, index + 6);
  for (const y of [control1Y, control2Y])
    assert.ok(
      y >= Math.min(fromY, toY) - 0.011 && y <= Math.max(fromY, toY) + 0.011,
      "the smooth line never overshoots the two readings it joins",
    );
  fromY = toY;
}

const schedules = [
  {
    schedule_id: "44444444-4444-4444-8444-444444444444",
    local_time: "08:30",
    weekdays: [1, 3],
    enabled: true,
    dose: { mode: "grams", amount_g: 20 },
    nozzle_number: 1,
  },
];
const applied = {
  timezone: "Asia/Manila",
  monitoring_limits: { do_low_mg_l: null, do_high_mg_l: null },
  low_feed_threshold_pct: null,
  schedules,
};
const changed = monitoring.withMonitoringLimits(applied, 3, 10, 25);
assert.equal(changed.timezone, "Asia/Manila");
assert.equal(
  changed.schedules,
  schedules,
  "monitor settings retain the applied schedule array",
);
const rezoned = monitoring.withMonitoringLimits(applied, 3, 10, 25, "UTC");
assert.equal(rezoned.timezone, "UTC");
assert.equal(
  rezoned.schedules,
  schedules,
  "a time zone change keeps the applied schedule array",
);
assert.equal(changed.monitoring_limits.do_low_mg_l, 3);
assert.equal(changed.monitoring_limits.do_high_mg_l, 10);
assert.equal(changed.low_feed_threshold_pct, 25);
assert.equal(
  sameDeviceRequestScope(
    { installationId: "a", revision: 1, selectedDeviceId: deviceId },
    { installationId: "a", revision: 2, selectedDeviceId: deviceId },
  ),
  false,
  "scope changes invalidate older reads",
);
assert.equal(
  sameDeviceRequestScope(
    { installationId: "a", revision: 1, selectedDeviceId: deviceId },
    { installationId: "b", revision: 1, selectedDeviceId: deviceId },
  ),
  false,
  "installation changes invalidate older reads",
);
assert.equal(
  sameDeviceRequestScope(
    { installationId: "a", revision: 1, selectedDeviceId: deviceId },
    { installationId: "a", revision: 1, selectedDeviceId: bootId },
  ),
  false,
  "device changes invalidate older reads",
);

function createSettingsHookRenderer() {
  const slots = [];
  let cursor = 0;
  let layoutEffects = [];
  let effects = [];
  let settingsSlot;
  const sameDependencies = (previous, next) =>
    previous?.length === next.length &&
    previous.every((value, index) => Object.is(value, next[index]));
  const useMemo = (factory, dependencies) => {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || !sameDependencies(previous.dependencies, dependencies))
      slots[index] = { dependencies, value: factory() };
    return slots[index].value;
  };
  const useRef = (initial) => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { current: initial };
    return slots[index];
  };
  const useState = (initial) => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: initial };
    const slot = (settingsSlot = slots[index]);
    return [
      slot.value,
      (update) => {
        slot.value = typeof update === "function" ? update(slot.value) : update;
      },
    ];
  };
  const scheduleEffect = (queue, callback, dependencies) => {
    const index = cursor++;
    const previous = slots[index];
    if (previous && sameDependencies(previous.dependencies, dependencies))
      return;
    const slot = { dependencies, cleanup: undefined };
    slots[index] = slot;
    queue.push(() => {
      previous?.cleanup?.();
      slot.cleanup = callback();
    });
  };
  const react = {
    useCallback: (callback, dependencies) =>
      useMemo(() => callback, dependencies),
    useEffect: (callback, dependencies) =>
      scheduleEffect(effects, callback, dependencies),
    useLayoutEffect: (callback, dependencies) =>
      scheduleEffect(layoutEffects, callback, dependencies),
    useMemo,
    useRef,
    useState,
  };
  const render = (renderHook) => {
    cursor = 0;
    layoutEffects = [];
    effects = [];
    const result = renderHook();
    for (const run of layoutEffects) run();
    for (const run of effects) run();
    return result;
  };
  return {
    react,
    useFocusEffect: (callback) => react.useEffect(() => callback(), [callback]),
    render,
    settle: async (renderHook) => {
      for (let index = 0; index < 8; index++) {
        render(renderHook);
        await Promise.resolve();
      }
      return render(renderHook);
    },
    settings: () => settingsSlot?.value,
    unmount: () => {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

async function checkSettingsHookLifecycle() {
  const firstDevice = "55555555-5555-4555-8555-555555555555";
  const secondDevice = "66666666-6666-4666-8666-666666666666";
  let requestedDeviceId = firstDevice;
  let access = {
    devices: [{ deviceId: firstDevice, profileRevision: 1 }],
    installationId: "installation-a",
    selectedDeviceId: firstDevice,
    scopeRevision: 1,
  };
  const reads = [];
  const readsByDevice = new Map();
  const subscriptions = [];
  let deferredRead = null;
  const makeConfiguration = (timezone, revision, low, high, feed) => ({
    applied_snapshot: {
      timezone,
      monitoring_limits: { do_low_mg_l: low, do_high_mg_l: high },
      low_feed_threshold_pct: feed,
      schedules: [],
    },
    current_state: {
      desired_revision: revision,
      last_attempt_status: "applied",
    },
    request_status: "applied",
  });
  const api = {
    readConfiguration: async (installationId, targetDeviceId) => {
      reads.push({ installationId, deviceId: targetDeviceId });
      const count = (readsByDevice.get(targetDeviceId) ?? 0) + 1;
      readsByDevice.set(targetDeviceId, count);
      if (deferredRead?.deviceId === targetDeviceId) {
        const pending = deferredRead;
        deferredRead = null;
        return pending.promise;
      }
      if (targetDeviceId === firstDevice)
        return count === 1
          ? makeConfiguration("Asia/Manila", 1, 2, 10, 20)
          : makeConfiguration("America/New_York", count, 4, 12, 40);
      return count === 1
        ? makeConfiguration("Europe/Paris", count, 3, 11, 25)
        : count === 2
          ? makeConfiguration("Asia/Tokyo", count, 4, 12, 35)
          : makeConfiguration("Australia/Sydney", count, 5, 13, 45);
    },
    loadPendingWrite: async () => null,
    checkPendingWrite: async () => ({ pending: null, state: null }),
    saveConfiguration: async () => undefined,
    isValidTimezone: () => true,
  };
  const hookRenderer = createSettingsHookRenderer();
  const modules = {
    "expo-router": { useFocusEffect: hookRenderer.useFocusEffect },
    react: hookRenderer.react,
    "react-native": { Alert: { alert() {} }, Platform: { OS: "web" } },
    "@/lib/device-access": { useDeviceAccess: () => access },
    "@/lib/device-access-state": { sameDeviceRequestScope },
    "@/lib/device-changes": {
      subscribeDeviceChanges: (key, targetDeviceId, tables, callback) => {
        const subscription = {
          key,
          deviceId: targetDeviceId,
          tables,
          callback,
        };
        subscriptions.push(subscription);
        return () => {
          subscription.stopped = true;
        };
      },
    },
    "@/lib/monitoring": {
      monitoringSettingsRecoveryStatus: (
        currentKnown,
        pendingKnown,
        pending,
        lastAttemptStatus,
      ) =>
        !currentKnown || !pendingKnown
          ? "unverified"
          : pending || lastAttemptStatus === "pending"
            ? "pending"
            : lastAttemptStatus === "applied"
              ? "resolved"
              : "unverified",
      withMonitoringLimits: (configuration) => configuration,
    },
    "@/lib/schedules": api,
  };
  const javascript = ts.transpile(
    await readFile(
      new URL("../src/lib/feeder-settings.tsx", import.meta.url),
      "utf8",
    ),
    { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  );
  const hookExports = {};
  vm.runInNewContext(javascript, {
    exports: hookExports,
    require: (name) => {
      assert.ok(modules[name], `unexpected hook import: ${name}`);
      return modules[name];
    },
  });
  const renderHook = () => hookExports.useFeederSettings(requestedDeviceId);
  const initial = await hookRenderer.settle(renderHook);
  assert.equal(initial.activeSettings.loading, false);
  assert.equal(initial.activeSettings.timezone, "Asia/Manila");

  initial.updateSettingsField("timezone", "UTC");
  initial.updateSettingsField("doLow", "3");
  initial.updateSettingsField("doHigh", "9");
  initial.updateSettingsField("feedLow", "30");
  hookRenderer.render(renderHook);
  const initialReads = reads.length;
  access = {
    ...access,
    devices: [{ deviceId: firstDevice, profileRevision: 2 }],
  };
  const refreshedDevice = hookRenderer.render(renderHook);
  assert.equal(hookRenderer.settings().loading, false);
  assert.equal(refreshedDevice.activeSettings.loading, false);
  assert.equal(reads.length, initialReads);
  assert.equal(subscriptions.length, 1);

  const activeSubscription = () =>
    [...subscriptions].reverse().find((subscription) => !subscription.stopped);
  activeSubscription().callback();
  await hookRenderer.settle(renderHook);
  activeSubscription().callback();
  const refreshedSettings = await hookRenderer.settle(renderHook);
  assert.deepEqual(
    [
      refreshedSettings.activeSettings.timezone,
      refreshedSettings.activeSettings.doLow,
      refreshedSettings.activeSettings.doHigh,
      refreshedSettings.activeSettings.feedLow,
    ],
    ["UTC", "3", "9", "30"],
    "repeated realtime reads preserve dirty fields",
  );

  requestedDeviceId = secondDevice;
  access = {
    ...access,
    devices: [{ deviceId: secondDevice, profileRevision: 1 }],
    selectedDeviceId: secondDevice,
    scopeRevision: 2,
  };
  const switchedDevice = hookRenderer.render(renderHook);
  assert.equal(switchedDevice.activeSettings, null);
  assert.equal(hookRenderer.settings().configuration, null);
  assert.equal(hookRenderer.settings().loading, true);
  const secondDeviceSettings = await hookRenderer.settle(renderHook);
  assert.equal(
    secondDeviceSettings.activeSettings.configuration.applied_snapshot.timezone,
    "Europe/Paris",
  );

  access = { ...access, scopeRevision: 3 };
  const switchedScope = hookRenderer.render(renderHook);
  assert.equal(switchedScope.activeSettings, null);
  assert.equal(hookRenderer.settings().configuration, null);
  assert.equal(hookRenderer.settings().loading, true);
  const changedScopeSettings = await hookRenderer.settle(renderHook);
  assert.equal(
    changedScopeSettings.activeSettings.configuration.applied_snapshot.timezone,
    "Asia/Tokyo",
  );

  let resolveDeferredRead;
  deferredRead = {
    deviceId: secondDevice,
    promise: new Promise((resolve) => {
      resolveDeferredRead = resolve;
    }),
  };
  activeSubscription().callback();
  const noMembership = {
    ...access,
    devices: [],
  };
  access = noMembership;
  const unauthorized = hookRenderer.render(renderHook);
  assert.equal(unauthorized.activeSettings, null);
  assert.equal(unauthorized.disabled, true);
  assert.equal(hookRenderer.settings(), null);
  unauthorized.updateSettingsField("timezone", "Unsafe edit");
  assert.equal(hookRenderer.settings(), null);
  resolveDeferredRead(makeConfiguration("STALE", 99, 1, 2, 3));
  await hookRenderer.settle(renderHook);
  assert.equal(hookRenderer.settings(), null);

  access = {
    ...noMembership,
    devices: [{ deviceId: secondDevice, profileRevision: 2 }],
  };
  const restored = hookRenderer.render(renderHook);
  assert.equal(restored.activeSettings, null);
  assert.equal(hookRenderer.settings().loading, true);
  const restoredSettings = await hookRenderer.settle(renderHook);
  assert.equal(
    restoredSettings.activeSettings.configuration.applied_snapshot.timezone,
    "Australia/Sydney",
    "the removed-device response cannot replace a fresh authorized read",
  );
  hookRenderer.unmount();
}

await checkSettingsHookLifecycle();

console.log(
  "ART-27 monitoring checks passed: telemetry parsing and write ordering, 100-sample cap, UTC normalization, freshness, graph bounds, device scope, configuration preservation, and settings hook lifecycle.",
);
