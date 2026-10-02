import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useState } from "react";

import { Button } from "@/components/app-shell";
import { Colors, ControlSize, InterFamilies, Radii, Spacing, Typography } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";

export function DevicePicker() {
  const { devices, selectedDevice, selectedDeviceId, selectDevice } = useDeviceAccess();
  const [visible, setVisible] = useState(false);

  const choose = (deviceId: string | null) => {
    void selectDevice(deviceId)
      .then(() => setVisible(false))
      .catch(() => setVisible(false));
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Selected device</Text>
      <Button
        variant="secondary"
        icon="chevrons-up-down"
        onPress={() => setVisible(true)}
        disabled={
          devices.length === 0 ||
          (devices.length === 1 && selectedDeviceId === devices[0].deviceId)
        }
        accessibilityHint={
          devices.length < 2 ? "Pair another device to switch devices." : "Choose the device for this page."
        }
      >
        {selectedDevice
          ? selectedDevice.alias ?? selectedDevice.model
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
        <View style={styles.scrim}>
          <View style={styles.sheet}>
            <Text accessibilityRole="header" style={styles.title}>Choose a device</Text>
            {devices.map((device) => (
              <Pressable
                key={device.deviceId}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedDeviceId === device.deviceId }}
                onPress={() => choose(device.deviceId)}
                style={({ pressed }) => [
                  styles.option,
                  selectedDeviceId === device.deviceId && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.optionTitle}>{device.alias ?? device.model}</Text>
                <Text style={styles.optionDetail}>
                  {device.location ? `${device.location} · ` : ""}{device.deviceId}
                </Text>
              </Pressable>
            ))}
            <Button variant="text" onPress={() => choose(null)}>
              Clear selection
            </Button>
            <Button variant="secondary" onPress={() => setVisible(false)}>
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
    backgroundColor: "rgba(24, 24, 27, 0.36)",
  },
  sheet: {
    gap: Spacing.two,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
    borderTopLeftRadius: Radii.bottomSheetTop,
    borderTopRightRadius: Radii.bottomSheetTop,
    backgroundColor: Colors.light.surface,
  },
  title: { ...Typography.cardTitle, marginBottom: Spacing.one },
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
  optionSelected: { backgroundColor: Colors.light.surfaceMuted, borderColor: Colors.light.text },
  optionTitle: { ...Typography.supporting, fontFamily: InterFamilies.semibold, color: Colors.light.text },
  optionDetail: { ...Typography.metadata, color: Colors.light.textSecondary },
  pressed: { opacity: 0.75 },
});
