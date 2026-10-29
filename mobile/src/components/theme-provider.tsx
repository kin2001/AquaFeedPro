import {
  createContext,
  forwardRef,
  type ComponentProps,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import {
  Appearance,
  Pressable as NativePressable,
  StyleSheet,
  Text as NativeText,
  useColorScheme,
  View as NativeView,
  type ColorValue,
  type StyleProp,
  type TextProps,
  type PressableProps,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { Lucide as NativeLucide } from "@react-native-vector-icons/lucide";

import { Colors, type ThemeColors } from "@/constants/theme";
import {
  loadUiPreferences,
  resolveColorScheme,
  saveUiPreference,
  type AppearancePreference,
  type MotionPreference,
  type UiPreferenceStorage,
} from "@/lib/ui-preferences";

type AppTheme = {
  appearancePreference: AppearancePreference;
  motionPreference: MotionPreference;
  scheme: "light" | "dark";
  colors: ThemeColors;
  setAppearancePreference: (value: AppearancePreference) => void;
  setMotionPreference: (value: MotionPreference) => void;
};

const defaultTheme: AppTheme = {
  appearancePreference: "system",
  motionPreference: "on",
  scheme: "light",
  colors: Colors.light,
  setAppearancePreference: () => {},
  setMotionPreference: () => {},
};

const AppThemeContext = createContext(defaultTheme);

function getPreferenceStorage(): UiPreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preferences, setPreferences] = useState(() =>
    loadUiPreferences(getPreferenceStorage()),
  );
  const scheme = resolveColorScheme(preferences.appearance, systemScheme);
  const colors = scheme === "dark" ? Colors.dark : Colors.light;

  useEffect(() => {
    try {
      Appearance.setColorScheme(
        preferences.appearance === "system"
          ? "unspecified"
          : preferences.appearance,
      );
    } catch {
      // The in-app palette still follows the selected preference if native UI mode is unavailable.
    }
  }, [preferences.appearance]);

  const value = useMemo<AppTheme>(
    () => ({
      appearancePreference: preferences.appearance,
      motionPreference: preferences.motion,
      scheme,
      colors,
      setAppearancePreference: (appearancePreference) => {
        setPreferences((current) => ({
          ...current,
          appearance: appearancePreference,
        }));
        saveUiPreference(
          getPreferenceStorage(),
          "appearance",
          appearancePreference,
        );
      },
      setMotionPreference: (motionPreference) => {
        setPreferences((current) => ({ ...current, motion: motionPreference }));
        saveUiPreference(getPreferenceStorage(), "motion", motionPreference);
      },
    }),
    [colors, preferences.appearance, preferences.motion, scheme],
  );

  return (
    <AppThemeContext.Provider value={value}>
      {children}
    </AppThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(AppThemeContext);
}

export function ThemePreview({
  scheme,
  children,
}: {
  scheme: "light" | "dark";
  children: ReactNode;
}) {
  const current = useAppTheme();
  const preview = useMemo(
    () => ({
      ...current,
      appearancePreference: scheme,
      scheme,
      colors: scheme === "dark" ? Colors.dark : Colors.light,
      setAppearancePreference: () => {},
    }),
    [current, scheme],
  );
  return (
    <AppThemeContext.Provider value={preview}>
      {children}
    </AppThemeContext.Provider>
  );
}

export function resolveTextColor(
  value: ColorValue | undefined,
  colors: ThemeColors,
) {
  if (value === undefined || value === Colors.light.ink) return colors.text;
  if (value === Colors.light.textSecondary) return colors.textSecondary;
  if (value === Colors.light.textTertiary) return colors.textTertiary;
  if (value === Colors.light.onInk) return colors.onInk;
  if (value === Colors.light.onInkSecondary) return colors.onInkSecondary;
  if (value === Colors.light.disabledText) return colors.disabledText;
  if (value === Colors.light.controlBorder) return colors.controlBorder;
  if (value === Colors.light.chartLine) return colors.chartLine;
  if (value === Colors.light.chartGrid) return colors.chartGrid;
  if (value === Colors.light.accent) return colors.accent;
  return value;
}

export function resolveSurfaceColor(
  value: ColorValue | undefined,
  colors: ThemeColors,
) {
  if (value === undefined) return undefined;
  if (value === Colors.light.background) return colors.background;
  if (value === Colors.light.surface) return colors.surface;
  if (value === Colors.light.surfaceMuted) return colors.surfaceMuted;
  if (value === Colors.light.ink || value === Colors.light.primary)
    return colors.primary;
  if (value === Colors.light.onInk) return colors.surface;
  if (value === Colors.light.border) return colors.border;
  if (value === Colors.light.controlBorder) return colors.controlBorder;
  if (value === Colors.light.progressTrack) return colors.progressTrack;
  if (value === Colors.light.chartLine) return colors.chartLine;
  if (value === Colors.light.chartGrid) return colors.chartGrid;
  if (value === Colors.light.plotBackground) return colors.plotBackground;
  if (value === Colors.light.accent) return colors.accent;
  if (value === Colors.light.disabledBackground)
    return colors.disabledBackground;
  if (value === Colors.light.inverseDisabledBackground)
    return colors.inverseDisabledBackground;
  return value;
}

export function mapThemedViewStyle(
  style: ViewStyle,
  colors: ThemeColors,
): ViewStyle {
  return {
    ...style,
    ...(style.backgroundColor !== undefined && {
      backgroundColor: resolveSurfaceColor(style.backgroundColor, colors),
    }),
    ...(style.borderColor !== undefined && {
      borderColor: resolveSurfaceColor(style.borderColor, colors),
    }),
    ...(style.borderTopColor !== undefined && {
      borderTopColor: resolveSurfaceColor(style.borderTopColor, colors),
    }),
    ...(style.borderBottomColor !== undefined && {
      borderBottomColor: resolveSurfaceColor(style.borderBottomColor, colors),
    }),
  };
}

export const ThemedText = forwardRef<
  ComponentRef<typeof NativeText>,
  TextProps
>(function ThemedText({ style, ...props }, ref) {
  const { colors } = useAppTheme();
  const flattened = StyleSheet.flatten(style) ?? {};
  return (
    <NativeText
      {...props}
      ref={ref}
      style={{
        ...flattened,
        color: resolveTextColor(flattened.color, colors),
      }}
    />
  );
});

export const ThemedView = forwardRef<
  ComponentRef<typeof NativeView>,
  ViewProps
>(function ThemedView({ style, ...props }, ref) {
  const { colors } = useAppTheme();
  const flattened = StyleSheet.flatten(style) ?? {};
  return (
    <NativeView
      {...props}
      ref={ref}
      style={mapThemedViewStyle(flattened, colors)}
    />
  );
});

export const ThemedPressable = forwardRef<
  ComponentRef<typeof NativePressable>,
  PressableProps
>(function ThemedPressable({ style, android_ripple, ...props }, ref) {
  const { colors } = useAppTheme();
  const mapStyle = (value: StyleProp<ViewStyle>) =>
    mapThemedViewStyle(StyleSheet.flatten(value) ?? {}, colors);
  const themedStyle =
    typeof style === "function"
      ? (state: Parameters<typeof style>[0]) => mapStyle(style(state))
      : mapStyle(style);
  let ripple = android_ripple;
  if (android_ripple?.color === Colors.light.rippleOnInk) {
    ripple = { ...android_ripple, color: colors.rippleOnInk };
  } else if (android_ripple?.color === Colors.light.rippleOnSurface) {
    ripple = { ...android_ripple, color: colors.rippleOnSurface };
  }
  return (
    <NativePressable
      {...props}
      ref={ref}
      android_ripple={ripple}
      style={themedStyle}
    />
  );
});

export function ThemedLucide(props: ComponentProps<typeof NativeLucide>) {
  const { colors } = useAppTheme();
  return (
    <NativeLucide
      {...props}
      color={resolveTextColor(props.color, colors) as string}
    />
  );
}
