import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let reduced = false;
let focused = true;
let keyboardVisible = false;
let keyboardDismissals = 0;
let current;
const animations = [];
const listeners = new Map();
let resolvePreference;
let revealViewport = null;
let preventRemoval;
const navigationActions = [];
const navigation = { dispatch: (action) => navigationActions.push(action) };
const react = {
  createContext: (initial) => ({ Provider: "provider", initial }),
  useContext: (context) =>
    context.initial === null ? revealViewport : reduced,
  forwardRef: (render) => (props) => render(props, null),
  useState: (initial) => current.state(initial),
  useRef: (initial) => current.state(() => ({ current: initial }))[0],
  useEffect: (effect, deps) => current.effect(effect, deps),
  useLayoutEffect: (effect, deps) => current.effect(effect, deps),
  useMemo: (create, deps) => current.memo(create, deps),
  useCallback: (callback, deps) => current.memo(() => callback, deps),
  useId: () => "test-id",
};
class Value {
  constructor(value) {
    this.value = value;
    this.listeners = new Map();
  }
  setValue(value) {
    this.value = value;
    this.listeners.forEach((listener) => listener({ value }));
  }
  addListener(listener) {
    const id = String(this.listeners.size);
    this.listeners.set(id, listener);
    return id;
  }
  removeListener(id) {
    this.listeners.delete(id);
  }
  stopAnimation() {
    this.running?.stop();
  }
  interpolate(config) {
    return { value: this, ...config };
  }
}
function animation(value, config) {
  const result = {
    config,
    stopped: false,
    start(callback) {
      value?.running?.stop();
      if (value) value.running = result;
      result.callback = callback;
      animations.push(result);
    },
    stop() {
      if (result.stopped) return;
      result.stopped = true;
      if (value?.running === result) value.running = null;
      result.callback?.({ finished: false });
    },
    finish() {
      if (result.stopped) return;
      if (value) {
        value.setValue(config.toValue);
        value.running = null;
      }
      result.callback?.({ finished: true });
    },
  };
  return result;
}
const native = {
  Animated: {
    Value,
    timing: animation,
    spring: (value, config) => animation(value, { ...config, spring: true }),
    sequence: (steps) => ({ steps }),
    loop: (sequence) => animation(null, { loop: sequence }),
    multiply: (...values) => values,
    add: (...values) => values,
    createAnimatedComponent: (component) => "animated-" + component,
    View: "animated-view",
  },
  AccessibilityInfo: {
    isReduceMotionEnabled: () =>
      new Promise((resolve) => {
        resolvePreference = resolve;
      }),
    addEventListener: (event, fn) => {
      listeners.set(event, fn);
      return { remove: () => listeners.delete(event) };
    },
  },
  AppState: {
    currentState: "active",
    addEventListener: (event, fn) => {
      listeners.set(event, fn);
      return { remove: () => listeners.delete(event) };
    },
  },
  Easing: { out: (value) => value, cubic: "cubic" },
  Platform: { OS: "web" },
  Pressable: "pressable",
  View: "view",
  Text: "text",
  Modal: "modal",
  KeyboardAvoidingView: "keyboard-avoiding-view",
  Keyboard: {
    isVisible: () => keyboardVisible,
    dismiss: () => {
      keyboardVisible = false;
      keyboardDismissals++;
    },
  },
  PanResponder: { create: (panHandlers) => ({ panHandlers }) },
  StyleSheet: {
    create: (styles) => styles,
    flatten: (styles) =>
      Array.isArray(styles)
        ? Object.assign({}, ...styles.filter(Boolean))
        : styles,
  },
  useWindowDimensions: () => ({ width: 375, height: 812 }),
};
function load(relative, modules = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(
    ts.transpile(source, {
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
          "react-native": native,
          "expo-router": {
            useIsFocused: () => focused,
            useNavigation: () => navigation,
            usePreventRemove: (enabled, callback) => {
              preventRemoval = enabled ? callback : null;
            },
          },
          "react-native-safe-area-context": {
            useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
          },
          ...modules,
        })[name] ?? {},
    },
  );
  return exports;
}
function harness(render) {
  const slots = [];
  let index = 0;
  let pending = [];
  const instance = {
    memo(create, deps) {
      const at = index++;
      const previous = slots[at];
      if (!previous || deps.some((value, i) => value !== previous.deps[i]))
        slots[at] = { memo: create(), deps };
      return slots[at].memo;
    },
    state(initial) {
      const at = index++;
      if (!(at in slots))
        slots[at] = typeof initial === "function" ? initial() : initial;
      return [
        slots[at],
        (value) => {
          slots[at] = typeof value === "function" ? value(slots[at]) : value;
        },
      ];
    },
    effect(effect, deps) {
      const at = index++;
      const previous = slots[at];
      if (
        !deps ||
        !previous ||
        deps.some((value, i) => value !== previous.deps?.[i])
      ) {
        pending.push(() => {
          previous?.cleanup?.();
          slots[at] = { deps, cleanup: effect() };
        });
      }
    },
    render() {
      index = 0;
      pending = [];
      current = instance;
      const result = render();
      pending.forEach((effect) => effect());
      return result;
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
  return instance;
}
const theme = load("../src/constants/theme.ts");
const motion = load("../src/components/motion.tsx", {
  "@/constants/theme": theme,
});
let liveTarget = 60;
let liveScope = "device-a";
let eligibleReading = true;
const number = harness(() =>
  motion.useAnimatedNumber(liveTarget, eligibleReading, liveScope),
);
number.render();
assert.equal(
  number.render(),
  60,
  "first entry renders the actual reading, without count-up",
);
assert.equal(animations.length, 0, "readings never schedule animation frames");
assert.equal(number.render(), 60);
liveTarget = 20;
assert.equal(
  number.render(),
  20,
  "decreases render the actual value immediately",
);
assert.equal(number.render(), 20, "identical polls keep actual readings");
liveTarget = 30;
number.render();
liveTarget = 25;
number.render();
assert.equal(animations.length, 0, "rapid readings do not leave an old frame");
eligibleReading = false;
assert.equal(
  number.render(),
  25,
  "stale values settle immediately to the actual value",
);
liveTarget = null;
assert.equal(number.render(), null, "unknown is never displayed as zero");
eligibleReading = true;
liveTarget = 8;
liveScope = "device-b";
assert.equal(
  number.render(),
  8,
  "the first context-switch render cannot show another feeder's frame",
);
assert.equal(number.render(), 8);
reduced = true;
assert.equal(number.render(), 8);
const afterReduced = animations.length;
reduced = false;
number.render();
assert.equal(
  animations.length,
  afterReduced,
  "resuming a settled reading does not restart from zero",
);
focused = false;
assert.equal(number.render(), 8, "leaving a page settles its reading");
focused = true;
number.render();
assert.equal(number.render(), 8, "returning keeps the actual reading");
assert.equal(animations.length, 0, "return and polling never animate readings");
focused = false;
liveTarget = null;
assert.equal(number.render(), null);
focused = true;
assert.equal(number.render(), null, "returning cannot count an unknown value");
eligibleReading = false;
liveTarget = 8;
assert.equal(number.render(), 8, "stale values stay actual after returning");
assert.equal(animations.length, 0);
reduced = true;
eligibleReading = true;
focused = false;
number.render();
focused = true;
assert.equal(number.render(), 8, "reduced motion suppresses return count-ups");
assert.equal(animations.length, 0);
liveTarget = Number.NaN;
assert.equal(number.render(), null, "invalid readings remain unavailable");
number.unmount();
reduced = false;
native.AppState.currentState = null;
const startup = harness(() => motion.MotionProvider({ children: null }));
startup.render();
resolvePreference(false);
await Promise.resolve();
assert.equal(
  startup.render().props.value,
  false,
  "unknown initial AppState permits motion once the OS preference is known",
);
startup.unmount();
native.AppState.currentState = "active";
const provider = harness(() => motion.MotionProvider({ children: null }));
assert.equal(
  provider.render().props.value,
  true,
  "motion stays off until preference is known",
);
listeners.get("reduceMotionChanged")(true);
resolvePreference(false);
await Promise.resolve();
assert.equal(
  provider.render().props.value,
  true,
  "a preference change wins over an older async query",
);
listeners.get("reduceMotionChanged")(false);
assert.equal(provider.render().props.value, false);
listeners.get("change")("background");
assert.equal(
  provider.render().props.value,
  true,
  "backgrounding disables motion",
);
provider.unmount();
assert.equal(
  listeners.size,
  0,
  "preference and app-state subscriptions are removed",
);

assert.equal(motion.sectionIntersectsViewport(850, 100, 0, 800), false);
assert.equal(motion.sectionIntersectsViewport(850, 100, 100, 800), true);
const revealChecks = new Set();
revealViewport = {
  seen: new Set(),
  content: { current: {} },
  bounds: { current: { offset: 0, height: 800 } },
  subscribe: (check) => {
    revealChecks.add(check);
    check();
    return () => revealChecks.delete(check);
  },
};
const section = harness(() =>
  motion.MotionSection({ style: { gap: 12 }, delay: 800, revealKey: "row-1" }),
);
let renderedSection = section.render();
renderedSection.props.ref.current = {
  measureLayout: (_parent, done) => done(0, 850, 375, 100),
};
renderedSection.props.onLayout({ nativeEvent: { layout: {} } });
const beforeScroll = animations.length;
section.render();
assert.equal(
  animations.length,
  beforeScroll,
  "offscreen sections retain their static layout without starting motion",
);
revealViewport.bounds.current.offset = 100;
revealChecks.forEach((check) => check());
renderedSection = section.render();
const sectionEntry = animations.at(-1);
assert.equal(
  sectionEntry.config.delay,
  0,
  "offscreen sections never stagger after scrolling",
);
assert.equal(sectionEntry.config.duration, 160);
sectionEntry.finish();
revealViewport.bounds.current.offset = 1000;
revealChecks.forEach((check) => check());
revealViewport.bounds.current.offset = 100;
revealChecks.forEach((check) => check());
section.render();
assert.equal(
  animations.at(-1),
  sectionEntry,
  "scrolling back never replays a section",
);
reduced = true;
section.render();
assert.equal(sectionEntry.stopped, true);
reduced = false;
section.render();
assert.equal(
  animations.at(-1),
  sectionEntry,
  "foreground/preference changes do not replay revealed sections",
);
focused = false;
section.render();
focused = true;
section.render();
assert.equal(
  animations.at(-1),
  sectionEntry,
  "returning to a page never replays revealed sections",
);
animations.at(-1).finish();
section.unmount();
assert.equal(revealChecks.size, 0);
const remountedSection = harness(() =>
  motion.MotionSection({ revealKey: "row-1" }),
);
const remountedView = remountedSection.render();
remountedView.props.ref.current = {
  measureLayout: (_parent, done) => done(0, 850, 375, 100),
};
remountedView.props.onLayout({ nativeEvent: { layout: {} } });
const beforeRemount = animations.length;
remountedSection.render();
assert.equal(
  animations.length,
  beforeRemount,
  "filter refresh/remount does not replay an already revealed record",
);
remountedSection.unmount();
revealViewport = null;

let target = 0;
const movement = harness(() =>
  motion.useMotionValue(target, motion.Motion.press),
);
movement.render();
target = 1;
movement.render();
const press = animations.at(-1);
assert.equal(press.config.duration, 120);
target = 0;
movement.render();
assert.equal(
  press.stopped,
  true,
  "rapid release cancels the previous press animation",
);
reduced = true;
assert.equal(
  movement.render().value,
  0,
  "reduced motion immediately settles at the actual target",
);
movement.unmount();

reduced = false;
const pulse = harness(() => motion.useSkeletonPulse());
pulse.render();
const loop = animations.at(-1);
assert.equal(loop.config.loop.steps.length, 2);
assert.equal(
  loop.config.loop.steps.reduce(
    (duration, step) => duration + step.config.duration,
    0,
  ),
  900,
  "a full loading pulse takes one 900 ms cycle",
);
pulse.render();
assert.equal(
  animations.at(-1),
  loop,
  "rerenders do not duplicate a loading loop",
);
reduced = true;
assert.equal(pulse.render().value, 1);
assert.equal(
  loop.stopped,
  true,
  "reduced motion cancels an active loading loop",
);
pulse.unmount();

reduced = false;
let route = "/";
const entrance = harness(() => motion.useEntranceMotion(route));
entrance.render();
const firstEntry = animations.at(-1);
entrance.render();
assert.equal(
  animations.at(-1),
  firstEntry,
  "data-only rerenders never replay screen entry",
);
route = "/history";
entrance.render();
assert.notEqual(animations.at(-1), firstEntry);
const nextEntry = animations.at(-1);
route = "/";
entrance.render();
assert.equal(
  animations.at(-1),
  nextEntry,
  "returning to a visited entrance trigger never replays",
);
entrance.unmount();
assert.equal(animations.at(-1).stopped, true);

const kit = load("../src/components/bento-kit.tsx", {
  "./button-state": load("../src/components/button-state.ts"),
  "./motion": motion,
  "@/constants/theme": theme,
});
let closes = 0;
const sheet = harness(() =>
  kit.Sheet({
    visible: true,
    title: "Test",
    onClose: () => {
      closes += 1;
    },
  }),
);
let modal = sheet.render();
animations.at(-1).finish();
keyboardVisible = true;
const beforeKeyboardBack = animations.length;
modal.props.onRequestClose();
assert.equal(
  keyboardDismissals,
  1,
  "Back hides the keyboard before closing the sheet",
);
assert.equal(
  animations.length,
  beforeKeyboardBack,
  "keyboard Back cannot start sheet exit",
);
assert.equal(closes, 0);
modal.props.onRequestClose();
const exit = animations.at(-1);
modal.props.onRequestClose();
assert.equal(animations.at(-1), exit, "repeated dismissals share one exit");
assert.equal(closes, 0, "dismiss callback waits for the short exit transition");
sheet.unmount();
exit.finish();
assert.equal(closes, 0, "an interrupted exit cannot navigate after unmount");
reduced = true;
let sheetVisible = true;
const instantSheet = harness(() =>
  kit.Sheet({
    visible: sheetVisible,
    title: "Test",
    onClose: () => {
      closes += 1;
    },
  }),
);
modal = instantSheet.render();
modal.props.onRequestClose();
assert.equal(closes, 1, "reduced-motion dismissal is immediate");
sheetVisible = false;
instantSheet.render();
sheetVisible = true;
modal = instantSheet.render();
assert.equal(closes, 1, "reopening a reduced-motion sheet stays open");
modal.props.onRequestClose();
assert.equal(closes, 2, "a reopened sheet can be dismissed again");
instantSheet.unmount();

reduced = false;
const routedSheet = harness(() =>
  kit.Sheet({
    visible: true,
    route: true,
    title: "Route",
    onClose: () => {
      closes++;
    },
  }),
);
routedSheet.render();
animations.at(-1).finish();
const backAction = { type: "GO_BACK" };
const repeatBack = () => {
  assert.equal(
    preventRemoval,
    null,
    "removal prevention is disabled before repeat",
  );
  navigation.dispatch(backAction);
};
preventRemoval({ repeat: repeatBack });
const routedExit = animations.at(-1);
preventRemoval({ repeat: () => navigation.dispatch(backAction) });
assert.equal(animations.at(-1), routedExit);
assert.equal(navigationActions.length, 0);
routedExit.finish();
routedSheet.render();
assert.equal(
  navigationActions.length,
  1,
  "route Back is dispatched once after exit",
);
routedSheet.render();
assert.equal(navigationActions.length, 1);
assert.equal(closes, 2, "replaying a route action does not also call onClose");
routedSheet.unmount();

let controlledVisible = true;
const controlledSheet = harness(() =>
  kit.Sheet({
    visible: controlledVisible,
    title: "Local",
    onClose: () => {
      closes++;
    },
  }),
);
controlledSheet.render();
animations.at(-1).finish();
controlledVisible = false;
assert.equal(
  controlledSheet.render().props.visible,
  true,
  "controlled sheets stay mounted during exit",
);
const controlledExit = animations.at(-1);
controlledSheet.render().props.onRequestClose();
assert.equal(
  animations.at(-1),
  controlledExit,
  "Back during a controlled exit cannot create a second close or callback",
);
controlledVisible = true;
controlledSheet.render();
assert.equal(controlledExit.stopped, true, "rapid reopen cancels the old exit");
animations.at(-1).finish();
assert.equal(controlledSheet.render().props.visible, true);
controlledVisible = false;
controlledSheet.render();
animations.at(-1).finish();
assert.equal(controlledSheet.render().props.visible, false);
assert.equal(
  closes,
  2,
  "externally controlled closure does not duplicate callbacks",
);
controlledSheet.unmount();

let toggleValue = false;
let toggles = 0;
const toggle = harness(() =>
  kit.Toggle({
    value: toggleValue,
    onValueChange: (value) => {
      toggleValue = value;
      toggles++;
    },
    accessibilityLabel: "Schedule",
    disabled: false,
  }),
);
let renderedToggle = toggle.render();
renderedToggle.props.onPress();
renderedToggle = toggle.render();
assert.equal(renderedToggle.props.accessibilityState.checked, true);
assert.equal(
  renderedToggle.props["aria-checked"],
  true,
  "web switch exposes checked state with current RN Web",
);
assert.equal(animations.at(-1).config.toValue, 1);
toggleValue = false; // Failed save reverts the controlled value.
renderedToggle = toggle.render();
assert.equal(animations.at(-1).config.toValue, 0);
assert.equal(renderedToggle.props.accessibilityState.checked, false);
assert.equal(renderedToggle.props["aria-checked"], false);
assert.equal(toggles, 1, "decorative toggle motion never invokes a mutation");
toggle.unmount();

reduced = false;
let presses = 0;
const button = harness(() =>
  motion.MotionPressable({
    children: "Open",
    style: { minHeight: 48 },
    onPress: () => {
      presses += 1;
    },
  }),
);
let renderedButton = button.render();
assert.equal(
  renderedButton.type,
  "pressable",
  "the hit target stays a stable native Pressable",
);
renderedButton.props.onPressIn({});
renderedButton = button.render();
assert.equal(animations.at(-1).config.toValue, 1);
assert.equal(renderedButton.props.style.minHeight, 48);
assert.equal(
  renderedButton.props.children[1].props.pointerEvents,
  "none",
  "visual feedback never intercepts a press",
);
renderedButton.props.onPress({});
renderedButton.props.onPressOut({});
button.render();
assert.equal(presses, 1);
button.unmount();
const disabledButton = harness(() =>
  motion.MotionPressable({ disabled: true, style: { opacity: 0.4 } }),
);
renderedButton = disabledButton.render();
assert.equal(renderedButton.props.disabled, true);
assert.equal(
  renderedButton.props.style.opacity,
  0.4,
  "disabled appearance remains intact",
);
assert.equal(renderedButton.props.children[1].props.style[1].opacity, 0);
disabledButton.unmount();
const focusButton = harness(() =>
  kit.Button({ children: "Focus", onPress: () => {} }),
);
let focusTarget = focusButton.render();
const normalButtonStyle = native.StyleSheet.flatten(focusTarget.props.style);
focusTarget.props.onFocus();
focusTarget = focusButton.render();
const focusedButtonStyle = native.StyleSheet.flatten(focusTarget.props.style);
assert.equal(
  focusedButtonStyle.borderWidth,
  normalButtonStyle.borderWidth,
  "keyboard focus cannot change button layout bounds",
);
focusButton.unmount();

const warning = harness(() =>
  kit.Notice({ tone: "warning", children: "Outdated reading" }),
);
const renderedWarning = warning.render();
assert.equal(renderedWarning.props.accessibilityRole, "alert");
assert.equal(renderedWarning.type, "animated-view");
assert.equal(
  renderedWarning.props.style.opacity,
  undefined,
  "warnings never wait for a reveal animation",
);
warning.unmount();

let opened = 0;
let removed = 0;
const deleteAction = {
  type: "pressable",
  props: { onPress: () => removed++ },
};
const actionRow = kit.ListRow({
  title: "Oxygen below limit",
  onPress: () => opened++,
  trailingAction: deleteAction,
});
assert.equal(actionRow.type, "view");
const [rowButton, actionContainer] = actionRow.props.children;
assert.equal(rowButton.type, "pressable");
assert.equal(actionContainer.props.children, deleteAction);
function contains(node, target) {
  if (node === target) return true;
  if (!node || typeof node !== "object") return false;
  const children = node.props?.children;
  return (Array.isArray(children) ? children : [children]).some((child) =>
    contains(child, target),
  );
}
assert.equal(
  contains(rowButton, deleteAction),
  false,
  "a row action must not be nested inside the row button",
);
deleteAction.props.onPress();
assert.equal(removed, 1);
assert.equal(opened, 0, "deleting a notification does not open its details");
rowButton.props.onPress();
assert.equal(opened, 1);
assert.equal(removed, 1);
assert.equal(
  kit.ListRow({ title: "History", onPress: () => {} }).type,
  "pressable",
  "rows without independent actions keep their existing hit target",
);
assert.equal(
  kit.ListRow({
    title: "Disabled",
    onPress: () => {},
    disabled: true,
    trailingAction: deleteAction,
  }).props.children[0].props.disabled,
  true,
);

let configurationReads = 0;
const notifications = load("../src/app/notifications.tsx", {
  "expo-router": { useFocusEffect: () => {} },
  "@/components/app-shell": kit,
  "@/components/feed-status": { relativeDayLabel: () => "Oct 16, 2026" },
  "@/constants/theme": theme,
  "@/lib/alerts": {
    useAlerts: () => [
      {
        id: "alert-1",
        deviceId: "device-1",
        at: "2026-10-16T00:00:00Z",
        read: false,
      },
    ],
    useUnreadCount: () => 1,
    alertTitle: () => "Oxygen below limit",
    alertLine: () => "4.9 mg/L · limit 5 · Dev 1 · Simulator",
  },
  "@/lib/device-access": {
    useDeviceAccess: () => ({ installationId: "test", devices: [] }),
  },
  "@/lib/schedules": {
    readConfiguration: () => {
      configurationReads++;
    },
  },
});
const notificationScreen = harness(() => notifications.default());
const firstNotification =
  notificationScreen.render().props.children.props.children[0];
await Promise.resolve();
const nextNotification =
  notificationScreen.render().props.children.props.children[0];
assert.equal(firstNotification.props.meta, "Oct 16, 2026");
assert.equal(
  firstNotification.props.revealKey,
  "test:device-1:alert-1",
  "notification motion uses installation/device/record identity",
);
assert.match(firstNotification.props.accessibilityLabel, /phone time/);
assert.equal(
  firstNotification.props.stackMeta,
  true,
  "narrow phones keep the timestamp below the title",
);
assert.equal(nextNotification.props.meta, firstNotification.props.meta);
assert.equal(
  configurationReads,
  0,
  "notification dates do not switch zones after a configuration request",
);
assert.ok(firstNotification.props.trailingAction);
assert.equal(firstNotification.props.trailing, undefined);
native.useWindowDimensions = () => ({ width: 515, height: 884 });
assert.equal(
  notificationScreen.render().props.children.props.children[0].props.stackMeta,
  false,
);
notificationScreen.unmount();

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));
function nodes(node, type) {
  if (!node || typeof node !== "object") return [];
  const children = [
    node.props?.children,
    node.props?.actions,
    node.props?.action,
    node.props?.footer,
    node.props?.header,
    node.props?.headerAction,
  ].flat();
  return [
    ...(node.type === type ? [node] : []),
    ...children.flatMap((child) => nodes(child, type)),
  ];
}
const deviceScope = load("../src/lib/device-access-state.ts");
let scheduleAccess = {
  installationId: "installation-a",
  scopeRevision: 1,
  selectedDeviceId: "device-a",
  selectedDevice: {
    deviceId: "device-a",
    capabilities: { localScheduleExecution: true, maxSchedules: 8 },
  },
  devices: [],
};
const scheduleFixture = {
  schedule_id: "schedule-a",
  local_time: "08:00",
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  enabled: true,
  targets: [{ nozzle_number: 1, dose: { mode: "grams", amount_g: 10 } }],
};
function configurationFor(enabled, pending = false) {
  const snapshot = {
    timezone: "Asia/Manila",
    monitoring_limits: {},
    low_feed_threshold_pct: null,
    schedules: [{ ...scheduleFixture, enabled }],
  };
  return {
    current_state: {
      desired_revision: pending ? 2 : 1,
      last_attempt_status: pending ? "pending" : "applied",
    },
    applied_snapshot: { ...snapshot, revision: 1 },
    desired_snapshot: pending
      ? { ...snapshot, schedules: [{ ...scheduleFixture, enabled: !enabled }] }
      : null,
  };
}
const scheduleReads = [];
const scheduleWrites = [];
let saveGate = deferred();
let scheduleChange;
const scheduleModule = load("../src/app/(tabs)/schedule.tsx", {
  "expo-router": {
    useFocusEffect: (effect) => react.useEffect(effect, [effect]),
  },
  "@/components/app-shell": {
    ...kit,
    AppPage: "page",
    ScreenHeader: "header",
    Toggle: "toggle",
    Skeleton: "skeleton",
    Button: "button",
  },
  "@/components/feed-status": {
    displayTime: (value) => value,
    relativeDayLabel: () => "Today",
    clockParts: () => ({ time: "8:00", period: "AM" }),
  },
  "@/constants/theme": theme,
  "@/lib/device-access-state": deviceScope,
  "@/lib/device-access": { useDeviceAccess: () => scheduleAccess },
  "@/lib/device-changes": {
    subscribeDeviceChanges: (_key, _device, _tables, callback) => {
      scheduleChange = callback;
      return () => {
        scheduleChange = null;
      };
    },
  },
  "@/lib/error-text": { errorText: (reason) => reason.message },
  "@/lib/schedules": {
    readConfiguration: () => {
      const read = deferred();
      scheduleReads.push(read);
      return read.promise;
    },
    readNextOccurrence: async () => ({ occurrence: null }),
    loadPendingWrite: async () => null,
    saveConfiguration: (...args) => {
      scheduleWrites.push(args);
      return saveGate.promise;
    },
    isConfirmedScheduleRejection: () => false,
  },
});
const scheduleScreen = harness(() => scheduleModule.default());
scheduleScreen.render();
scheduleReads[0].resolve(configurationFor(true));
await flushPromises();
let scheduleView = scheduleScreen.render();
const initialScheduleReveal = nodes(scheduleView, kit.BentoCard).find(
  (node) => node.props.revealKey,
)?.props.revealKey;
assert.ok(
  initialScheduleReveal,
  "applied schedule cards use stable, device-scoped reveal identities",
);
assert.equal(nodes(scheduleView, "toggle")[0].props.disabled, false);
nodes(scheduleView, "toggle")[0].props.onValueChange();
scheduleView = scheduleScreen.render();
assert.equal(
  nodes(scheduleView, "skeleton").length,
  0,
  "saving never replaces loaded schedules with skeletons",
);
saveGate.resolve();
await flushPromises();
scheduleView = scheduleScreen.render();
assert.equal(scheduleReads.length, 2);
assert.equal(
  nodes(scheduleView, "skeleton").length,
  0,
  "the post-save read keeps schedule cards mounted",
);
assert.equal(
  nodes(scheduleView, "toggle")[0].props.disabled,
  true,
  "editing stays locked during refresh",
);
nodes(scheduleView, "toggle")[0].props.onValueChange();
assert.equal(
  scheduleWrites.length,
  1,
  "a refresh cannot admit another mutation",
);
assert.equal(scheduleWrites[0][3].schedules[0].enabled, false);
scheduleReads[1].resolve(configurationFor(true, true));
await flushPromises();
scheduleView = scheduleScreen.render();
assert.equal(
  nodes(scheduleView, "toggle")[0].props.value,
  true,
  "requested state is not reported as applied",
);
assert.equal(nodes(scheduleView, "toggle")[0].props.disabled, true);
scheduleChange();
scheduleReads[2].resolve(configurationFor(false));
await flushPromises();
scheduleView = scheduleScreen.render();
assert.equal(nodes(scheduleView, "toggle")[0].props.value, false);
assert.equal(
  nodes(scheduleView, kit.BentoCard).find(
    (node) => node.props.revealKey === initialScheduleReveal,
  )?.props.revealKey,
  initialScheduleReveal,
  "acknowledging a toggle does not replace its reveal identity",
);
assert.equal(nodes(scheduleView, "toggle")[0].props.disabled, false);

saveGate = deferred();
nodes(scheduleView, "toggle")[0].props.onValueChange();
saveGate.resolve();
await flushPromises();
scheduleReads[3].reject(new Error("Offline"));
await flushPromises();
scheduleView = scheduleScreen.render();
assert.equal(
  nodes(scheduleView, "skeleton").length,
  0,
  "a failed refresh retains the last applied list",
);
assert.equal(
  nodes(scheduleView, "toggle")[0].props.disabled,
  true,
  "stale configuration cannot be edited after a failed refresh",
);
nodes(scheduleView, "button")
  .find((node) => node.props.children === "Refresh")
  .props.onPress();
scheduleReads[4].resolve(configurationFor(false));
await flushPromises();
assert.equal(nodes(scheduleScreen.render(), "toggle")[0].props.disabled, false);

scheduleChange();
scheduleChange();
assert.equal(
  scheduleReads.length,
  6,
  "overlapping updates share one in-flight read",
);
scheduleReads[5].resolve(configurationFor(true));
await flushPromises();
assert.equal(
  scheduleReads.length,
  7,
  "queued updates produce one follow-up read",
);
assert.equal(
  nodes(scheduleScreen.render(), "toggle")[0].props.value,
  false,
  "a superseded response cannot replace the applied list",
);
scheduleReads[6].resolve(configurationFor(false));
await flushPromises();

scheduleChange();
scheduleAccess = {
  ...scheduleAccess,
  scopeRevision: 2,
  selectedDeviceId: "device-b",
  selectedDevice: { ...scheduleAccess.selectedDevice, deviceId: "device-b" },
};
scheduleScreen.render();
scheduleView = scheduleScreen.render();
assert.equal(
  nodes(scheduleView, "toggle").length,
  0,
  "changing feeders clears the previous feeder's schedules",
);
scheduleReads[7].resolve(configurationFor(true));
await flushPromises();
assert.equal(
  nodes(scheduleScreen.render(), "toggle").length,
  0,
  "a late response cannot repopulate a different feeder",
);
scheduleReads[8].resolve(configurationFor(false));
await flushPromises();
assert.equal(nodes(scheduleScreen.render(), "toggle")[0].props.value, false);
scheduleChange();
scheduleView = scheduleScreen.render();
assert.equal(
  nodes(scheduleView, "toggle")[0].props.disabled,
  false,
  "routine Realtime reads never dim or disable loaded schedules",
);
assert.equal(nodes(scheduleView, "skeleton").length, 0);
scheduleChange();
scheduleReads[9].resolve(configurationFor(false));
await flushPromises();
assert.equal(
  nodes(scheduleScreen.render(), "toggle")[0].props.disabled,
  false,
  "queued background reads remain silent",
);
scheduleReads[10].resolve(configurationFor(false));
await flushPromises();
scheduleView = scheduleScreen.render();
saveGate = deferred();
nodes(scheduleView, "toggle")[0].props.onValueChange();
const writesBeforeRepeatedInput = scheduleWrites.length;
scheduleView = scheduleScreen.render();
assert.equal(nodes(scheduleView, "toggle")[0].props.disabled, true);
nodes(scheduleView, "toggle")[0].props.onValueChange();
assert.equal(
  scheduleWrites.length,
  writesBeforeRepeatedInput,
  "pending toggle feedback cannot submit a repeated save",
);
saveGate.reject(new Error("Save failed"));
await flushPromises();
scheduleView = scheduleScreen.render();
assert.equal(
  nodes(scheduleView, "toggle")[0].props.value,
  false,
  "failed saves retain the real applied switch state",
);
assert.equal(nodes(scheduleView, "toggle")[0].props.disabled, true);
assert.equal(
  scheduleWrites.at(-1)[1],
  "device-b",
  "motion retains the current feeder binding",
);
scheduleScreen.unmount();

const dates = load("../src/components/date-field.tsx", {
  "@/constants/theme": theme,
  "@/components/motion": { MotionPressable: "date-button" },
  "@expo/ui/community/datetime-picker": { DateTimePicker: "date-picker" },
});
assert.equal(dates.calendarDate("2026-02-29"), undefined);
assert.equal(dates.calendarDate("2026-04-31"), undefined);
assert.equal(dates.calendarDate("2026-2-01"), undefined);
assert.equal(dates.calendarDate(""), undefined);
assert.equal(
  dates.calendarDateValue(dates.calendarDate("2028-02-29")),
  "2028-02-29",
);
const priorTZ = process.env.TZ;
try {
  for (const zone of [
    "Asia/Manila",
    "America/Los_Angeles",
    "Pacific/Kiritimati",
  ]) {
    process.env.TZ = zone;
    assert.equal(
      dates.calendarDateValue(dates.calendarDate("2026-10-20")),
      "2026-10-20",
    );
  }
} finally {
  if (priorTZ === undefined) delete process.env.TZ;
  else process.env.TZ = priorTZ;
}
native.Platform.OS = "android";
let chosenDate = "unchanged";
const dateField = harness(() =>
  dates.DateField({
    label: "To",
    value: "",
    minimum: "2026-10-20",
    onChange: (value) => {
      chosenDate = value;
    },
  }),
);
nodes(dateField.render(), "date-button")[0].props.onPress();
let picker = nodes(dateField.render(), "date-picker")[0];
assert.equal(
  dates.calendarDateValue(picker.props.value),
  "2026-10-20",
  "an empty picker starts within its range",
);
picker.props.onChange({ type: "dismissed" });
assert.equal(chosenDate, "unchanged", "cancel preserves the date");
assert.equal(nodes(dateField.render(), "date-picker").length, 0);
nodes(dateField.render(), "date-button")[0].props.onPress();
picker = nodes(dateField.render(), "date-picker")[0];
picker.props.onChange({ type: "set" }, dates.calendarDate("2026-10-21"));
assert.equal(chosenDate, "2026-10-21");
dateField.unmount();
native.Platform.OS = "web";

const webDateField = harness(() =>
  dates.DateField({
    label: "From",
    value: "",
    maximum: "2026-10-20",
    onChange: (value) => {
      chosenDate = value;
    },
  }),
);
const webDateInput = nodes(webDateField.render(), "input")[0];
assert.equal(webDateInput.props.type, "date");
assert.equal(webDateInput.props.max, "2026-10-20");
webDateInput.props.onChange({ currentTarget: { value: "2026-10-15" } });
assert.equal(chosenDate, "2026-10-15");
webDateInput.props.onChange({ currentTarget: { value: "" } });
assert.equal(chosenDate, "", "clearing a calendar date removes its bound");
webDateField.unmount();

const statusSelect = load("../src/components/history-status-select.tsx", {
  "@expo/ui/community/menu": { MenuView: "native-menu" },
  "@/constants/theme": theme,
});
const statusChanges = [];
const statusProps = {
  value: "failed",
  onChange: (value) => statusChanges.push(value),
};
const webStatus = harness(() => statusSelect.HistoryStatusSelect(statusProps));
let select = nodes(webStatus.render(), "select")[0];
assert.equal(select.props["aria-label"], "Status");
assert.equal(select.props.value, "failed");
assert.equal(nodes(select, "option").length, 5);
for (const value of ["all", "completed", "failed", "in_progress", "unknown"])
  select.props.onChange({ currentTarget: { value } });
assert.equal(
  statusChanges.join(","),
  "all,completed,failed,in_progress,unknown",
);
select.props.onChange({ currentTarget: { value: "invalid" } });
assert.equal(statusChanges.length, 5);
webStatus.unmount();
native.Platform.OS = "android";
const nativeStatus = harness(() =>
  statusSelect.HistoryStatusSelect(statusProps),
);
const menu = nodes(nativeStatus.render(), "native-menu")[0];
assert.equal(
  menu.props.actions.filter((option) => option.state === "on")[0].id,
  "failed",
);
menu.props.onPressAction({ nativeEvent: { event: "unknown" } });
assert.equal(statusChanges.at(-1), "unknown");
nativeStatus.unmount();
native.Platform.OS = "web";

const historyReads = [];
const historyModule = load("../src/app/(tabs)/history.tsx", {
  "expo-router": {
    useFocusEffect: (effect) => react.useEffect(effect, [effect]),
  },
  "@/components/app-shell": Object.fromEntries(
    [
      "AppPage",
      "ScreenHeader",
      "IconButton",
      "Sheet",
      "Button",
      "Segmented",
      "Skeleton",
    ].map((name) => [name, name.toLowerCase()]),
  ),
  "@/components/date-field": { ...dates, DateField: "date-field" },
  "@/components/history-status-select": {
    HistoryStatusSelect: "status-select",
  },
  "@/constants/theme": theme,
  "@/lib/device-access": { useDeviceAccess: () => scheduleAccess },
  "@/lib/manual-feed": {
    readHistoryPage: async (_installation, _device, filters) => {
      historyReads.push(filters);
      return {
        records: [],
        totals: { completed: 0, needs_attention: 0 },
        timezone_known: true,
        from_date: "2026-10-15",
        to_date: "2026-10-20",
      };
    },
  },
});
const historyScreen = harness(() => historyModule.default());
const filterButton = () => nodes(historyScreen.render(), "iconbutton")[0];
const filterSheet = () => nodes(historyScreen.render(), "sheet")[0];
const filterDate = (label) =>
  nodes(filterSheet(), "date-field").find((node) => node.props.label === label);
const filterAction = (label) =>
  nodes(filterSheet(), "button").find((node) => node.props.children === label);
historyScreen.render();
await flushPromises();
filterButton().props.onPress();
assert.equal(
  filterDate("From").props.value,
  "2026-10-15",
  "the picker starts with the displayed history range",
);
assert.equal(filterDate("To").props.value, "2026-10-20");
filterDate("From").props.onChange("2026-02-29");
assert.equal(
  filterAction("Apply filters").props.disabled,
  true,
  "invalid dates cannot be applied",
);
filterDate("From").props.onChange("2026-10-20");
filterDate("To").props.onChange("2026-10-15");
assert.equal(
  filterAction("Apply filters").props.disabled,
  true,
  "inverted dates cannot be applied",
);
filterDate("To").props.onChange("2026-10-20");
assert.equal(
  filterAction("Apply filters").props.disabled,
  false,
  "a single day is a valid range",
);
nodes(filterSheet(), "segmented")[0].props.onChange("manual");
nodes(filterSheet(), "status-select")[0].props.onChange("completed");
filterAction("Apply filters").props.onPress();
historyScreen.render();
assert.equal(historyReads.at(-1).from, "2026-10-20");
assert.equal(historyReads.at(-1).to, "2026-10-20");
assert.equal(historyReads.at(-1).source, "manual");
assert.equal(historyReads.at(-1).status, "completed");
filterButton().props.onPress();
assert.equal(
  nodes(filterSheet(), "status-select")[0].props.value,
  "completed",
  "applied status remains selected when reopening",
);
filterDate("From").props.onChange("2026-10-01");
filterSheet().props.onClose();
filterButton().props.onPress();
assert.equal(
  filterDate("From").props.value,
  "2026-10-20",
  "dismissed edits do not replace applied filters",
);
const readsBeforeReset = historyReads.length;
filterAction("Reset").props.onPress();
assert.equal(
  filterSheet().props.visible,
  true,
  "Reset keeps the sheet open for review",
);
assert.equal(filterDate("From").props.value, "");
assert.equal(filterDate("To").props.value, "");
assert.equal(nodes(filterSheet(), "status-select")[0].props.value, "all");
assert.equal(nodes(filterSheet(), "segmented")[0].props.value, "all");
assert.equal(
  historyReads.length,
  readsBeforeReset,
  "Reset does not apply a request",
);
filterSheet().props.onClose();
filterButton().props.onPress();
assert.equal(
  nodes(filterSheet(), "status-select")[0].props.value,
  "completed",
  "closing after Reset preserves applied filters",
);
filterAction("Reset").props.onPress();
filterAction("Apply filters").props.onPress();
historyScreen.render();
assert.equal(historyReads.at(-1).from, undefined);
assert.equal(historyReads.at(-1).to, undefined);
assert.equal(historyReads.at(-1).source, "all");
assert.equal(historyReads.at(-1).status, "all");
filterButton().props.onPress();
assert.equal(
  nodes(filterSheet(), "status-select")[0].props.value,
  "all",
  "applying Reset restores the default status",
);
historyScreen.unmount();

let numericValue = 5.8;
const numericLabel = harness(() =>
  motion.AnimatedNumber({
    value: numericValue,
    eligible: true,
    scope: "semantic-reading",
  }),
);
numericLabel.render();
const visualReading = numericLabel.render();
assert.equal(visualReading.props.children, "5.8");
assert.equal(
  visualReading.props.accessibilityLabel,
  "5.8",
  "accessible readings never announce animated frames",
);
const readingStat = kit.Stat({
  icon: "container",
  label: "Feed",
  value: "45",
  visualValue: visualReading,
});
assert.equal(
  nodes(readingStat, "text").find(
    (node) => node.props.style === theme.Typography.reading,
  ).props.accessibilityLabel,
  "45",
  "the outer stat Text retains its actual semantic value",
);
numericValue = Number.NaN;
const invalidReading = numericLabel.render();
assert.equal(invalidReading.props.children, "—");
assert.equal(
  invalidReading.props.accessibilityLabel,
  "Unavailable",
  "invalid readings are unavailable visually and semantically",
);
numericLabel.unmount();

let progressTarget = 80;
let progressAnimated = true;
const progressBar = harness(() =>
  kit.ProgressBar({
    value: progressTarget,
    animated: progressAnimated,
    accessibilityLabel: "Remaining",
    accessibilityText: "Actual value",
  }),
);
progressBar.render();
progressTarget = 25;
let renderedProgress = progressBar.render();
assert.equal(renderedProgress.props.accessibilityValue.now, 25);
assert.equal(
  renderedProgress.props["aria-valuenow"],
  25,
  "web progress announces the actual value",
);
assert.equal(
  renderedProgress.props.children.props.style[1].width,
  "25%",
  "fresh progress is actual immediately too",
);
progressAnimated = false;
renderedProgress = progressBar.render();
assert.equal(
  renderedProgress.props.children.props.style[1].width,
  "25%",
  "stale progress settles immediately, independently of its animated frame",
);
progressBar.unmount();

const closingSheet = harness(() =>
  kit.Sheet({
    visible: true,
    title: "Interrupt",
    onClose: () => {
      closes++;
    },
  }),
);
let interruptedModal = closingSheet.render();
animations.at(-1).finish();
const dragHandle =
  interruptedModal.props.children.props.children[1].props.children[0];
const beforeCancel = closes;
dragHandle.props.onPanResponderGrant();
dragHandle.props.onPanResponderMove(null, { dy: 50 });
dragHandle.props.onPanResponderTerminate();
assert.equal(animations.at(-1).config.toValue, 0);
assert.equal(
  animations.at(-1).config.spring,
  true,
  "canceled drags settle with a spring",
);
assert.equal(
  animations.at(-1).config.overshootClamping,
  true,
  "settling never bounces",
);
animations.at(-1).finish();
assert.equal(
  closes,
  beforeCancel,
  "canceling a sheet drag does not dismiss or navigate",
);
dragHandle.props.onPanResponderMove(null, { dy: 30 });
dragHandle.props.onPanResponderTerminate();
const interruptedSpring = animations.at(-1);
interruptedModal.props.onRequestClose();
const interruptedExit = animations.at(-1);
assert.equal(
  interruptedSpring.stopped,
  true,
  "closing interrupts a settling drag at its current position",
);
dragHandle.props.onPanResponderTerminate();
assert.equal(
  animations.at(-1),
  interruptedExit,
  "a late canceled gesture cannot replace an exit",
);
reduced = true;
closingSheet.render();
assert.equal(interruptedExit.stopped, true);
assert.equal(
  closes,
  beforeCancel + 1,
  "enabling reduced motion settles a pending close once",
);
closingSheet.render();
interruptedModal.props.onRequestClose();
assert.equal(closes, beforeCancel + 1);
closingSheet.unmount();
reduced = false;

const backgroundRoute = harness(() =>
  kit.Sheet({
    visible: true,
    route: true,
    title: "Background route",
    onClose: () => {
      closes++;
    },
  }),
);
backgroundRoute.render();
focused = false;
assert.equal(
  backgroundRoute.render().props.visible,
  false,
  "a route sheet cannot cover the next focused page",
);
backgroundRoute.unmount();
focused = true;
let callbackVisible = true;
const callbackSheet = harness(() =>
  kit.Sheet({
    visible: callbackVisible,
    title: "Callback close",
    onClose: () => {
      callbackVisible = false;
    },
  }),
);
let callbackModal = callbackSheet.render();
animations.at(-1).finish();
callbackModal.props.onRequestClose();
animations.at(-1).finish();
const beforeCompletedClose = animations.length;
callbackSheet.render();
assert.equal(
  callbackSheet.render().props.visible,
  false,
  "a completed local exit removes its modal without a second invisible exit",
);
assert.equal(
  animations.length,
  beforeCompletedClose,
  "completed local close does not schedule a second exit",
);
callbackSheet.unmount();
const localFocus = harness(() =>
  kit.Sheet({ visible: true, title: "Local focus", onClose: () => {} }),
);
localFocus.render();
focused = false;
assert.equal(
  localFocus.render().props.visible,
  false,
  "local sheets cannot cover a newly focused route either",
);
localFocus.unmount();
focused = true;

console.log(
  "Motion and UI checks passed: startup, one-time entrances, viewport/record identity, immediate readings/progress, accessibility, cancellation, sheet close/reopen/keyboard/Back/drag, notification actions, scoped schedule writes and filters.",
);
