/** Neutral ocean semantic tokens shared by app screens and reusable components. */

import type { TextStyle } from "react-native";

const light = {
  background: "#F4F5F6",
  surface: "#FFFFFF",
  surfaceMuted: "#ECEFF0",
  ink: "#20272A",
  primary: "#22292C",
  text: "#20272A",
  textSecondary: "#58646B",
  textTertiary: "#738087",
  border: "#DDE3E6",
  controlBorder: "#849197",
  onInk: "#F4F6F7",
  onInkSecondary: "#C4CDD1",
  progressTrack: "#DFE5E7",
  chartLine: "#126782",
  chartGrid: "#DFE8EA",
  plotBackground: "#F0F6F6",
  accent: "#18B7B0",
  disabledBackground: "#DDE3E6",
  disabledText: "#738087",
  inverseDisabledBackground: "#58646B",
  scrim: "rgba(22, 26, 29, 0.48)",
  rippleOnInk: "rgba(244, 246, 247, 0.16)",
  rippleOnSurface: "rgba(32, 39, 42, 0.10)",
  navDock: "#22292C",
  navText: "#C4CDD1",
  navSelected: "#F4F6F7",
  navSelectedBackground: "#3B4549",
} as const;

const dark = {
  background: "#161A1D",
  surface: "#22282C",
  surfaceMuted: "#2B3236",
  ink: "#F4F6F7",
  primary: "#22292C",
  text: "#F4F6F7",
  textSecondary: "#B6C0C5",
  textTertiary: "#8D9AA0",
  border: "#343D42",
  controlBorder: "#748087",
  onInk: "#F4F6F7",
  onInkSecondary: "#B6C0C5",
  progressTrack: "#394348",
  chartLine: "#18B7B0",
  chartGrid: "#394348",
  plotBackground: "#20272B",
  accent: "#18B7B0",
  disabledBackground: "#394348",
  disabledText: "#8D9AA0",
  inverseDisabledBackground: "#4D585E",
  scrim: "rgba(0, 0, 0, 0.58)",
  rippleOnInk: "rgba(244, 246, 247, 0.16)",
  rippleOnSurface: "rgba(244, 246, 247, 0.10)",
  navDock: "#F4F6F7",
  navText: "#58646B",
  navSelected: "#20272A",
  navSelectedBackground: "#DDE5E7",
} as const;

export type ThemeColors = {
  readonly [K in keyof typeof light]: string;
};

export const Colors = { light, dark } as const;

export const InterFamilies = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export const Typography = {
  display: {
    fontFamily: InterFamilies.semibold,
    fontSize: 56,
    lineHeight: 60,
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
    color: light.ink,
  },
  pageTitle: {
    fontFamily: InterFamilies.semibold,
    fontSize: 28,
    lineHeight: 34,
    color: light.ink,
  },
  reading: {
    fontFamily: InterFamilies.semibold,
    fontSize: 32,
    lineHeight: 40,
    fontVariant: ["tabular-nums"],
    color: light.ink,
  },
  title: {
    fontFamily: InterFamilies.semibold,
    fontSize: 20,
    lineHeight: 28,
    fontVariant: ["tabular-nums"],
    color: light.ink,
  },
  cardTitle: {
    fontFamily: InterFamilies.semibold,
    fontSize: 16,
    lineHeight: 24,
    color: light.ink,
  },
  listTitle: {
    fontFamily: InterFamilies.medium,
    fontSize: 16,
    lineHeight: 24,
    color: light.ink,
  },
  body: {
    fontFamily: InterFamilies.regular,
    fontSize: 16,
    lineHeight: 24,
    color: light.ink,
  },
  unit: {
    fontFamily: InterFamilies.medium,
    fontSize: 16,
    lineHeight: 24,
    color: light.textSecondary,
  },
  button: {
    fontFamily: InterFamilies.semibold,
    fontSize: 15,
    lineHeight: 20,
  },
  label: {
    fontFamily: InterFamilies.medium,
    fontSize: 14,
    lineHeight: 20,
    color: light.ink,
  },
  supporting: {
    fontFamily: InterFamilies.regular,
    fontSize: 14,
    lineHeight: 20,
    color: light.textSecondary,
  },
  metadata: {
    fontFamily: InterFamilies.medium,
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ["tabular-nums"],
    color: light.textTertiary,
  },
  overline: {
    fontFamily: InterFamilies.semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: light.textTertiary,
  },
  pill: {
    fontFamily: InterFamilies.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: light.ink,
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
  page: 20,
  cardGap: 12,
  card: 16,
} as const;

export const Radii = {
  card: 16,
  control: 12,
  segment: 8,
  pill: 999,
  bottomSheetTop: 24,
} as const;

export const ControlSize = {
  minimumTarget: 48,
  compact: 40,
  iconWell: 40,
  pill: 28,
} as const;

export const IconSize = { nav: 24, default: 20, small: 16 } as const;

export const MaxContentWidth = 760;
