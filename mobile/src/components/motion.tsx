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
  press: 120,
  selection: 150,
  transition: 200,
  reveal: 160,
  sheet: 220,
  scrim: 160,
  stagger: 24,
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
  distance = 6,
  delay = 0,
  duration: number = Motion.transition,
) {
  const reduced = useReducedMotion();
  const [value] = useState(() => new Animated.Value(1));
  const played = useRef(new Set<string | undefined>());
  useEffect(() => {
    value.stopAnimation();
    if (!enabled) {
      value.setValue(1);
      return;
    }
    const alreadyPlayed = played.current.has(trigger);
    played.current.add(trigger);
    if (reduced || alreadyPlayed) {
      value.setValue(1);
      return;
    }
    value.setValue(0);
    const animation = Animated.timing(value, {
      toValue: 1,
      duration,
      delay: Math.min(72, Math.max(0, delay)),
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

/** Compatibility API: premium motion always presents actual values, never count-up frames. */
export function useAnimatedNumber(
  target: number | null,
  _eligible: boolean,
  _scope: string,
) {
  return target !== null && Number.isFinite(target) ? target : null;
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
  return (
    <Text
      {...props}
      accessibilityLabel={
        props.accessibilityLabel ??
        (displayed === null ? "Unavailable" : String(displayed))
      }
    >
      {displayed === null ? "—" : String(displayed)}
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
  const entrance = useEntranceMotion(
    undefined,
    entered && focused,
    4,
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
