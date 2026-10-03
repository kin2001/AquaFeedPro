import { useState } from "react";
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

import { Button, LinkButton } from "@/components/app-shell";
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
  const { devices, selectedDevice, selectedDeviceId, selectDevice } =
    useDeviceAccess();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const choose = async (deviceId: string | null) => {
    setBusy(true);
    setSelectionError(null);
    try {
      await selectDevice(deviceId);
      setVisible(false);
    } catch (error) {
      setSelectionError(
        error instanceof Error
          ? error.message
          : "The selected device could not be saved on this installation.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Selected device</Text>
      <Button
        variant="secondary"
        icon="chevrons-up-down"
        onPress={() => {
          setSelectionError(null);
          setVisible(true);
        }}
        disabled={devices.length === 0}
        accessibilityHint={
          devices.length === 1
            ? "Choose this device or clear the selection."
            : "Choose or clear the device for this page."
        }
      >
        {selectedDevice
          ? selectedDevice.alias?.trim() || selectedDevice.model
          : selectedDeviceId
            ? "Checking device access"
            : devices.length === 0
              ? "No paired devices"
              : "Choose a device"}
      </Button>
      {selectedDevice?.location ? (
        <Text style={styles.location}>{selectedDevice.location}</Text>
      ) : null}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <View
          style={[styles.scrim, { paddingTop: insets.top + Spacing.three }]}
        >
          <View
            style={[
              styles.sheet,
              {
                maxHeight: Math.max(
                  180,
                  height - insets.top - insets.bottom - Spacing.six,
                ),
                paddingBottom: Math.max(
                  Spacing.four,
                  insets.bottom + Spacing.two,
                ),
              },
            ]}
          >
            <Text accessibilityRole="header" style={styles.title}>
              Choose a device
            </Text>
            {selectionError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {selectionError}
              </Text>
            ) : null}
            <ScrollView
              style={styles.options}
              contentContainerStyle={styles.optionList}
              keyboardShouldPersistTaps="handled"
            >
              {devices.map((device) => (
                <Pressable
                  key={device.deviceId}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: selectedDeviceId === device.deviceId,
                    disabled: busy,
                  }}
                  disabled={busy}
                  onPress={() => void choose(device.deviceId)}
                  style={({ pressed }) => [
                    styles.option,
                    selectedDeviceId === device.deviceId &&
                      styles.optionSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.optionTitle}>
                    {device.alias?.trim() || device.model}
                    {selectedDeviceId === device.deviceId ? " · Selected" : ""}
                  </Text>
                  {device.location ? (
                    <Text style={styles.optionDetail}>{device.location}</Text>
                  ) : null}
                  <Text style={styles.optionDetail}>
                    ID · {device.deviceId.slice(-6).toUpperCase()}
                  </Text>
                  <Text style={styles.optionDetail}>
                    Contact status · {device.contactFreshness}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <LinkButton href="/device" variant="text">
              Manage devices
            </LinkButton>
            <Button
              variant="text"
              onPress={() => void choose(null)}
              disabled={busy}
            >
              Clear selection
            </Button>
            <Button
              variant="secondary"
              onPress={() => setVisible(false)}
              disabled={busy}
            >
              Close
            </Button>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  label: { ...Typography.metadata, color: Colors.light.textSecondary },
  location: { ...Typography.supporting, color: Colors.light.textSecondary },
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: Spacing.page,
    paddingBottom: Spacing.three,
    backgroundColor: "rgba(24, 24, 27, 0.36)",
  },
  sheet: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderTopLeftRadius: Radii.bottomSheetTop,
    borderTopRightRadius: Radii.bottomSheetTop,
    backgroundColor: Colors.light.surface,
  },
  title: { ...Typography.cardTitle, marginBottom: Spacing.one },
  options: { flexShrink: 1 },
  optionList: { gap: Spacing.two },
  option: {
    minHeight: ControlSize.minimumTarget,
    justifyContent: "center",
    gap: Spacing.one,
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
  optionTitle: {
    ...Typography.supporting,
    fontFamily: InterFamilies.semibold,
    color: Colors.light.text,
  },
  optionDetail: { ...Typography.metadata, color: Colors.light.textSecondary },
  error: { ...Typography.supporting, color: Colors.light.text },
  pressed: { opacity: 0.75 },
});
