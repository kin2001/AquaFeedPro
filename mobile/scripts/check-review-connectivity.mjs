import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const accessSource = await readFile(
  new URL("../src/lib/device-access.tsx", import.meta.url),
  "utf8",
);
const changesSource = await readFile(
  new URL("../src/lib/device-changes.ts", import.meta.url),
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
      "./device-access-state": {},
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

function realtimeHarness() {
  const time = clock();
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
    channel(name) {
      const channel = {
        name,
        changes: [],
        removed: false,
        on(event, filter, callback) {
          assert.equal(event, "postgres_changes");
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
  const exported = evaluate(
    changesSource,
    {
      "@/lib/supabase": { supabase },
      "react-native": { AppState: appState },
    },
    time,
  );
  return {
    time,
    listeners,
    channels,
    supabase,
    appState,
    subscribe: exported.subscribeDeviceChanges,
    state(state) {
      appState.currentState = state;
      for (const callback of listeners) callback(state);
    },
  };
}

test("Realtime rejoin refetches changes missed during disconnect, coalescing status and row events", async () => {
  const rt = realtimeHarness();
  let value = "cached";
  let serverValue = "initial";
  let reads = 0;
  const stop = rt.subscribe(
    "settings",
    deviceId,
    ["device_config_revisions"],
    () => {
      value = serverValue;
      reads++;
    },
  );
  const channel = rt.channels[0];
  channel.status?.("SUBSCRIBED");
  await rt.time.advance(250);
  assert.equal(value, "initial", "join closes the initial read/subscribe race");
  channel.status?.("CHANNEL_ERROR");
  serverValue = "changed while disconnected";
  channel.status?.("SUBSCRIBED");
  channel.changes[0].callback();
  await rt.time.advance(250);
  assert.equal(value, "changed while disconnected");
  assert.equal(reads, 2);
  assert.equal(channel.changes[0].filter.filter, `device_id=eq.${deviceId}`);
  stop();
  channel.status?.("SUBSCRIBED");
  channel.changes[0].callback();
  await rt.time.advance(60_000);
  assert.equal(reads, 2);
  assert.equal(rt.time.tasks.size, 0);
  assert.equal(rt.listeners.size, 0);
  assert.equal(channel.removed, true);
});

test("failed Realtime has bounded foreground fallback, resume refresh, and cleanup on device switch", async () => {
  const rt = realtimeHarness();
  let reads = 0;
  const stop = rt.subscribe(
    "settings",
    deviceId,
    ["device_config_revisions"],
    () => reads++,
  );
  rt.channels[0].status?.("TIMED_OUT");
  await rt.time.advance(15_250);
  assert.equal(
    reads,
    1,
    "failed subscription must not leave cached settings frozen",
  );
  rt.state("background");
  await rt.time.advance(60_000);
  assert.equal(reads, 1);
  rt.state("active");
  await rt.time.advance(250);
  assert.equal(reads, 2);
  rt.channels[0].status?.("SUBSCRIBED");
  await rt.time.advance(250);
  await rt.time.advance(30_000);
  assert.equal(reads, 3, "healthy subscription does not need fallback polling");
  rt.channels[0].changes[0].callback();
  stop();
  const stopNext = rt.subscribe(
    "settings",
    installationId,
    ["device_config_revisions"],
    () => (reads += 10),
  );
  rt.channels[1].status?.("SUBSCRIBED");
  await rt.time.advance(250);
  assert.equal(reads, 13, "old device debounce cannot run after switch");
  stopNext();
  assert.equal(rt.time.tasks.size, 0);
  assert.equal(rt.listeners.size, 0);
});

// Execute the real Home focus callback without rendering its unrelated UI tree.
const homeAst = ts.createSourceFile(
  "index.tsx",
  homeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let homeEffect;
function findHomeEffect(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(homeAst) === "useFocusEffect"
  )
    homeEffect = node.arguments[0].arguments[0].getText(homeAst);
  ts.forEachChild(node, findHomeEffect);
}
findHomeEffect(homeAst);
assert.ok(homeEffect);

test("Home polling recovers after a secondary request stalls; loads do not overlap or publish after switch/unmount", async () => {
  const api = apiHarness();
  const rt = realtimeHarness();
  const scope = { installationId, selectedDeviceId: deviceId, revision: 1 };
  const scopeRef = { current: scope };
  let snapshots = 0;
  let published = 0;
  let delaySnapshot;
  let snapshotFailure = false;
  const { freshnessAfterElapsed } = evaluate(monitoringSource, {
    "./device-access": {},
    "./device-access-state": {},
  });
  const globals = {
    ...api.time,
    performance: { now: api.time.now },
    installationId,
    deviceId,
    device: {},
    currentScope: scope,
    scopeRef,
    window: "1h",
    requestedWindowRef: { current: "1h" },
    scopeKey: "fixture",
    dataRef: { current: null },
    setMonotonicNowMs() {},
    setData() {
      published++;
    },
    sameDeviceRequestScope: (a, b) =>
      a === b ||
      (a.revision === b.revision &&
        a.installationId === b.installationId &&
        a.selectedDeviceId === b.selectedDeviceId),
    readMonitoringSnapshot: async () => {
      snapshots++;
      if (delaySnapshot) await delaySnapshot;
      if (snapshotFailure) throw new Error("Monitoring network unavailable");
      return { ...snapshotFixture, device_id: deviceId };
    },
    readDoGraph: () => api.request(),
    readConfiguration: async () => null,
    readNextOccurrence: async () => null,
    readHistoryPage: async () => null,
    message: (reason) => reason.message,
    supabase: rt.supabase,
    AppState: rt.appState,
  };
  const start = evaluate(`module.exports = ${homeEffect};`, {}, globals);
  api.transport(({ signal }) => waitForAbort(signal));
  const stop = start();
  await api.time.advance(14_999);
  assert.equal(snapshots, 1, "poll does not duplicate an in-flight load");
  assert.equal(published, 0);
  await api.time.advance(1);
  assert.equal(
    published,
    1,
    "timeout releases allSettled and publishes the working monitoring card",
  );
  assert.ok(globals.dataRef.current.graphError);
  api.transport(async () => ({ ok: true, text: async () => "{}" }));
  await api.time.advance(15_000);
  assert.ok(published >= 2);
  assert.equal(globals.dataRef.current.graphError, null);
  const fetchedAt = globals.dataRef.current.snapshotFetchedAtMonotonicMs;
  snapshotFailure = true;
  await api.time.advance(45_000);
  const stale = globals.dataRef.current;
  assert.ok(stale.snapshotError);
  assert.equal(
    stale.snapshotFetchedAtMonotonicMs,
    fetchedAt,
    "failed refresh cannot reset freshness",
  );
  const elapsed = (api.time.now() - fetchedAt) / 1000;
  assert.equal(
    freshnessAfterElapsed(
      stale.snapshot.contact.freshness,
      stale.snapshot.contact.age_seconds,
      elapsed,
      45,
    ),
    "stale",
  );
  assert.equal(
    freshnessAfterElapsed(
      stale.snapshot.latest_sample.do_freshness,
      stale.snapshot.latest_sample.sample_age_seconds,
      elapsed,
      30,
    ),
    "stale",
  );
  assert.equal(
    stale.snapshot.latest_sample.do_mg_l,
    5.8,
    "cached readings are preserved, not replaced with zero",
  );
  rt.state("background");
  const beforeBackground = snapshots;
  await api.time.advance(30_000);
  assert.equal(snapshots, beforeBackground);
  snapshotFailure = false;
  rt.state("active");
  await flush();
  assert.equal(globals.dataRef.current.snapshotError, null);
  assert.equal(
    globals.dataRef.current.snapshotFetchedAtMonotonicMs,
    api.time.now(),
  );
  assert.equal(
    freshnessAfterElapsed(
      globals.dataRef.current.snapshot.contact.freshness,
      1,
      0,
      45,
    ),
    "fresh",
  );
  let release;
  delaySnapshot = new Promise((resolve) => {
    release = resolve;
  });
  await api.time.advance(15_000);
  const before = published;
  scopeRef.current = { ...scope, selectedDeviceId: installationId };
  release();
  await flush();
  assert.equal(
    published,
    before,
    "device switch rejects late results even before cleanup",
  );
  stop();
  assert.equal(api.time.tasks.size, 0);
  assert.equal(rt.listeners.size, 0);
  scopeRef.current = scope;
  delaySnapshot = new Promise((resolve) => {
    release = resolve;
  });
  const stopUnmount = start();
  await flush();
  stopUnmount();
  release();
  await flush();
  assert.equal(
    published,
    before,
    "unmount rejects late results without a device switch",
  );
  assert.equal(api.time.tasks.size, 0);
  assert.equal(rt.listeners.size, 0);
});
