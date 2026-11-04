import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as RN from "react-native-web";

// Render the worktree's actual components, not a CSS imitation. Only platform
// services and motion are settled mocks; this does not establish native acceptance.
const require = createRequire(import.meta.url);
let dimensions = { width: 390, height: 844, fontScale: 1, scale: 1 };
const h = React.createElement;
let routeStates = null;
let routeName = "components";
const react = {
  ...React,
  useState: (initial) =>
    React.useState(routeStates?.length ? routeStates.shift() : initial),
};
const scope = "fixture:feeder:1";
const device = {
  deviceId: "feeder",
  alias: "Pond 01 Feeder",
  location: "North pond",
  model: "AquaFeed Pro",
  isSimulated: true,
  contactFreshness: "fresh",
  capabilities: {
    localScheduleExecution: true,
    manualFeeding: true,
    doMonitoring: true,
    feedRemainingMonitoring: true,
    feedCapacityG: 1000,
  },
};
const record = {
  sequence_id: "fixture-run",
  created_at: "2026-11-03T13:42:00Z",
  source: "scheduled",
  status: "completed",
  targets: [{ nozzle_number: 1, dose: { mode: "grams", amount_g: 50 } }],
  nozzle_results: [],
};
const history = {
  from_date: "2026-10-28",
  to_date: "2026-11-04",
  timezone: "Asia/Manila",
  timezone_known: true,
  totals: { completed: 6, needs_attention: 3 },
  records: [record],
  next_cursor: null,
};
const configuration = {
  current_state: { last_attempt_status: "applied" },
  applied_snapshot: {
    timezone: "Asia/Manila",
    monitoring_limits: { do_low_mg_l: 3, do_high_mg_l: 8 },
    low_feed_threshold_pct: 10,
    schedules: [
      {
        schedule_id: "fixture-schedule",
        local_time: "12:00",
        enabled: true,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        targets: record.targets,
      },
    ],
  },
};
const home = {
  scopeKey: scope,
  snapshotFetchedAtMonotonicMs: 0,
  snapshot: {
    contact: { freshness: "fresh", age_seconds: 2 },
    display_policy: {
      device_offline_after_seconds: 45,
      metric_outdated_after_seconds: 30,
    },
    profile: {
      is_simulated: true,
      capabilities: {
        do_monitoring: true,
        feed_remaining_monitoring: true,
        feed_capacity_g: 1000,
      },
    },
    latest_sample: {
      do_mg_l: 5.8,
      do_quality: "valid",
      do_freshness: "fresh",
      feed_quality: "valid",
      feed_freshness: "fresh",
      feed_remaining_g: 720,
      feed_percent: 72,
      sample_age_seconds: 2,
    },
  },
  configuration,
  history,
  graph: null,
  next: { occurrence: null },
};
const Text = ({ style, ...props }) => {
  const flat = RN.StyleSheet.flatten(style) ?? {};
  return h(RN.Text, {
    ...props,
    style: [
      style,
      flat.fontSize && { fontSize: flat.fontSize * dimensions.fontScale },
      flat.lineHeight && { lineHeight: flat.lineHeight * dimensions.fontScale },
    ],
  });
};
const native = { ...RN, Text, useWindowDimensions: () => dimensions };
const motion = {
  Motion: { stagger: 55 },
  MotionSection: RN.View,
  MotionPressable: RN.Pressable,
  MotionScrollView: ({ children, contentStyle, ...props }) =>
    h(RN.ScrollView, props, h(RN.View, { style: contentStyle }, children)),
  AnimatedNumber: ({ value, decimals = 0, style }) =>
    h(Text, { style }, value === null ? "—" : value.toFixed(decimals)),
  useEntryProgress: () => 1,
  useMotionValue: () => new RN.Animated.Value(1),
  useReducedMotion: () => true,
  useSkeletonPulse: () => 1,
  useEntranceMotion: () => ({}),
};
const router = {
  router: {},
  usePathname: () => "/history",
  useIsFocused: () => true,
  usePreventRemove: () => {},
  useFocusEffect: () => {},
};
const modules = new Map();
function load(relative, extra = "") {
  const path = resolve(import.meta.dirname, "..", relative);
  if (modules.has(path)) return modules.get(path);
  const exports = {};
  modules.set(path, exports);
  vm.runInNewContext(
    ts.transpile(readFileSync(path, "utf8") + extra, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    }),
    {
      exports,
      require: (name) => {
        if (name === "react") return react;
        if (name === "react-native") return native;
        if (name === "expo-constants")
          return { default: { expoConfig: { version: "fixture" } } };
        if (name === "react-native-svg")
          return { default: "svg", Circle: "circle", Path: "path" };
        if (name === "expo-router") return router;
        if (name === "react-native-safe-area-context")
          return {
            SafeAreaView: RN.View,
            useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
          };
        if (name === "@react-native-vector-icons/lucide")
          return {
            Lucide: ({ size, color }) =>
              h(
                "svg",
                { width: size, height: size, "aria-hidden": true },
                h("circle", {
                  cx: size / 2,
                  cy: size / 2,
                  r: size / 3,
                  fill: "none",
                  stroke: color,
                }),
              ),
          };
        if (name.includes("/motion") || name === "./motion") return motion;
        if (name === "./tab-presentation")
          return { TabSceneReadyContext: React.createContext(null) };
        if (name === "@/lib/device-access")
          return {
            useDeviceAccess: () => ({
              installationId: "fixture",
              scopeRevision: 1,
              selectedDeviceId: "feeder",
              selectedDevice: device,
              devices: [device],
            }),
          };
        if (name === "@/lib/alerts") return { useUnreadCount: () => 0 };
        if (name === "@/lib/monitoring")
          return {
            graphForWindow: (value) => value,
            buildDoGraphShape: () => ({}),
            freshnessAfterElapsed: (value) => value,
            feedCapacityForDisplay: () => 1000,
          };
        if (name.startsWith("@/lib/") || name.startsWith("@expo/ui")) return {};
        if (name.startsWith("@/") || name.startsWith(".")) {
          const local = name.startsWith("@/")
            ? resolve(import.meta.dirname, "../src", name.slice(2))
            : resolve(path, "..", name);
          for (const ext of [".tsx", ".ts"])
            if (existsSync(local + ext)) return load(local + ext);
        }
        return require(name);
      },
      console,
      performance,
    },
    { filename: path },
  );
  return exports;
}
const kit = load("src/components/bento-kit.tsx");
const { HistorySummaryCard } = load(
  "src/app/(tabs)/history.tsx",
  "\nexport { HistorySummaryCard };",
);
const { Typography, Spacing, MaxContentWidth } = load("src/constants/theme.ts");
const { AppPage, ScreenHeader } = load("src/components/app-shell.tsx");
router.usePathname = () =>
  ({ index: "/", schedule: "/schedule", device: "/device" })[routeName] ??
  "/history";

function Summary({ count = 6, total = 9, label = "Needs attention" }) {
  return h(HistorySummaryCard, {
    icon: "triangle-alert",
    label,
    value: String(count),
    count,
    total,
    eligible: false,
    scope: "isolated",
    explanation: "Mocked summary",
  });
}
function Fixture() {
  return h(
    AppPage,
    {
      header: h(ScreenHeader, {
        title: "History",
        subtitle: "Last 7 days · Asia/Manila",
      }),
    },
    h(
      RN.View,
      {
        testID: "summaries",
        style: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.cardGap },
      },
      h(Summary, { label: "Completed" }),
      h(Summary, { count: 3 }),
    ),
    h(
      RN.View,
      {
        testID: "long-label",
        style: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.cardGap },
      },
      h(Summary, { label: "Long translated needs-attention summary label" }),
    ),
    h(
      RN.View,
      {
        testID: "long-counts",
        style: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.cardGap },
      },
      h(Summary, { count: 123456, total: 999999 }),
      h(Summary, { count: 0, total: 0 }),
    ),
    h(
      kit.BentoCard,
      { flush: true },
      h(kit.FeedingRow, {
        record,
        timeText: "Yesterday, 12:00 PM",
        simulated: false,
        onPress: () => {},
      }),
    ),
    h(
      kit.BentoCard,
      {},
      h(kit.TextField, {
        label: "Feeder name",
        value: "Pond 01 feeder with a longer name",
        onChangeText: () => {},
      }),
      h(kit.KeyValue, {
        label: "Requested amount for nozzle 1",
        value: "50 g requested, not measured",
      }),
      h(kit.Segmented, {
        accessibilityLabel: "Source",
        value: "scheduled",
        onChange: () => {},
        options: [
          { value: "all", label: "All" },
          { value: "manual", label: "Manual" },
          { value: "scheduled", label: "Scheduled" },
        ],
      }),
      h(kit.Button, { onPress: () => {} }, "Confirm feeding"),
    ),
    h(kit.EmptyState, {
      icon: "history",
      title: "No feeding records yet",
      description: "Feeding activity will appear here when available.",
      action: null,
    }),
  );
}
const routes = Object.fromEntries(
  ["index", "schedule", "history", "device"].map((name) => [
    name,
    load(`src/app/(tabs)/${name}.tsx`).default,
  ]),
);
function RouteFixture() {
  const filter = { from: "", to: "", source: "all", status: "all" };
  routeStates = {
    index: ["1h", 0, false, null, 0, 0, home],
    schedule: [
      configuration,
      null,
      false,
      false,
      false,
      null,
      null,
      null,
      false,
      null,
    ],
    history: [
      filter,
      filter,
      history,
      history.records,
      null,
      scope,
      false,
      false,
    ],
    device: [{}, null, { key: scope, configuration, error: null }],
  }[routeName].slice();
  try {
    return routes[routeName]();
  } finally {
    routeStates = null;
  }
}
function html() {
  RN.AppRegistry.registerComponent("ResponsiveFixture", () =>
    routeName === "components" ? Fixture : RouteFixture,
  );
  const { element, getStyleElement } =
    RN.AppRegistry.getApplication("ResponsiveFixture");
  const body = renderToStaticMarkup(element);
  const fonts = ["400Regular", "500Medium", "600SemiBold"]
    .map((weight) => {
      const name = `Inter_${weight}`;
      const data = readFileSync(
        require.resolve(`@expo-google-fonts/inter/${weight}/${name}.ttf`),
      ).toString("base64");
      return `@font-face{font-family:${name};src:url(data:font/ttf;base64,${data})}`;
    })
    .join("");
  return `<!doctype html><html><head>${renderToStaticMarkup(getStyleElement())}<style>${fonts}html,body,#root{margin:0;width:100%;height:100%}</style></head><body><div id="root">${body}</div></body></html>`;
}

// Direct execution of sizing values is supplemented by browser geometry below.
assert.equal(MaxContentWidth, 760);
assert.ok(
  Typography.display.fontSize <= 56,
  "Telemetry must not exceed approved display role",
);
const browserModule = process.env.PLAYWRIGHT_MODULE;
if (browserModule) {
  const { chromium } = require(browserModule);
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.RESPONSIVE_BROWSER ||
      "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
  });
  const output = process.env.RESPONSIVE_EVIDENCE;
  if (output) mkdirSync(output, { recursive: true });
  const results = [];
  try {
    for (const width of [320, 360, 390, 412, 768, 1024]) {
      for (const fontScale of [1, 1.3, 2]) {
        dimensions = { ...dimensions, width, fontScale };
        const context = await browser.newContext({
          viewport: { width, height: 1000 },
        });
        const page = await context.newPage();
        await page.route("**/*", (route) => route.abort());
        await page.setContent(html());
        await page.evaluate(() => document.fonts.ready);
        const result = await page.evaluate(() => {
          const summaries = [
            ...document.querySelectorAll(
              '[data-testid="summaries"] [role="button"], [data-testid="long-counts"] [role="button"], [data-testid="long-label"] [role="button"]',
            ),
          ];
          const cards = summaries.map((button) => {
            const card = button.firstElementChild;
            const bounds = card.getBoundingClientRect();
            const texts = [...card.querySelectorAll('[dir="auto"]')].map(
              (text) => ({
                text: text.textContent,
                bottom: text.getBoundingClientRect().bottom,
                right: text.getBoundingClientRect().right,
                height: text.getBoundingClientRect().height,
              }),
            );
            return {
              top: bounds.top,
              left: bounds.left,
              height: bounds.height,
              width: bounds.width,
              bottom: bounds.bottom,
              right: bounds.right,
              texts,
            };
          });
          return {
            cards,
            horizontalOverflow:
              document.documentElement.scrollWidth > innerWidth,
            pageWidth: document
              .querySelector('[data-testid="summaries"]')
              .getBoundingClientRect().width,
          };
        });
        results.push({ width, fontScale, ...result });
        if (
          output &&
          [320, 390, 1024].includes(width) &&
          [1, 2].includes(fontScale)
        )
          await page.screenshot({
            path: resolve(output, `responsive-${width}-${fontScale}.png`),
            fullPage: true,
          });
        assert.equal(
          result.horizontalOverflow,
          false,
          `${width}/${fontScale}: horizontal overflow`,
        );
        assert.ok(
          result.pageWidth <= MaxContentWidth,
          "Tablet content stays constrained",
        );
        assert.equal(result.cards.length, 5);
        const paired = width >= 768 || (fontScale === 1 && width >= 390);
        assert.equal(
          result.cards[0].top === result.cards[1].top,
          paired,
          `${width}/${fontScale}: summary reflow`,
        );
        if (fontScale === 1 && width >= 390)
          assert.ok(
            result.cards[1].texts[0].height <= 21,
            "Normal-width summary label stays whole",
          );
        for (const card of result.cards) {
          for (const text of card.texts) {
            assert.ok(
              text.bottom <= card.bottom + 1,
              `${width}/${fontScale}: '${text.text}' below card (${text.bottom} > ${card.bottom})`,
            );
            assert.ok(
              text.right <= card.right + 1,
              `${width}/${fontScale}: '${text.text}' outside card width`,
            );
          }
        }
        await context.close();
      }
    }
    const routeErrors = [];
    for (const name of Object.keys(routes)) {
      routeName = name;
      for (const width of [320, 390, 1024]) {
        for (const fontScale of [1, 2]) {
          dimensions = { ...dimensions, width, fontScale };
          const context = await browser.newContext({
            viewport: { width, height: 844 },
          });
          const page = await context.newPage();
          await page.route("**/*", (route) => route.abort());
          await page.setContent(html());
          await page.evaluate(() => document.fonts.ready);
          const geometry = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth > innerWidth,
            buttons: [
              ...document.querySelectorAll(
                '[role="button"], [role="switch"], [role="link"]',
              ),
            ].map((node) => {
              const r = node.getBoundingClientRect();
              return {
                label: node.getAttribute("aria-label") ?? node.textContent,
                width: r.width,
                height: r.height,
              };
            }),
          }));
          results.push({ route: name, width, fontScale, ...geometry });
          if (output)
            await page.screenshot({
              path: resolve(output, `${name}-${width}-${fontScale}.png`),
              fullPage: true,
            });
          if (geometry.overflow)
            routeErrors.push(
              `${name}/${width}/${fontScale}: horizontal overflow`,
            );
          if (!geometry.buttons.length)
            routeErrors.push(`${name}: controls missing`);
          for (const button of geometry.buttons) {
            if (button.width < 48 || button.height < 48)
              routeErrors.push(
                `${name}/${width}/${fontScale}: small target ${JSON.stringify(button)}`,
              );
          }
          await context.close();
        }
      }
    }
    assert.deepEqual(routeErrors, []);
  } finally {
    if (output)
      writeFileSync(
        resolve(output, "geometry.json"),
        JSON.stringify(results, null, 2),
      );
    await browser.close();
  }
  console.log(
    "PASS: 18 actual RN-web card/form cases plus 24 mocked four-tab cases; summary reflow, contained text, tablet constraint, 48px tab-page controls, no horizontal overflow. Motion/services settled; not native acceptance.",
  );
} else {
  html();
  console.log(
    "PASS: responsive fixtures render using worktree sources. Set PLAYWRIGHT_MODULE for browser geometry checks (not native acceptance).",
  );
}
