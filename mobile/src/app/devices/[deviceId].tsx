import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Platform, Text } from "react-native";

import {
  AppPage,
  BackAction,
  BentoCard,
  Button,
  EmptyState,
  ErrorState,
  PageHeading,
  TextField,
} from "@/components/app-shell";
import { Colors, Typography } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";
import { isUuid } from "@/lib/device-access-state";

export default function DeviceDetailsScreen() {
  const { deviceId: rawDeviceId } = useLocalSearchParams<{ deviceId: string }>();
  const deviceId = Array.isArray(rawDeviceId) ? rawDeviceId[0] : rawDeviceId;
  const {
    devices,
    selectedDeviceId,
    deviceError,
    refreshDevices,
    selectDevice,
    updateDeviceLabels,
    revokeDevice,
  } = useDeviceAccess();
  const device = useMemo(
    () => devices.find((candidate) => candidate.deviceId === deviceId) ?? null,
    [deviceId, devices],
  );
  const [alias, setAlias] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refreshDevices();
    }, [refreshDevices]),
  );

  useEffect(() => {
    setAlias(device?.alias ?? "");
    setLocation(device?.location ?? "");
  }, [device]);

  const saveLabels = async () => {
    if (!device) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await updateDeviceLabels(device.deviceId, alias.trim() || null, location.trim() || null);
      setMessage("Label and location saved for this installation.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The labels could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const removeAccess = async () => {
    if (!device) return;
    setBusy(true);
    setError(null);
    try {
      await revokeDevice(device.deviceId);
      router.replace("/device");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Access could not be removed.");
      setBusy(false);
    }
  };

  const confirmRemoval = () => {
    if (!device) return;
    const description =
      "This revokes access for this installation and clears its local device data. Feeder schedules are not deleted and may continue on the controller.";
    if (Platform.OS === "web") {
      if (globalThis.confirm(description)) void removeAccess();
      return;
    }
    Alert.alert("Remove this device?", description, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove access", style: "destructive", onPress: () => void removeAccess() },
    ]);
  };

  if (!isUuid(deviceId)) {
    return (
      <AppPage>
        <BackAction label="Back" fallback="/device" />
        <PageHeading title="Device details" />
        <EmptyState icon="cpu" title="Device unavailable" description="This device link is invalid or no longer available." action="Go to Device" href="/device" />
      </AppPage>
    );
  }

  if (!device) {
    return (
      <AppPage>
        <BackAction label="Back" fallback="/device" />
        <PageHeading title="Device details" />
        {deviceError ? (
          <ErrorState title="Device access could not be verified" description={deviceError} onRetry={() => void refreshDevices()} />
        ) : (
          <EmptyState icon="cpu" title="Device unavailable" description="This installation has no active access to the device, or the device list is still refreshing." action="Go to Device" href="/device" />
        )}
      </AppPage>
    );
  }

  return (
    <AppPage>
      <BackAction label="Back" fallback="/device" />
      <PageHeading title="Device details" description="Identity and capabilities declared by this device." />
      {selectedDeviceId !== device.deviceId ? (
        <Button variant="secondary" onPress={() => void selectDevice(device.deviceId)}>
          Select this device
        </Button>
      ) : null}
      {error ? <ErrorState title="Device action failed" description={error} onRetry={() => setError(null)} /> : null}
      {message ? <BentoCard compact><Text style={Typography.supporting}>{message}</Text></BentoCard> : null}
      <BentoCard>
        <Text style={Typography.cardTitle}>{device.alias ?? device.model}</Text>
        {device.location ? <Text style={[Typography.supporting, { color: Colors.light.textSecondary }]}>{device.location}</Text> : null}
        <Text style={[Typography.metadata, { color: Colors.light.textSecondary }]}>{device.deviceId}</Text>
        <Text style={Typography.supporting}>Model: {device.model}</Text>
        <Text style={Typography.supporting}>Firmware: {device.firmwareVersion}</Text>
        <Text style={Typography.supporting}>Protocol major: 2</Text>
        <Text style={Typography.supporting}>{device.isSimulated ? "Simulator fixture; values are not hardware evidence." : "Device profile"}</Text>
        <Text style={Typography.supporting}>Contact status: {device.contactFreshness}</Text>
        <Text style={Typography.supporting}>
          Last authenticated contact: {device.lastAuthenticatedContactAt
            ? new Date(device.lastAuthenticatedContactAt).toLocaleString()
            : "unknown"}
        </Text>
      </BentoCard>
      <BentoCard>
        <Text style={Typography.cardTitle}>Shared container and nozzles</Text>
        <Text style={Typography.supporting}>Both nozzles use the same continuously weighed container.</Text>
        {(["1", "2"] as const).map((number) => {
          const nozzle = device.capabilities.nozzles[number];
          const range = nozzle.minDoseG !== null && nozzle.maxDoseG !== null
            ? "; declared range " + nozzle.minDoseG + "–" + nozzle.maxDoseG + " g" + (device.isSimulated ? " (simulator fixture)" : "")
            : "";
          const status = nozzle.enabled
            ? "enabled; " + (nozzle.doseModes.join(", ") || "no dose mode declared") + range
            : "disabled";
          return (
            <Text key={number} style={Typography.supporting}>
              Nozzle {number}: {status}
            </Text>
          );
        })}
        <Text style={[Typography.supporting, { color: Colors.light.textSecondary }]}>
          Declared capabilities: {[
            device.capabilities.doMonitoring ? "DO monitoring" : null,
            device.capabilities.feedRemainingMonitoring ? "remaining-feed monitoring" : null,
            device.capabilities.localScheduleExecution ? "local schedule execution" : null,
          ].filter(Boolean).join(", ") || "none"}.
        </Text>
      </BentoCard>
      <BentoCard>
        <Text style={Typography.cardTitle}>This installation&apos;s label</Text>
        <Text style={[Typography.supporting, { color: Colors.light.textSecondary }]}>
          Labels and locations apply only to this installation.
        </Text>
        <TextField label="Device label" value={alias} onChangeText={setAlias} maxLength={80} autoCapitalize="words" />
        <TextField label="Location (optional)" value={location} onChangeText={setLocation} maxLength={80} autoCapitalize="words" />
        <Button onPress={() => void saveLabels()} loading={busy} disabled={busy}>Save label</Button>
      </BentoCard>
      <BentoCard>
        <Text style={Typography.cardTitle}>Remove access</Text>
        <Text style={[Typography.supporting, { color: Colors.light.textSecondary }]}>
          Removal clears this installation&apos;s cached device profile. Applied feeder schedules remain on the controller and may continue.
        </Text>
        <Button variant="secondary" icon="unlink" onPress={confirmRemoval} disabled={busy}>
          Remove this device
        </Button>
      </BentoCard>
    </AppPage>
  );
}
