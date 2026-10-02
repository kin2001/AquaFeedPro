/** Graphite design tokens shared by app screens and reusable components. */

import "@/global.css";

import { Platform, type TextStyle } from "react-native";

const graphitePalette = {
  background: "#F4F4F5",
  surface: "#FFFFFF",
  surfaceMuted: "#EEEEF0",
  primary: "#18181B",
  textPrimary: "#18181B",
  text: "#18181B",
  textSecondary: "#62626B",
  border: "#DEDEE3",
  controlBorder: "#85858F",
  progressTrack: "#E9E9ED",
  chartLine: "#27272A",
  chartGrid: "#E4E4E7",
  disabledBackground: "#E4E4E7",
  disabledText: "#71717A",
  backgroundElement: "#FFFFFF",
  backgroundSelected: "#EEEEF0",
} as const;

// DESIGN.md defines one Graphite palette. Keep both scheme keys for existing
// helpers until a separate dark palette is approved.
export const Colors = {
  light: graphitePalette,
  dark: graphitePalette,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const InterFamilies = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

export const Typography = {
  pageTitle: {
    fontFamily: InterFamilies.semibold,
    fontSize: 24,
    lineHeight: 32,
    color: graphitePalette.text,
  },
  reading: {
    fontFamily: InterFamilies.semibold,
    fontSize: 40,
    lineHeight: 48,
    fontVariant: ["tabular-nums"],
  },
  feedingPercentage: {
    fontFamily: InterFamilies.semibold,
    fontSize: 32,
    lineHeight: 40,
    fontVariant: ["tabular-nums"],
  },
  quantity: {
    fontFamily: InterFamilies.medium,
    fontSize: 16,
    lineHeight: 24,
    fontVariant: ["tabular-nums"],
  },
  cardTitle: {
    fontFamily: InterFamilies.semibold,
    fontSize: 16,
    lineHeight: 24,
    color: graphitePalette.text,
  },
  body: {
    fontFamily: InterFamilies.regular,
    fontSize: 16,
    lineHeight: 24,
    color: graphitePalette.text,
  },
  button: {
    fontFamily: InterFamilies.semibold,
    fontSize: 14,
    lineHeight: 20,
  },
  supporting: {
    fontFamily: InterFamilies.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  metadata: {
    fontFamily: InterFamilies.medium,
    fontSize: 12,
    lineHeight: 16,
  },
} satisfies Record<string, TextStyle>;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
  page: 16,
  cardGap: 12,
  card: 20,
  cardCompact: 16,
} as const;

export const Radii = {
  card: 20,
  control: 12,
  bottomSheetTop: 24,
} as const;

export const ControlSize = {
  minimumTarget: 48,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 760;
