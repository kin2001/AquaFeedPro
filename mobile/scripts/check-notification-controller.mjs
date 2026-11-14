import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const deviceId = "22222222-2222-4222-8222-222222222222";
const installationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "11111111-1111-4111-8111-111111111111";
const device = {
  deviceId,
  alias: "Synthetic feeder",
  model: "AquaFeed",
  isSimulated: true,
};
const event = {
  event_id: eventId,
  device_id: deviceId,
  kind: "do_low",
  value: 2.5,
  limit: 4,
  measured_at: "2026-11-13T00:00:00Z",
  raised_at: "2026-11-13T00:00:01Z",
  applied_revision: 1,
  boot_id: "33333333-3333-4333-8333-333333333333",
  sample_sequence: 1,
  sequence_id: null,
  is_simulated: true,
  is_read: false,
  is_dismissed: false,
};
const response = {
  notification: {
    request: {
      identifier: "synthetic-system-notification",
      content: {
        data: {
          device_id: deviceId,
          event_id: eventId,
          route_hint: "notifications",
        },
      },
    },
  },
};
const sources = Object.fromEntries(
  ["alerts", "push-payload", "notification-controller"].map((name) => [
    name,
    ts.transpileModule(
      readFileSync(
        new URL(
          `../src/lib/${name}.${name === "notification-controller" ? "tsx" : "ts"}`,
          import.meta.url,
        ),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
  ]),
);

function fixture({
  permission = "granted",
  os = "android",
  refreshRenders = false,
} = {}) {
  const hooks = [],
    effects = [],
    layouts = [],
    listeners = new Map(),
    appListeners = new Set();
  const calls = [],
    navigations = [],
    selected = [],
    channels = [];
  let hookIndex = 0,
    nextTimer = 0,
    notificationsLoaded = 0,
    prompts = 0,
    clears = 0;
  let token = "ExponentPushToken[synthetic_mobile_001]",
    revoked = false,
    selectionGate;
  let releaseSelection;
  const same = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  function effect(queue, callback, deps) {
    const index = hookIndex++;
    if (!same(hooks[index]?.deps, deps))
      queue.push(() => {
        hooks[index]?.cleanup?.();
        hooks[index] = { deps, cleanup: callback() };
      });
  }
  const react = {
    useRef(initial) {
      const index = hookIndex++;
      return hooks[index] ?? (hooks[index] = { current: initial });
    },
    useCallback(callback, deps) {
      const index = hookIndex++;
      if (!same(hooks[index]?.deps, deps)) hooks[index] = { deps, callback };
      return hooks[index].callback;
    },
    useEffect: (callback, deps) => effect(effects, callback, deps),
    useLayoutEffect: (callback, deps) => effect(layouts, callback, deps),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  };
  const access = {
    phase: "ready",
    installationId,
    devices: [device],
    async refreshDevices() {
      if (refreshRenders) {
        access.devices = [...access.devices];
        render();
      }
      return access.devices;
    },
    async selectDevice(id) {
      selected.push(id);
      await selectionGate;
    },
  };
  async function requestAppApi(installation, path, method, body, headers) {
    calls.push({ installation, path, method, body, headers });
    if (path === "/push-token")
      return { request_id: body.request_id, registered: method === "POST" };
    if (revoked)
      throw Object.assign(new Error("Synthetic revoked membership"), {
        status: 403,
        code: "ACCESS_REVOKED",
      });
    if (path.endsWith(`/${eventId}`))
      return {
        request_id: headers["X-Request-Id"],
        device_id: deviceId,
        event,
      };
    return {
      request_id: headers["X-Request-Id"],
      device_id: deviceId,
      events: [],
      has_more: false,
      next_cursor: null,
      unread_count: 0,
    };
  }
  const notifications = {
    AndroidImportance: { HIGH: 4 },
    setNotificationHandler() {},
    async setNotificationChannelAsync(id) {
      channels.push(id);
    },
    async getPermissionsAsync() {
      return { status: permission, granted: permission === "granted" };
    },
    async requestPermissionsAsync() {
      prompts++;
      return { status: permission, granted: permission === "granted" };
    },
    async getExpoPushTokenAsync() {
      return { data: token };
    },
    async getLastNotificationResponseAsync() {
      return null;
    },
    async clearLastNotificationResponseAsync() {
      clears++;
    },
    addNotificationReceivedListener: (callback) => listen("received", callback),
    addNotificationResponseReceivedListener: (callback) =>
      listen("response", callback),
    addPushTokenListener: (callback) => listen("token", callback),
  };
  function listen(name, callback) {
    listeners.set(name, callback);
    return { remove: () => listeners.delete(name) };
  }
  const modules = {};
  function load(name) {
    if (modules[name]) return modules[name];
    const module = { exports: {} };
    runInNewContext(sources[name], {
      exports: module.exports,
      module,
      crypto,
      Date,
      Promise,
      setInterval: () => ++nextTimer,
      clearInterval() {},
      require(specifier) {
        if (specifier === "react") return react;
        if (specifier === "expo") return { isRunningInExpoGo: () => false };
        if (specifier === "expo-device") return { isDevice: true };
        if (specifier === "expo-router")
          return { router: { push: (target) => navigations.push(target) } };
        if (specifier === "react-native")
          return {
            Platform: { OS: os },
            AppState: {
              currentState: "active",
              addEventListener(_name, callback) {
                appListeners.add(callback);
                return { remove: () => appListeners.delete(callback) };
              },
            },
          };
        if (specifier === "expo-notifications") {
          notificationsLoaded++;
          return notifications;
        }
        if (["./device-access", "@/lib/device-access"].includes(specifier))
          return { requestAppApi, useDeviceAccess: () => access };
        if (specifier === "@/lib/alerts") return load("alerts");
        if (specifier === "@/lib/push-payload") return load("push-payload");
        if (specifier === "@/lib/supabase")
          return {
            supabase: {
              channel() {
                const channel = {
                  on() {
                    return channel;
                  },
                  subscribe() {
                    return channel;
                  },
                };
                return channel;
              },
              async removeChannel() {},
            },
          };
        throw new Error(`Unexpected controller import: ${specifier}`);
      },
    });
    return (modules[name] = module.exports);
  }
  const controller = load("notification-controller");
  function render() {
    hookIndex = 0;
    controller.NotificationController();
    while (layouts.length) layouts.shift()();
    while (effects.length) effects.shift()();
  }
  render();
  return {
    access,
    calls,
    navigations,
    selected,
    channels,
    setPermission(value) {
      permission = value;
    },
    setToken(value) {
      token = value;
    },
    revoke() {
      revoked = true;
    },
    render,
    pauseSelection() {
      selectionGate = new Promise((resolve) => {
        releaseSelection = resolve;
      });
    },
    releaseSelection() {
      releaseSelection();
    },
    resume() {
      for (const callback of [...appListeners]) callback("active");
    },
    respond() {
      listeners.get("response")?.(response);
    },
    refreshToken() {
      listeners.get("token")?.({ type: "fcm", data: "synthetic-native-token" });
    },
    get prompts() {
      return prompts;
    },
    get clears() {
      return clears;
    },
    get notificationsLoaded() {
      return notificationsLoaded;
    },
    get entries() {
      return load("alerts").useAlerts();
    },
    unmount() {
      for (const hook of hooks) hook?.cleanup?.();
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 25; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
const registrations = (app) =>
  app.calls.filter(
    (call) => call.path === "/push-token" && call.method === "POST",
  );

let app = fixture({ permission: "denied" });
await flush();
assert.equal(
  registrations(app).length,
  0,
  "denied permission never registers a token",
);
assert.equal(
  app.calls.some(
    (call) => call.path === "/push-token" && call.method === "DELETE",
  ),
  true,
);
assert.equal(app.prompts, 0, "denied permission is not repeatedly prompted");
app.setPermission("granted");
app.resume();
await flush();
assert.equal(
  registrations(app).length,
  1,
  "settings regrant registers on resume",
);
assert.equal(
  app.channels[0],
  "feeder-alerts",
  "channel exists before permission/token registration",
);
app.setToken("ExponentPushToken[synthetic_mobile_002]");
app.refreshToken();
await flush();
assert.equal(
  registrations(app).at(-1).body.expo_push_token,
  "ExponentPushToken[synthetic_mobile_002]",
  "token refresh replaces registration",
);
app.access.installationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
app.render();
await flush();
assert.equal(
  registrations(app).at(-1).installation,
  app.access.installationId,
  "replacement installation never reuses the previous installation identity",
);
app.unmount();

app = fixture({ permission: "undetermined" });
await flush();
app.resume();
await flush();
assert.equal(
  app.prompts,
  1,
  "undetermined permission prompts once per controller mount",
);
assert.equal(registrations(app).length, 0);
app.unmount();

app = fixture();
await flush();
app.revoke();
app.respond();
await flush();
assert.equal(app.navigations.length, 0, "a revoked tap cannot navigate");
assert.equal(app.selected.length, 0, "a revoked tap cannot select its feeder");
assert.equal(app.entries.length, 0, "a revoked tap cannot pin protected data");
assert.equal(
  app.clears,
  1,
  "definitive access denial clears the native response",
);
app.unmount();

app = fixture({ os: "ios" });
await flush();
assert.equal(
  app.notificationsLoaded,
  0,
  "iOS remains explicitly unsupported by this Android-only baseline, not accepted by mocks",
);
assert.equal(registrations(app).length, 0);
app.unmount();

app = fixture();
await flush();
app.respond();
await flush();
app.respond();
await flush();
assert.equal(
  app.navigations.length,
  1,
  "a verified tap navigates once, even if the system repeats the response",
);
assert.equal(
  app.entries.length,
  1,
  "authorized event lookup pins the real parsed event",
);
app.unmount();

// A normal membership refresh returns a fresh array even when IDs are unchanged.
app = fixture({ refreshRenders: true });
await flush();
app.respond();
await flush();
app.respond();
await flush();
assert.equal(
  app.navigations.length,
  1,
  "same-membership refresh must not silently consume or duplicate an authorized tap",
);
app.unmount();

for (const change of [
  "membership-removed",
  "installation-replaced",
  "unmounted",
]) {
  app = fixture();
  await flush();
  app.pauseSelection();
  app.respond();
  await flush();
  assert.equal(
    app.selected.length,
    1,
    "the authorized lookup reached selection before the lifecycle race",
  );
  if (change === "membership-removed") {
    app.access.devices = [];
    app.render();
  }
  if (change === "installation-replaced") {
    app.access.installationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    app.render();
  }
  if (change === "unmounted") app.unmount();
  app.releaseSelection();
  await flush();
  assert.equal(
    app.navigations.length,
    0,
    `late selection cannot navigate after ${change}`,
  );
  assert.equal(
    app.entries.length,
    0,
    `late selection cannot pin protected data after ${change}`,
  );
  app.unmount();
}
console.log(
  "Notification controller checks passed (permission, token refresh, installation replacement, access denial, deduplication and same-membership refresh).",
);
