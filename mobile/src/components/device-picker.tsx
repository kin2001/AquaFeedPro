import { Lucide } from "@react-native-vector-icons/lucide";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  BentoCard,
  Button,
  ListRow,
  Notice,
  Sheet,
} from "@/components/app-shell";
import {
  Colors,
  ControlSize,
  IconSize,
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
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.iconWell}
        >
          <Lucide name="cpu" size={IconSize.default} color={Colors.light.ink} />
        </View>
        <View style={styles.controlText}>
          <Text style={Typography.cardTitle}>{value}</Text>
          {selectedDevice?.location ? (
            <Text style={Typography.metadata}>{selectedDevice.location}</Text>
          ) : null}
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Lucide
            name="chevron-down"
            size={IconSize.default}
            color={Colors.light.textSecondary}
          />
        </View>
      </Pressable>
      {!visible && selectionError ? (
        <Notice tone="error">
          {selectionError + " Open the device list to try again."}
        </Notice>
      ) : null}
      {deviceError ? (
        <Notice tone="error">
          Device access could not be checked. Open Device to retry.
        </Notice>
      ) : null}
      <Sheet
        visible={visible}
        title="Choose a device"
        onClose={() => setVisible(false)}
        footer={
          <View style={styles.sheetActions}>
            <Button variant="text" onPress={manageDevices} disabled={busy}>
              Manage devices
            </Button>
            <Button
              variant="text"
              onPress={() => void choose(null)}
              disabled={busy}
            >
              Clear selection
            </Button>
          </View>
        }
      >
        {selectionError ? <Notice tone="error">{selectionError}</Notice> : null}
        <BentoCard flush>
          {devices.map((device, index) => {
            const selected = selectedDeviceId === device.deviceId;
            const name = device.alias?.trim() || device.model;
            const contact =
              device.contactFreshness === "fresh"
                ? "Contact is recent"
                : device.contactFreshness === "stale"
                  ? "Last contact is out of date"
                  : "No contact time recorded";
            return (
              <ListRow
                key={device.deviceId}
                icon="cpu"
                title={name}
                lines={[
                  device.location,
                  "ID · " + device.deviceId.slice(-6).toUpperCase(),
                  contact +
                    (device.lastAuthenticatedContactAt
                      ? " · " +
                        new Date(
                          device.lastAuthenticatedContactAt,
                        ).toLocaleString()
                      : ""),
                ]}
                trailing={
                  selected ? (
                    <View
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      <Lucide
                        name="check"
                        size={IconSize.default}
                        color={Colors.light.ink}
                      />
                    </View>
                  ) : undefined
                }
                divider={index > 0}
                disabled={busy}
                onPress={() => void choose(device.deviceId)}
                accessibilityLabel={`${name}${device.location ? `, ${device.location}` : ""}, device ID ${device.deviceId}${selected ? ", selected" : ""}`}
              />
            );
          })}
        </BentoCard>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  control: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 7,
    paddingBottom: 7,
    paddingLeft: 7,
    paddingRight: 12,
    borderRadius: Radii.control,
    borderWidth: 1,
    borderColor: Colors.light.controlBorder,
    backgroundColor: Colors.light.surface,
  },
  controlDisabled: { backgroundColor: Colors.light.surfaceMuted },
  pressed: { opacity: 0.72 },
  iconWell: {
    width: ControlSize.iconWell,
    height: ControlSize.iconWell,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radii.pill,
    backgroundColor: Colors.light.surfaceMuted,
  },
  controlText: { flex: 1, minWidth: 0 },
  sheetActions: { flexDirection: "row", justifyContent: "space-between" },
});
