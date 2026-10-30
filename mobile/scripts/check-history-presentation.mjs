import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const deviceId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
let width = 375;
let fontScale = 1;
let scopeRevision = 1;
let state = [];
let slot = 0;
const actions = [];
const device = { deviceId, alias: "Long pond feeder name", isSimulated: true };
const entry = {
  id: "event-1",
  deviceId,
  deviceName: device.alias,
  simulated: true,
  kind: "feeding_unknown",
  sequenceId: runId,
  at: "2026-10-30T01:00:00Z",
  read: false,
};
const components = Object.fromEntries(
  [
    "AppPage",
    "BentoCard",
    "Button",
    "EmptyState",
    "ErrorState",
    "IconButton",
    "KeyValue",
    "ListRow",
    "Notice",
    "ScreenHeader",
    "SectionHeader",
    "Segmented",
    "Sheet",
    "Skeleton",
    "Stat",
    "StatusLabel",
  ].map((name) => [name, name]),
);
const jsx = (type, props) => ({ type, props });
function load(file) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(readFileSync(new URL(file, import.meta.url), "utf8"), {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    }),
    {
      exports,
      Intl,
      require: (name) =>
        ({
          react: {
            useState: (initial) => {
              const index = slot++;
              if (!(index in state))
                state[index] =
                  typeof initial === "function" ? initial() : initial;
              return [
                state[index],
                (value) => {
                  state[index] =
                    typeof value === "function" ? value(state[index]) : value;
                },
              ];
            },
            useRef: (current) => ({ current }),
            useCallback: (fn) => fn,
            useEffect: () => {},
          },
          "react/jsx-runtime": { jsx, jsxs: jsx },
          "react-native": {
            StyleSheet: { create: (styles) => styles },
            useWindowDimensions: () => ({ width, fontScale }),
          },
          "expo-router": {
            useFocusEffect: () => {},
            useLocalSearchParams: () => ({ runId, device_id: deviceId }),
            router: {
              push: (route) => actions.push(["push", route]),
              canGoBack: () => true,
              back: () => actions.push(["back"]),
            },
          },
          "@/components/theme-provider": {
            ThemedText: "Text",
            ThemedView: "View",
          },
          "@/components/app-shell": {
            ...components,
            statusIcons: { unknown: "circle-help" },
          },
          "@/components/feed-status": {
            statusKind: () => "unknown",
            statusText: (s) => s,
            feedingSummary: () => "Unknown",
            relativeDayLabel: () => "Today",
          },
          "@/components/date-field": {
            DateField: "DateField",
            calendarDate: () => new Date(),
          },
          "@/components/history-status-select": {
            HistoryStatusSelect: "HistoryStatusSelect",
          },
          "@/constants/theme": {
            Spacing: { two: 8, cardGap: 12 },
            Typography: {},
            Colors: { light: {} },
          },
          "@/lib/device-access": {
            useDeviceAccess: () => ({
              devices: [device],
              selectedDevice: device,
              selectedDeviceId: deviceId,
              installationId: "installation",
              scopeRevision,
              selectDevice: async (id) => {
                actions.push(["select", id]);
              },
            }),
          },
          "@/lib/device-access-state": { isUuid: () => true },
          "@/lib/manual-feed": {},
          "@/lib/error-text": {},
          "@/lib/alerts": {
            useAlerts: () => [entry],
            useUnreadCount: () => (entry.read ? 0 : 1),
            alertTitle: () => "Feeding result unknown",
            alertLine: () =>
              "Not confirmed · Long pond feeder name · Simulator",
            markRead: (id) => actions.push(["read", id]),
            remove: (id) => actions.push(["remove", id]),
            markAllRead: () => actions.push(["read-all"]),
          },
        })[name] ?? {},
    },
  );
  return exports.default;
}
function nodes(tree, type) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => nodes(child, type));
  return [
    ...(tree.type === type ? [tree] : []),
    ...Object.values(tree.props ?? {}).flatMap((value) => nodes(value, type)),
  ];
}
function text(tree) {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (!tree || typeof tree !== "object") return "";
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  return text(tree.props?.children);
}
function render(Screen, seed = []) {
  state = seed;
  slot = 0;
  return Screen();
}

const Notifications = load("../src/app/notifications.tsx");
let tree = render(Notifications);
let row = nodes(tree, "ListRow")[0];
assert.match(
  text(row.props.footer),
  /Unread/,
  "Unread must be visible, not just an icon or a screen-reader label",
);
assert.equal(
  row.props.icon,
  "circle-help",
  "An unknown feeding outcome must not show a completion icon",
);
row.props.onPress();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(actions.slice(0, 2), [
  ["read", entry.id],
  ["select", deviceId],
]);
assert.equal(actions[2][1].params.runId, runId);
assert.equal(actions[2][1].params.device_id, deviceId);
assert.match(
  nodes(row.props.trailingAction, "IconButton")[0].props.accessibilityLabel,
  /Feeding result unknown/,
);
entry.read = true;
tree = render(Notifications);
assert.match(text(nodes(tree, "ListRow")[0].props.footer), /Read/);
assert.equal(
  nodes(tree, "Button").find((n) => n.props.children === "Mark all as read")
    .props.disabled,
  true,
);

const History = load("../src/app/(tabs)/history.tsx");
const filter = { from: "", to: "", source: "all", status: "all" };
const page = {
  from_date: "2026-10-24",
  to_date: "2026-10-30",
  timezone: "UTC",
  timezone_known: true,
  totals: { completed: 0, needs_attention: 1 },
  next_cursor: "next",
};
const record = {
  sequence_id: runId,
  source: "manual",
  created_at: entry.at,
  status: "unknown",
  targets: [{ nozzle_number: 1 }, { nozzle_number: 2 }],
};
const seed = () => [
  filter,
  filter,
  page,
  [record],
  null,
  `installation:${deviceId}:1`,
  false,
  false,
];
tree = render(History, seed());
row = nodes(tree, "ListRow")[0];
assert.match(
  row.props.lines.join(" "),
  /Nozzle 1.*Nozzle 2/,
  "History must retain nozzle context",
);
assert.equal(
  row.props.stackMeta,
  true,
  "Phone rows must leave room for long source labels",
);
row.props.onPress();
assert.equal(actions.at(-1)[1].params.device_id, deviceId);
assert.equal(
  nodes(tree, "Button").some((n) => n.props.children === "Load more"),
  true,
);
width = 800;
fontScale = 2;
tree = render(History, seed());
assert.equal(
  nodes(tree, "ListRow")[0].props.stackMeta,
  true,
  "Large text must retain a stacked layout on wide devices too",
);

const Details = load("../src/app/history/[runId].tsx");
const scope = {
  deviceId,
  installationId: "installation",
  selectedDeviceId: deviceId,
  scopeRevision: 1,
  simulated: true,
};
const detailRecord = {
  ...record,
  reason_code: "OUTCOME_UNKNOWN",
  safety_lockout: true,
  nozzle_results: [
    {
      nozzle_number: 1,
      status: "unknown",
      requested_dose: { mode: "grams", amount_g: 35 },
      measurement_quality: "unavailable",
      measured_dispensed_g: null,
      estimated_dispensed_g: null,
    },
    {
      nozzle_number: 2,
      status: "completed",
      requested_dose: { mode: "grams", amount_g: 20 },
      measurement_quality: "valid",
      measured_dispensed_g: 18,
      estimated_dispensed_g: 19,
    },
  ],
};
const detailSeed = [
  scope,
  {
    key: `installation:${deviceId}:1:${runId}`,
    detail: { record: detailRecord, timezone: "UTC", timezone_known: false },
  },
  null,
];
tree = render(Details, detailSeed);
const values = nodes(tree, "KeyValue");
assert.equal(
  values.find((n) => n.props.label === "Measured").props.value,
  "Not measured",
  "Requested grams must never substitute for an unknown measurement",
);
assert.equal(
  values.filter((n) => n.props.label === "Measured")[1].props.value,
  "18 g synthetic simulator reading",
);
assert.equal(
  values.find((n) => n.props.label === "Estimated").props.value,
  "19 g · simulator estimate",
);
assert.equal(
  values.every((n) => n.props.stacked),
  true,
  "Large text detail values must stack",
);
assert.match(text(nodes(tree, "Notice")), /in-person safety check/);
assert.equal(nodes(tree, "StatusLabel")[0].props.children, "unknown");
assert.equal(nodes(tree, "ScreenHeader")[0].props.back.fallback, "/history");
scopeRevision = 2;
tree = render(Details, detailSeed);
assert.match(
  text(nodes(tree, "Notice")),
  /not available for the selected feeder/,
);
assert.equal(
  nodes(tree, "KeyValue").length,
  0,
  "A revoked scope must not expose cached run details",
);

console.log(
  "History/notification presentation checks passed: read state, device/run navigation, nozzle context, pagination, large text, measured/requested separation and revoked detail scope.",
);
