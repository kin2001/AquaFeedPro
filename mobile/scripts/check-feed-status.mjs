import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

import {
  agoText,
  clockParts,
  displayTime,
  feedingSummary,
  localTimeFromDate,
  pickerDate,
  relativeDayLabel,
  statusKind,
  statusText,
  zoneOffsetLabel,
} from "../src/components/feed-status.ts";

assert.equal(statusText("running"), "In progress");
assert.equal(statusText("something_new"), "something_new");
assert.equal(statusText("not_started"), "Not started");

assert.equal(agoText(null), "age unavailable");
assert.equal(agoText(0.4), "just now");
assert.equal(agoText(59.9), "59 seconds ago");
assert.equal(agoText(60), "1 min ago");
assert.equal(agoText(3599), "59 min ago");
assert.equal(agoText(3600), "1 h ago");
assert.equal(agoText(90000), "1 d ago");

const nozzle = (
  nozzle_number,
  grams,
  quality = grams === null ? "unavailable" : "valid",
) => ({
  nozzle_number,
  measurement_quality: quality,
  measured_dispensed_g: grams,
});
const both = [{ nozzle_number: 1 }, { nozzle_number: 2 }];
const summary = (status, targets, nozzle_results, simulated = false) =>
  feedingSummary({ status, targets, nozzle_results }, simulated);
assert.equal(
  summary("completed", both, [nozzle(1, 20.1), nozzle(2, 14.9)]),
  "Completed · 35 g measured",
);
assert.equal(
  summary("completed", both, [nozzle(1, 20.1), nozzle(2, 14.9)], true),
  "Completed · 35 g simulated",
);
// One nozzle without a valid measurement: no total at all, never a partial one.
assert.equal(
  summary("completed", both, [nozzle(1, 20.1), nozzle(2, null)]),
  "Completed",
);
assert.equal(summary("failed", both, [nozzle(1, 20)]), "Failed");
assert.equal(
  summary("completed", [{ nozzle_number: 1 }], [nozzle(1, 12, "error")]),
  "Completed",
);
assert.equal(summary("not_started", [], []), "Not started");

assert.equal(statusKind("partial"), "warning");
assert.equal(statusKind("expired"), "failed");
assert.equal(statusKind("something_new"), "unknown");

const now = new Date("2026-10-12T10:00:00Z");
const day = (iso) => relativeDayLabel(new Date(iso), "Asia/Manila", now);
assert.equal(day("2026-10-12T04:00:00Z"), "Today");
// Midnight in Manila belongs to the new day; one minute earlier does not.
assert.equal(day("2026-10-11T16:00:00Z"), "Today");
assert.equal(day("2026-10-11T15:59:00Z"), "Yesterday");
assert.equal(day("2026-10-12T16:00:00Z"), "Tomorrow");

const { time } = clockParts(now, "Asia/Manila");
assert.ok(time.includes("6") && time.includes("00"), time);

// ART-99: the picker round-trips feeder-local HH:mm in the phone's own calendar, whatever its zone.
for (const time of [
  "00:00",
  "00:01",
  "11:59",
  "12:00",
  "12:30",
  "23:59",
  "08:05",
])
  assert.equal(localTimeFromDate(pickerDate(time)), time, time);
assert.equal(
  localTimeFromDate(new Date(2000, 0, 1, 0, 0)),
  "00:00",
  "12:00 AM",
);
assert.equal(
  localTimeFromDate(new Date(2000, 0, 1, 12, 0)),
  "12:00",
  "12:00 PM",
);
assert.equal(
  localTimeFromDate(new Date(2000, 0, 1, 23, 59)),
  "23:59",
  "11:59 PM",
);
assert.match(displayTime("00:00"), /^(12:00\sAM|00:00)$/u);
assert.match(displayTime("12:00"), /^(12:00\sPM|12:00)$/u);
assert.match(displayTime("23:59"), /^(11:59\sPM|23:59)$/u);
assert.equal(displayTime("bad"), "bad");

const january = new Date(Date.UTC(2026, 0, 15, 12));
const july = new Date(Date.UTC(2026, 6, 15, 12));
assert.equal(zoneOffsetLabel("Asia/Manila", july), "UTC+08:00");
assert.equal(zoneOffsetLabel("UTC", july), "UTC+00:00");
assert.equal(zoneOffsetLabel("Asia/Kathmandu", july), "UTC+05:45");
assert.equal(zoneOffsetLabel("Asia/Kolkata", january), "UTC+05:30");
assert.equal(zoneOffsetLabel("America/St_Johns", january), "UTC−03:30");
assert.equal(zoneOffsetLabel("America/St_Johns", july), "UTC−02:30");
assert.equal(zoneOffsetLabel("America/New_York", january), "UTC−05:00");
assert.equal(zoneOffsetLabel("America/New_York", july), "UTC−04:00");
assert.equal(zoneOffsetLabel("Australia/Adelaide", january), "UTC+10:30");
assert.equal(zoneOffsetLabel("Not/AZone", july), null);

// Run the actual History route with local React/native boundaries; no network or credentials.
const historySource = readFileSync(
  new URL("../src/app/(tabs)/history.tsx", import.meta.url),
  "utf8",
);
let slots = [],
  slot = 0,
  effects = [],
  focusEffects = [],
  requests = [],
  routes = [];
let device = {
  deviceId: "11111111-1111-4111-8111-111111111111",
  alias: "Local feeder",
  isSimulated: false,
};
let fixture = {
  from_date: "2026-10-06",
  to_date: "2026-10-12",
  timezone: "Asia/Manila",
  timezone_known: true,
  totals: { completed: 18, needs_attention: 2 },
  next_cursor: "older",
  records: [
    {
      sequence_id: "run-1",
      source: "manual",
      created_at: "2026-10-12T04:00:00Z",
      status: "unknown",
      targets: [],
      nozzle_results: [],
    },
  ],
};
const effect = (fn, deps, focus = false) => {
  const index = slot++;
  const previous = slots[index];
  if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
    previous?.cleanup?.();
    const entry = { deps, fn, focus };
    slots[index] = entry;
    (focus ? focusEffects : effects).push(() => {
      entry.cleanup = fn();
    });
  }
};
const react = {
  useState: (initial) => {
    const index = slot++;
    if (!(index in slots))
      slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      slots[index],
      (value) => {
        slots[index] =
          typeof value === "function" ? value(slots[index]) : value;
      },
    ];
  },
  useRef: (initial) => react.useState(() => ({ current: initial }))[0],
  useCallback: (fn, deps) => {
    const index = slot++;
    if (!slots[index] || deps.some((dep, i) => dep !== slots[index].deps[i]))
      slots[index] = { deps, fn };
    return slots[index].fn;
  },
  useEffect: (fn, deps) => effect(fn, deps),
};
const shell = new Proxy(
  { statusIcons: {} },
  { get: (target, key) => target[key] ?? key },
);
const exports = {};
vm.runInNewContext(
  ts.transpile(historySource, {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  }),
  {
    exports,
    require: (name) =>
      ({
        react,
        "react/jsx-runtime": {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        },
        "react-native": {
          StyleSheet: { create: (x) => x },
          Text: "Text",
          View: "View",
          useWindowDimensions: () => ({ width: 375, fontScale: 1 }),
        },
        "expo-router": {
          router: { push: (route) => routes.push(route) },
          useFocusEffect: (fn) => effect(fn, [fn], true),
        },
        "@/components/app-shell": shell,
        "@/components/motion": {
          MotionSection: "MotionSection",
          AnimatedNumber: "AnimatedNumber",
        },
        "@/components/date-field": {
          calendarDate: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value),
          DateField: "DateField",
        },
        "@/components/history-status-select": {
          HistoryStatusSelect: "HistoryStatusSelect",
        },
        "@/components/feed-status": {
          feedingSummary,
          relativeDayLabel,
          statusKind,
        },
        "@/constants/theme": { Spacing: {}, Typography: {} },
        "@/lib/device-access": {
          useDeviceAccess: () => ({
            devices: [device],
            selectedDevice: device,
            selectedDeviceId: device.deviceId,
            installationId: "local-installation",
            scopeRevision: 1,
          }),
        },
        "@/lib/error-text": { errorText: (error) => error.message },
        "@/lib/manual-feed": {
          readHistoryPage: async (...args) => {
            requests.push(args);
            if (fixture instanceof Error) throw fixture;
            return fixture;
          },
        },
      })[name] ?? {},
  },
);
function nodes(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => nodes(child, type));
  if (!node || typeof node !== "object") return [];
  return [
    ...(node.type === type ? [node] : []),
    ...nodes(node.props?.children, type),
  ];
}
function renderHistory() {
  slot = 0;
  return exports.default();
}
async function settleHistory() {
  for (let i = 0; i < 4; i++) {
    renderHistory();
    effects.splice(0).forEach((fn) => fn());
    focusEffects.splice(0).forEach((fn) => fn());
    await Promise.resolve();
  }
  return renderHistory();
}
let tree = renderHistory();
assert.equal(
  nodes(tree, "Skeleton").length,
  5,
  "initial loading does not claim a successful empty history",
);
assert.equal(nodes(tree, "Stat").length, 0);
tree = await settleHistory();
assert.equal(requests.length, 1);
assert.equal(
  nodes(tree, "Stat").find((node) => node.props.label === "Completed").props
    .value,
  "18",
  "counts are server totals, not loaded-row counts",
);
const loadMore = nodes(tree, "Button").find(
  (node) => node.props.children === "Load more",
);
fixture = {
  ...fixture,
  next_cursor: null,
  records: [{ ...fixture.records[0], sequence_id: "run-2" }],
};
await loadMore.props.onPress();
tree = await settleHistory();
assert.equal(nodes(tree, "ListRow").length, 2);
const beforeReturn = requests.length;
for (const entry of slots)
  if (entry?.focus && entry.cleanup) {
    entry.cleanup();
    entry.cleanup = entry.fn();
  }
tree = await settleHistory();
assert.equal(
  requests.length,
  beforeReturn,
  "tab return must preserve loaded pagination instead of replacing it with page one",
);
assert.ok(
  nodes(tree, "Stat").some((node) => node.props.label === "Needs attention"),
  "approved attention label is visible",
);
const refresh = nodes(tree.props.header.props.action, "IconButton").find(
  (node) => node.props.accessibilityLabel === "Refresh history",
);
assert.ok(refresh, "history retains deliberate read refresh");
fixture = new Error("Local offline fixture");
await refresh.props.onPress();
tree = await settleHistory();
assert.equal(
  nodes(tree, "ListRow").length,
  2,
  "read errors preserve loaded records",
);
assert.ok(
  nodes(tree, "Notice").some((node) =>
    node.props.children.includes("outdated"),
  ),
);
const row = nodes(tree, "ListRow")[0];
row.props.onPress();
assert.equal(routes[0].params.device_id, device.deviceId);
device = { ...device, deviceId: "22222222-2222-4222-8222-222222222222" };
tree = renderHistory();
assert.equal(
  nodes(tree, "ListRow").length,
  0,
  "old-device records cannot render under the new device",
);
await settleHistory();
assert.equal(nodes(renderHistory(), "ErrorState").length, 1);
assert.equal(
  nodes(renderHistory(), "Stat").length,
  0,
  "failed device switch cannot relabel old-device totals",
);
assert.equal(
  nodes(renderHistory(), "ListRow").length,
  0,
  "failed device switch cannot relabel old-device records",
);
// A slow old-device refresh must not restore records after selection changes.
let resolveOldRead;
fixture = new Promise((resolve) => {
  resolveOldRead = resolve;
});
const oldRefresh = nodes(
  renderHistory().props.header.props.action,
  "IconButton",
).find((node) => node.props.accessibilityLabel === "Refresh history");
const pendingRead = oldRefresh.props.onPress();
device = { ...device, deviceId: "33333333-3333-4333-8333-333333333333" };
fixture = {
  from_date: "2026-10-06",
  to_date: "2026-10-12",
  timezone: "UTC",
  timezone_known: true,
  totals: { completed: 0, needs_attention: 0 },
  records: [],
  next_cursor: null,
};
await settleHistory();
resolveOldRead({
  ...fixture,
  totals: { completed: 99, needs_attention: 99 },
  records: [
    {
      sequence_id: "old-device-run",
      created_at: "2026-10-12T04:00:00Z",
      source: "manual",
      targets: [],
      nozzle_results: [],
    },
  ],
});
await pendingRead;
tree = await settleHistory();
assert.equal(
  nodes(tree, "ListRow").length,
  0,
  "late old-device response is ignored",
);
assert.ok(nodes(tree, "Stat").every((node) => node.props.value === "0"));
const detailSource = readFileSync(
  new URL("../src/app/history/[runId].tsx", import.meta.url),
  "utf8",
);
assert.match(
  detailSource,
  /label="Started"/,
  "reported start time remains available in details",
);
assert.match(
  detailSource,
  /label="Completed"/,
  "reported completion time remains available in details",
);
assert.match(
  detailSource,
  /label="Measurement quality"/,
  "unmeasured results expose their quality without inventing grams",
);
assert.match(
  detailSource,
  /accessibilityState=\{\{ expanded: technicalOpen \}\}/,
  "secondary identifiers are in an accessible expandable group",
);
assert.match(
  detailSource,
  /label="Sequence ID"/,
  "stable event identity remains accessible",
);
process.stdout.write("Feed status and History route checks passed.\n");
