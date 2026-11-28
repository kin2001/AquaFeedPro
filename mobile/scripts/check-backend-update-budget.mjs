import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const feederIds = Array.from(
  { length: 5 },
  (_, index) => `00000000-0000-4000-8000-00000000000${index + 1}`,
);
const counters = [
  "monitoring",
  "graph",
  "configuration",
  "next",
  "history",
  "revisions",
];
const readSource = (file) =>
  readFileSync(new URL(file, import.meta.url), "utf8");

function compile(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return new vm.Script(outputText);
}

function evaluate(script, imports, globals = {}) {
  const module = { exports: {} };
  script.runInNewContext({
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
      return imports[name];
    },
    ...globals,
  });
  return module.exports;
}

function homeEffects() {
  // Exercise the checked-in effects and their real reader registrations.
  // React focus scheduling, the transport, and network readers are the doubles.
  const source = ts.createSourceFile(
    "index.tsx",
    readSource("../src/app/(tabs)/index.tsx"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const callbacks = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useFocusEffect" &&
      ts.isCallExpression(node.arguments[0])
    )
      callbacks.push(node.arguments[0].arguments[0].getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  return ["const readers", "registerDeviceUpdateReader"].map((marker) => {
    const matches = callbacks.filter((callback) => callback.includes(marker));
    assert.equal(matches.length, 1, `Home callback containing ${marker}`);
    return compile(`module.exports = ${matches[0]};`);
  });
}

const homeScripts = homeEffects();
const updateState = evaluate(
  compile(readSource("../src/lib/device-update-state.ts")),
  {},
);
const transportScript = compile(readSource("../src/lib/device-changes.ts"));
const providerScript = compile(readSource("../src/lib/device-updates.tsx"));

function fakeClock() {
  let now = 0;
  let id = 0;
  const tasks = new Map();
  const add = (callback, delay, repeats) => {
    tasks.set(++id, { callback, at: now + delay, delay, repeats });
    return id;
  };
  return {
    tasks,
    now: () => now,
    setTimeout: (callback, delay) => add(callback, delay, false),
    clearTimeout: (id) => tasks.delete(id),
    setInterval: (callback, delay) => add(callback, delay, true),
    clearInterval: (id) => tasks.delete(id),
    async advance(ms) {
      const end = now + ms;
      await flush();
      while (true) {
        const next = [...tasks].reduce((earliest, candidate) => {
          if (candidate[1].at > end) return earliest;
          return !earliest || candidate[1].at < earliest[1].at
            ? candidate
            : earliest;
        }, null);
        if (!next) break;
        const [taskId, task] = next;
        now = task.at;
        if (task.repeats) task.at += task.delay;
        else tasks.delete(taskId);
        task.callback();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

function createViewer(index, time, revisionsFor) {
  const installationId = `00000000-0001-4000-8000-${String(index + 1).padStart(12, "0")}`;
  const channels = [];
  const listeners = new Set();
  const reads = [];
  const publications = [];
  let pendingMonitoring;
  let pendingGraph;
  let failGraph = false;
  let selection;
  let cleanup = [];
  let displayTicks = 0;
  const AppState = {
    currentState: "active",
    addEventListener(event, callback) {
      assert.equal(event, "change");
      listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    },
  };
  const supabase = {
    channel(topic, options) {
      assert.equal(options.config.private, true);
      const result = {
        topic,
        removed: false,
        on(event, filter, callback) {
          assert.equal(event, "broadcast");
          assert.equal(filter.event, "resource_update");
          this.receive = callback;
          return this;
        },
        subscribe(callback) {
          this.status = callback;
          return this;
        },
      };
      channels.push(result);
      return result;
    },
    async removeChannel(channel) {
      channel.removed = true;
    },
  };
  const { subscribeDeviceUpdates } = evaluate(transportScript, {
    "@/lib/supabase": { supabase },
    "./device-update-state": updateState,
  });
  const { createDeviceUpdates } = evaluate(
    providerScript,
    {
      react: { createContext: () => ({}) },
      "react-native": { AppState },
      "./device-update-state": updateState,
    },
    {
      ...time,
      Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    },
  );
  const blur = () => {
    cleanup.forEach((dispose) => dispose());
    cleanup = [];
  };
  function focus(window = "1h") {
    const { deviceId, scopeRevision, updates } = selection;
    const currentScope = {
      installationId,
      selectedDeviceId: deviceId,
      revision: scopeRevision,
    };
    const dataRef = { current: null };
    const read = (resource, response) => async (install, device, query) => {
      assert.equal(install, installationId);
      assert.equal(device, deviceId);
      const call = { resource, device, query, at: time.now(), error: false };
      reads.push(call);
      try {
        return await response(device, query);
      } catch (error) {
        call.error = true;
        throw error;
      }
    };
    const globals = {
      ...time,
      installationId,
      deviceId,
      currentScope,
      scopeRef: { current: currentScope },
      requestedWindowRef: { current: window },
      window,
      performance: { now: time.now },
      independentTelemetry: true,
      providerLoadRef: { current: null },
      providerUpdates: updates,
      scopeKey: `${deviceId}:${scopeRevision}`,
      dataRef,
      setData(data) {
        publications.push(data);
      },
      setMonotonicNowMs() {
        displayTicks++;
      },
      sameDeviceRequestScope: (a, b) =>
        a.installationId === b.installationId &&
        a.selectedDeviceId === b.selectedDeviceId &&
        a.revision === b.revision,
      reportDeviceAccessLoss: () => assert.fail("Unexpected access loss"),
      readMetricSnapshot: read("monitoring", async (device) => {
        if (pendingMonitoring) await pendingMonitoring;
        return {
          device_id: device,
          resources: { do: { status: "valid" }, feed: { status: "valid" } },
        };
      }),
      readMonitoringSnapshot: () => assert.fail("Unexpected legacy snapshot"),
      readDoGraph: read("graph", async (device, requestedWindow) => {
        if (pendingGraph) await pendingGraph;
        if (failGraph) {
          failGraph = false;
          throw new Error("Synthetic graph fault");
        }
        return { device_id: device, window: requestedWindow };
      }),
      readConfiguration: read("configuration", async (device) => ({
        device_id: device,
        revision: revisionsFor(device).configuration,
      })),
      readNextOccurrence: read("next", async () => null),
      readHistoryPage: read("history", async () => null),
      message: (error) => error.message,
      AppState,
    };
    cleanup = homeScripts.map((script) => evaluate(script, {}, globals)());
  }
  function select(deviceId, scopeRevision) {
    blur();
    selection?.updates.stop();
    const scope = { installationId, deviceId, scopeRevision };
    const updates = createDeviceUpdates(scope, subscribeDeviceUpdates, {
      async readRevisions(actualScope) {
        assert.equal(actualScope.deviceId, deviceId);
        reads.push({
          resource: "revisions",
          device: deviceId,
          at: time.now(),
          error: false,
        });
        return { ...revisionsFor(deviceId) };
      },
    });
    selection = { ...scope, updates };
    focus();
    updates.start();
  }
  return {
    reads,
    publications,
    channels,
    select,
    focus,
    blur,
    get selected() {
      return selection.deviceId;
    },
    get channel() {
      return channels.at(-1);
    },
    get ticks() {
      return displayTicks;
    },
    hold: (promise) => {
      pendingMonitoring = promise;
    },
    holdGraph: (promise) => {
      pendingGraph = promise;
    },
    fault: () => {
      failGraph = true;
    },
    stop() {
      blur();
      selection.updates.stop();
      assert.equal(listeners.size, 0);
      assert.ok(channels.every((channel) => channel.removed));
    },
  };
}

function summarize(calls) {
  const counts = Object.fromEntries(
    counters.map((key) => [
      key,
      calls.filter((call) => call.resource === key).length,
    ]),
  );
  return {
    ...counts,
    networkReads: calls.length,
    otherReads: counts.configuration + counts.next + counts.history,
    errors: calls.filter((call) => call.error).length,
  };
}

async function budgetScenario(viewerCount) {
  const time = fakeClock();
  const revisions = new Map(
    feederIds.map((id) => [
      id,
      Object.fromEntries(updateState.DEVICE_RESOURCES.map((key) => [key, 0])),
    ]),
  );
  const viewers = Array.from({ length: viewerCount }, (_, index) =>
    createViewer(index, time, (id) => revisions.get(id)),
  );
  const all = (action) => viewers.forEach(action);
  const after = (offsets) =>
    viewers.flatMap((viewer, index) => viewer.reads.slice(offsets[index]));
  const mark = () => viewers.map((viewer) => viewer.reads.length);
  async function phase(action) {
    const start = mark();
    await action();
    return summarize(after(start));
  }
  function deliver(channel, deviceId, resources) {
    channel.receive({
      type: "broadcast",
      event: "resource_update",
      payload: {
        id: deviceId,
        device_id: deviceId,
        resources,
        revisions: Object.fromEntries(
          resources.map((key) => [key, revisions.get(deviceId)[key]]),
        ),
      },
    });
  }
  function emit(resources) {
    for (const id of feederIds)
      for (const key of resources) revisions.get(id)[key]++;
    all((viewer) => deliver(viewer.channel, viewer.selected, resources));
  }
  const ready = (viewer) => {
    assert.equal(viewer.channel.topic, `device:${viewer.selected}:updates`);
    viewer.channel.status("SUBSCRIBED");
  };
  const initial = await phase(async () => {
    all((viewer, index) =>
      viewer.select(feederIds[index % feederIds.length], 1),
    );
    all(ready);
    await time.advance(0);
  });
  assert.equal(initial.networkReads, 6 * viewerCount);
  const peakChannels = viewers.reduce(
    (sum, viewer) =>
      sum + viewer.channels.filter((channel) => !channel.removed).length,
    0,
  );
  assert.equal(peakChannels, viewerCount);

  const oldTicks = viewers.map((viewer) => viewer.ticks);
  const healthy = await phase(() => time.advance(60_000));
  all((viewer, index) => assert.equal(viewer.ticks - oldTicks[index], 12));
  // Counterfactual control only: five reads per active viewer every 15 seconds,
  // over the same 60-second window, excluding startup and all other phases.
  const legacyIdleControl = viewerCount * 5 * (60_000 / 15_000);
  const healthyReconciliation = await phase(() => time.advance(240_000));
  assert.equal(healthyReconciliation.revisions, viewerCount);
  assert.equal(healthyReconciliation.networkReads, viewerCount);

  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  all((viewer) => viewer.hold(held));
  const atHint = time.now();
  const start = mark();
  emit(["do"]);
  await time.advance(249);
  assert.equal(after(start).length, 0);
  await time.advance(1);
  const oxygenCalls = after(start);
  const oxygen = summarize(oxygenCalls);
  for (const call of oxygenCalls) assert.equal(call.at - atHint, 250);
  all((viewer, index) => {
    const calls = summarize(viewer.reads.slice(start[index]));
    assert.equal(calls.monitoring, 1);
    assert.equal(calls.graph, 1);
    assert.equal(calls.otherReads, 0);
  });
  const dirtyFollowUp = await phase(async () => {
    const during = mark();
    for (let index = 0; index < 100; index++) emit(["do", "feed"]);
    await time.advance(250);
    assert.equal(summarize(after(during)).monitoring, 0);
    all((viewer) => viewer.hold(undefined));
    release();
    await time.advance(0);
    await time.advance(250);
    all((viewer, index) =>
      assert.equal(summarize(viewer.reads.slice(during[index])).monitoring, 1),
    );
  });
  all((viewer) =>
    assert.deepEqual(
      Object.keys(viewer.publications.at(-1).metricSnapshot.resources),
      ["do", "feed"],
    ),
  );

  const hidden = await phase(async () => {
    all((viewer) => viewer.blur());
    emit(["configuration", "feeding", "do", "history"]);
    await time.advance(250);
  });
  const refocus = await phase(async () => {
    all((viewer) => viewer.focus("6h"));
    await time.advance(0);
  });
  const visibleConfiguration = await phase(async () => {
    emit(["configuration"]);
    await time.advance(250);
  });
  assert.equal(visibleConfiguration.configuration, viewerCount);
  assert.equal(visibleConfiguration.next, viewerCount);
  assert.equal(visibleConfiguration.networkReads, 2 * viewerCount);
  const visibleFeeding = await phase(async () => {
    emit(["feeding"]);
    await time.advance(250);
  });
  assert.equal(visibleFeeding.history, viewerCount);
  assert.equal(visibleFeeding.next, viewerCount);
  assert.equal(visibleFeeding.networkReads, 2 * viewerCount);

  const rejoin = await phase(async () => {
    const oldChannels = viewers.map((viewer) => viewer.channel);
    all((viewer) => viewer.channel.status("CHANNEL_ERROR"));
    for (const id of feederIds) revisions.get(id).do++;
    await time.advance(1_000);
    all((viewer, index) => assert.equal(oldChannels[index].removed, true));
    all(ready);
    await time.advance(0);
  });
  assert.equal(rejoin.monitoring, viewerCount);
  assert.equal(rejoin.revisions, viewerCount);

  const fallback = await phase(async () => {
    all((viewer) => viewer.fault());
    emit(["history"]);
    await time.advance(250);
    const beforeRetry = mark();
    await time.advance(29_999);
    assert.equal(after(beforeRetry).length, 0);
    await time.advance(1);
    assert.equal(summarize(after(beforeRetry)).graph, viewerCount);
    assert.equal(summarize(after(beforeRetry)).monitoring, 0);
  });

  const isolationReads = mark();
  all((viewer) => {
    const other = feederIds.find((id) => id !== viewer.selected);
    revisions.get(other).do += 1000;
    deliver(viewer.channel, other, ["do"]);
  });
  await time.advance(250);
  assert.equal(after(isolationReads).length, 0);

  let releaseGraph;
  const oldGraph = new Promise((resolve) => {
    releaseGraph = resolve;
  });
  all((viewer) => viewer.holdGraph(oldGraph));
  emit(["history"]);
  await time.advance(250);
  const beforeWindow = viewers.map((viewer) => viewer.publications.length);
  const window = await phase(async () => {
    all((viewer) => {
      viewer.holdGraph(undefined);
      viewer.blur();
      viewer.focus("24h");
    });
    await time.advance(0);
    releaseGraph();
    await time.advance(250);
  });
  all((viewer, index) => {
    assert.equal(viewer.publications.at(-1).graph.window, "24h");
    for (const view of viewer.publications.slice(beforeWindow[index]))
      if (view.graph) assert.equal(view.graph.window, "24h");
  });

  let releaseRetired;
  const retired = new Promise((resolve) => {
    releaseRetired = resolve;
  });
  all((viewer) => viewer.hold(retired));
  emit(["do"]);
  await time.advance(250);
  const retiredIds = viewers.map((viewer) => viewer.selected);
  const beforeSwitch = viewers.map((viewer) => viewer.publications.length);
  const switchReads = await phase(async () => {
    all((viewer, index) => {
      viewer.hold(undefined);
      viewer.select(feederIds[(index + 1) % feederIds.length], 2);
    });
    all(ready);
    await time.advance(0);
    releaseRetired();
    await time.advance(250);
  });
  let stalePublications = 0;
  all((viewer, index) => {
    for (const view of viewer.publications.slice(beforeSwitch[index])) {
      if (view.metricSnapshot?.device_id === retiredIds[index])
        stalePublications++;
      if (view.graph) assert.equal(view.graph.device_id, viewer.selected);
    }
    assert.equal(
      viewer.publications.at(-1).metricSnapshot.device_id,
      viewer.selected,
    );
    viewer.stop();
  });
  await time.advance(0);
  assert.equal(time.tasks.size, 0);
  return {
    viewers: viewerCount,
    feeders: feederIds.length,
    peakChannels,
    initial,
    legacyIdleControl,
    healthy,
    healthyReconciliation,
    oxygen: {
      ...oxygen,
      syntheticFirstReadDelayMs: oxygenCalls[0].at - atHint,
    },
    dirtyFollowUp,
    hidden,
    refocus,
    visibleConfiguration,
    visibleFeeding,
    rejoin,
    fallback,
    window,
    isolation: { stalePublications, switchReads },
  };
}

for (const viewerCount of [1, 5, 20]) {
  test(`Task 11 request budget with ${viewerCount} synthetic viewers`, async () => {
    const report = await budgetScenario(viewerCount);
    assert.equal(report.healthy.networkReads, 0);
    assert.equal(report.oxygen.monitoring, viewerCount);
    assert.equal(report.oxygen.graph, viewerCount);
    assert.equal(report.oxygen.otherReads, 0);
    assert.equal(report.dirtyFollowUp.monitoring, viewerCount);
    assert.equal(report.dirtyFollowUp.otherReads, 0);
    assert.equal(report.hidden.networkReads, 0);
    assert.equal(report.rejoin.errors, 0);
    assert.equal(report.fallback.errors, viewerCount);
    assert.equal(report.isolation.stalePublications, 0);
    console.log(JSON.stringify(report));
  });
}
