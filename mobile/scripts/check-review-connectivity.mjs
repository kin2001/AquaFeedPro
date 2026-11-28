import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { isUuid } from "../src/lib/device-access-state.ts";
import * as monitoringTime from "../src/lib/monitoring-time.ts";

const accessSource = await readFile(
  new URL("../src/lib/device-access.tsx", import.meta.url),
  "utf8",
);
const changesSource = await readFile(
  new URL("../src/lib/device-changes.ts", import.meta.url),
  "utf8",
);
const updatesSource = await readFile(
  new URL("../src/lib/device-updates.tsx", import.meta.url),
  "utf8",
);
const updateStateSource = await readFile(
  new URL("../src/lib/device-update-state.ts", import.meta.url),
  "utf8",
);
const homeSource = await readFile(
  new URL("../src/app/(tabs)/index.tsx", import.meta.url),
  "utf8",
);
const monitoringSource = await readFile(
  new URL("../src/lib/monitoring.ts", import.meta.url),
  "utf8",
);
const schedulesSource = await readFile(
  new URL("../src/lib/schedules.ts", import.meta.url),
  "utf8",
);
const snapshotFixture = JSON.parse(
  await readFile(
    new URL(
      "../../contracts/fixtures/examples/v2/monitoring-snapshot-valid.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const installationId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const flush = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
};

function clock() {
  let now = 0;
  let nextId = 0;
  const tasks = new Map();
  const add = (callback, delay, repeat = false) => {
    const id = ++nextId;
    tasks.set(id, { callback, at: now + delay, delay, repeat });
    return id;
  };
  return {
    tasks,
    setTimeout: (callback, delay) => add(callback, delay),
    clearTimeout: (id) => tasks.delete(id),
    setInterval: (callback, delay) => add(callback, delay, true),
    clearInterval: (id) => tasks.delete(id),
    now: () => now,
    async advance(ms) {
      const end = now + ms;
      await flush();
      while (true) {
        const next = [...tasks.entries()]
          .filter(([, task]) => task.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, task] = next;
        now = task.at;
        if (task.repeat) task.at += task.delay;
        else tasks.delete(id);
        task.callback();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

function evaluate(source, imports, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require(name) {
        assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
        return imports[name];
      },
      ...globals,
    },
  );
  return module.exports;
}

function apiHarness() {
  const time = clock();
  let sessionId = installationId;
  let expired = false;
  let refreshes = 0;
  let transport = async () => ({
    ok: true,
    text: async () => '{"fresh":true}',
  });
  const calls = [];
  const session = () => ({
    access_token: "isolated-fixture-only",
    user: { id: sessionId, is_anonymous: true },
    expires_at: expired ? 1 : Number.MAX_SAFE_INTEGER,
  });
  const exported = evaluate(
    accessSource,
    {
      react: { createContext: () => ({}) },
      "react/jsx-runtime": {},
      "react-native": { Platform: { OS: "android" } },
      "expo-secure-store": {},
      "./device-access-state": { isUuid },
      "./device-changes": {},
      "./secure-session-storage": { getSecureStorageFailure: () => null },
      "./supabase": {
        supabase: {
          auth: {
            getSession: async () => ({ data: { session: session() } }),
            refreshSession: async () => {
              refreshes++;
              expired = false;
              return { data: { session: session() } };
            },
          },
        },
      },
    },
    {
      ...time,
      AbortController,
      process: { env: { EXPO_PUBLIC_SUPABASE_URL: "https://fixture.invalid" } },
      fetch(url, init) {
        calls.push({ url, init });
        return transport(init);
      },
    },
  );
  return {
    time,
    calls,
    request: (method = "GET") =>
      exported.requestAppApi(
        installationId,
        `/devices/${deviceId}/fixture`,
        method,
      ),
    transport: (value) => (transport = value),
    switchInstallation: () => (sessionId = deviceId),
    expire: () => (expired = true),
    refreshes: () => refreshes,
  };
}

function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    signal?.addEventListener(
      "abort",
      () => reject(new Error("transport aborted")),
      {
        once: true,
      },
    );
  });
}

for (const stage of ["headers", "body"]) {
  test(`app API releases a stalled ${stage} request and can read fresh data afterwards`, async () => {
    const api = apiHarness();
    api.transport(({ signal }) =>
      stage === "headers"
        ? waitForAbort(signal)
        : Promise.resolve({ ok: true, text: () => waitForAbort(signal) }),
    );
    let failure;
    const pending = api.request().catch((error) => (failure = error));
    await api.time.advance(15_000);
    assert.equal(
      failure?.code,
      "REQUEST_TIMEOUT",
      "stalled read must settle by its deadline",
    );
    await pending;
    assert.equal(api.calls[0].init.signal.aborted, true);
    assert.equal(api.time.tasks.size, 0);
    api.transport(async () => ({
      ok: true,
      text: async () => '{"fresh":true}',
    }));
    assert.equal((await api.request()).fresh, true);
    assert.equal(api.time.tasks.size, 0);
  });
}

test("timed-out mutations remain uncertain and are never automatically resent", async () => {
  const api = apiHarness();
  api.transport(({ signal }) => waitForAbort(signal));
  let failure;
  const pending = api.request("POST").catch((error) => (failure = error));
  await api.time.advance(60_000);
  assert.equal(failure?.code, "REQUEST_TIMEOUT");
  await pending;
  assert.equal(
    failure.status,
    undefined,
    "timeout is not a definitive admission refusal",
  );
  assert.equal(api.calls.length, 1);
  assert.equal(api.time.tasks.size, 0);
});

test("transport failures retain their cause, expired sessions refresh, and installation changes block requests", async () => {
  const api = apiHarness();
  const failure = new Error("isolated network loss");
  api.transport(async () => {
    throw failure;
  });
  await assert.rejects(api.request(), (error) => error === failure);
  assert.equal(api.time.tasks.size, 0);
  api.transport(async () => ({ ok: true, text: async () => "{}" }));
  api.expire();
  await api.request();
  assert.equal(api.refreshes(), 1);
  api.switchInstallation();
  await assert.rejects(
    api.request(),
    (error) => error.code === "SESSION_UNAVAILABLE",
  );
  assert.equal(api.calls.length, 2);
});

function realtimeHarness(time = clock()) {
  const listeners = new Set();
  const appState = {
    currentState: "active",
    addEventListener(event, callback) {
      assert.equal(event, "change");
      listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    },
  };
  const channels = [];
  const supabase = {
    channel(name, options) {
      assert.deepEqual(JSON.parse(JSON.stringify(options)), {
        config: { private: true },
      });
      const channel = {
        name,
        changes: [],
        removed: false,
        on(event, filter, callback) {
          assert.equal(event, "broadcast");
          assert.equal(filter.event, "resource_update");
          this.changes.push({ filter, callback });
          return this;
        },
        subscribe(callback) {
          this.status = callback;
          return this;
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      channel.removed = true;
    },
  };
  const updateState = evaluate(updateStateSource, {});
  const { subscribeDeviceUpdates } = evaluate(
    changesSource,
    { "@/lib/supabase": { supabase }, "./device-update-state": updateState },
    time,
  );
  const { createDeviceUpdates } = evaluate(
    updatesSource,
    {
      react: { createContext: () => ({}) },
      "react-native": { AppState: appState },
      "./device-update-state": updateState,
    },
    {
      ...time,
      Math: {
        ...Math,
        max: Math.max,
        min: Math.min,
        round: Math.round,
        random: () => 0.5,
      },
    },
  );
  const revisions = Object.fromEntries(
    updateState.DEVICE_RESOURCES.map((key) => [key, 0]),
  );
  return {
    time,
    listeners,
    channels,
    appState,
    create(scope) {
      return createDeviceUpdates(scope, subscribeDeviceUpdates, {
        async readRevisions() {
          return { ...revisions };
        },
      });
    },
    hint(channel, selectedDeviceId, resources) {
      for (const resource of resources) revisions[resource]++;
      channel.changes[0].callback({
        type: "broadcast",
        event: "resource_update",
        payload: {
          id: installationId,
          device_id: selectedDeviceId,
          resources,
          revisions: Object.fromEntries(
            resources.map((key) => [key, revisions[key]]),
          ),
        },
      });
    },
    state(state) {
      appState.currentState = state;
      for (const callback of listeners) callback(state);
    },
  };
}

const selectedScope = { installationId, deviceId, scopeRevision: 1 };

test("Private rejoin refetches changes missed during disconnect and retires the old channel", async () => {
  const rt = realtimeHarness();
  const updates = rt.create(selectedScope);
  let value = "cached";
  let serverValue = "initial";
  let reads = 0;
  updates.registerDeviceUpdateReader(
    "configuration",
    ["configuration"],
    { focus: "settings", query: "selected" },
    async () => {
      value = serverValue;
      reads++;
    },
  );
  updates.start();
  const channel = rt.channels[0];
  assert.equal(channel.name, `device:${deviceId}:updates`);
  channel.status("SUBSCRIBED");
  await rt.time.advance(0);
  assert.equal(value, "initial");
  channel.status("CHANNEL_ERROR");
  serverValue = "changed while disconnected";
  await rt.time.advance(1_000);
  assert.equal(channel.removed, true);
  assert.equal(rt.channels.length, 2);
  rt.channels[1].status("SUBSCRIBED");
  rt.hint(rt.channels[1], deviceId, ["configuration"]);
  await rt.time.advance(250);
  assert.equal(value, "changed while disconnected");
  assert.equal(reads, 2);
  updates.stop();
  rt.hint(channel, deviceId, ["configuration"]);
  await rt.time.advance(60_000);
  assert.equal(reads, 2);
  assert.equal(rt.time.tasks.size, 0);
  assert.equal(rt.listeners.size, 0);
});

test("Foreground fallback retries a failed read, suspends in background, and retires on switch", async () => {
  const rt = realtimeHarness();
  let attempts = 0;
  const updates = rt.create(selectedScope);
  updates.registerDeviceUpdateReader(
    "configuration",
    ["configuration"],
    { focus: "settings", query: "selected" },
    async () => {
      if (++attempts === 1) throw new Error("Network unavailable");
    },
  );
  updates.start();
  rt.channels[0].status("TIMED_OUT");
  await rt.time.advance(29_999);
  assert.equal(attempts, 1);
  await rt.time.advance(1);
  assert.equal(attempts, 2, "foreground retry releases failed settings");
  rt.state("background");
  await rt.time.advance(60_000);
  assert.equal(attempts, 2);
  assert.equal(rt.time.tasks.size, 0);
  rt.state("active");
  rt.channels.at(-1).status("SUBSCRIBED");
  await rt.time.advance(30_000);
  assert.equal(
    attempts,
    3,
    "resume requests one snapshot without fast healthy polling",
  );
  const retiredChannel = rt.channels.at(-1);
  rt.hint(retiredChannel, deviceId, ["configuration"]);
  updates.stop();
  const next = rt.create({
    ...selectedScope,
    deviceId: installationId,
    scopeRevision: 2,
  });
  let nextReads = 0;
  next.registerDeviceUpdateReader(
    "configuration",
    ["configuration"],
    { focus: "settings", query: "next" },
    async () => {
      nextReads++;
    },
  );
  next.start();
  rt.channels.at(-1).status("SUBSCRIBED");
  await rt.time.advance(250);
  assert.equal(attempts, 3);
  assert.equal(nextReads, 1);
  next.stop();
  assert.equal(rt.time.tasks.size, 0);
  assert.equal(rt.listeners.size, 0);
});

const homeAst = ts.createSourceFile(
  "index.tsx",
  homeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function homeEffect(marker) {
  let callback;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(homeAst) === "useFocusEffect" &&
      ts.isCallExpression(node.arguments[0])
    ) {
      const candidate = node.arguments[0].arguments[0].getText(homeAst);
      if (candidate.includes(marker)) callback = candidate;
    }
    ts.forEachChild(node, visit);
  }
  visit(homeAst);
  assert.ok(callback, `Home effect containing ${marker}`);
  return callback;
}

test("Home publishes independent reads, recovers a stalled graph, and retires late snapshots", async () => {
  const api = apiHarness();
  const rt = realtimeHarness(api.time);
  const updates = rt.create(selectedScope);
  const scope = { installationId, selectedDeviceId: deviceId, revision: 1 };
  const scopeRef = { current: scope };
  let snapshots = 0;
  let graphReads = 0;
  let published = 0;
  let clockValue = -1;
  let delaySnapshot;
  let snapshotFailure = false;
  const schedules = evaluate(schedulesSource, {
    "expo-secure-store": {},
    "./device-access": {},
    "./device-access-state": {},
  });
  const { freshnessAfterElapsed } = evaluate(monitoringSource, {
    "./device-access": {},
    "./device-access-state": {},
    "./schedules": schedules,
    "./monitoring-time": monitoringTime,
  });
  const globals = {
    ...api.time,
    performance: { now: api.time.now },
    installationId,
    deviceId,
    independentTelemetry: false,
    currentScope: scope,
    scopeRef,
    window: "1h",
    requestedWindowRef: { current: "1h" },
    providerLoadRef: { current: null },
    providerUpdates: updates,
    scopeKey: "fixture",
    dataRef: { current: null },
    setMonotonicNowMs(value) {
      clockValue = value;
    },
    setData() {
      published++;
    },
    sameDeviceRequestScope: (a, b) =>
      a.revision === b.revision &&
      a.installationId === b.installationId &&
      a.selectedDeviceId === b.selectedDeviceId,
    readMonitoringSnapshot: async () => {
      snapshots++;
      if (delaySnapshot) await delaySnapshot;
      if (snapshotFailure) throw new Error("Monitoring network unavailable");
      return { ...snapshotFixture, device_id: deviceId };
    },
    readDoGraph: () => {
      graphReads++;
      return api.request();
    },
    readConfiguration: async () => null,
    readNextOccurrence: async () => null,
    readHistoryPage: async () => null,
    message: (reason) => reason.message,
    AppState: rt.appState,
  };
  const start = evaluate(
    `module.exports = ${homeEffect("const readers")};`,
    {},
    globals,
  );
  const register = evaluate(
    `module.exports = ${homeEffect("registerDeviceUpdateReader")};`,
    {},
    globals,
  );
  api.transport(({ signal }) => waitForAbort(signal));
  const stop = start();
  const unregister = register();
  updates.start();
  rt.channels[0].status("SUBSCRIBED");
  await api.time.advance(14_999);
  assert.equal(snapshots, 1);
  assert.equal(graphReads, 1);
  assert.ok(
    globals.dataRef.current.snapshot,
    "a stalled graph cannot hide the monitoring card",
  );
  await api.time.advance(1);
  assert.ok(globals.dataRef.current.graphError);
  api.transport(async () => ({ ok: true, text: async () => "{}" }));
  await api.time.advance(30_000);
  assert.equal(
    graphReads,
    2,
    "bounded reconciliation retries the failed graph",
  );
  assert.equal(globals.dataRef.current.graphError, null);
  assert.equal(snapshots, 1, "graph retry does not refresh monitoring");
  const fetchedAt = globals.dataRef.current.snapshotFetchedAtMonotonicMs;
  snapshotFailure = true;
  rt.hint(rt.channels[0], deviceId, ["feed"]);
  await api.time.advance(250);
  const stale = globals.dataRef.current;
  assert.ok(stale.snapshotError);
  assert.equal(stale.snapshotFetchedAtMonotonicMs, fetchedAt);
  assert.equal(
    freshnessAfterElapsed(
      stale.snapshot.latest_sample.do_freshness,
      stale.snapshot.latest_sample.sample_age_seconds,
      (api.time.now() - fetchedAt) / 1000,
      30,
    ),
    "stale",
  );
  assert.equal(stale.snapshot.latest_sample.do_mg_l, 5.8);
  rt.state("background");
  const beforeBackground = snapshots;
  await api.time.advance(30_000);
  assert.equal(snapshots, beforeBackground);
  snapshotFailure = false;
  rt.state("active");
  rt.channels.at(-1).status("SUBSCRIBED");
  assert.equal(
    clockValue,
    api.time.now(),
    "resume updates display age immediately",
  );
  await api.time.advance(0);
  assert.equal(globals.dataRef.current.snapshotError, null);
  assert.equal(
    globals.dataRef.current.snapshotFetchedAtMonotonicMs,
    api.time.now(),
  );

  let release;
  delaySnapshot = new Promise((resolve) => {
    release = resolve;
  });
  const currentChannel = rt.channels.at(-1);
  rt.hint(currentChannel, deviceId, ["feed"]);
  await api.time.advance(250);
  const beforeOverlap = snapshots;
  rt.hint(currentChannel, deviceId, ["feed"]);
  await api.time.advance(250);
  assert.equal(
    snapshots,
    beforeOverlap,
    "a new hint cannot overlap its in-flight snapshot",
  );
  const beforeSwitch = published;
  scopeRef.current = { ...scope, selectedDeviceId: installationId };
  release();
  await flush();
  assert.equal(published, beforeSwitch);
  unregister();
  stop();
  updates.stop();
  assert.equal(api.time.tasks.size, 0);
  assert.equal(rt.listeners.size, 0);

  scopeRef.current = scope;
  delaySnapshot = new Promise((resolve) => {
    release = resolve;
  });
  const stopUnmount = start();
  const stopReaders = register();
  updates.start();
  await api.time.advance(0);
  const beforeUnmount = published;
  stopReaders();
  stopUnmount();
  updates.stop();
  release();
  await flush();
  assert.equal(published, beforeUnmount);
  assert.equal(api.time.tasks.size, 0);
  assert.equal(rt.listeners.size, 0);
});
