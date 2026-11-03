import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./device-access" &&
      context.parentURL?.endsWith("/src/lib/alerts.ts")
    ) {
      return {
        url: "data:text/javascript,export%20const%20requestAppApi%20%3D%20async%20()%20%3D%3E%20undefined",
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { alertEntryFromEvent, alertLine, alertTitle, detectAlerts } =
  await import("../src/lib/alerts.ts");

const limits = { doLow: 4, doHigh: 9, feedLow: 20 };
const reading = (doMgL, feedPercent) => ({ doMgL, feedPercent });

// Limit not set: that kind is false and never raised, even from an active state.
assert.deepEqual(
  detectAlerts(
    reading(1, 1),
    { doLow: null, doHigh: null, feedLow: null },
    { do_low: true, do_high: true, feed_low: true },
  ),
  { state: { do_low: false, do_high: false, feed_low: false }, raised: [] },
);

// Value outside, previously inactive: raised.
assert.deepEqual(detectAlerts(reading(3.8, 18), limits, {}), {
  state: { do_low: true, do_high: false, feed_low: true },
  raised: ["do_low", "feed_low"],
});
assert.deepEqual(detectAlerts(reading(9.5, 50), limits, {}).raised, [
  "do_high",
]);

// Value outside, already active: stays active, not raised again.
assert.deepEqual(
  detectAlerts(reading(3.8, 18), limits, { do_low: true, feed_low: true }),
  { state: { do_low: true, do_high: false, feed_low: true }, raised: [] },
);

// Value null (unknown, stale, invalid): keeps an active alert active and raises nothing.
assert.deepEqual(
  detectAlerts(reading(null, null), limits, { do_low: true, feed_low: true }),
  { state: { do_low: true, do_high: false, feed_low: true }, raised: [] },
);
// Value null never raises from an inactive state either.
assert.deepEqual(detectAlerts(reading(null, null), limits, {}), {
  state: { do_low: false, do_high: false, feed_low: false },
  raised: [],
});

// Value back inside: cleared, so the next crossing raises again.
const cleared = detectAlerts(reading(6, 60), limits, {
  do_low: true,
  feed_low: true,
});
assert.deepEqual(cleared, {
  state: { do_low: false, do_high: false, feed_low: false },
  raised: [],
});
assert.deepEqual(detectAlerts(reading(3, 10), limits, cleared.state).raised, [
  "do_low",
  "feed_low",
]);

// Equal to the limit is inside, for every kind.
assert.deepEqual(detectAlerts(reading(4, 20), limits, {}).raised, []);
assert.deepEqual(detectAlerts(reading(9, 20), limits, {}).raised, []);

const entry = (kind, value, limit, simulated) => ({
  id: "1",
  deviceId: "d",
  deviceName: "Device 1",
  kind,
  value,
  limit,
  simulated,
  at: "2026-10-14T00:00:00Z",
  read: false,
  sequenceId: null,
});
assert.equal(
  alertLine(entry("do_low", 3.8, 4, false)),
  "3.8 mg/L · limit 4 · Device 1",
);
assert.equal(
  alertLine(entry("feed_low", 18, 20, true)),
  "18% · alert below 20% · Device 1 · Simulator",
);

// ART-100: feeding outcomes share one strict parser and one presentation with the push sender.
const device = {
  deviceId: "22222222-2222-4222-8222-222222222222",
  alias: "Pond A",
  model: "AquaFeed",
  isSimulated: false,
};
const telemetryEvent = {
  event_id: "11111111-1111-4111-8111-111111111111",
  device_id: device.deviceId,
  kind: "do_low",
  value: 3.8,
  limit: 4,
  measured_at: "2026-10-14T00:00:00Z",
  raised_at: "2026-10-14T00:00:01Z",
  applied_revision: 2,
  boot_id: "33333333-3333-4333-8333-333333333333",
  sample_sequence: 9,
  sequence_id: null,
  is_simulated: false,
  is_read: false,
  is_dismissed: false,
};
const feedingEvent = {
  ...telemetryEvent,
  kind: "feeding_partial",
  value: null,
  limit: null,
  measured_at: null,
  applied_revision: null,
  boot_id: null,
  sample_sequence: null,
  sequence_id: "55555555-5555-4555-8555-555555555555",
};
assert.equal(alertEntryFromEvent(telemetryEvent, device)?.sequenceId, null);
const feeding = alertEntryFromEvent(feedingEvent, device);
assert.equal(feeding?.sequenceId, feedingEvent.sequence_id);
assert.equal(
  feeding?.value,
  null,
  "no reading is invented for a feeding outcome",
);
assert.equal(alertTitle("feeding_failed"), "Feeding needs attention");
assert.match(
  alertLine({ ...feeding, kind: "feeding_failed" }),
  /No completed feeding confirmed/,
);
assert.equal(alertTitle("feeding_partial"), "Feeding partly completed");
assert.equal(alertLine(feeding), "Only one nozzle completed · Pond A");
assert.equal(alertTitle("feeding_unknown"), "Feeding result unknown");
for (const forged of [
  { ...feedingEvent, value: 0 },
  { ...feedingEvent, sequence_id: null },
  { ...feedingEvent, boot_id: telemetryEvent.boot_id },
  { ...feedingEvent, kind: "feeding_succeeded" },
  { ...telemetryEvent, sequence_id: feedingEvent.sequence_id },
  { ...feedingEvent, device_id: "44444444-4444-4444-8444-444444444444" },
])
  assert.equal(
    alertEntryFromEvent(forged, device),
    null,
    JSON.stringify(forged),
  );

// Execute the owned route: a late selection must not navigate after focus/scope loss.
const routeSource = readFileSync(
  new URL("../src/app/notifications.tsx", import.meta.url),
  "utf8",
);
let hookIndex = 0;
const hooks = [];
let focusEffects = [];
const react = {
  useState(initial) {
    const index = hookIndex++;
    if (!(index in hooks)) hooks[index] = initial;
    return [
      hooks[index],
      (value) => {
        hooks[index] =
          typeof value === "function" ? value(hooks[index]) : value;
      },
    ];
  },
  useRef(initial) {
    const index = hookIndex++;
    return hooks[index] ?? (hooks[index] = { current: initial });
  },
  useCallback: (callback) => callback,
  useEffect: () => {},
};
const jsx = (type, props) => ({ type, props });
let resolveSelection;
let rejectSelection;
let readIds = [],
  deletedIds = [],
  navigations = [];
let access = {
  installationId: "installation-a",
  devices: [{ deviceId: "device-a" }],
  scopeRevision: 1,
  selectedDeviceId: "device-a",
  refreshDevices: async () => [],
  selectDevice: () =>
    new Promise((resolve, reject) => {
      resolveSelection = resolve;
      rejectSelection = reject;
    }),
};
const alert = {
  id: "route-alert",
  deviceId: "device-a",
  sequenceId: "run-a",
  kind: "feeding_unknown",
  at: "2026-10-14T00:00:00Z",
  read: false,
};
const routeModule = { exports: {} };
runInNewContext(
  ts.transpileModule(routeSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
  {
    exports: routeModule.exports,
    module: routeModule,
    Intl,
    Date,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react-native")
        return {
          Platform: { OS: "web" },
          Text: "text",
          View: "view",
          useWindowDimensions: () => ({ width: 375 }),
        };
      if (name === "expo-router")
        return {
          router: { push: (target) => navigations.push(target) },
          useFocusEffect: (effect) => {
            focusEffects.push(effect);
          },
        };
      if (name === "@/components/app-shell")
        return Object.fromEntries(
          [
            "BentoCard",
            "Button",
            "IconButton",
            "ListRow",
            "Sheet",
            "Notice",
          ].map((name) => [name, name]),
        );
      if (name === "@/components/feed-status")
        return { relativeDayLabel: () => "Today" };
      if (name === "@/constants/theme")
        return { Typography: { supporting: {} }, Spacing: { two: 8 } };
      if (name === "@/lib/device-access")
        return { useDeviceAccess: () => access };
      if (name === "@/lib/alerts")
        return {
          useAlerts: () => [alert],
          useUnreadCount: () => 1,
          alertTitle,
          alertLine: () => "Fixture feeder",
          refreshAlerts: async () => [],
          markRead: (id) => readIds.push(id),
          remove: (id) => deletedIds.push(id),
          markAllRead: () => {},
          clear: () => {},
        };
      throw new Error("Unexpected route import: " + name);
    },
  },
);
function renderRoute() {
  hookIndex = 0;
  focusEffects = [];
  return routeModule.exports.default();
}
function focusEffect() {
  const cleanups = focusEffects.map((effect) => effect());
  return () => cleanups.forEach((cleanup) => cleanup?.());
}
function findNodes(tree, type) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((item) => findNodes(item, type));
  return [
    ...(tree.type === type ? [tree] : []),
    ...findNodes(tree.props?.children, type),
  ];
}
let tree = renderRoute();
let blur = focusEffect();
let row = findNodes(tree, "ListRow")[0];
row.props.onPress();
blur();
resolveSelection();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
  navigations.length,
  0,
  "late notification selection cannot push details over a different route",
);
tree = renderRoute();
blur = focusEffect();
row = findNodes(tree, "ListRow")[0];
row.props.onPress();
rejectSelection(new Error("Selection unavailable"));
await new Promise((resolve) => setImmediate(resolve));
assert.ok(
  findNodes(renderRoute().props.footer, "Notice").length,
  "notification navigation failure stays visible and retryable",
);
const actions = findNodes(row.props.trailingAction, "IconButton");
const readAction = actions.find((node) =>
  /Mark.*read/i.test(node.props.accessibilityLabel),
);
assert.ok(
  readAction,
  "read has an explicit action independent of opening details and deleting",
);
readIds = [];
readAction.props.onPress();
assert.deepEqual(readIds, ["route-alert"]);
actions
  .find((node) => /Delete/.test(node.props.accessibilityLabel))
  .props.onPress();
assert.deepEqual(deletedIds, ["route-alert"]);
assert.equal(navigations.length, 0);
// A successful retry opens the original feeder/run exactly once, even on rapid taps.
row = findNodes(renderRoute(), "ListRow")[0];
row.props.onPress();
const firstResolve = resolveSelection;
row.props.onPress();
assert.equal(
  resolveSelection,
  firstResolve,
  "same-frame double tap does not start a second selection",
);
resolveSelection();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(navigations.length, 1);
assert.equal(navigations[0].params.runId, "run-a");
assert.equal(navigations[0].params.device_id, "device-a");
blur();
renderRoute();
blur = focusEffect();
findNodes(renderRoute(), "ListRow")[0].props.onPress();
const oldResolve = resolveSelection;
blur();
access = { ...access, installationId: "installation-b" };
renderRoute();
blur = focusEffect();
oldResolve();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
  navigations.length,
  1,
  "old installation cannot navigate in a new installation scope",
);
blur();

const controller = readFileSync(
  new URL("../src/lib/notification-controller.tsx", import.meta.url),
  "utf8",
);
const nativePushGuard = controller.match(
  /function isPhysicalAndroidDevelopmentBuild\(\) \{[\s\S]*?\n\}/,
);
assert.ok(nativePushGuard, "native push support guard remains present");
for (const [os, isDevice, expoGo, expected] of [
  ["android", true, true, false],
  ["android", true, false, true],
  ["android", false, false, false],
  ["ios", true, false, false],
  ["web", false, false, false],
]) {
  assert.equal(
    runInNewContext(`(${nativePushGuard[0]})()`, {
      Platform: { OS: os },
      Device: { isDevice },
      Constants: { appOwnership: null },
      isRunningInExpoGo: () => expoGo,
    }),
    expected,
    `native notifications: ${os}, physical=${isDevice}, Expo Go=${expoGo}`,
  );
}
const responseHandlerStart = controller.indexOf(
  "const handleResponse = useCallback(",
);
const responseHandlerEnd = controller.indexOf(
  "responseHandlerRef.current = handleResponse;",
  responseHandlerStart,
);
const responseHandler =
  responseHandlerStart >= 0 && responseHandlerEnd > responseHandlerStart
    ? controller.slice(responseHandlerStart, responseHandlerEnd)
    : null;
assert.ok(responseHandler, "push response handler remains present");
const retryBranch = responseHandler.indexOf('if (result === "retry")');
const processedMark = responseHandler.indexOf(
  "processedResponseRef.current.add(key)",
);
const definitiveClearResponse = responseHandler.indexOf(
  "clearLastNotificationResponseAsync",
  processedMark,
);
assert.ok(
  retryBranch >= 0 && retryBranch < processedMark,
  "transient tap failures remain retryable",
);
assert.match(
  responseHandler.slice(retryBranch, processedMark),
  /pendingResponseRef\.current = response/,
);
assert.ok(
  processedMark < definitiveClearResponse,
  "the native last response is cleared only after definitive handling",
);
assert.match(
  controller,
  /if \(pending\) void responseHandlerRef\.current\(pending\)/,
  "pending taps retry on app resume and bounded foreground refresh",
);

process.stdout.write("Alert rule checks passed.\n");
