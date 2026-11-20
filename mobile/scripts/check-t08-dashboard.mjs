import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function effect(file, hook, marker, pickDependencies = false) {
  const source = ts.createSourceFile(
    file,
    readFileSync(new URL("../src/app/(tabs)/" + file, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === hook) {
      const argument = node.arguments[0];
      const fn =
        hook === "useFocusEffect" && ts.isCallExpression(argument)
          ? argument.arguments[0]
          : argument;
      if (fn.getText(source).includes(marker))
        callback = (pickDependencies ? argument.arguments[1] : fn).getText(
          source,
        );
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, file + " has a " + marker + " effect");
  const js = ts.transpileModule("(" + callback + ")", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return (globals) => {
    const value = vm.runInNewContext(js, globals);
    return pickDependencies ? [...value] : value();
  };
}

function defer() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const scope = {
  installationId: "installation",
  selectedDeviceId: "device",
  revision: 1,
};
const readScope = {
  installationId: "installation",
  deviceId: "device",
  scopeRevision: 1,
};

function harness() {
  const registrations = new Map();
  const calls = [];
  const denied = [];
  const reads = {};
  const fallback =
    (name, result) =>
    (...args) => {
      calls.push([name, ...args]);
      return reads[name] ? reads[name]() : Promise.resolve(result);
    };
  const providerUpdates = {
    registerDeviceUpdateReader(key, resources, binding, load) {
      registrations.set(key, { resources: [...resources], binding, load });
      return () => registrations.delete(key);
    },
  };
  const access = {
    reportDeviceAccessLoss(value) {
      denied.push(value);
    },
  };
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  };
  const globals = {
    ...scope,
    deviceId: scope.selectedDeviceId,
    currentScope: scope,
    scopeRef: { current: scope },
    device: { capabilities: { independentTelemetry: true } },
    independentTelemetry: true,
    window: "1h",
    requestedWindowRef: { current: "1h" },
    scopeKey: "device:1",
    providerUpdates,
    providerLoadRef: { current: null },
    readCurrentScopeRef: { current: null },
    focused: { current: false },
    focusGeneration: { current: 0 },
    dataRef: { current: null },
    access,
    reportDeviceAccessLoss: access.reportDeviceAccessLoss,
    sameDeviceRequestScope: (a, b) =>
      a.installationId === b.installationId &&
      a.selectedDeviceId === b.selectedDeviceId &&
      a.revision === b.revision,
    AppState: {
      currentState: "active",
      addEventListener: () => ({ remove() {} }),
    },
    supabase: { channel: () => channel, removeChannel() {} },
    subscribeDeviceChanges: () => () => {},
    performance: { now: () => 1 },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    message: (reason) => reason.message,
    errorText: (reason) => reason.message,
    setMonotonicNowMs() {},
    setData() {},
    setConfiguration() {},
    setNextOccurrence() {},
    setPendingLocal() {},
    setError() {},
    setNotice() {},
    setRecoveryOpen() {},
    setLocalChange() {},
    setBusy() {},
    setRefreshing() {},
    readMetricSnapshot: fallback("metric", { resources: {} }),
    readMonitoringSnapshot: fallback("legacy", { latest_sample: null }),
    readDoGraph: fallback("graph", { window: "1h" }),
    readConfiguration: fallback("config", { desired_snapshot: null }),
    readNextOccurrence: fallback("next", { occurrence: null }),
    readHistoryPage: fallback("history", { records: [] }),
    loadPendingWrite: fallback("pending", null),
  };
  const context = (key, isCurrent = () => true) => ({
    isCurrent,
    scope: readScope,
    binding: registrations.get(key).binding,
  });
  return {
    globals,
    registrations,
    calls,
    denied,
    reads,
    load: (key, current) => registrations.get(key).load(context(key, current)),
  };
}

const mountHome = effect("index.tsx", "useFocusEffect", "const readers");
const registerHome = effect("index.tsx", "useFocusEffect", '"monitoring"');
const homeDependencies = effect(
  "index.tsx",
  "useFocusEffect",
  "const readers",
  true,
);
const home = harness();
const inFlightHome = defer();
home.reads.metric = () => inFlightHome.promise;
const stopHome = mountHome(home.globals);
const stopHomeReaders = registerHome(home.globals);
let acknowledged = false;
const joinedHome = home.load("monitoring").then(() => (acknowledged = true));
await flush();
assert.equal(
  acknowledged,
  false,
  "Home must wait for the actual shared snapshot",
);
assert.equal(home.calls.filter(([name]) => name === "metric").length, 1);
inFlightHome.resolve({ resources: {} });
await joinedHome;
assert.equal(acknowledged, true);

home.calls.length = 0;
delete home.reads.metric;
assert.deepEqual(home.registrations.get("monitoring").resources, [
  "do",
  "feed",
]);
assert.deepEqual(home.registrations.get("history").resources, ["feeding"]);
assert.deepEqual(
  [...home.registrations.values()].filter((reader) =>
    reader.resources.includes("contact"),
  ),
  [],
  "contact hints do not trigger Home data fetches",
);
await home.load("monitoring");
assert.deepEqual(
  home.calls.map(([name]) => name),
  ["metric"],
);
await home.load("history");
assert.deepEqual(
  home.calls.map(([name]) => name),
  ["metric", "history"],
);
assert.deepEqual(home.registrations.get("graph").resources, ["do", "history"]);
const previousDependencies = homeDependencies(home.globals);
home.globals.device = {
  ...home.globals.device,
  contactFreshness: "fresh",
  lastAuthenticatedContactAt: "2026-11-20T01:00:00Z",
};
assert.deepEqual(
  homeDependencies(home.globals),
  previousDependencies,
  "a contact update keeps Home's owner attached without a broad read",
);
home.globals.independentTelemetry = false;
assert.notDeepEqual(homeDependencies(home.globals), previousDependencies);
home.globals.independentTelemetry = true;

const cachedSnapshot = home.globals.dataRef.current.metricSnapshot;
home.reads.metric = () => Promise.reject(new Error("unavailable"));
await assert.rejects(home.load("monitoring"), /unavailable/);
assert.equal(home.globals.dataRef.current.metricSnapshot, cachedSnapshot);

const staleHome = defer();
home.reads.metric = () => staleHome.promise;
const oldHome = home.load("monitoring");
const beforeStale = home.globals.dataRef.current;
home.globals.scopeRef.current = { ...scope, revision: 2 };
staleHome.resolve({ resources: { stale: true } });
assert.equal(await oldHome, "deferred");
assert.equal(home.globals.dataRef.current, beforeStale);
stopHomeReaders();
stopHome();
assert.equal(home.registrations.size, 0);
assert.ok(
  !home.registrations.has("graph"),
  "blur unregisters the graph reader",
);

home.globals.scopeRef.current = scope;
home.globals.window = "24h";
home.globals.requestedWindowRef.current = "24h";
delete home.reads.metric;
home.reads.graph = () => Promise.reject(new Error("graph unavailable"));
const stopNewWindow = mountHome(home.globals);
await flush();
assert.equal(home.globals.dataRef.current.graphRequestedWindow, "24h");
assert.equal(home.globals.dataRef.current.graph, null);
assert.equal(home.globals.dataRef.current.graphError, "graph unavailable");
stopNewWindow();

const mountSchedules = effect(
  "schedule.tsx",
  "useLayoutEffect",
  "readCurrentScopeRef.current = read",
);
const focusSchedules = effect(
  "schedule.tsx",
  "useFocusEffect",
  "schedule-configuration-",
);
const registerSchedules = effect(
  "schedule.tsx",
  "useFocusEffect",
  'focus: "schedules"',
);
const schedule = harness();
const inFlightSchedule = defer();
schedule.reads.config = () => inFlightSchedule.promise;
const stopLayout = mountSchedules(schedule.globals);
const stopLegacySchedule = focusSchedules(schedule.globals);
const stopSchedule = registerSchedules(schedule.globals);
let scheduleAcknowledged = false;
const joinedSchedule = schedule
  .load("configuration")
  .then(() => (scheduleAcknowledged = true));
await flush();
assert.equal(
  scheduleAcknowledged,
  false,
  "Schedules must await the existing scoped read",
);
assert.equal(schedule.calls.filter(([name]) => name === "config").length, 1);
inFlightSchedule.resolve({ desired_snapshot: null });
await joinedSchedule;

schedule.reads.config = () => Promise.reject(new Error("network"));
await assert.rejects(schedule.load("configuration"), /network/);
schedule.reads.config = () =>
  Promise.reject(
    Object.assign(new Error("access revoked"), { code: "ACCESS_REVOKED" }),
  );
await assert.rejects(schedule.load("configuration"), /access revoked/);
assert.equal(schedule.denied.length, 1);
assert.equal(schedule.denied[0].deviceId, scope.selectedDeviceId);
const retiredRead = defer();
schedule.reads.config = () => retiredRead.promise;
let schedulePublished = false;
schedule.globals.setConfiguration = () => (schedulePublished = true);
const oldSchedule = schedule.load("configuration");
stopLegacySchedule();
retiredRead.resolve({ desired_snapshot: null });
assert.equal(await oldSchedule, "deferred");
assert.equal(
  schedulePublished,
  false,
  "blur retires an in-flight Schedule read",
);
stopSchedule();
stopLayout();
assert.equal(schedule.registrations.size, 0);
console.log(
  "Task 8 dashboard actual reader bindings, shared in-flight reads, scope retirement, and denial checks passed.",
);
