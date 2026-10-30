import { MenuView, type MenuComponentRef } from "@expo/ui/community/menu";

import { useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import {
  ThemedLucide as Lucide,
  ThemedText as Text,
  ThemedView as View,
  useAppTheme,
} from "@/components/theme-provider";

import { Colors, InterFamilies, Radii, Typography } from "@/constants/theme";

const statuses = [
  { value: "all", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "in_progress", label: "In progress" },
  { value: "unknown", label: "Partial / unknown" },
] as const;
export type HistoryStatus = (typeof statuses)[number]["value"];

export function HistoryStatusSelect({
  value,
  onChange,
}: {
  value: HistoryStatus;
  onChange: (value: HistoryStatus) => void;
}) {
  const { colors, scheme } = useAppTheme();
  const menu = useRef<MenuComponentRef>(null);
  const selected = statuses.find((option) => option.value === value)!;
  const choose = (next: string) => {
    const option = statuses.find((option) => option.value === next);
    if (option) onChange(option.value);
  };
  const chevron = (
    <View aria-hidden>
      <Lucide name="chevron-down" size={18} color={colors.textSecondary} />
    </View>
  );

  if (Platform.OS === "web") {
    return (
      <View>
        <select
          aria-label="Status"
          value={value}
          onChange={(event) => choose(event.currentTarget.value)}
          style={{
            width: "100%",
            minHeight: 48,
            padding: "12px 40px 12px 12px",
            border: `1px solid ${colors.controlBorder}`,
            borderRadius: Radii.control,
            backgroundColor: colors.surface,
            color: colors.text,
            fontFamily: InterFamilies.regular,
            fontSize: 16,
            appearance: "none",
            cursor: "pointer",
          }}
        >
          {statuses.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <View pointerEvents="none" aria-hidden style={styles.chevron}>
          {chevron}
        </View>
      </View>
    );
  }

  return (
    <MenuView
      ref={menu}
      style={{ width: "100%" }}
      colorScheme={scheme}
      onPressAction={({ nativeEvent }) => choose(nativeEvent.event)}
      actions={statuses.map((option) => ({
        id: option.value,
        title: option.label,
        state: option.value === value ? "on" : "off",
      }))}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Status, ${selected.label}`}
        accessibilityHint="Choose a feeding status"
        accessibilityActions={[{ name: "activate" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "activate") menu.current?.show();
        }}
        onAccessibilityTap={() => menu.current?.show()}
        style={styles.control}
      >
        <Text style={[Typography.body, styles.label]}>{selected.label}</Text>
        {chevron}
      </View>
    </MenuView>
  );
}

const styles = StyleSheet.create({
  control: {
    width: "100%",
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.light.controlBorder,
    borderRadius: Radii.control,
    backgroundColor: Colors.light.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  label: { flex: 1 },
  chevron: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
});
