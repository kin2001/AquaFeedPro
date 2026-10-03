import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { Text, View } from "react-native";

import {
  AppPage,
  BentoCard,
  Button,
  EmptyState,
  ErrorState,
  LinkButton,
  PageHeading,
  StatusLabel,
} from "@/components/app-shell";
import { Colors, Typography } from "@/constants/theme";
import { useDeviceAccess, type DeviceRecord } from "@/lib/device-access";

export default function DeviceScreen() {
  const {
    devices,
    selectedDeviceId,
    deviceError,
    refreshing,
    refreshDevices,
    selectDevice,
  } = useDeviceAccess();

  useFocusEffect(
    useCallback(() => {
      void refreshDevices();
    }, [refreshDevices]),
  );

  const openDetails = async (device: DeviceRecord) => {
    try {
      await selectDevice(device.deviceId);
      router.push({
        pathname: "/devices/[deviceId]",
        params: { deviceId: device.deviceId },
      });
    } catch {
      // The provider fails closed if selected-device persistence is unavailable.
    }
  };

  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading title="Device" description="Manage your paired feeders." />
      {deviceError ? (
        <ErrorState
          title="Device access could not be refreshed"
          description={deviceError}
          onRetry={() => void refreshDevices()}
        />
      ) : devices.length === 0 ? (
        <EmptyState
          icon="cpu"
          title="No devices yet"
          description={
            refreshing
              ? "Checking active device access."
              : "Pair a feeder to see its identity, declared capabilities, and local label here."
          }
        />
      ) : (
        <>
          {devices.map((device) => (
            <BentoCard key={device.deviceId}>
              <View style={{ gap: 8 }}>
                <StatusLabel kind={device.isSimulated ? "warning" : "pending"}>
                  {device.isSimulated ? "Simulator fixture" : "Device profile"}
                </StatusLabel>
                <Text style={Typography.cardTitle}>
                  {device.alias ?? device.model}
                </Text>
                {device.location ? (
                  <Text
                    style={[
                      Typography.supporting,
                      { color: Colors.light.textSecondary },
                    ]}
                  >
                    {device.location}
                  </Text>
                ) : null}
                <Text
                  style={[
                    Typography.metadata,
                    { color: Colors.light.textSecondary },
                  ]}
                >
                  {device.deviceId}
                </Text>
                <Text style={Typography.supporting}>
                  Protocol 2 · {device.model} · {device.firmwareVersion}
                </Text>
                <Text style={Typography.supporting}>
                  Two nozzles share one weighed container.
                </Text>
                <Text
                  style={[
                    Typography.metadata,
                    { color: Colors.light.textSecondary },
                  ]}
                >
                  Contact status: {device.contactFreshness}
                </Text>
              </View>
              <Button
                variant={
                  selectedDeviceId === device.deviceId ? "primary" : "secondary"
                }
                icon={
                  selectedDeviceId === device.deviceId
                    ? "check"
                    : "arrow-up-right"
                }
                onPress={() => void openDetails(device)}
              >
                {selectedDeviceId === device.deviceId
                  ? "Selected · open details"
                  : "Select and view details"}
              </Button>
            </BentoCard>
          ))}
          <LinkButton href="/devices/add" icon="plus">
            Pair a device
          </LinkButton>
        </>
      )}
      {__DEV__ ? (
        <BentoCard compact>
          <Text style={Typography.cardTitle}>
            Component previews (development only)
          </Text>
          <Text
            style={[
              Typography.supporting,
              { color: Colors.light.textSecondary },
            ]}
          >
            Shared components use local preview state and do not contact a
            feeder.
          </Text>
          <LinkButton href="/dev/components" variant="secondary">
            Open component previews
          </LinkButton>
        </BentoCard>
      ) : null}
    </AppPage>
  );
}
