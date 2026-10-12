import { Lucide } from "@react-native-vector-icons/lucide";
import { router, type Href } from "expo-router";
import { useState, type ReactNode } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { IconButton } from "./bento-kit";

import {
  Colors,
  ControlSize,
  IconSize,
  InterFamilies,
  MaxContentWidth,
  Radii,
  Spacing,
  Typography,
} from "@/constants/theme";

export {
  BentoCard,
  Button,
  Chip,
  DisabledButton,
  EmptyState,
  ErrorState,
  IconButton,
  KeyValue,
  LinkButton,
  ListRow,
  Notice,
  ProgressBar,
  SectionHeader,
  Segmented,
  Sheet,
  Skeleton,
  Stat,
  StatusLabel,
  statusIcons,
  SwitchRow,
  TextField,
  Toggle,
} from "./bento-kit";

export function AppIcon({
  size,
  decorative = false,
}: {
  size: number;
  decorative?: boolean;
}) {
  return (
    <Image
      // shortcut: ships the full-size source PNG; resize to 288 px if bundle size matters.
      source={require("@/assets/images/aquafeed-app-icon.png")}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={decorative ? undefined : "AquaFeed Pro"}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
      }}
    />
  );
}

export function AppPage({
  children,
  edges = ["top", "left", "right", "bottom"],
  gap = Spacing.four,
}: {
  children: React.ReactNode;
  edges?: Edge[];
  gap?: number;
}) {
  return (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.page, { gap }]}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function ScreenHeader({
  title,
  action,
  back,
}: {
  title: string;
  action?: ReactNode;
  back?: { label: string; fallback: Href; icon?: "arrow-left" | "x" };
}) {
  if (!back) {
    return (
      <View style={styles.tabHeader}>
        <Text accessibilityRole="header" style={styles.tabHeaderTitle}>
          {title}
        </Text>
        {action ? <View style={styles.headerAction}>{action}</View> : null}
      </View>
    );
  }
  return (
    <View style={styles.stackHeader}>
      <IconButton
        icon={back.icon ?? "arrow-left"}
        size={IconSize.nav}
        accessibilityLabel={back.label}
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace(back.fallback)
        }
      />
      <Text accessibilityRole="header" style={styles.stackHeaderTitle}>
        {title}
      </Text>
      {action}
    </View>
  );
}

export function PageHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={Typography.pageTitle}>
        {title}
      </Text>
      {description ? (
        <Text style={[Typography.body, styles.secondaryText]}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

export function BackAction({
  label,
  fallback,
}: {
  label: string;
  fallback: Href;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.canGoBack() ? router.back() : router.replace(fallback)
      }
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.backAction,
        focused && styles.backActionFocused,
        pressed && styles.pressed,
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Lucide name="arrow-left" size={18} color={Colors.light.text} />
      </View>
      <Text style={styles.backText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.light.background },
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: Spacing.page,
    paddingVertical: Spacing.four,
  },
  page: { width: "100%", maxWidth: MaxContentWidth },
  tabHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: ControlSize.minimumTarget,
  },
  tabHeaderTitle: { ...Typography.pageTitle, flexShrink: 1 },
  headerAction: { flexShrink: 0 },
  stackHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    minHeight: ControlSize.minimumTarget,
    marginLeft: -12,
  },
  stackHeaderTitle: { ...Typography.title, flex: 1 },
  heading: { gap: Spacing.two, marginBottom: Spacing.two },
  secondaryText: { color: Colors.light.textSecondary },
  backAction: {
    alignSelf: "flex-start",
    minHeight: ControlSize.minimumTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: Radii.control,
  },
  backActionFocused: {
    borderWidth: 2,
    borderColor: Colors.light.textSecondary,
  },
  backText: {
    ...Typography.supporting,
    color: Colors.light.text,
    fontFamily: InterFamilies.medium,
  },
  pressed: { opacity: 0.72 },
});
