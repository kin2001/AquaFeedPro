import { Platform, StyleSheet, Text, type TextProps } from "react-native";

import {
  Colors,
  Fonts,
  InterFamilies,
  ThemeColor,
  Typography,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type ThemedTextProps = TextProps & {
  type?:
    | "default"
    | "title"
    | "small"
    | "smallBold"
    | "subtitle"
    | "link"
    | "linkPrimary"
    | "code";
  themeColor?: ThemeColor;
};

export function ThemedText({
  style,
  type = "default",
  themeColor,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        type === "default" && styles.default,
        type === "title" && styles.title,
        type === "small" && styles.small,
        type === "smallBold" && styles.smallBold,
        type === "subtitle" && styles.subtitle,
        type === "link" && styles.link,
        type === "linkPrimary" && styles.linkPrimary,
        type === "code" && styles.code,
        {
          color:
            theme[themeColor ?? (type === "linkPrimary" ? "primary" : "text")],
        },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    ...Typography.supporting,
    fontFamily: InterFamilies.medium,
  },
  smallBold: {
    ...Typography.supporting,
    fontFamily: InterFamilies.bold,
  },
  default: {
    ...Typography.body,
  },
  title: {
    ...Typography.pageTitle,
  },
  subtitle: {
    ...Typography.feedingPercentage,
  },
  link: {
    ...Typography.button,
    fontFamily: InterFamilies.medium,
  },
  linkPrimary: {
    ...Typography.button,
    fontFamily: InterFamilies.medium,
    color: Colors.light.primary,
  },
  code: {
    ...Typography.metadata,
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
  },
});
