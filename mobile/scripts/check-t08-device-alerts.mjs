import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const installationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const selectedDeviceId = "22222222-2222-4222-8222-222222222222";
const otherDeviceId = "33333333-3333-4333-8333-333333333333";
const scope = { installationId, deviceId: selectedDeviceId, scopeRevision: 1 };
const device = (deviceId) => ({
  deviceId,
  alias: deviceId,
  model: "Synthetic",
  isSimulated: true,
  capabilities: {},
});
const access = {
  phase: "ready",
  ...scope,
  selectedDeviceId,
  devices: [device(selectedDeviceId), device(otherDeviceId)],
};

test("Metro forwards the monitoring contract version to the Edge API", async (t) => {
  const require = createRequire(import.meta.url);
  const { server } = require("../metro.config.js");
  const request = Readable.from([]);
  request.url =
    "/functions/v1/app-api/v2/devices/example/monitoring/do?window=6h";
  request.method = "GET";
  request.headers = {
    "x-contract-version": "2.8.0",
    "x-protocol-major": "2",
    "x-request-id": installationId,
  };
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response());
  await new Promise((resolve) => {
    const response = { setHeader() {}, end: resolve };
    server.enhanceMiddleware(() => {})(request, response, () => {});
  });
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(fetch.mock.calls[0].arguments[1].headers, request.headers);
});

function hookFixture() {
  const hooks = [];
  let cursor = 0;
  const effects = [];
  const memo = (create, deps) => {
    const index = cursor++;
    const last = hooks[index];
    if (last && deps?.every((value, i) => Object.is(value, last.deps[i])))
      return last.value;
    const value = create();
    hooks[index] = { deps, value };
    return value;
  };
  const useEffect = (callback, deps) => {
    const index = cursor++;
    const last = hooks[index];
    if (last && deps?.every((value, i) => Object.is(value, last.deps[i])))
      return;
    effects.push(() => {
      last?.cleanup?.();
      hooks[index] = { deps, cleanup: callback() };
    });
  };
  const react = {
    useRef: (current) => memo(() => ({ current }), []),
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useLayoutEffect: useEffect,
    useEffect,
    useState(initial) {
      const state = memo(() => ({ value: initial }), []);
      return [
        state.value,
        (next) => {
          state.value = typeof next === "function" ? next(state.value) : next;
        },
      ];
    },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  return {
    react,
    render(component) {
      cursor = 0;
      const result = component();
      for (const effect of effects.splice(0)) effect();
      return result;
    },
  };
}

function load(relativePath, modules, globals = {}) {
  const module = { exports: {} };
  const name = new URL(relativePath, import.meta.url);
  const source = ts.transpileModule(readFileSync(name, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: name.pathname,
  }).outputText;
  runInNewContext(source, {
    ...globals,
    crypto,
    Error,
    exports: module.exports,
    module,
    require(specifier) {
      assert.ok(Object.hasOwn(modules, specifier), "Unexpected " + specifier);
      return modules[specifier];
    },
  });
  return module.exports;
}

function updateFixture() {
  const registrations = new Map();
  return {
    registrations,
    api: {
      registerDeviceUpdateReader(key, resources, binding, read) {
        const owner = { resources: [...resources], binding, read };
        registrations.set(key, owner);
        return () => {
          if (registrations.get(key) === owner) registrations.delete(key);
        };
      },
    },
  };
}

const runPending = () => new Promise(setImmediate);

test("controller owns the selected hint, preserves fleet alerts, and keeps the 60s fallback", async () => {
  const { react, render } = hookFixture();
  const updates = updateFixture();
  const intervals = new Map();
  const calls = [];
  const losses = [];
  let currentError;
  let pendingRead;
  let releaseRead;
  const requestAppApi = async (
    _installation,
    path,
    _method,
    _body,
    headers,
  ) => {
    const deviceId = path.split("/")[2];
    calls.push(deviceId);
    if (deviceId === selectedDeviceId) {
      if (currentError) throw currentError;
      await pendingRead;
    }
    return {
      request_id: headers["X-Request-Id"],
      device_id: deviceId,
      events: [],
      has_more: false,
      next_cursor: null,
      unread_count: 1,
    };
  };

  const alerts = load("../src/lib/alerts.ts", {
    react,
    "./device-access": { requestAppApi },
  });
  const accessValue = {
    ...access,
    refreshDevices: async () => access.devices,
    reportDeviceAccessLoss: (lost) => losses.push(lost),
  };
  const { NotificationController } = load(
    "../src/lib/notification-controller.tsx",
    {
      react,
      expo: { isRunningInExpoGo: () => false },
      "expo-device": { isDevice: false },
      "expo-router": { router: {} },
      "react-native": {
        AppState: {
          currentState: "active",
          addEventListener: () => ({ remove() {} }),
        },
        Platform: { OS: "ios" },
      },
      "@/lib/device-access": {
        requestAppApi,
        useDeviceAccess: () => accessValue,
      },
      "@/lib/alerts": alerts,
      "@/lib/device-updates": { useDeviceUpdates: () => updates.api },
      "@/lib/push-payload": {},
    },
    {
      setInterval(callback, delay) {
        intervals.set(delay, callback);
        return delay;
      },
      clearInterval(id) {
        intervals.delete(id);
      },
    },
  );
  render(NotificationController);
  await runPending();
  assert.deepEqual(calls, [selectedDeviceId, otherDeviceId]);
  assert.equal(alerts.useUnreadCount(), 2);
  const registration = updates.registrations.get("alerts");
  assert.ok(
    registration,
    "the controller owns alerts while the sheet is closed",
  );
  assert.deepEqual(registration.resources, ["alerts"]);
  const context = {
    scope,
    binding: registration.binding,
    isCurrent: () => true,
  };
  assert.equal(await registration.read(context), undefined);
  assert.equal(calls.at(-1), selectedDeviceId);
  assert.equal(calls.length, 3, "a selected hint makes one authorized read");
  assert.equal(alerts.useUnreadCount(), 2, "the other feeder remains cached");

  currentError = Object.assign(new Error("temporary alert service failure"), {
    status: 502,
  });
  await assert.rejects(registration.read(context), /alert/i);
  assert.deepEqual(losses, []);
  currentError = undefined;

  let current = true;
  pendingRead = new Promise((resolve) => (releaseRead = resolve));
  const retired = registration.read({ ...context, isCurrent: () => current });
  await runPending();
  current = false;
  releaseRead();
  assert.equal(await retired, "deferred");
  assert.equal(alerts.useUnreadCount(), 2);

  currentError = Object.assign(new Error("revoked"), {
    code: "ACCESS_REVOKED",
    status: 403,
  });
  assert.equal(await registration.read(context), "deferred");
  assert.deepEqual(losses, [scope]);

  currentError = undefined;
  const fallback = intervals.get(60_000);
  assert.ok(fallback);
  fallback();
  await runPending();
  assert.deepEqual(calls.slice(-2), [selectedDeviceId, otherDeviceId]);
  const beforeConcurrentFleet = calls.length;
  await Promise.all([
    alerts.refreshAlerts(installationId, access.devices),
    alerts.refreshAlerts(installationId, access.devices),
  ]);
  assert.deepEqual(calls.slice(beforeConcurrentFleet), [
    selectedDeviceId,
    otherDeviceId,
  ]);
});

function nodes(tree, type) {
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, type));
  if (!tree || typeof tree !== "object") return [];
  return [
    ...(tree.type === type ? [tree] : []),
    ...nodes(tree.props?.children, type),
  ];
}

function screenModules(react, useDeviceAccess, updates, params = {}) {
  const jsx = (type, props) => ({ type, props });
  return {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      StyleSheet: { create: (styles) => styles },
      View: "View",
      Text: "Text",
    },
    "expo-router": {
      router: {},
      useLocalSearchParams: () => params,
      useFocusEffect: (callback) => react.useEffect(callback, [callback]),
    },
    "expo-constants": {},
    "@/components/app-shell": new Proxy({}, { get: (_target, name) => name }),
    "@/components/motion": { MotionSection: "MotionSection" },
    "@/constants/theme": { Spacing: {}, Typography: {} },
    "@/lib/device-access": { useDeviceAccess },
    "@/lib/device-access-state": { isUuid: () => true },
    "@/lib/device-updates": { useDeviceUpdates: () => updates.api },
    "@/lib/monitoring": {
      reportingConfigurationLabels: () => ({ applied: "—" }),
    },
  };
}

test("device overview consumes shared contact/profile and loads only selected configuration", async () => {
  const { react, render } = hookFixture();
  const updates = updateFixture();
  const calls = [];
  const losses = [];
  let failure;
  let readGate;
  let current = true;
  const state = {
    ...access,
    selectedDevice: access.devices[0],
    refreshDevices: async () => access.devices,
    reportDeviceAccessLoss: (lost) => losses.push(lost),
  };
  const { default: DeviceScreen } = load("../src/app/(tabs)/device.tsx", {
    ...screenModules(react, () => state, updates),
    "@/lib/schedules": {
      async readConfiguration(_installation, deviceId) {
        calls.push(deviceId);
        await readGate;
        if (failure) throw failure;
        return {
          current_state: {},
          applied_snapshot: {
            timezone: "Asia/Manila",
            monitoring_limits: {},
            low_feed_threshold_pct: null,
          },
        };
      },
    },
  });
  render(DeviceScreen);
  await runPending();
  assert.deepEqual(calls, [], "provider and focus must not each start a read");
  const registration = updates.registrations.get("configuration");
  assert.ok(registration);
  assert.deepEqual(registration.resources, ["configuration"]);
  const context = {
    scope,
    binding: registration.binding,
    isCurrent: () => current,
  };
  assert.equal(await registration.read(context), undefined);
  assert.deepEqual(calls, [selectedDeviceId]);

  state.selectedDevice = {
    ...state.selectedDevice,
    alias: "Updated profile",
    contactFreshness: "fresh",
  };
  state.devices = [state.selectedDevice, state.devices[1]];
  const tree = render(DeviceScreen);
  assert.equal(nodes(tree, "ListRow")[0].props.title, "Updated profile");
  assert.equal(
    nodes(nodes(tree, "ListRow")[0].props.footer, "StatusLabel")[0].props
      .children,
    "Online",
  );
  assert.equal(
    calls.length,
    1,
    "contact and profile rendering do not reload configuration",
  );
  assert.equal(updates.registrations.get("configuration"), registration);

  failure = new Error("Configuration timed out");
  await assert.rejects(registration.read(context), /timed out/);
  assert.ok(
    nodes(render(DeviceScreen), "Notice").some(
      (node) => node.props.children === "Configuration timed out",
    ),
  );
  assert.deepEqual(losses, []);

  let release;
  readGate = new Promise((resolve) => (release = resolve));
  const retired = registration.read(context);
  current = false;
  failure = Object.assign(new Error("Old scope revoked"), {
    code: "ACCESS_REVOKED",
  });
  release();
  assert.equal(await retired, "deferred");
  assert.deepEqual(losses, []);
});

test("device details can navigate to another feeder without claiming the feeding detail slot", async () => {
  const { react, render } = hookFixture();
  const updates = updateFixture();
  const params = { deviceId: selectedDeviceId };
  let fleetRefreshes = 0;
  const state = {
    ...access,
    refreshDevices: async () => {
      fleetRefreshes++;
      return access.devices;
    },
  };
  const { default: DeviceDetailsScreen } = load(
    "../src/app/devices/[deviceId].tsx",
    screenModules(react, () => state, updates, params),
  );
  let tree = render(DeviceDetailsScreen);
  assert.equal(nodes(tree, "ScreenHeader")[0].props.title, selectedDeviceId);
  assert.equal(fleetRefreshes, 0, "selected contact is owned by the provider");
  assert.equal(updates.registrations.has("detail"), false);
  params.deviceId = otherDeviceId;
  tree = render(DeviceDetailsScreen);
  assert.equal(nodes(tree, "ScreenHeader")[0].props.title, otherDeviceId);
  assert.equal(
    fleetRefreshes,
    1,
    "nonselected detail refreshes its fleet source on focus",
  );
  assert.equal(updates.registrations.has("detail"), false);
});

test("web removal is cancellable and confirms only the feeder captured when opened", async () => {
  const { react, render } = hookFixture();
  const params = { deviceId: selectedDeviceId };
  const revoked = [];
  const state = {
    ...access,
    refreshDevices: async () => access.devices,
    revokeDevice: async (id) => void revoked.push(id),
  };
  const modules = screenModules(react, () => state, updateFixture(), params);
  modules["react-native"].Platform = { OS: "web" };
  modules["expo-router"].router.replace = () => {};
  const { default: DeviceDetailsScreen } = load(
    "../src/app/devices/[deviceId].tsx",
    modules,
    { confirm: () => assert.fail("Removal must not use a browser prompt") },
  );
  const button = (tree, label) =>
    nodes(tree, "Button").find(({ props }) => props.children === label);
  const open = () => {
    button(render(DeviceDetailsScreen), "Remove this device").props.onPress();
    const sheet = nodes(render(DeviceDetailsScreen), "Sheet").find(
      ({ props }) => props.visible,
    );
    assert.ok(sheet);
    return sheet;
  };
  const cancel = open();
  assert.ok(cancel.props.title.includes(selectedDeviceId));
  button(cancel.props.footer, "Cancel").props.onPress();
  assert.equal(
    nodes(render(DeviceDetailsScreen), "Sheet").some(
      ({ props }) => props.visible,
    ),
    false,
  );
  assert.deepEqual(revoked, []);

  const staleConfirm = button(open().props.footer, "Remove access").props
    .onPress;
  params.deviceId = otherDeviceId;
  render(DeviceDetailsScreen);
  await staleConfirm();
  assert.deepEqual(revoked, []);

  await button(open().props.footer, "Remove access").props.onPress();
  assert.deepEqual(revoked, [otherDeviceId]);
});

test("feeder settings use the focused provider read and keep a failed read dirty", async () => {
  const { react, render } = hookFixture();
  const updates = updateFixture();
  let calls = 0;
  let configurationError;
  const owner = {
    ...access,
    getDeviceContactFreshness: () => "fresh",
    reportDeviceAccessLoss() {},
  };
  const { useFeederSettings } = load("../src/lib/feeder-settings.tsx", {
    ...screenModules(react, () => owner, updates),
    "@/lib/device-access-state": { sameDeviceRequestScope: () => true },
    "@/lib/monitoring": { monitoringSettingsRecoveryStatus: () => "clear" },
    "@/lib/schedules": {
      configurationForDevice: (configuration) => configuration,
      loadPendingWrite: async () => null,
      async readConfiguration() {
        calls++;
        if (configurationError) throw configurationError;
        return { current_state: {}, applied_snapshot: null };
      },
    },
  });
  render(() => useFeederSettings(selectedDeviceId));
  await runPending();
  assert.equal(
    calls,
    0,
    "settings focus delegates its initial load to provider",
  );
  const registration = updates.registrations.get("configuration");
  assert.ok(registration);
  assert.deepEqual(registration.resources, ["configuration"]);
  const context = {
    scope,
    binding: registration.binding,
    isCurrent: () => true,
  };
  assert.equal(await registration.read(context), undefined);
  assert.equal(calls, 1);
  configurationError = new Error("Feeder config unavailable");
  await assert.rejects(registration.read(context), /Feeder config unavailable/);
  assert.equal(calls, 2);
  assert.equal(
    render(() => useFeederSettings(selectedDeviceId)).activeSettings.error,
    "Feeder config unavailable",
  );
});
