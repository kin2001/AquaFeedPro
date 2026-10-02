import { Lucide, type LucideIconName } from "@react-native-vector-icons/lucide";
import { Link, router, type Href } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { Colors, MaxContentWidth } from "@/constants/theme";

const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
};

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
      <Text style={styles.pageTitle}>{title}</Text>
      {description ? <Text style={styles.body}>{description}</Text> : null}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action = "Add device",
  href = "/devices/add",
}: {
  icon: LucideIconName;
  title: string;
  description: string;
  action?: string;
  href?: Href;
}) {
  return (
    <View style={styles.emptyCard}>
      <View
        style={styles.emptyIcon}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Lucide name={icon} size={22} color={Colors.light.text} />
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.body}>{description}</Text>
      <LinkButton href={href} icon="plus">
        {action}
      </LinkButton>
    </View>
  );
}

export function LinkButton({
  href,
  children,
  icon,
}: {
  href: Href;
  children: string;
  icon?: LucideIconName;
}) {
  return (
    <Link href={href} asChild style={styles.button}>
      <Pressable
        accessibilityRole="button"
        android_ripple={{ color: "rgba(255, 255, 255, 0.16)" }}
      >
        {icon ? <Lucide name={icon} size={19} color="#FFFFFF" /> : null}
        <Text style={styles.buttonText}>{children}</Text>
      </Pressable>
    </Link>
  );
}

export function DisabledButton({
  children,
  icon,
}: {
  children: string;
  icon?: LucideIconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: true }}
      disabled
      style={[styles.button, styles.buttonDisabled]}
    >
      {icon ? (
        <Lucide name={icon} size={19} color={Colors.light.disabledText} />
      ) : null}
      <Text style={styles.buttonTextDisabled}>{children}</Text>
    </Pressable>
  );
}

export function BackAction({
  label,
  fallback,
}: {
  label: string;
  fallback: Href;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.canGoBack() ? router.back() : router.replace(fallback)
      }
      style={({ pressed }) => [styles.backAction, pressed && styles.pressed]}
    >
      <Lucide name="arrow-left" size={18} color={Colors.light.text} />
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
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  page: { width: "100%", maxWidth: MaxContentWidth, gap: 12 },
  heading: { gap: 8, marginBottom: 8 },
  pageTitle: {
    color: Colors.light.text,
    fontFamily: font.semibold,
    fontSize: 24,
    lineHeight: 32,
  },
  body: {
    color: Colors.light.textSecondary,
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  emptyCard: {
    width: "100%",
    gap: 12,
    alignItems: "flex-start",
    backgroundColor: Colors.light.backgroundElement,
    borderColor: Colors.light.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.light.backgroundSelected,
    borderRadius: 14,
    marginBottom: 4,
  },
  cardTitle: {
    color: Colors.light.text,
    fontFamily: font.semibold,
    fontSize: 16,
    lineHeight: 24,
  },
  button: {
    minHeight: 48,
    width: "100%",
    borderRadius: 12,
    backgroundColor: Colors.light.text,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  buttonText: {
    color: "#FFFFFF",
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 20,
  },
  buttonDisabled: { backgroundColor: Colors.light.disabledBackground },
  buttonTextDisabled: {
    color: Colors.light.disabledText,
    fontFamily: font.semibold,
    fontSize: 14,
    lineHeight: 20,
  },
  backAction: {
    alignSelf: "flex-start",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  backText: {
    color: Colors.light.text,
    fontFamily: font.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: { opacity: 0.72 },
});
