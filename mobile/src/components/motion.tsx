import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
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
  press: 150,
  transition: 350,
  reveal: 800,
  stagger: 50,
  pulse: 900,
} as const;

export const isMotionAppActive = (state: string | null | undefined) =>
  state == null || state === "active";

const ReducedMotion = createContext(true);
const nativeDriver = Platform.OS !== "web";

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(true);
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
      () => {},
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
    <ReducedMotion.Provider value={reduced || !active}>
      {children}
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
      easing: Easing.out(Easing.cubic),
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
  distance = 10,
  delay = 0,
  duration: number = Motion.transition,
) {
  const reduced = useReducedMotion();
  const [value] = useState(() => new Animated.Value(1));
  const played = useRef(false);
  const previousTrigger = useRef(trigger);
  useEffect(() => {
    value.stopAnimation();
    if (previousTrigger.current !== trigger || !enabled) played.current = false;
    previousTrigger.current = trigger;
    if (reduced || !enabled) {
      value.setValue(1);
      return;
    }
    if (played.current) {
      value.setValue(1);
      return;
    }
    played.current = true;
    value.setValue(0);
    const animation = Animated.timing(value, {
      toValue: 1,
      duration,
      delay: Math.min(150, Math.max(0, delay)),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [trigger, enabled, reduced, value, delay, duration]);
  return {
    opacity: reduced || !enabled ? 1 : value,
    transform: [
      {
        translateY:
          reduced || !enabled
            ? 0
            : value.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
      },
    ],
  };
}

/** Visual frames only; callers keep actual readings for labels, limits and actions. */
export function useAnimatedNumber(
  target: number | null,
  eligible: boolean,
  scope: string,
) {
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const actual = target !== null && Number.isFinite(target) ? target : null;
  const [progress] = useState(() => new Animated.Value(0));
  const [frame, setFrame] = useState({ scope, value: actual });
  const history = useRef({ scope, started: false, displayed: actual });
  useEffect(() => {
    let active = true;
    progress.stopAnimation();
    if (history.current.scope !== scope)
      history.current = { scope, started: false, displayed: actual };
    if (!focused) history.current.started = false;
    const listener = progress.addListener(({ value }) => {
      if (!active) return;
      history.current.displayed = value;
      setFrame({ scope, value });
    });
    let animation: Animated.CompositeAnimation | undefined;
    if (actual !== null) {
      if (reduced || !eligible || !focused) progress.setValue(actual);
      else {
        if (!history.current.started) progress.setValue(0);
        history.current.started = true;
        if (history.current.displayed !== actual) {
          animation = Animated.timing(progress, {
            toValue: actual,
            duration: Motion.reveal,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
            isInteraction: false,
          });
          animation.start();
        }
      }
    }
    return () => {
      active = false;
      animation?.stop();
      progress.removeListener(listener);
    };
  }, [actual, eligible, progress, reduced, scope, focused]);
  return reduced ||
    !eligible ||
    !focused ||
    actual === null ||
    frame.scope !== scope
    ? actual
    : frame.value;
}

export function AnimatedNumber({
  value,
  eligible,
  scope,
  ...props
}: TextProps & {
  value: number | null;
  eligible: boolean;
  scope: string;
}) {
  const displayed = useAnimatedNumber(value, eligible, scope);
  const precision = Math.min(6, String(value).split(".")[1]?.length ?? 0);
  return (
    <Text
      {...props}
      accessibilityLabel={
        props.accessibilityLabel ??
        (value === null ? "Unavailable" : String(value))
      }
    >
      {displayed === null
        ? "—"
        : displayed === value
          ? String(value)
          : String(Number(displayed.toFixed(precision)))}
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
  const [entered, setEntered] = useState(false);
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
    if (revealKey && viewport.seen.has(revealKey)) {
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
            setEntered(true);
        }
      },
      () => {},
    );
  }, [viewport, reduced, revealKey]);
  useEffect(() => {
    if (reduced) return;
    const epoch = measurementEpoch.current;
    const unsubscribe = viewport?.subscribe(check);
    return () => {
      measurementEpoch.current = epoch + 1;
      unsubscribe?.();
    };
  }, [check, reduced, viewport]);
  const entrance = useEntranceMotion(undefined, entered && focused, 12, delay);
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
            duration: Motion.pulse,
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
