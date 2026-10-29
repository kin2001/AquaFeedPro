import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Colors } from "@/constants/theme";
import { mapThemedViewStyle, useAppTheme } from "@/components/theme-provider";
import { shouldReduceMotion } from "@/lib/ui-preferences";

export const Motion = { press: 150, transition: 180, pulse: 900 } as const;

const ReducedMotion = createContext(true);
const nativeDriver = Platform.OS !== "web";

export function MotionProvider({ children }: { children: ReactNode }) {
  const { motionPreference } = useAppTheme();
  const [systemReduced, setSystemReduced] = useState(true);
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    let mounted = true;
    let changed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (mounted && !changed) setSystemReduced(value);
      },
      () => {},
    );
    const preference = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => {
        changed = true;
        setSystemReduced(value);
      },
    );
    const appState = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => {
      mounted = false;
      preference.remove();
      appState.remove();
    };
  }, []);
  return (
    <ReducedMotion.Provider
      value={shouldReduceMotion(motionPreference, systemReduced, active)}
    >
      {children}
    </ReducedMotion.Provider>
  );
}

export const useReducedMotion = () => useContext(ReducedMotion);

export function useMotionValue(target: number, duration: number) {
  const reduced = useReducedMotion();
  // This is only an animation frame; callers keep the semantic reading separately.
  const safeTarget = Number.isFinite(target) ? target : 0;
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const [value] = useState(() => new Animated.Value(safeTarget));
  useEffect(() => {
    value.stopAnimation();
    if (reduced) {
      value.setValue(safeTarget);
      return;
    }
    const animation = Animated.timing(value, {
      toValue: safeTarget,
      duration: safeDuration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [safeDuration, safeTarget, reduced, value]);
  return value;
}

export function useEntranceMotion(trigger?: string, enabled = true) {
  const reduced = useReducedMotion();
  const [value] = useState(() => new Animated.Value(1));
  useEffect(() => {
    value.stopAnimation();
    if (reduced || !enabled) {
      value.setValue(1);
      return;
    }
    value.setValue(0);
    const animation = Animated.timing(value, {
      toValue: 1,
      duration: Motion.transition,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: nativeDriver,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [trigger, enabled, reduced, value]);
  return {
    opacity: reduced || !enabled ? 1 : value,
    transform: [
      {
        translateY:
          reduced || !enabled
            ? 0
            : value.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }),
      },
    ],
  };
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
  ComponentRef<typeof Pressable>,
  Omit<PressableProps, "style" | "children"> & {
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
    feedbackColor?: string;
  }
>(function MotionPressable(
  {
    style,
    disabled,
    onPressIn,
    onPressOut,
    hitSlop = 2,
    feedbackColor,
    ...props
  },
  ref,
) {
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion();
  const { colors } = useAppTheme();
  const progress = useMotionValue(pressed && !disabled ? 1 : 0, Motion.press);
  const base = StyleSheet.flatten(style);
  const onInk = base?.backgroundColor === Colors.light.ink;
  const rippleColor =
    props.android_ripple?.color === Colors.light.rippleOnInk || onInk
      ? colors.rippleOnInk
      : props.android_ripple?.color === Colors.light.rippleOnSurface
        ? colors.rippleOnSurface
        : props.android_ripple?.color;
  const pressedOpacity = onInk ? 0.16 : 0.08;
  return (
    <Pressable
      {...props}
      ref={ref}
      disabled={disabled}
      hitSlop={hitSlop}
      android_ripple={
        props.android_ripple
          ? { ...props.android_ripple, color: rippleColor }
          : props.android_ripple
      }
      onPressIn={(event) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        onPressOut?.(event);
      }}
      style={base ? mapThemedViewStyle(base, colors) : undefined}
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
            backgroundColor:
              feedbackColor ?? (onInk ? colors.onInk : colors.ink),
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
