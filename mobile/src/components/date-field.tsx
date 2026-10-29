import { DateTimePicker } from "@expo/ui/community/datetime-picker";

import { useState } from "react";
import { Platform, StyleSheet } from "react-native";
import {
  ThemedLucide as Lucide,
  ThemedText as Text,
  ThemedView as View,
  useAppTheme,
} from "@/components/theme-provider";

import { MotionPressable } from "@/components/motion";
import { Colors, Radii, Typography } from "@/constants/theme";

// Calendar dates stay in local time; converting to ISO would shift some days.
export function calendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value + "T12:00:00");
  return Number.isFinite(date.getTime()) && calendarDateValue(date) === value
    ? date
    : undefined;
}

export function calendarDateValue(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DateField({
  label,
  value,
  minimum,
  maximum,
  onChange,
}: {
  label: string;
  value: string;
  minimum?: string;
  maximum?: string;
  onChange: (value: string) => void;
}) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const selected = calendarDate(value);
  const display = selected
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(selected)
    : "Select date";
  const content = (
    <>
      <Text
        style={[
          Typography.supporting,
          styles.dateText,
          selected && styles.selected,
        ]}
      >
        {display}
      </Text>
      <Lucide name="calendar-days" size={18} color={colors.textSecondary} />
    </>
  );

  return (
    <View style={styles.field}>
      <Text style={Typography.label}>{label}</Text>
      {Platform.OS === "web" ? (
        <View style={[styles.control, focused && styles.focused]}>
          <View aria-hidden style={styles.content}>
            {content}
          </View>
          {/* Keep the browser's keyboard and calendar behavior, with our date label. */}
          <input
            type="date"
            aria-label={label}
            value={value}
            min={minimum || undefined}
            max={maximum || undefined}
            onChange={(event) => onChange(event.currentTarget.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onClick={(event) => event.currentTarget.showPicker?.()}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0,
              cursor: "pointer",
              boxSizing: "border-box",
            }}
          />
        </View>
      ) : (
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${display}`}
          accessibilityHint="Opens a calendar"
          onPress={() => setOpen(true)}
          style={styles.control}
        >
          {content}
        </MotionPressable>
      )}
      {Platform.OS !== "web" && open ? (
        <DateTimePicker
          mode="date"
          value={
            selected ??
            calendarDate(minimum ?? "") ??
            calendarDate(maximum ?? "") ??
            new Date()
          }
          minimumDate={calendarDate(minimum ?? "")}
          maximumDate={calendarDate(maximum ?? "")}
          accentColor={colors.accent}
          onChange={(event, date) => {
            setOpen(false);
            if (event.type === "set" && date) onChange(calendarDateValue(date));
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, minWidth: 0, gap: 8 },
  control: {
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
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  selected: { color: Colors.light.ink },
  dateText: { flexShrink: 1 },
  focused: {
    borderColor: Colors.light.ink,
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: Colors.light.ink,
  },
});
