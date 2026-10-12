import { Lucide } from "@react-native-vector-icons/lucide";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import {
  Colors,
  ControlSize,
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

export function AppPage({
  children,
  edges = ["top", "left", "right", "bottom"],
}: {
  children: React.ReactNode;
  edges?: Edge[];
}) {
  return (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.page}>{children}</View>
      </ScrollView>
    </SafeAreaView>
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
  page: { width: "100%", maxWidth: MaxContentWidth, gap: Spacing.cardGap },
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
