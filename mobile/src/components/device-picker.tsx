import { Lucide } from "@react-native-vector-icons/lucide";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/app-shell";
import {
  Colors,
  ControlSize,
  InterFamilies,
  Radii,
  Spacing,
  Typography,
} from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";

export function DevicePicker() {
  const {
    devices,
    selectedDevice,
    selectedDeviceId,
    deviceError,
    selectDevice,
  } = useDeviceAccess();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const canOpen = !busy && (devices.length > 0 || selectionError !== null);
  const mounted = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const choose = async (deviceId: string | null) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSelectionError(null);
    try {
      await selectDevice(deviceId);
      if (mounted.current) setVisible(false);
    } catch (error) {
      if (mounted.current) {
        setSelectionError(
          error instanceof Error
            ? error.message
            : "This device could not be selected. Try again.",
        );
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const manageDevices = () => {
    try {
      router.push("/device");
      setVisible(false);
    } catch {
      setSelectionError(
        "Device management could not be opened. Close and try again.",
      );
    }
  };

  const label = selectedDevice?.alias?.trim() || selectedDevice?.model;
  const value = label
    ? label
    : selectedDeviceId
      ? "Checking device access"
      : devices.length === 0
        ? "No paired devices"
        : "Choose a device";
  const accessibilityValue = [label, selectedDevice?.location]
    .filter(Boolean)
    .join(", ");

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          accessibilityValue
            ? `Selected device: ${accessibilityValue}`
            : "Selected device"
        }
        accessibilityHint="Opens the device list and selection actions."
        accessibilityState={{
          selected: Boolean(selectedDevice),
          disabled: !canOpen,
        }}
        disabled={!canOpen}
        onPress={() => {
          setVisible(true);
        }}
        style={({ pressed }) => [
          styles.control,
          pressed && styles.pressed,
          !canOpen && styles.controlDisabled,
        ]}
      >
        <View style={styles.controlText}>
          <Text numberOfLines={1} style={styles.deviceName}>
            {value}
          </Text>
          {selectedDevice?.location ? (
            <Text numberOfLines={1} style={styles.location}>
              {selectedDevice.location}
            </Text>
          ) : null}
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Lucide name="chevron-down" size={20} color={Colors.light.text} />
        </View>
      </Pressable>
      {!visible && selectionError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {selectionError} Open the device list to try again.
        </Text>
      ) : null}
      {deviceError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Device access could not be checked. Open Device to retry.
        </Text>
      ) : null}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <View
          accessibilityViewIsModal
          style={[
            styles.scrim,
            {
              paddingTop: Math.max(Spacing.three, insets.top + Spacing.two),
              paddingBottom: Math.max(
                Spacing.three,
                insets.bottom + Spacing.two,
              ),
              paddingLeft: Math.max(Spacing.page, insets.left + Spacing.two),
              paddingRight: Math.max(Spacing.page, insets.right + Spacing.two),
            },
          ]}
        >
          <ScrollView
            style={[
              styles.sheet,
              {
                maxHeight: Math.max(
                  1,
                  height -
                    Math.max(Spacing.three, insets.top + Spacing.two) -
                    Math.max(Spacing.three, insets.bottom + Spacing.two),
                ),
              },
            ]}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text accessibilityRole="header" style={styles.title}>
              Choose a device
            </Text>
            {selectionError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {selectionError}
              </Text>
            ) : null}
            <View style={styles.optionList}>
              {devices.map((device) => {
                const selected = selectedDeviceId === device.deviceId;
                const name = device.alias?.trim() || device.model;
                const contact =
                  device.contactFreshness === "fresh"
                    ? "Contact is recent"
                    : device.contactFreshness === "stale"
                      ? "Last contact is out of date"
                      : "No contact time recorded";
                return (
                  <Pressable
                    key={device.deviceId}
                    accessibilityRole="button"
                    accessibilityLabel={`${name}${device.location ? `, ${device.location}` : ""}, device ID ${device.deviceId}${selected ? ", selected" : ""}`}
                    accessibilityState={{ selected, disabled: busy }}
                    disabled={busy}
                    onPress={() => void choose(device.deviceId)}
                    style={({ pressed }) => [
                      styles.option,
                      selected && styles.optionSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.optionCopy}>
                      <Text numberOfLines={1} style={styles.optionTitle}>
                        {name}
                      </Text>
                      {device.location ? (
                        <Text numberOfLines={1} style={styles.optionDetail}>
                          {device.location}
                        </Text>
                      ) : null}
                      <Text style={styles.optionDetail}>
                        ID · {device.deviceId.slice(-6).toUpperCase()}
                      </Text>
                      <Text style={styles.optionDetail}>
                        {contact}
                        {device.lastAuthenticatedContactAt
                          ? ` · ${new Date(device.lastAuthenticatedContactAt).toLocaleString()}`
                          : ""}
                      </Text>
                    </View>
                    {selected ? (
                      <View
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                      >
                        <Lucide
                          name="check"
                          size={20}
                          color={Colors.light.text}
                        />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.secondaryActions}>
              <Button
                variant="text"
                onPress={manageDevices}
                disabled={busy}
                style={styles.secondaryAction}
              >
                Manage devices
              </Button>
              <Button
                variant="text"
                onPress={() => void choose(null)}
                disabled={busy}
                style={styles.secondaryAction}
              >
                Clear selection
              </Button>
            </View>
            <Button variant="secondary" onPress={() => setVisible(false)}>
              Close
            </Button>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  control: {
    minHeight: ControlSize.minimumTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.control,
    borderWidth: 1,
    borderColor: Colors.light.controlBorder,
    backgroundColor: Colors.light.surface,
  },
  controlText: { flex: 1, minWidth: 0, gap: Spacing.half },
  deviceName: {
    ...Typography.supporting,
    fontFamily: InterFamilies.semibold,
    color: Colors.light.text,
  },
  location: { ...Typography.metadata, color: Colors.light.textSecondary },
  controlDisabled: { backgroundColor: Colors.light.surfaceMuted },
  pressed: { opacity: 0.76 },
  error: { ...Typography.supporting, color: Colors.light.text },
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(24, 24, 27, 0.36)",
  },
  sheet: {
    flexGrow: 0,
    flexShrink: 1,
    borderTopLeftRadius: Radii.bottomSheetTop,
    borderTopRightRadius: Radii.bottomSheetTop,
    backgroundColor: Colors.light.surface,
  },
  sheetContent: { gap: Spacing.two, padding: Spacing.four },
  title: { ...Typography.cardTitle, marginBottom: Spacing.one },
  optionList: { gap: Spacing.two, paddingBottom: Spacing.one },
  option: {
    minHeight: ControlSize.minimumTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radii.control,
    borderColor: Colors.light.border,
    borderWidth: 1,
  },
  optionSelected: {
    backgroundColor: Colors.light.surfaceMuted,
    borderColor: Colors.light.text,
  },
  optionCopy: { flex: 1, minWidth: 0, gap: Spacing.one },
  optionTitle: {
    ...Typography.supporting,
    fontFamily: InterFamilies.semibold,
    color: Colors.light.text,
  },
  optionDetail: { ...Typography.metadata, color: Colors.light.textSecondary },
  secondaryActions: { flexDirection: "row", gap: Spacing.two },
  secondaryAction: { width: "auto", flex: 1, minWidth: 0 },
});
