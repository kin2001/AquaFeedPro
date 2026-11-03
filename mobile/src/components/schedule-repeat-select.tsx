import { MenuView, type MenuComponentRef } from "@expo/ui/community/menu";
import { Lucide } from "@react-native-vector-icons/lucide";
import { useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { Colors, InterFamilies, Radii, Typography } from "@/constants/theme";

const statuses = [
  { value: "all", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekends", label: "Weekends" },
  { value: "custom", label: "Custom days" },
] as const;
export type RepeatPreset = (typeof statuses)[number]["value"];

export function ScheduleRepeatSelect({
  value,
  onChange,
}: {
  value: RepeatPreset;
  onChange: (value: RepeatPreset) => void;
}) {
  const menu = useRef<MenuComponentRef>(null);
  const [controlWidth, setControlWidth] = useState<number>();
  const selected = statuses.find((option) => option.value === value)!;
  const choose = (next: string) => {
    const option = statuses.find((option) => option.value === next);
    if (option) onChange(option.value);
  };
  const chevron = (
    <Lucide name="chevron-down" size={18} color={Colors.light.textSecondary} />
  );

  if (Platform.OS === "web") {
    return (
      <View>
        <select
          aria-label="Repeat"
          value={value}
          onChange={(event) => choose(event.currentTarget.value)}
          style={{
            width: "100%",
            minHeight: 48,
            padding: "12px 40px 12px 12px",
            border: `1px solid ${Colors.light.controlBorder}`,
            borderRadius: Radii.control,
            backgroundColor: Colors.light.surface,
            color: Colors.light.ink,
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

  // MenuView's content-sized native hosts cannot resolve the form's percentage width.
  return (
    <View
      style={{ width: "100%" }}
      onLayout={({ nativeEvent }) => setControlWidth(nativeEvent.layout.width)}
    >
      <MenuView
        ref={menu}
        style={{ width: "100%" }}
        colorScheme="light"
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
          accessibilityLabel={`Repeat, ${selected.label}`}
          accessibilityHint="Choose repeat days"
          accessibilityActions={[{ name: "activate" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "activate") menu.current?.show();
          }}
          onAccessibilityTap={() => menu.current?.show()}
          style={[
            styles.control,
            controlWidth === undefined ? null : { width: controlWidth },
          ]}
        >
          <Text style={Typography.body}>{selected.label}</Text>
          {chevron}
        </View>
      </MenuView>
    </View>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  chevron: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
});
