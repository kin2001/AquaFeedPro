import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const deviceId = "11111111-1111-4111-8111-111111111111";
const otherDeviceId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const otherRunId = "44444444-4444-4444-8444-444444444444";
const newestRunId = "55555555-5555-4555-8555-555555555555";
const timestamp = "2026-11-20T00:00:00Z";
const node = (type, props) => ({ type, props });
const find = (view, type) => {
  if (Array.isArray(view)) return view.flatMap((child) => find(child, type));
  if (!view?.props) return [];
  return [
    ...(view.type === type ? [view] : []),
    ...find(view.props.children, type),
    ...find(view.props.footer, type),
  ];
};
const denial = () =>
  Object.assign(new Error("revoked"), { code: "ACCESS_REVOKED" });
const transient = () =>
  Object.assign(new Error("temporarily unavailable"), {
    code: "SERVICE_UNAVAILABLE",
  });
const pending = { idempotency_key: "saved-key", targets: [] };
const openCommand = {
  command_id: runId,
  idempotency_key: pending.idempotency_key,
  status: "running",
  nozzle_results: [],
};
const record = (sequence_id) => ({
  sequence_id,
  source: "manual",
  status: "completed",
  created_at: timestamp,
  received_at: timestamp,
  targets: [],
  nozzle_results: [],
});
const page = (sequenceId) => ({
  records: [record(sequenceId)],
  totals: { completed: 1, needs_attention: 0 },
  from_date: "2026-11-19",
  to_date: "2026-11-20",
  next_cursor: null,
});
const flush = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};

function renderRoute(path, services, initialParams = {}) {
  let params = initialParams;
  let selectedDeviceId = deviceId;
  let scopeRevision = 1;
  let focused = true;
  let index = 0;
  let jobs = [];
  const hooks = [];
  const readers = new Map();
  const losses = [];
  const writes = [];
  const accessScope = () => ({
    installationId: "fixture",
    deviceId: selectedDeviceId,
    scopeRevision,
  });
  const provider = {
    registerDeviceUpdateReader(key, resources, binding, read) {
      const scope = accessScope();
      const entry = { resources, binding, call };
      function call() {
        return read({
          binding,
          scope,
          isCurrent: () =>
            readers.get(key) === entry &&
            focused &&
            scope.deviceId === selectedDeviceId &&
            scope.scopeRevision === scopeRevision,
        });
      }
      readers.set(key, entry);
      return () => {
        if (readers.get(key) === entry) readers.delete(key);
      };
    },
  };
  const unchanged = (entry, deps) =>
    entry &&
    deps?.length === entry.deps?.length &&
    deps.every((dep, i) => Object.is(dep, entry.deps[i]));
  const effect = (fn, deps, focus = false) => {
    const position = index++;
    const previous = hooks[position];
    const dependencies = focus ? [...deps, focused] : deps;
    if (unchanged(previous, dependencies)) return;
    const entry = { deps: dependencies, focus };
    hooks[position] = entry;
    jobs.push(() => {
      previous?.cleanup?.();
      if (!focus || focused) entry.cleanup = fn();
    });
  };
  const react = {
    useState(initial) {
      const position = index++;
      if (!(position in hooks))
        hooks[position] = typeof initial === "function" ? initial() : initial;
      return [
        hooks[position],
        (next) => {
          const value =
            typeof next === "function" ? next(hooks[position]) : next;
          writes.push(value);
          hooks[position] = value;
        },
      ];
    },
    useRef: (current) => react.useState(() => ({ current }))[0],
    useCallback(fn, deps) {
      const position = index++;
      if (!unchanged(hooks[position], deps)) hooks[position] = { fn, deps };
      return hooks[position].fn;
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
  const capability = { enabled: true, doseModes: ["grams"], minDoseG: 5 };
  const refreshDevices = async () => [];
  const reportDeviceAccessLoss = (scope) => losses.push(scope);
  const modules = {
    react,
    "react/jsx-runtime": { jsx: node, jsxs: node },
    "react-native": {
      Platform: { select: (options) => options.default },
      StyleSheet: { create: (obj) => obj },
      useWindowDimensions: () => ({ fontScale: 1, width: 375 }),
    },
    "expo-router": {
      router: {},
      useFocusEffect: (fn) => effect(fn, [fn], true),
      useLocalSearchParams: () => params,
    },
    "@/components/app-shell": new Proxy(
      { statusIcons: {} },
      { get: (target, key) => target[key] ?? key },
    ),
    "@/components/feed-status": {
      relativeDayLabel: () => "Today",
      statusKind: () => "info",
      statusText: (status) => status,
      feedingReasonText: () => "Outcome",
    },
    "@/components/date-field": { calendarDate: () => true },
    "@/constants/theme": {
      Colors: { light: {} },
      Typography: {},
      Spacing: {},
      IconSize: {},
    },
    "@/lib/device-access": {
      useDeviceAccess: () => {
        const selectedDevice = {
          deviceId: selectedDeviceId,
          contactFreshness: "fresh",
          capabilities: { nozzles: { 1: capability, 2: capability } },
        };
        return {
          ...accessScope(),
          selectedDeviceId,
          selectedDevice,
          devices: [selectedDevice],
          refreshDevices,
          reportDeviceAccessLoss,
        };
      },
    },
    "@/lib/device-access-state": {
      isUuid: (value) => typeof value === "string" && value.length === 36,
    },
    "@/lib/device-updates": { useDeviceUpdates: () => provider },
    "@/lib/device-changes": { subscribeDeviceChanges: () => () => {} },
    "@/lib/error-text": { errorText: (error) => error.message },
    "@/lib/manual-feed": { manualInventoryNotice: () => null, ...services },
    "@/lib/monitoring-time": {
      feedChronology: () => ({ instant: timestamp, label: "Received" }),
      formatPhilippineTime: () => "8:00 AM",
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpile(
      readFileSync(new URL("../src/app/" + path, import.meta.url), "utf8"),
      {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    ),
    {
      exports,
      require: (name) => modules[name] ?? {},
      setTimeout,
      clearTimeout,
    },
  );
  const render = () => {
    index = 0;
    const view = exports.default();
    const pendingJobs = jobs;
    jobs = [];
    pendingJobs.forEach((job) => job());
    return view;
  };
  return {
    render,
    readers,
    writes,
    losses,
    focus(value) {
      focused = value;
      render();
    },
    switchDevice() {
      selectedDeviceId = otherDeviceId;
      scopeRevision++;
      render();
    },
    switchRun(nextRun) {
      params = { ...params, runId: nextRun };
      render();
    },
    notify(key, resource) {
      const entry = readers.get(key);
      if (entry?.resources.includes(resource)) return entry.call();
    },
  };
}

test("History reads feeding changes and retires delayed results after filter, blur and device changes", async () => {
  let read = async () => page(runId);
  const calls = [];
  const route = renderRoute("(tabs)/history.tsx", {
    readHistoryPage: async (...args) => {
      calls.push(args);
      return read();
    },
  });
  route.render();
  await flush();
  const history = route.readers.get("history");
  assert.equal(history?.resources.join(","), "feeding");
  assert.equal(route.notify("history", "history"), undefined);
  assert.equal(calls.length, 1);

  let finish;
  read = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const first = route.notify("history", "feeding");
  await flush();
  assert.equal(calls.length, 2);
  const filter = find(route.render(), "Segmented").find(
    (entry) => entry.props.value === "all",
  );
  assert.ok(filter);
  filter.props.onChange("manual");
  const apply = find(route.render(), "Button").find(
    (entry) => entry.props.children === "Apply filters",
  );
  assert.ok(apply);
  read = async () => page(otherRunId);
  apply.props.onPress();
  route.render();
  await flush();
  assert.notEqual(
    route.readers.get("history")?.binding.query,
    history.binding.query,
  );
  assert.equal(calls.at(-1)[2].source, "manual");
  const writesBefore = route.writes.length;
  finish(page(runId));
  assert.equal(await first, "deferred");
  assert.equal(route.writes.length, writesBefore);

  read = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const last = route.notify("history", "feeding");
  route.focus(false);
  read = async () => page(otherRunId);
  route.switchDevice();
  await flush();
  const latestWrites = route.writes.length;
  finish(page(runId));
  assert.equal(await last, "deferred");
  assert.equal(route.writes.length, latestWrites);
});

test("Feeding detail follows the focused run and reports definitive access loss only", async () => {
  let read = async (_installation, _device, id) => ({ record: record(id) });
  const calls = [];
  const route = renderRoute(
    "history/[runId].tsx",
    {
      readHistoryDetail(...args) {
        calls.push(args);
        return read(...args);
      },
    },
    { runId, device_id: deviceId },
  );
  route.render();
  await flush();
  const detail = route.readers.get("detail");
  assert.equal(detail?.resources.join(","), "feeding");
  assert.equal(detail.binding.query, runId);
  assert.equal(route.notify("detail", "history"), undefined);

  let finish;
  read = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const old = route.notify("detail", "feeding");
  read = async (_installation, _device, id) => ({ record: record(id) });
  route.switchRun(otherRunId);
  await flush();
  assert.equal(route.readers.get("detail")?.binding.query, otherRunId);
  assert.equal(calls.at(-1)[2], otherRunId);
  const writesBefore = route.writes.length;
  finish({ record: record(runId) });
  assert.equal(await old, "deferred");
  assert.equal(route.writes.length, writesBefore);

  const missing = Object.assign(new Error("run missing"), {
    code: "RESOURCE_NOT_FOUND",
  });
  read = async () => {
    throw missing;
  };
  await assert.rejects(route.notify("detail", "feeding"), missing);
  assert.equal(route.losses.length, 0);
  read = async () => {
    throw denial();
  };
  await assert.rejects(route.notify("detail", "feeding"), {
    code: "ACCESS_REVOKED",
  });
  assert.equal(route.losses.length, 1);
  assert.equal(route.losses[0].deviceId, deviceId);
});

test("History refresh preserves an already loaded older page and nonfinal cursor", async () => {
  const displacedRunId = "66666666-6666-4666-8666-666666666666";
  let read = async () => ({
    ...page(runId),
    records: [record(runId), record(displacedRunId)],
    next_cursor: "older",
  });
  const requests = [];
  const route = renderRoute("(tabs)/history.tsx", {
    readHistoryPage: async (...args) => {
      requests.push(args[2].cursor);
      return read();
    },
  });
  route.render();
  await flush();
  const more = (view) =>
    find(view, "Button").find((entry) => entry.props.children === "Load more");
  read = async () => ({ ...page(otherRunId), next_cursor: "oldest" });
  more(route.render()).props.onPress();
  await flush();
  assert.equal(requests.at(-1), "older");
  read = async () => ({
    ...page(newestRunId),
    records: [record(newestRunId), record(runId)],
    next_cursor: "newer-cursor",
  });
  assert.equal(await route.notify("history", "feeding"), undefined);
  const nextView = route.render();
  assert.deepEqual(
    find(nextView, "FeedingRow").map((entry) => entry.props.record.sequence_id),
    [newestRunId, runId, displacedRunId, otherRunId],
  );
  more(nextView).props.onPress();
  await flush();
  assert.equal(requests.at(-1), "oldest");
});

test("Command reader binds the command and awaits reconciliation before success", async () => {
  const calls = [];
  let status = async () => openCommand;
  const route = renderRoute("feed/confirm.tsx", {
    loadPendingManualFeed: async () => pending,
    reconcileManualFeed: async (...args) => {
      calls.push(args);
      return status();
    },
  });
  route.render();
  await flush();
  route.render();
  const reader = route.readers.get("command");
  assert.equal(reader?.resources.join(","), "feeding");
  assert.equal(reader.binding.query, runId);
  assert.equal(route.notify("command", "history"), undefined);

  let finish;
  status = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  let settled = false;
  const work = route.notify("command", "feeding").then((result) => {
    settled = true;
    return result;
  });
  await flush();
  assert.equal(calls.at(-1)[2], pending.idempotency_key);
  assert.equal(settled, false);
  finish(openCommand);
  assert.equal(await work, undefined);

  status = async () => ({ ...openCommand, command_id: otherRunId });
  const writesAtMismatch = route.writes.length;
  assert.equal(await route.notify("command", "feeding"), "deferred");
  assert.equal(
    route.writes
      .slice(writesAtMismatch)
      .some((value) => value?.command_id === otherRunId),
    false,
  );

  status = async () => {
    throw transient();
  };
  await assert.rejects(route.notify("command", "feeding"), {
    code: "SERVICE_UNAVAILABLE",
  });
  assert.equal(route.losses.length, 0);
  status = async () => {
    throw denial();
  };
  await assert.rejects(route.notify("command", "feeding"), {
    code: "ACCESS_REVOKED",
  });
  assert.equal(route.losses.length, 1);

  status = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const old = route.notify("command", "feeding");
  await flush();
  route.switchDevice();
  const writesBefore = route.writes.length;
  finish(openCommand);
  assert.equal(await old, "deferred");
  assert.equal(route.writes.length, writesBefore);
});
