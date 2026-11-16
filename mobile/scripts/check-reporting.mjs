// Real TypeScript readers/state and durable writer; native storage/network only are doubles.
import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";
const storage = new Map();
let calls = [],
  reply,
  lose = false;
globalThis.__reportingStorage = storage;
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
        "export const Alert={alert(){}}; export const Platform={OS:'web'};",
      "offline:reporting-changes":
        "export const subscribeDeviceChanges=()=>()=>{};",
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
          "export const getItemAsync=async k=>globalThis.__reportingStorage.get(k)??null;export const setItemAsync=async(k,v)=>{globalThis.__reportingStorage.set(k,v)};export const deleteItemAsync=async k=>{globalThis.__reportingStorage.delete(k)};",
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
console.log(
  "PASS reporting cadence/nonPH safety policy, real readers/durable writer, actual settings hook no-mount-write and mid-save device switch (mock runtime, not native rendering)",
);
