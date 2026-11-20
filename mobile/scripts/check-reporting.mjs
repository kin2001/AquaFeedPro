// Real TypeScript readers/state and durable writer; native storage/network only are doubles.
import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const storage = new Map();
let calls = [],
  reply,
  lose = false;
globalThis.__reportingStorage = storage;
function fixtureContactFreshness(
  id,
  scope,
  requireIndependentTelemetry = false,
) {
  const access = globalThis.__reportingAccess;
  if (
    scope &&
    (scope.installationId !== access.installationId ||
      scope.revision !== access.scopeRevision ||
      scope.selectedDeviceId !== access.selectedDeviceId ||
      id !== access.selectedDeviceId)
  )
    return "unknown";
  const record = access.devices.find((item) => item.deviceId === id);
  return record &&
    (!requireIndependentTelemetry ||
      record.capabilities.independentTelemetry === true)
    ? record.contactFreshness
    : "unknown";
}
globalThis.__reportingRequest = async (...args) => {
  calls.push(args);
  if (lose) throw new Error("timeout");
  const id = args[4]?.["X-Request-Id"] ?? args[3]?.request_id;
  return { ...reply, request_id: id };
};
registerHooks({
  resolve(s, c, n) {
    if (s === "expo-secure-store")
      return { url: "offline:reporting-storage", shortCircuit: true };
    if (s === "react")
      return { url: "offline:reporting-react", shortCircuit: true };
    if (s === "expo-router")
      return { url: "offline:reporting-router", shortCircuit: true };
    if (s === "react-native")
      return { url: "offline:reporting-native", shortCircuit: true };
    if (s === "@/lib/device-changes")
      return { url: "offline:reporting-changes", shortCircuit: true };
    if (s === "@/lib/device-updates")
      return { url: "offline:reporting-updates", shortCircuit: true };
    if (s === "@/lib/device-access")
      return { url: "offline:reporting-access", shortCircuit: true };
    if (s.startsWith("@/lib/"))
      return n(
        new URL(
          "../src/lib/" +
            s.slice(6) +
            (s.endsWith("device-access-state") ||
            s.endsWith("monitoring") ||
            s.endsWith("schedules")
              ? ".ts"
              : ".tsx"),
          import.meta.url,
        ).href,
        c,
      );
    if (s === "./device-access")
      return { url: "offline:reporting-access", shortCircuit: true };
    if (
      s === "./device-access-state" ||
      s === "./monitoring-time" ||
      s === "./schedules"
    )
      return n(
        new URL("../src/lib/" + s.slice(2) + ".ts", import.meta.url).href,
        c,
      );
    return n(s, c);
  },
  load(u, c, n) {
    if (u.endsWith("/feeder-settings.tsx"))
      return {
        format: "module",
        shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(new URL(u), "utf8")),
      };
    const mock = {
      "offline:reporting-react": [
        "useCallback",
        "useEffect",
        "useLayoutEffect",
        "useMemo",
        "useRef",
        "useState",
      ]
        .map(
          (key) =>
            `export const ${key}=(...args)=>globalThis.__reportingRenderer.react.${key}(...args);`,
        )
        .join("\n"),
      "offline:reporting-router":
        "export const useFocusEffect=(...a)=>globalThis.__reportingRenderer.useFocusEffect(...a);",
      "offline:reporting-native":
        "export const Alert={alert(...args){globalThis.__reportingAlert?.(...args)}}; export const Platform={OS:'web'};",
      "offline:reporting-changes":
        "export const subscribeDeviceChanges=()=>()=>{};",
      "offline:reporting-updates": "export const useDeviceUpdates=()=>null;",
    };
    if (mock[u])
      return { format: "module", shortCircuit: true, source: mock[u] };
    if (u === "offline:reporting-access")
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const requestAppApi=(...a)=>globalThis.__reportingRequest(...a); export const useDeviceAccess=()=>globalThis.__reportingAccess;",
      };
    if (u === "offline:reporting-storage")
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export const getItemAsync=async k=>{if(globalThis.__reportingStorageGate)await globalThis.__reportingStorageGate('get',k);return globalThis.__reportingStorage.get(k)??null};export const setItemAsync=async(k,v)=>{globalThis.__reportingDurableWrites=(globalThis.__reportingDurableWrites??0)+1;globalThis.__reportingStorage.set(k,v);if(globalThis.__reportingStorageGate)await globalThis.__reportingStorageGate('set',k,v)};export const deleteItemAsync=async k=>{globalThis.__reportingStorage.delete(k)};",
      };
    return n(u, c);
  },
});
const m = await import("../src/lib/monitoring.ts");
const s = await import("../src/lib/schedules.ts");
const now = Date.parse("2026-11-13T01:00:00Z");
assert.equal(
  typeof m.metricReportState,
  "function",
  "cadence state implemented",
);
for (const [seconds, deadline] of [
  [15, 45],
  [30, 60],
  [60, 90],
  [3600, 3960],
  [7200, 7920],
  [14400, 15840],
  [28800, 31680],
]) {
  assert.equal(
    m.metricReportState(now + deadline * 1000, "2026-11-13T01:00:00Z", seconds),
    "on_schedule",
  );
  assert.equal(
    m.metricReportState(
      now + deadline * 1000 + 1,
      "2026-11-13T01:00:00Z",
      seconds,
    ),
    "overdue",
  );
}
assert.equal(m.metricReportState(now, null, 30), "waiting");
for (const interval of [null, 0, 31, "30", NaN, Infinity])
  assert.equal(m.metricReportState(now, null, interval), "unknown");
assert.equal(m.metricReportState(now, "2026-11-13T01:00:01Z", 30), "unknown");
for (const action of ["delete", "disable"])
  assert.equal(s.reportingScheduleActionAllowed("UTC", action), true);
for (const action of ["create", "edit", "enable"])
  assert.equal(s.reportingScheduleActionAllowed("UTC", action), false);
assert.equal(s.reportingScheduleActionAllowed("Asia/Manila", "enable"), true);
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/fixtures/examples/v2/metric-280-snapshot-valid.json",
      import.meta.url,
    ),
  ),
);
const device = fixture.device_id;
reply = fixture;
const snapshot = await m.readMetricSnapshot("installation", device);
assert.equal(calls.at(-1)[1], `/devices/${device}/monitoring/metrics`);
assert.equal(calls.at(-1)[4]["X-Contract-Version"], "2.8.0");
assert.equal(
  snapshot.resources.do.latest.observation.do_mg_l,
  fixture.resources.do.latest.observation.do_mg_l,
);
for (const mutate of [
  (x) => ({ ...x, device_id: "bad" }),
  (x) => ({
    ...x,
    resources: { ...x.resources, do: { ...x.resources.do, quality: "error" } },
  }),
  (x) => ({ ...x, server_time: "2026-11-12T00:00:00Z" }),
]) {
  reply = mutate(fixture);
  await assert.rejects(() => m.readMetricSnapshot("installation", device));
}
const empty = {
  request_id: "77777777-7777-4777-8777-777777777777",
  receipt: null,
  request_status: null,
  request_error_code: null,
  desired_snapshot: null,
  applied_snapshot: null,
  current_state: {
    desired_revision: null,
    applied_revision: null,
    last_attempt_revision: null,
    last_attempt_status: null,
    error_code: null,
  },
};
const settledReporting = {
  ...empty,
  applied_snapshot: {
    ...fixture.configuration.applied_snapshot,
    oxygen_report_interval_seconds: 30,
  },
  current_state: {
    desired_revision: 2,
    applied_revision: 2,
    last_attempt_revision: 2,
    last_attempt_status: "applied",
    error_code: null,
  },
};
const requestedReporting = (interval) => ({
  ...settledReporting,
  desired_snapshot: {
    ...fixture.configuration.desired_snapshot,
    oxygen_report_interval_seconds: interval,
  },
  current_state: {
    ...settledReporting.current_state,
    desired_revision: 3,
    last_attempt_revision: 3,
    last_attempt_status: "pending",
  },
});
assert.equal(
  typeof m.reportingConfigurationLabels,
  "function",
  "truthful reporting labels are implemented",
);
for (const [name, configuration, verified, expected] of [
  [
    "settled",
    settledReporting,
    true,
    { applied: "30 seconds", requested: "No pending request" },
  ],
  [
    "pending value",
    requestedReporting(28800),
    true,
    { applied: "30 seconds", requested: "8 hours" },
  ],
  [
    "explicit requested null",
    requestedReporting(null),
    true,
    { applied: "30 seconds", requested: "Not configured" },
  ],
  [
    "explicit applied null",
    {
      ...settledReporting,
      applied_snapshot: {
        ...settledReporting.applied_snapshot,
        oxygen_report_interval_seconds: null,
      },
    },
    true,
    { applied: "Not configured", requested: "No pending request" },
  ],
  [
    "known empty",
    empty,
    true,
    { applied: "No applied configuration", requested: "No pending request" },
  ],
  [
    "no read",
    null,
    false,
    { applied: "Not yet verified", requested: "Not yet verified" },
  ],
  [
    "loading cached read",
    settledReporting,
    false,
    { applied: "Not yet verified", requested: "Not yet verified" },
  ],
  [
    "failed cached read",
    requestedReporting(null),
    false,
    { applied: "Not yet verified", requested: "Not yet verified" },
  ],
])
  assert.deepEqual(
    m.reportingConfigurationLabels(configuration, verified),
    expected,
    name,
  );
const deviceViewSource = readFileSync(
  new URL("../src/app/(tabs)/device.tsx", import.meta.url),
  "utf8",
);
assert.ok(
  /const reportingAppliedLabel = reportingConfigurationLabels\(\s*configuration \?\? null,\s*!!current && !current\.error,?\s*\)\.applied;/.test(
    deviceViewSource,
  ),
  "Device overview uses the shared helper with current successful-read verification",
);
assert.ok(
  /selectedDevice\.capabilities\.independentTelemetry\s*\? `Device-applied: \$\{reportingAppliedLabel\}`\s*: "Unsupported by this feeder"/.test(
    deviceViewSource,
  ),
  "only the new reporting row uses the verified applied label and keeps unsupported capability text",
);
console.log(
  "PASS Device reporting-row source wiring to shared verified label helper (source check, not JSX/native rendering)",
);
console.log(
  "PASS reporting card label helper: settled/no pending, actual requested value/null, actual applied null, empty, unread/loading/error inputs remain distinct",
);
assert.equal(s.emptyReportingBaseline(empty, false).timezone, "Asia/Manila");
for (const read of [
  null,
  {
    ...empty,
    current_state: {
      ...empty.current_state,
      last_attempt_revision: 1,
      last_attempt_status: "rejected",
    },
  },
  { ...empty, receipt: {} },
  { ...empty, desired_snapshot: {} },
])
  assert.equal(
    s.emptyReportingBaseline(read, false),
    null,
    "unproven/rejected/desired state is not empty",
  );
assert.equal(
  s.emptyReportingBaseline(empty, true),
  null,
  "unresolved local request blocks bootstrap",
);
const values = {
  timezone: "UTC",
  monitoring_limits: { do_low_mg_l: 4, do_high_mg_l: 8 },
  low_feed_threshold_pct: 20,
  schedules: [
    {
      schedule_id: "44444444-4444-4444-8444-444444444444",
      local_time: "08:00",
      weekdays: [1, 3],
      enabled: true,
      targets: [
        { nozzle_number: 1, dose: { mode: "grams", amount_g: 10 } },
        { nozzle_number: 2, dose: { mode: "grams", amount_g: 12 } },
      ],
    },
  ],
  oxygen_report_interval_seconds: 28800,
};
assert.equal(
  Object.hasOwn(
    s.configurationForDevice(
      { ...values, revision: 9, based_on_revision: 8 },
      { independentTelemetry: true },
    ),
    "revision",
  ),
  false,
  "full snapshot metadata is not a configuration values field",
);
assert.equal(
  m.withMonitoringLimits(values, 3, 9, 30).oxygen_report_interval_seconds,
  28800,
);
assert.deepEqual(
  m.withMonitoringLimits(values, 3, 9, 30).schedules,
  values.schedules,
);
assert.equal(
  s.configurationForDevice(
    { ...values, oxygen_report_interval_seconds: null },
    { independentTelemetry: false },
  ).oxygen_report_interval_seconds,
  null,
  "client never guesses projected vs stored null provenance",
);
assert.throws(
  () => s.configurationForDevice(values, { independentTelemetry: false }),
  /capability/,
);
reply = {
  receipt: { revision: 1, based_on_revision: 0, snapshot: values },
  current_state: {
    desired_revision: 1,
    applied_revision: null,
    last_attempt_revision: 1,
    last_attempt_status: "pending",
    error_code: null,
  },
};
await s.saveConfiguration("installation", device, 0, values);
assert.equal(calls.at(-1)[4]["X-Contract-Version"], "2.8.0");
assert.equal(calls.at(-1)[3].snapshot.timezone, "UTC");
lose = true;
await assert.rejects(() =>
  s.saveConfiguration("installation", device, 1, values),
);
const pending = await s.loadPendingWrite("installation", device);
assert.equal(pending.snapshot.oxygen_report_interval_seconds, 28800);
await assert.rejects(
  () => s.saveConfiguration("installation", device, 1, values),
  "uncertain request blocks second revision",
);
assert.equal(
  (await s.loadPendingWrite("installation", device)).request_id,
  pending.request_id,
);
lose = false;
reply = {
  ...reply,
  receipt: { revision: 2, based_on_revision: 1, snapshot: pending.snapshot },
};
await s.saveConfiguration(
  "installation",
  device,
  99,
  { ...values, oxygen_report_interval_seconds: 15 },
  pending,
);
assert.equal(calls.at(-1)[3].request_id, pending.request_id);
assert.deepEqual(
  calls.at(-1)[3].snapshot,
  pending.snapshot,
  "uncertain retry preserves original payload, not edited draft",
);
assert.equal(calls.at(-1)[4]["X-Contract-Version"], "2.8.0");
const legacyValues = { ...values };
delete legacyValues.oxygen_report_interval_seconds;
lose = true;
await assert.rejects(() =>
  s.saveConfiguration("installation", device, 2, legacyValues),
);
const legacyPending = await s.loadPendingWrite("installation", device);
lose = false;
reply = {
  ...reply,
  receipt: {
    revision: 3,
    based_on_revision: 2,
    snapshot: legacyPending.snapshot,
  },
};
await s.saveConfiguration("installation", device, 99, values, legacyPending);
assert.equal(
  calls.at(-1)[4]["X-Contract-Version"],
  undefined,
  "pre-upgrade unresolved request retains legacy header and absent key",
);
assert.deepEqual(calls.at(-1)[3].snapshot, legacyPending.snapshot);
// Reuse the incumbent test-only hook driver; Node strips this no-JSX hook with no installed transpiler.
const hookTest = readFileSync(
  new URL("./check-art27-monitoring.mjs", import.meta.url),
  "utf8",
);
const factorySource = hookTest.slice(
  hookTest.indexOf("function createSettingsHookRenderer()"),
  hookTest.indexOf("async function checkSettingsHookLifecycle()"),
);
const createRenderer = new Function(
  factorySource + ";return createSettingsHookRenderer;",
)();
const { useFeederSettings } = await import("../src/lib/feeder-settings.tsx");
const secondDevice = "22222222-2222-4222-8222-222222222222";
const config = {
  ...fixture.configuration,
  receipt: null,
  request_status: null,
  desired_snapshot: null,
  current_state: {
    desired_revision: 2,
    applied_revision: 2,
    last_attempt_revision: 2,
    last_attempt_status: "applied",
    error_code: null,
  },
};
lose = false;
storage.clear();
calls = [];
let requestedDevice = device,
  releasePut;
globalThis.__reportingAccess = {
  installationId: "installation",
  selectedDeviceId: device,
  scopeRevision: 1,
  devices: [
    {
      deviceId: device,
      contactFreshness: "fresh",
      capabilities: { independentTelemetry: true },
    },
  ],
};
globalThis.__reportingAccess.getDeviceContactFreshness =
  fixtureContactFreshness;
globalThis.__reportingRenderer = createRenderer();
globalThis.__reportingRequest = async (...args) => {
  calls.push(args);
  if (args[2] === "PUT") {
    await new Promise((resolve) => {
      releasePut = resolve;
    });
    return {
      request_id: args[3].request_id,
      receipt: {
        revision: 3,
        based_on_revision: 2,
        snapshot: args[3].snapshot,
      },
      current_state: {
        ...config.current_state,
        desired_revision: 3,
        last_attempt_revision: 3,
        last_attempt_status: "pending",
      },
    };
  }
  return { ...config, request_id: args[4]["X-Request-Id"] };
};
const render = () => useFeederSettings(requestedDevice);
let view = await globalThis.__reportingRenderer.settle(render);
assert.equal(
  calls.filter((args) => args[2] === "PUT").length,
  0,
  "actual focus hook does not write a suggested interval",
);
view.updateSettingsField("reporting", "28800");
view = globalThis.__reportingRenderer.render(render);
view.requestSaveSettings("reporting");
for (let index = 0; index < 8; index++) await Promise.resolve();
assert.equal(calls.filter((args) => args[2] === "PUT").length, 1);
assert.equal(calls.at(-1)[3].snapshot.oxygen_report_interval_seconds, 28800);
assert.equal(
  view.activeSettings.configuration.applied_snapshot
    .oxygen_report_interval_seconds,
  null,
  "pending request is not applied",
);
requestedDevice = secondDevice;
globalThis.__reportingAccess = {
  ...globalThis.__reportingAccess,
  selectedDeviceId: secondDevice,
  scopeRevision: 2,
  devices: [
    {
      deviceId: secondDevice,
      contactFreshness: "fresh",
      capabilities: { independentTelemetry: true },
    },
  ],
};
view = globalThis.__reportingRenderer.render(render);
assert.equal(
  view.activeSettings,
  null,
  "old device content is hidden immediately",
);
releasePut();
view = await globalThis.__reportingRenderer.settle(render);
assert.equal(
  calls.filter((args) => args[2] === "PUT").length,
  1,
  "late save never retries or retargets",
);
assert.equal(
  calls.filter((args) => args[2] === "GET" && args[1].includes(device)).length,
  1,
  "old save cannot refresh old content into new scope",
);
globalThis.__reportingRenderer.unmount();
for (const [capable, contactFreshness, expectWrite] of [
  [true, "stale", false],
  [false, "fresh", false],
  [true, "fresh", true],
]) {
  storage.clear();
  calls = [];
  requestedDevice = device;
  globalThis.__reportingAccess = {
    installationId: "installation",
    selectedDeviceId: device,
    scopeRevision: 1,
    devices: [
      {
        deviceId: device,
        contactFreshness,
        capabilities: { independentTelemetry: capable },
      },
    ],
  };
  globalThis.__reportingAccess.getDeviceContactFreshness =
    fixtureContactFreshness;
  globalThis.__reportingRenderer = createRenderer();
  let serverConfig = empty;
  globalThis.__reportingRequest = async (...args) => {
    calls.push(args);
    if (args[2] === "PUT") {
      const current_state = {
        desired_revision: 1,
        applied_revision: null,
        last_attempt_revision: 1,
        last_attempt_status: "pending",
        error_code: null,
      };
      serverConfig = {
        ...empty,
        current_state,
        desired_snapshot: {
          ...args[3].snapshot,
          revision: 1,
          based_on_revision: 0,
        },
      };
      return {
        request_id: args[3].request_id,
        receipt: {
          revision: 1,
          based_on_revision: 0,
          snapshot: args[3].snapshot,
        },
        current_state,
      };
    }
    return { ...serverConfig, request_id: args[4]["X-Request-Id"] };
  };
  view = await globalThis.__reportingRenderer.settle(render);
  assert.equal(view.activeSettings.reporting, "30");
  assert.equal(calls.filter((args) => args[2] === "PUT").length, 0);
  view.updateSettingsField("reporting", "15");
  view = globalThis.__reportingRenderer.render(render);
  view.requestSaveSettings("reporting");
  view = await globalThis.__reportingRenderer.settle(render);
  const puts = calls.filter((args) => args[2] === "PUT");
  assert.equal(
    puts.length,
    expectWrite ? 1 : 0,
    "only explicit online capable bootstrap submits",
  );
  if (expectWrite) {
    assert.deepEqual(puts[0][3].snapshot, {
      timezone: "Asia/Manila",
      schedules: [],
      monitoring_limits: { do_low_mg_l: null, do_high_mg_l: null },
      low_feed_threshold_pct: null,
      oxygen_report_interval_seconds: 15,
    });
    assert.equal(
      view.activeSettings.configuration.applied_snapshot,
      null,
      "bootstrap request is never an invented applied configuration",
    );
  }
  globalThis.__reportingRenderer.unmount();
}
const { Platform } = await import("react-native");
Platform.OS = "android";
const confirmationResults = [];
for (const change of [
  "device",
  "scope",
  "blur",
  "access",
  "unmount",
  "stale",
  "unknown",
  "reporting-profile",
  "migration-profile",
  "legacy-profile",
  "fresh-record",
  "unchanged",
]) {
  storage.clear();
  calls = [];
  globalThis.__reportingDurableWrites = 0;
  requestedDevice = device;
  globalThis.__reportingAccess = {
    installationId: "installation",
    selectedDeviceId: device,
    scopeRevision: 1,
    devices: [
      {
        deviceId: device,
        contactFreshness: "fresh",
        capabilities: { independentTelemetry: true },
      },
    ],
  };
  globalThis.__reportingAccess.getDeviceContactFreshness =
    fixtureContactFreshness;
  globalThis.__reportingRenderer = createRenderer();
  const renderer = globalThis.__reportingRenderer;
  const focusCleanups = [];
  renderer.useFocusEffect = (callback) =>
    renderer.react.useEffect(() => {
      const cleanup = callback();
      focusCleanups.push(cleanup);
      return cleanup;
    }, [callback]);
  let confirm;
  globalThis.__reportingAlert = (title, message, buttons) => {
    assert.equal(title, "Change the time zone?");
    confirm = buttons.find((button) => button.text === "Change").onPress;
  };
  const migrationConfig = {
    ...config,
    applied_snapshot: {
      ...config.applied_snapshot,
      timezone: "UTC",
      oxygen_report_interval_seconds:
        change === "migration-profile" ? 30 : null,
      schedules: values.schedules,
    },
  };
  globalThis.__reportingRequest = async (...args) => {
    calls.push(args);
    if (args[2] === "PUT")
      return {
        request_id: args[3].request_id,
        receipt: {
          revision: 3,
          based_on_revision: 2,
          snapshot: args[3].snapshot,
        },
        current_state: {
          ...config.current_state,
          desired_revision: 3,
          last_attempt_revision: 3,
          last_attempt_status: "pending",
        },
      };
    return { ...migrationConfig, request_id: args[4]["X-Request-Id"] };
  };
  view = await renderer.settle(render);
  if (change === "reporting-profile") {
    const retainedSave = view.requestSaveSettings;
    confirm = () => retainedSave("reporting");
  } else view.requestSaveSettings("timezone");
  assert.equal(
    typeof confirm,
    "function",
    "save/confirmation action is retained, not auto-approved",
  );
  assert.equal(globalThis.__reportingDurableWrites, 0);
  assert.equal(calls.filter((args) => args[2] === "PUT").length, 0);
  if (change === "device") {
    requestedDevice = secondDevice;
    globalThis.__reportingAccess = {
      ...globalThis.__reportingAccess,
      selectedDeviceId: secondDevice,
      devices: [
        { ...globalThis.__reportingAccess.devices[0], deviceId: secondDevice },
      ],
    };
    renderer.render(render);
  }
  if (change === "scope") {
    globalThis.__reportingAccess = {
      ...globalThis.__reportingAccess,
      scopeRevision: 2,
    };
    renderer.render(render);
  }
  if (change === "stale" || change === "unknown") {
    globalThis.__reportingAccess = {
      ...globalThis.__reportingAccess,
      devices: [
        {
          ...globalThis.__reportingAccess.devices[0],
          contactFreshness: change,
        },
      ],
    };
    const refreshed = renderer.render(render);
    assert.equal(
      refreshed.disabled,
      true,
      "same-scope live contact refresh disables editing",
    );
    assert.equal(globalThis.__reportingAccess.scopeRevision, 1);
    assert.equal(globalThis.__reportingAccess.selectedDeviceId, device);
  }
  if (
    [
      "reporting-profile",
      "migration-profile",
      "legacy-profile",
      "fresh-record",
    ].includes(change)
  ) {
    const previous = globalThis.__reportingAccess.devices[0];
    globalThis.__reportingAccess = {
      ...globalThis.__reportingAccess,
      devices: [
        {
          ...previous,
          capabilities: {
            ...previous.capabilities,
            independentTelemetry: change === "fresh-record",
          },
        },
      ],
    };
    renderer.render(render);
  }
  if (change === "access") {
    globalThis.__reportingAccess = {
      ...globalThis.__reportingAccess,
      devices: [],
    };
    renderer.render(render);
  }
  if (change === "blur") for (const cleanup of focusCleanups) cleanup?.();
  if (change === "unmount") renderer.unmount();
  confirm();
  for (let index = 0; index < 16; index++) await Promise.resolve();
  const putCount = calls.filter((args) => args[2] === "PUT").length;
  const writes = globalThis.__reportingDurableWrites;
  confirmationResults.push({ change, writes, putCount });
  if (["unchanged", "fresh-record", "legacy-profile"].includes(change)) {
    assert.equal(
      writes,
      1,
      "current explicit confirmation still stores the request before sending",
    );
    assert.equal(putCount, 1);
    assert.equal(
      calls.find((args) => args[2] === "PUT")[3].snapshot.timezone,
      "Asia/Manila",
    );
  }
  renderer.unmount();
}
Platform.OS = "web";
assert.deepEqual(
  confirmationResults.filter(
    (result) =>
      !["unchanged", "fresh-record", "legacy-profile"].includes(result.change),
  ),
  [
    "device",
    "scope",
    "blur",
    "access",
    "unmount",
    "stale",
    "unknown",
    "reporting-profile",
    "migration-profile",
  ].map((change) => ({
    change,
    writes: 0,
    putCount: 0,
  })),
  "delayed migration confirmation must perform zero durable writes/PUTs after scope/focus/access/mount loss",
);
console.log(
  "PASS retained save actions: device/scope/blur/access/unmount/stale/unknown/relevant profile loss block all durable writes and PUTs; current/fresh-record/compatible legacy confirmations send once (mock hook, not native rendering)",
);
console.log(
  "PASS reporting cadence/nonPH safety policy, real readers/durable writer, actual settings hook no-mount-write and mid-save device switch (mock runtime, not native rendering)",
);

// REAL Provider -> context -> retained settings callback -> real serialized writer/API.
// Only native storage/session/fetch/React and VM-local clocks are substitutes.
const contactState = await import("../src/lib/device-access-state.ts");
const contactProviderCode = ts.transpileModule(
  readFileSync(
    new URL("../src/lib/device-access.tsx", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const drainContact = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
function contactGate() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function contactFixture({
  count = 1,
  field = "reporting",
  offsets = [],
  initialMono = 0,
  fresh = true,
  interval = null,
} = {}) {
  storage.clear();
  globalThis.__reportingDurableWrites = 0;
  globalThis.__reportingStorageGate = undefined;
  const install = "44444444-4444-4444-8444-444444444444";
  let wall = now,
    mono = initialMono,
    timerId = 0,
    liveInstallation = install,
    appState = "active";
  let sessionGate,
    refreshGate,
    queryGate,
    expiredSession = false,
    authListener;
  const timers = new Map(),
    listeners = new Set(),
    requests = [],
    queryCalls = [];
  const ids = [device, secondDevice].slice(0, count);
  const rows = new Map(
    ids.map((id, index) => [
      id,
      {
        device_id: id,
        contact_freshness: "fresh",
        last_authenticated_contact_at: new Date(
          now + (offsets[index] ?? 0),
        ).toISOString(),
      },
    ]),
  );
  const metadata = new Map();
  const nozzle = {
    enabled: true,
    dose_modes: ["grams"],
    fixed_portion_ids: [],
    min_dose_g: 5,
    max_dose_g: 100,
    dose_step_g: 1,
    measured_dispensed_g: true,
    max_actuation_ms: 15000,
    minimum_cooldown_ms: null,
  };
  let reportingCapable = true,
    capabilitiesRevision = 1;
  const profile = (id) => ({
    device_id: id,
    alias: metadata.get(id)?.alias ?? null,
    location: metadata.get(id)?.location ?? null,
    metadata_revision: metadata.get(id)?.metadata_revision ?? 1,
    metadata_conflict: false,
    model: "offline-fixture",
    firmware_version: "offline",
    protocol_major: 2,
    is_simulated: true,
    capabilities_revision: capabilitiesRevision,
    capabilities: {
      do_monitoring: true,
      feed_remaining_monitoring: true,
      feed_capacity_g: 20000,
      local_schedule_execution: true,
      scheduled_both: true,
      independent_telemetry_v1: reportingCapable,
      max_schedules: 10,
      max_clock_uncertainty_ms: null,
      scheduler_wake_grace_ms: null,
      maximum_settling_ms: null,
      nozzles: { 1: nozzle, 2: nozzle },
    },
  });
  const session = () => ({
    access_token: "offline-only",
    user: { id: liveInstallation, is_anonymous: true },
    expires_at: expiredSession ? 1 : Number.MAX_SAFE_INTEGER,
  });
  const supabase = {
    auth: {
      async getSession() {
        const gate = sessionGate;
        sessionGate = undefined;
        if (gate) await gate.promise;
        return { data: { session: session() }, error: null };
      },
      async refreshSession() {
        const gate = refreshGate;
        refreshGate = undefined;
        if (gate) await gate.promise;
        expiredSession = false;
        return { data: { session: session() }, error: null };
      },
      getUser: async () => ({ data: { user: session().user }, error: null }),
      onAuthStateChange(callback) {
        authListener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      startAutoRefresh() {},
      stopAutoRefresh() {},
    },
    from(table) {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        in: () => query,
        async then(resolve, reject) {
          const gate = queryGate;
          queryGate = undefined;
          if (gate) await gate.promise;
          queryCalls.push(table);
          return Promise.resolve({
            error: null,
            data: ids.map((id) =>
              table === "device_access"
                ? { device_id: id }
                : table === "devices"
                  ? profile(id)
                  : rows.get(id),
            ),
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const providerRenderer = createRenderer();
  let renderingProvider = false;
  const providerReact = {
    ...providerRenderer.react,
    useState(initial) {
      const [value, update] = providerRenderer.react.useState(initial);
      return [
        value,
        (next) => {
          assert.equal(
            renderingProvider,
            false,
            "real Provider/getter must not setState during render",
          );
          update(next);
        },
      ];
    },
  };
  const modules = {
    react: {
      ...providerReact,
      createContext: () => ({ Provider: "Provider" }),
      useContext: () => null,
    },
    "react/jsx-runtime": {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    "react-native": {
      Platform: { OS: "android" },
      AppState: {
        get currentState() {
          return appState;
        },
        addEventListener(event, callback) {
          assert.equal(event, "change");
          listeners.add(callback);
          return { remove: () => listeners.delete(callback) };
        },
      },
    },
    "expo-secure-store": { isAvailableAsync: async () => true },
    "./device-access-state": contactState,
    "./device-changes": { subscribeDeviceChanges: () => () => {} },
    "./secure-session-storage": {
      getSecureStorageFailure: () => null,
      resetSecureStorageFailure() {},
      SecureSessionStorageError: class extends Error {},
    },
    "./supabase": {
      supabase,
      removeLegacySqliteSession() {},
      secureSessionStorage: {
        getItem: async () => device,
        setItem: async () => {},
        removeItem: async () => {},
      },
    },
  };
  const module = { exports: {} };
  const configuration = {
    ...config,
    applied_snapshot: {
      ...config.applied_snapshot,
      timezone: field === "timezone" ? "UTC" : "Asia/Manila",
      schedules: field === "timezone" ? values.schedules : [],
    },
  };
  if (interval === "absent")
    delete configuration.applied_snapshot.oxygen_report_interval_seconds;
  else configuration.applied_snapshot.oxygen_report_interval_seconds = interval;
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(name) {
      assert.ok(
        Object.hasOwn(modules, name),
        `Unexpected contact Provider import: ${name}`,
      );
      return modules[name];
    },
    Date: class extends Date {
      static now() {
        return wall;
      }
    },
    performance: { now: () => mono },
    AbortController,
    setTimeout(run, delay) {
      const id = ++timerId;
      timers.set(id, { run, at: mono + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    crypto: globalThis.crypto,
    __DEV__: true,
    process: {
      env: {
        EXPO_PUBLIC_SUPABASE_URL: "https://fixture.invalid",
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline",
      },
    },
    async fetch(url, init) {
      const body = init.body ? JSON.parse(init.body) : null;
      requests.push({ method: init.method, body, headers: init.headers });
      if (init.method === "POST" && url.endsWith("/pair")) {
        const id = body.device_id;
        ids.push(id);
        rows.set(id, {
          device_id: id,
          contact_freshness: "fresh",
          last_authenticated_contact_at: new Date(wall).toISOString(),
        });
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              request_id: body.request_id,
              device: profile(id),
              metadata: profile(id),
              access: {
                device_id: id,
                granted_at: new Date(wall).toISOString(),
              },
            }),
        };
      }
      if (init.method === "PATCH") {
        const id = url.split("/devices/")[1].split("/")[0];
        const value = {
          device_id: id,
          alias: body.alias,
          location: body.location,
          metadata_revision: body.expected_revision + 1,
          metadata_conflict: false,
        };
        metadata.set(id, value);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ request_id: body.request_id, metadata: value }),
        };
      }
      if (init.method === "DELETE") {
        const id = url.split("/devices/")[1].split("/")[0];
        ids.splice(ids.indexOf(id), 1);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              request_id: init.headers["X-Request-Id"],
              device_id: id,
              revoked_at: new Date(wall).toISOString(),
            }),
        };
      }
      const response =
        init.method === "PUT"
          ? {
              request_id: body.request_id,
              receipt: {
                revision: 3,
                based_on_revision: body.based_on_revision,
                snapshot: body.snapshot,
              },
              current_state: {
                ...config.current_state,
                desired_revision: 3,
                last_attempt_revision: 3,
                last_attempt_status: "pending",
              },
            }
          : { ...configuration, request_id: init.headers["X-Request-Id"] };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(response),
      };
    },
  });
  new vm.Script(contactProviderCode).runInContext(context);
  let access;
  const publish = (readGetter = false) => {
    access = providerRenderer.render(() => {
      renderingProvider = true;
      try {
        const tree = module.exports.DeviceAccessProvider({ children: null });
        if (readGetter) tree.props.value.getDeviceContactFreshness(device);
        return tree;
      } finally {
        renderingProvider = false;
      }
    }).props.value;
    globalThis.__reportingAccess = access;
    return access;
  };
  for (let i = 0; i < 30; i++) {
    publish();
    await drainContact();
  }
  assert.equal(access.phase, "ready");
  assert.equal(access.selectedDeviceId, device);
  assert.equal(access.devices.length, count);
  const settingsRenderer = createRenderer();
  globalThis.__reportingRenderer = settingsRenderer;
  globalThis.__reportingRequest = (...args) =>
    module.exports.requestAppApi(...args);
  const renderSettings = () => useFeederSettings(device);
  let settings = await settingsRenderer.settle(renderSettings);
  await drainContact();
  settings = settingsRenderer.render(renderSettings);
  assert.ok(settings.activeSettings);
  assert.equal(
    settings.disabled,
    !fresh,
    "actual settings eligibility follows accepted local clock evidence",
  );
  const lateLifecycle = [...listeners][0];
  return {
    ids,
    rows,
    timers,
    requests,
    queryCalls,
    publish,
    access: () => access,
    async refreshProfile(capable) {
      reportingCapable = capable;
      capabilitiesRevision += 1;
      return access.refreshDevices();
    },
    settings: () => settings,
    readDuringRender() {
      publish(true);
    },
    gateQuery() {
      const gate = contactGate();
      queryGate = gate;
      return gate;
    },
    lateState(state) {
      lateLifecycle(state);
    },
    renderSettings() {
      publish();
      settings = settingsRenderer.render(renderSettings);
      return settings;
    },
    at(elapsed) {
      wall = now + elapsed;
      mono = elapsed;
    },
    wall(value) {
      wall = value;
    },
    mono(value) {
      mono = value;
    },
    async due() {
      for (let i = 0; i < 20; i++) {
        const entry = [...timers].find(([, task]) => task.at <= mono);
        if (!entry) break;
        timers.delete(entry[0]);
        entry[1].run();
        await drainContact();
      }
    },
    confirm() {
      if (field === "timezone") {
        let confirm;
        globalThis.confirm = () => {
          confirm = true;
          return true;
        };
        settings.requestSaveSettings(field);
        assert.equal(confirm, true);
      } else settings.requestSaveSettings(field);
    },
    retain() {
      if (field !== "timezone") {
        const retained = settings.requestSaveSettings;
        return () => retained(field);
      }
      let callback;
      Platform.OS = "android";
      globalThis.__reportingAlert = (title, text, buttons) => {
        callback = buttons.find((item) => item.text === "Change").onPress;
      };
      settings.requestSaveSettings(field);
      Platform.OS = "web";
      assert.equal(typeof callback, "function");
      return callback;
    },
    gateSession(refresh = false) {
      const gate = contactGate();
      if (refresh) {
        expiredSession = true;
        refreshGate = gate;
      } else sessionGate = gate;
      return gate;
    },
    background(state) {
      appState = state;
      for (const callback of listeners) callback(state);
    },
    auth(event, id = liveInstallation) {
      liveInstallation = id;
      authListener(event, event === "SIGNED_OUT" ? null : session());
    },
    blur() {
      settingsRenderer.unmount();
    },
    stop() {
      settingsRenderer.unmount();
      providerRenderer.unmount();
      globalThis.__reportingStorageGate = undefined;
    },
  };
}

// Missing local timeout leaves the ACTUAL retained context fresh forever: behavioral RED.
{
  const f = await contactFixture();
  const before = [f.requests.length, f.queryCalls.length];
  f.at(44_999);
  await f.due();
  f.publish();
  assert.equal(f.access().selectedDevice.contactFreshness, "fresh");
  f.at(45_000);
  await f.due();
  f.publish();
  assert.equal(
    f.access().selectedDevice.contactFreshness,
    "stale",
    "real Provider must publish stale eligibility at45_000 with total network silence",
  );
  assert.deepEqual(
    [f.requests.length, f.queryCalls.length],
    before,
    "local expiry does not fetch",
  );
  f.stop();
}
for (const field of ["reporting", "timezone"]) {
  const f = await contactFixture({ field });
  const confirm = f.retain(),
    sample = JSON.stringify(snapshot.resources.do);
  const before = [f.requests.length, f.queryCalls.length];
  f.at(44_999);
  assert.equal(f.access().getDeviceContactFreshness(device), "fresh");
  f.at(45_000);
  confirm();
  await drainContact();
  assert.equal(
    globalThis.__reportingDurableWrites,
    0,
    `real retained ${field} callback before timer/render must not journal at45_000`,
  );
  assert.equal(f.requests.filter((item) => item.method === "PUT").length, 0);
  assert.deepEqual([f.requests.length, f.queryCalls.length], before);
  assert.equal(f.access().getDeviceContactFreshness(device), "stale");
  f.readDuringRender();
  assert.equal(
    f.access().selectedDevice.contactFreshness,
    "fresh",
    "no visible render has been consumed by getter",
  );
  await f.due();
  assert.equal(
    f.renderSettings().disabled,
    true,
    "queued deadline still publishes actual stale UI after getter latched expiry",
  );
  assert.equal(f.access().selectedDevice.contactFreshness, "stale");
  assert.equal(
    JSON.stringify(snapshot.resources.do),
    sample,
    "contact never rewrites independent oxygen evidence",
  );
  f.stop();
  assert.equal(f.timers.size, 0);
}
for (const field of ["reporting", "timezone"])
  for (const phase of ["queue", "get", "set", "session", "refresh"]) {
    for (const change of ["expiry", "scope", "blur", "revoke"]) {
      const f = await contactFixture({ count: 2, field });
      const confirm = f.retain();
      const gate =
        phase === "session" || phase === "refresh"
          ? f.gateSession(phase === "refresh")
          : contactGate();
      let entered = false,
        blocker;
      if (["queue", "get", "set"].includes(phase))
        globalThis.__reportingStorageGate = async (kind) => {
          if (entered || kind !== (phase === "set" ? "set" : "get")) return;
          entered = true;
          await gate.promise;
        };
      if (phase === "queue") {
        blocker = s.checkPendingWrite(f.access().installationId, device);
        await drainContact();
      }
      confirm();
      await drainContact();
      const saved = [...storage.entries()];
      if (["set", "session", "refresh"].includes(phase))
        assert.equal(
          saved.length,
          1,
          `real ${phase} journal exists before blocked phase finishes`,
        );
      if (change === "expiry") f.at(45_000);
      if (change === "scope") await f.access().selectDevice(secondDevice); // no Provider/settings render
      if (change === "blur") f.blur();
      if (change === "revoke") await f.access().revokeDevice(device);
      gate.resolve();
      await blocker;
      await drainContact();
      assert.equal(
        f.requests.filter((item) => item.method === "PUT").length,
        0,
        `${phase}/${change}: real writer/API must not fetch after lost eligibility`,
      );
      if (["queue", "get"].includes(phase)) {
        assert.equal(
          globalThis.__reportingDurableWrites,
          0,
          `${phase}/${change}: no new journal`,
        );
        assert.equal(storage.size, 0);
      } else {
        assert.deepEqual(
          [...storage.entries()],
          saved,
          `${phase}/${change}: preserve exact journal bytes, no deletion/rewrite`,
        );
        assert.equal(globalThis.__reportingDurableWrites, 1);
        const pending = JSON.parse(saved[0][1]);
        assert.ok(pending.request_id);
        assert.equal(
          pending.snapshot.oxygen_report_interval_seconds,
          field === "reporting" ? 30 : null,
        );
        assert.equal(pending.snapshot.timezone, "Asia/Manila");
      }
      f.stop();
    }
  }
for (const field of ["reporting", "timezone"]) {
  const f = await contactFixture({ field });
  f.confirm();
  await drainContact();
  assert.equal(globalThis.__reportingDurableWrites, 1);
  const put = f.requests.filter((item) => item.method === "PUT");
  assert.equal(put.length, 1);
  assert.equal(put[0].headers["X-Contract-Version"], "2.8.0");
  assert.equal(put[0].headers["X-Request-Id"], put[0].body.request_id);
  assert.equal(storage.size, 0, "verified receipt still clears journal");
  f.stop();
}
console.log(
  "PASS R2 REAL Provider/timer/context/settings/writer/API: exclusive45s silence and getter-before-timer UI publication, gated queue/pending/storage/session/refresh expiry+scope+blur+revoke, exact retained journals, fresh once",
);

// A same-scope accepted profile can change before any Provider/settings render.
// Removing the Provider-authoritative capability check must restore unsupported PUTs.
for (const [field, interval, capable, wantPut] of [
  ["reporting", null, false, 0],
  ["timezone", 30, false, 0],
  ["reporting", null, true, 1],
  ["timezone", 30, true, 1],
  ["timezone", null, false, 1],
  ["timezone", "absent", false, 1],
]) {
  for (const phase of ["before", "queue", "get", "set", "session", "refresh"]) {
    const label = `${field}/${interval}/${phase}/capable=${capable}`;
    const f = await contactFixture({ field, interval });
    const confirm = f.retain();
    const scopeRevision = f.access().scopeRevision;
    const gate =
      phase === "session" || phase === "refresh"
        ? f.gateSession(phase === "refresh")
        : contactGate();
    let entered = false,
      blocker;
    if (["queue", "get", "set"].includes(phase))
      globalThis.__reportingStorageGate = async (kind) => {
        if (entered || kind !== (phase === "set" ? "set" : "get")) return;
        entered = true;
        await gate.promise;
      };
    if (phase === "queue") {
      blocker = s.checkPendingWrite(f.access().installationId, device);
      await drainContact();
    }
    if (phase !== "before") {
      confirm();
      await drainContact();
    }
    const saved = [...storage.entries()];
    const afterJournal = ["set", "session", "refresh"].includes(phase);
    assert.equal(
      saved.length,
      afterJournal ? 1 : 0,
      `${label}: actual gated journal phase`,
    );
    const accepted = await f.refreshProfile(capable);
    assert.equal(accepted[0].capabilities.independentTelemetry, capable);
    assert.equal(accepted[0].capabilitiesRevision, 2);
    assert.equal(
      f.access().devices[0].capabilities.independentTelemetry,
      true,
      `${label}: retained context has not rendered the new Provider record`,
    );
    assert.equal(f.access().devices[0].capabilitiesRevision, 1);
    assert.equal(f.access().scopeRevision, scopeRevision);
    assert.equal(f.access().selectedDeviceId, device);
    assert.equal(
      f.access().getDeviceContactFreshness(device),
      "fresh",
      `${label}: contact stays fresh; no unrelated expiry/scope workaround`,
    );
    if (phase === "before") confirm();
    gate.resolve();
    await blocker;
    await drainContact();
    const puts = f.requests.filter((item) => item.method === "PUT");
    assert.equal(
      puts.length,
      wantPut,
      `${label}: use live reporting capability before dispatch`,
    );
    if (!wantPut) {
      assert.equal(globalThis.__reportingDurableWrites, afterJournal ? 1 : 0);
      assert.deepEqual(
        [...storage.entries()],
        saved,
        `${label}: preserve original journal bytes without deletion/rewrite`,
      );
    } else {
      assert.equal(globalThis.__reportingDurableWrites, 1);
      assert.equal(
        storage.size,
        0,
        `${label}: verified receipt still clears journal`,
      );
      assert.equal(puts[0].headers["X-Contract-Version"], "2.8.0");
      assert.equal(puts[0].headers["X-Request-Id"], puts[0].body.request_id);
      assert.equal(puts[0].body.based_on_revision, 2);
      assert.equal(
        puts[0].body.snapshot.oxygen_report_interval_seconds,
        field === "reporting" || interval === 30 ? 30 : null,
      );
      if (afterJournal) {
        const pending = JSON.parse(saved[0][1]);
        assert.equal(puts[0].body.request_id, pending.request_id);
        assert.deepEqual(puts[0].body.snapshot, pending.snapshot);
      }
    }
    f.stop();
  }
}
console.log(
  "PASS R2-F1 real Provider revision1->2 without render: reporting/PH-nonnull capability loss before confirmation + five async phases, unchanged journals, benign refresh and legacy null/absent controls",
);

{
  const f = await contactFixture({ count: 2, offsets: [0, -10000] });
  assert.equal(f.timers.size, 1, "one earliest retained-record timeout");
  const old = [...f.timers.values()][0].run;
  f.at(35000);
  await f.due();
  f.publish();
  assert.equal(
    f.access().devices.find((item) => item.deviceId === secondDevice)
      .contactFreshness,
    "stale",
  );
  assert.equal(f.access().selectedDevice.contactFreshness, "fresh");
  assert.equal(f.timers.size, 1);
  f.at(45000);
  await f.due();
  f.publish();
  assert.equal(f.timers.size, 0);
  f.wall(now + 1000);
  await f.access().refreshDevices();
  f.publish();
  assert.equal(
    f.access().getDeviceContactFreshness(device),
    "stale",
    "same-contact rollback reread cannot revive expiry",
  );
  f.rows.get(device).last_authenticated_contact_at = new Date(
    now + 500,
  ).toISOString();
  await f.access().refreshDevices();
  f.publish();
  assert.equal(f.access().getDeviceContactFreshness(device), "fresh");
  old();
  assert.equal(
    f.access().getDeviceContactFreshness(device),
    "fresh",
    "retired deadline cannot replace new contact",
  );
  f.stop();
  assert.equal(f.access().getDeviceContactFreshness(device), "unknown");
  f.lateState("active");
  await drainContact();
  assert.equal(
    f.access().getDeviceContactFreshness(device),
    "unknown",
    "queued old AppState callback cannot remount unmounted eligibility",
  );
  assert.equal(f.timers.size, 0);
}
for (const kind of ["unknown", "stale", "future", "invalid", "wall", "mono"]) {
  const f = await contactFixture();
  f.at(1000);
  const row = f.rows.get(device);
  if (kind === "unknown") {
    row.contact_freshness = "unknown";
    row.last_authenticated_contact_at = null;
  }
  if (kind === "stale") row.contact_freshness = "stale";
  if (kind === "future")
    row.last_authenticated_contact_at = new Date(now + 1000000).toISOString();
  if (kind === "invalid") row.last_authenticated_contact_at = "not-a-date";
  if (kind === "wall") f.wall(NaN);
  if (kind === "mono") f.mono(-1);
  if (["wall", "mono"].includes(kind))
    assert.notEqual(f.access().getDeviceContactFreshness(device), "fresh");
  else {
    await f.access().refreshDevices();
    f.publish();
    assert.notEqual(
      f.access().getDeviceContactFreshness(device),
      "fresh",
      kind,
    );
  }
  f.at(46000);
  await f.due();
  f.wall(now + 1000);
  row.contact_freshness = "fresh";
  row.last_authenticated_contact_at = new Date(now).toISOString();
  await f.access().refreshDevices();
  f.publish();
  assert.equal(
    f.access().getDeviceContactFreshness(device),
    "stale",
    `${kind}: original evidence cannot revive after elapsed expiry`,
  );
  row.last_authenticated_contact_at = new Date(now + 500).toISOString();
  await f.access().refreshDevices();
  f.publish();
  assert.equal(
    f.access().getDeviceContactFreshness(device),
    "fresh",
    `${kind}: strictly newer valid evidence recovers without future poisoning`,
  );
  assert.equal(
    m.freshnessAfterElapsed("fresh", 0, 46, 30),
    "stale",
    "new contact does not renew actual independent DO age policy",
  );
  f.stop();
}
{
  const f = await contactFixture();
  f.at(44999);
  await f.access().updateDeviceLabels(device, "New label", null, 1);
  await drainContact();
  f.at(45000);
  await f.due();
  f.publish();
  assert.equal(
    f.access().selectedDevice.contactFreshness,
    "stale",
    "label/copy/verified reread never renew contact",
  );
  f.ids.length = 0;
  await f.access().refreshDevices();
  f.publish();
  assert.equal(f.access().getDeviceContactFreshness(device), "unknown");
  assert.equal(f.timers.size, 0);
  f.wall(now + 1000);
  f.ids.push(device);
  await f.access().refreshDevices();
  f.publish();
  assert.equal(
    f.access().getDeviceContactFreshness(device),
    "stale",
    "empty membership/selection clear cannot erase same-installation expired watermark",
  );
  f.stop();
}
{
  const f = await contactFixture();
  const gate = f.gateQuery();
  const paired = await f.access().pairDevice({
    device_id: secondDevice,
    challenge_id: "33333333-3333-4333-8333-333333333333",
    pairing_secret: "offline-only",
  });
  f.publish();
  assert.equal(paired.contactFreshness, "unknown");
  assert.equal(
    f.access().getDeviceContactFreshness(secondDevice),
    "unknown",
    "pair receipt/granted time is not contact",
  );
  gate.resolve();
  await drainContact();
  f.publish();
  assert.equal(
    f.access().getDeviceContactFreshness(secondDevice),
    "fresh",
    "only subsequent verified state establishes contact",
  );
  f.stop();
}
{
  const f = await contactFixture();
  f.at(10000);
  f.background("background");
  assert.equal(f.timers.size, 0);
  assert.equal(f.access().getDeviceContactFreshness(device), "unknown");
  const before = f.queryCalls.length;
  f.at(45000);
  await f.due();
  assert.equal(f.queryCalls.length, before);
  f.background("active");
  f.publish();
  assert.equal(
    f.access().selectedDevice.contactFreshness,
    "stale",
    "resume publishes expiry before async recovery",
  );
  await drainContact();
  f.publish();
  assert.equal(f.access().getDeviceContactFreshness(device), "stale");
  f.stop();
}
for (const sameInstallation of [true, false]) {
  const f = await contactFixture();
  f.at(1000);
  f.auth("SIGNED_OUT");
  assert.equal(f.access().getDeviceContactFreshness(device), "unknown");
  f.at(45000); // Time expires while no record/permission is visible and no deadline is armed.
  f.wall(now + 1000);
  f.auth(
    "SIGNED_IN",
    sameInstallation
      ? "44444444-4444-4444-8444-444444444444"
      : "66666666-6666-4666-8666-666666666666",
  );
  await f.due();
  await drainContact();
  f.publish();
  assert.equal(
    f.access().getDeviceContactFreshness(device),
    sameInstallation ? "stale" : "fresh",
    "temporary null preserves evidence; only verified different installation drops it",
  );
  f.stop();
}
{
  const f = await contactFixture();
  const gate = f.gateSession();
  f.confirm();
  await drainContact();
  const bytes = [...storage.values()][0],
    pending = JSON.parse(bytes);
  f.at(45000);
  gate.resolve();
  await drainContact();
  assert.equal(f.requests.filter((item) => item.method === "PUT").length, 0);
  assert.equal([...storage.values()][0], bytes);
  await s.retryPendingWrite(f.access().installationId, device);
  const puts = f.requests.filter((item) => item.method === "PUT");
  assert.equal(
    puts.length,
    1,
    "only explicit original retry, with guard omitted, keeps original recovery policy",
  );
  assert.equal(puts[0].body.request_id, pending.request_id);
  assert.deepEqual(puts[0].body.snapshot, pending.snapshot);
  assert.equal(puts[0].headers["X-Contract-Version"], "2.8.0");
  assert.equal(storage.size, 0);
  f.stop();
}
for (const action of ["disable", "delete"]) {
  const f = await contactFixture();
  f.at(45000);
  assert.equal(s.reportingScheduleActionAllowed("UTC", action), true);
  const legacy = {
    ...values,
    schedules:
      action === "delete"
        ? []
        : values.schedules.map((item) => ({ ...item, enabled: false })),
  };
  delete legacy.oxygen_report_interval_seconds;
  await s.saveConfiguration(f.access().installationId, device, 2, legacy);
  const puts = f.requests.filter((item) => item.method === "PUT");
  assert.equal(
    puts.length,
    1,
    "omitted guard adds no blanket freshness/PH requirement",
  );
  assert.equal(puts[0].headers["X-Contract-Version"], undefined);
  assert.deepEqual(puts[0].body.snapshot, legacy);
  f.stop();
}
for (const initialMono of [-1, NaN, Infinity]) {
  const f = await contactFixture({ initialMono, fresh: false });
  assert.notEqual(
    f.access().getDeviceContactFreshness(device),
    "fresh",
    "initial invalid monotonic evidence must fail closed",
  );
  f.at(1000);
  await f.access().refreshDevices();
  f.publish();
  assert.equal(
    f.access().getDeviceContactFreshness(device),
    "stale",
    "fixed clock alone cannot re-anchor same server contact",
  );
  f.rows.get(device).last_authenticated_contact_at = new Date(
    now + 500,
  ).toISOString();
  await f.access().refreshDevices();
  f.publish();
  assert.equal(f.access().getDeviceContactFreshness(device), "fresh");
  f.stop();
}
{
  const f = await contactFixture({ count: 2 });
  const gate = f.gateQuery();
  f.at(1000);
  f.rows.get(device).last_authenticated_contact_at = new Date(
    now + 1000,
  ).toISOString();
  const old = f.access().refreshDevices();
  await drainContact();
  await f.access().selectDevice(secondDevice); // retire scope before its Provider render/effects
  gate.resolve();
  await old;
  f.at(45000);
  await f.due();
  f.publish();
  assert.equal(
    f.access().getDeviceContactFreshness(device),
    "stale",
    "old-scope async read cannot install a newer anchor",
  );
  f.stop();
}
{
  const f = await contactFixture();
  const gate = f.gateQuery();
  const old = f.access().refreshDevices();
  await drainContact();
  f.stop();
  gate.resolve();
  await old;
  assert.equal(
    f.access().getDeviceContactFreshness(device),
    "unknown",
    "post-unmount response cannot restore eligibility",
  );
  assert.equal(f.timers.size, 0);
}
console.log(
  "PASS R2 actual Provider lifecycle: one deadline, rollback/non-revival/new evidence, invalid/future/clock, labels/pair/membership/selection, background/resume/unmount/retired callbacks, transient-null vs different-installation, independent DO and original/legacy controls",
);
