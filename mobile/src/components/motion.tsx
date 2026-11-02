import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
  type ViewProps,
  type ScrollViewProps,
  type TextProps,
} from "react-native";
import { useIsFocused } from "expo-router";
import { Colors } from "@/constants/theme";

export const Motion = {
  press: 120,
  selection: 150,
  transition: 460,
  reveal: 520,
  sheet: 420,
  scrim: 260,
  stagger: 55,
  pulse: 900,
} as const;

export const isMotionAppActive = (state: string | null | undefined) =>
  state == null || state === "active";

const ReducedMotion = createContext(true);
const MotionActivity = createContext({ active: true });
const nativeDriver = Platform.OS !== "web";

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState<boolean | null>(null);
  const [active, setActive] = useState(
    isMotionAppActive(AppState.currentState),
  );
  useEffect(() => {
    let mounted = true;
    let changed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (mounted && !changed) setReduced(value);
      },
      () => {
        if (mounted && !changed) setReduced(true);
      },
    );
    const preference = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => {
        changed = true;
        setReduced(value);
      },
    );
    const appState = AppState.addEventListener("change", (state) =>
      setActive(isMotionAppActive(state)),
    );
    return () => {
      mounted = false;
      preference.remove();
      appState.remove();
    };
  }, []);
  return (
    <ReducedMotion.Provider value={reduced !== false || !active}>
      <MotionActivity.Provider value={{ active }}>
        {reduced === null ? null : children}
      </MotionActivity.Provider>
    </ReducedMotion.Provider>
  );
}

export const useReducedMotion = () => useContext(ReducedMotion);

export function useMotionValue(
  target: number,
  duration: number,
  useNativeDriver = nativeDriver,
) {
  const reduced = useReducedMotion();
  const [value] = useState(() => new Animated.Value(target));
  useEffect(() => {
    value.stopAnimation();
    if (reduced) {
      value.setValue(target);
      return;
    }
    const animation = Animated.timing(value, {
      toValue: target,
      duration,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [target, duration, reduced, value, useNativeDriver]);
  return value;
}

export function useEntranceMotion(
  trigger?: string,
  enabled = true,
  distance = 18,
  delay = 0,
  duration: number = Motion.transition,
) {
  const reduced = useReducedMotion();
  const routeFocused = useIsFocused();
  const activity = useContext(MotionActivity);
  const focused = routeFocused && activity.active;
  const [value] = useState(
    () => new Animated.Value(enabled && focused && !reduced ? 0 : 1),
  );
  const previous = useRef<{
    trigger?: string;
    active: boolean;
    reduced: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    value.stopAnimation();
    const active = enabled && focused;
    const replay =
      active &&
      (!previous.current?.active || previous.current.trigger !== trigger);
    previous.current = { trigger, active, reduced };
    if (reduced || !replay) {
      value.setValue(1);
      return;
    }
    value.setValue(0);
    const animation = Animated.timing(value, {
      toValue: 1,
      duration,
      delay: Math.min(165, Math.max(0, delay)),
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: nativeDriver,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [trigger, enabled, focused, reduced, value, delay, duration]);
  return {
    opacity:
      reduced || !enabled || !focused
        ? 1
        : value.interpolate({
            inputRange: [0, 1],
            outputRange: [duration === Motion.reveal ? 0.35 : 0.25, 1],
          }),
    transform: [
      {
        translateY:
          reduced || !enabled || !focused
            ? 0
            : value.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
      },
    ],
  };
}

/** One decorative reveal per focus; retargets settle synchronously to model truth. */
export function useAnimatedNumber(
  target: number | null,
  eligible: boolean,
  scope: string,
) {
  const progress = useEntryProgress(target, eligible, scope, 740);
  return target !== null && Number.isFinite(target) ? target * progress : null;
}

/** Shared by counters, the feed meter and real graph clipping, never by command progress. */
export function useEntryProgress(
  target: number | null,
  eligible: boolean,
  scope: string,
  duration: number,
  replayKey = "",
) {
  const routeFocused = useIsFocused();
  const activity = useContext(MotionActivity);
  const focused = routeFocused && activity.active;
  const reduced = useReducedMotion();
  const [entry, setEntry] = useState({
    focused,
    generation: focused ? 1 : 0,
    replayKey,
  });
  const changed = entry.focused !== focused || entry.replayKey !== replayKey;
  const generation = entry.generation + (changed && focused ? 1 : 0);
  if (changed) setEntry({ focused, generation, replayKey });
  const consumed = useRef(-1);
  const [value] = useState(() => new Animated.Value(1));
  const [frame, setFrame] = useState({
    target,
    scope,
    generation,
    progress: eligible && focused && !reduced ? 0 : 1,
  });
  const valid = target !== null && Number.isFinite(target);
  useLayoutEffect(() => {
    value.stopAnimation();
    if (!focused || reduced || !eligible || !valid) {
      if (reduced || !focused) consumed.current = generation;
      return;
    }
    if (consumed.current === generation) return;
    consumed.current = generation;
    let live = true;
    value.setValue(0);
    setFrame({ target, scope, generation, progress: 0 });
    const listener = value.addListener(({ value: progress }) => {
      if (live) setFrame({ target, scope, generation, progress });
    });
    const animation = Animated.timing(value, {
      toValue: 1,
      duration,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: false,
      isInteraction: false,
    });
    animation.start();
    return () => {
      live = false;
      value.removeListener(listener);
      animation.stop();
      setFrame({ target, scope, generation, progress: 1 });
    };
  }, [
    target,
    scope,
    generation,
    focused,
    reduced,
    eligible,
    valid,
    value,
    duration,
  ]);
  return focused &&
    !reduced &&
    eligible &&
    valid &&
    frame.target === target &&
    frame.scope === scope &&
    frame.generation === generation
    ? frame.progress
    : 1;
}

export function AnimatedNumber({
  value,
  eligible,
  scope,
  decimals = value === null || Number.isInteger(value)
    ? 0
    : Math.min(3, String(value).split(".")[1]?.length ?? 0),
  ...props
}: TextProps & {
  value: number | null;
  eligible: boolean;
  scope: string;
  decimals?: number;
}) {
  const displayed = useAnimatedNumber(value, eligible, scope);
  return (
    <Text
      {...props}
      accessibilityLabel={
        props.accessibilityLabel ??
        (value === null || !Number.isFinite(value)
          ? "Unavailable"
          : String(value))
      }
    >
      {displayed === null ? "—" : displayed.toFixed(decimals)}
    </Text>
  );
}

type RevealViewport = {
  seen: Set<string>;
  initialStatic: boolean;
  subscribe: (check: () => void) => () => void;
  content: React.RefObject<React.ComponentRef<typeof View> | null>;
  bounds: React.RefObject<{ offset: number; height: number }>;
};
const RevealContext = createContext<RevealViewport | null>(null);

/** The existing scroll container, with measurements only for sections still awaiting reveal. */
export function MotionScrollView({
  children,
  contentStyle,
  initialStatic = false,
  ...props
}: ScrollViewProps & {
  contentStyle?: React.ComponentProps<typeof Animated.View>["style"];
  initialStatic?: boolean;
}) {
  const content = useRef<React.ComponentRef<typeof View>>(null);
  const [checks] = useState(() => new Set<() => void>());
  const [seen] = useState(() => new Set<string>());
  const bounds = useRef({ offset: 0, height: 0 });
  const focused = useIsFocused();
  const reduced = useReducedMotion();
  const notify = () => checks.forEach((check) => check());
  const subscribe = useCallback(
    (check: () => void) => {
      checks.add(check);
      check();
      return () => {
        checks.delete(check);
      };
    },
    [checks],
  );
  const context = useMemo(
    () => ({ content, bounds, subscribe, seen, initialStatic }),
    [bounds, subscribe, seen, initialStatic],
  );
  return (
    <ReducedMotion.Provider value={reduced || !focused}>
      <RevealContext.Provider value={context}>
        <ScrollView
          {...props}
          scrollEventThrottle={16}
          onLayout={(event) => {
            bounds.current.height = event.nativeEvent.layout.height;
            notify();
            props.onLayout?.(event);
          }}
          onScroll={(event) => {
            bounds.current.offset = event.nativeEvent.contentOffset.y;
            bounds.current.height = event.nativeEvent.layoutMeasurement.height;
            notify();
            props.onScroll?.(event);
          }}
          onContentSizeChange={(width, height) => {
            notify();
            props.onContentSizeChange?.(width, height);
          }}
        >
          <Animated.View ref={content} collapsable={false} style={contentStyle}>
            {children}
          </Animated.View>
        </ScrollView>
      </RevealContext.Provider>
    </ReducedMotion.Provider>
  );
}

export const sectionIntersectsViewport = (
  y: number,
  height: number,
  offset: number,
  viewportHeight: number,
) => viewportHeight > 0 && y < offset + viewportHeight && y + height > offset;

/** Replaces a View in place: measurements, gaps and accessibility order remain intact. */
export function MotionSection({
  style,
  delay = 0,
  revealKey,
  ...props
}: ViewProps & { delay?: number; revealKey?: string }) {
  const viewport = useContext(RevealContext);
  const focused = useIsFocused();
  const section = useRef<React.ComponentRef<typeof View>>(null);
  const seen = useRef(false);
  const [entry, setEntry] = useState({ focused, entered: false });
  if (entry.focused !== focused) setEntry({ focused, entered: false });
  const entered = entry.focused === focused && entry.entered;
  const measurementEpoch = useRef(0);
  const reduced = useReducedMotion();
  const check = useCallback(() => {
    if (
      reduced ||
      seen.current ||
      !viewport?.content.current ||
      !section.current
    )
      return;
    if (revealKey && viewport.seen.has(revealKey) && !entered) {
      seen.current = true;
      return;
    }
    const epoch = measurementEpoch.current;
    section.current.measureLayout(
      viewport.content.current,
      (_x, y, _width, height) => {
        if (
          epoch === measurementEpoch.current &&
          !seen.current &&
          sectionIntersectsViewport(
            y,
            height,
            viewport.bounds.current.offset,
            viewport.bounds.current.height,
          )
        ) {
          seen.current = true;
          if (revealKey) viewport.seen.add(revealKey);
          if (!(viewport.initialStatic && viewport.bounds.current.offset === 0))
            setEntry({ focused, entered: true });
        }
      },
      () => {},
    );
  }, [viewport, reduced, revealKey, entered, focused]);
  useEffect(() => {
    if (!focused) {
      seen.current = false;
      if (revealKey) viewport?.seen.delete(revealKey);
    }
  }, [focused, revealKey, viewport]);
  useEffect(() => {
    if (reduced || !focused) return;
    const epoch = measurementEpoch.current;
    const unsubscribe = viewport?.subscribe(check);
    return () => {
      measurementEpoch.current = epoch + 1;
      unsubscribe?.();
    };
  }, [check, reduced, focused, viewport]);
  const entrance = useEntranceMotion(
    undefined,
    entered && focused,
    13,
    viewport?.bounds.current.offset === 0 ? delay : 0,
    Motion.reveal,
  );
  return (
    <Animated.View
      {...props}
      ref={section}
      collapsable={false}
      onLayout={(event) => {
        check();
        props.onLayout?.(event);
      }}
      style={[style, entrance]}
    />
  );
}

export function useSkeletonPulse() {
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) {
      opacity.stopAnimation();
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence(
        [0.5, 1].map((toValue) =>
          Animated.timing(opacity, {
            toValue,
            duration: Motion.pulse / 2,
            useNativeDriver: nativeDriver,
            isInteraction: false,
          }),
        ),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [reduced, opacity]);
  return opacity;
}

export const MotionPressable = forwardRef<
  React.ComponentRef<typeof View>,
  Omit<PressableProps, "style" | "children"> & {
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
  }
>(function MotionPressable(
  { style, disabled, onPressIn, onPressOut, hitSlop = 2, ...props },
  ref,
) {
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion();
  const progress = useMotionValue(pressed && !disabled ? 1 : 0, Motion.press);
  const base = StyleSheet.flatten(style);
  const onInk = base?.backgroundColor === Colors.light.ink;
  const pressedOpacity = onInk ? 0.16 : 0.08;
  return (
    <Pressable
      {...props}
      ref={ref}
      aria-busy={props["aria-busy"] ?? props.accessibilityState?.busy}
      aria-checked={props["aria-checked"] ?? props.accessibilityState?.checked}
      aria-expanded={
        props["aria-expanded"] ?? props.accessibilityState?.expanded
      }
      aria-selected={
        props["aria-selected"] ?? props.accessibilityState?.selected
      }
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={(event) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        onPressOut?.(event);
      }}
      style={base}
    >
      {props.children}
      <Animated.View
        pointerEvents="none"
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: base?.borderRadius,
            backgroundColor: onInk ? Colors.light.onInk : Colors.light.ink,
            opacity: disabled
              ? 0
              : reduced
                ? pressed
                  ? pressedOpacity
                  : 0
                : progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, pressedOpacity],
                  }),
          },
        ]}
      />
    </Pressable>
  );
});
