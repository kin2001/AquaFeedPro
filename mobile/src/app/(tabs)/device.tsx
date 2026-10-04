import { Lucide } from "@react-native-vector-icons/lucide";
import { router, useFocusEffect } from "expo-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AppPage,
  BentoCard,
  Button,
  PageHeading,
  StatusLabel,
} from "@/components/app-shell";
import { Colors, ControlSize, Spacing, Typography } from "@/constants/theme";
import { useDeviceAccess, type DeviceRecord } from "@/lib/device-access";

function contactLabel(device: DeviceRecord) {
  switch (device.contactFreshness) {
    case "fresh":
      return "Contact is recent";
    case "stale":
      return "Last contact is out of date";
    default:
      return "No contact time recorded";
  }
}

export default function DeviceScreen() {
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const {
    installationId,
    devices,
    selectedDeviceId,
    deviceError,
    refreshing,
    refreshDevices,
    selectDevice,
  } = useDeviceAccess();
  const mounted = useRef(true);
  const focused = useRef(false);
  const focusGeneration = useRef(0);
  const installationIdRef = useRef(installationId);
  const pendingRef = useRef(false);

  useLayoutEffect(() => {
    installationIdRef.current = installationId;
  }, [installationId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      focusGeneration.current += 1;
      const generation = focusGeneration.current;
      void refreshDevices().catch((reason) => {
        if (mounted.current && focusGeneration.current === generation) {
          setRefreshError(
            reason instanceof Error
              ? reason.message
              : "Paired devices could not be refreshed.",
          );
        }
      });
      return () => {
        focused.current = false;
        focusGeneration.current += 1;
      };
    }, [refreshDevices]),
  );

  const openDashboard = async (device: DeviceRecord) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const selectedInstallation = installationIdRef.current;
    const navigationGeneration = focusGeneration.current;
    setPendingDeviceId(device.deviceId);
    setActionErrors((current) => ({ ...current, [device.deviceId]: "" }));
    try {
      await selectDevice(device.deviceId);
      if (
        mounted.current &&
        focused.current &&
        focusGeneration.current === navigationGeneration &&
        installationIdRef.current === selectedInstallation
      ) {
        router.replace("/");
      }
    } catch (reason) {
      if (
        mounted.current &&
        installationIdRef.current === selectedInstallation
      ) {
        setActionErrors((current) => ({
          ...current,
          [device.deviceId]:
            reason instanceof Error
              ? reason.message
              : "This device could not be selected. Try again.",
        }));
      }
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPendingDeviceId(null);
    }
  };

  const manageDevice = (device: DeviceRecord) => {
    try {
      router.push({
        pathname: "/devices/[deviceId]",
        params: { deviceId: device.deviceId },
      });
    } catch {
      setActionErrors((current) => ({
        ...current,
        [device.deviceId]: "Device details could not be opened. Try again.",
      }));
    }
  };

  const retryRefresh = () => {
    setRefreshError(null);
    void refreshDevices().catch((reason) =>
      setRefreshError(
        reason instanceof Error
          ? reason.message
          : "Paired devices could not be refreshed.",
      ),
    );
  };

  return (
    <AppPage edges={["top", "left", "right"]}>
      <View style={styles.headingRow}>
        <PageHeading title="Device" description="Manage paired feeders." />
        <Button
          variant="secondary"
          icon="plus"
          onPress={() => router.push("/devices/add")}
          style={styles.addButton}
        >
          Add
        </Button>
      </View>
      <View style={styles.countRow}>
        <Text style={styles.count}>
          {devices.length} paired {devices.length === 1 ? "device" : "devices"}
        </Text>
        {refreshing ? (
          <View style={styles.refreshing}>
            <ActivityIndicator size="small" color={Colors.light.text} />
            <Text style={styles.refreshingText}>Checking access</Text>
          </View>
        ) : null}
      </View>
      {deviceError || refreshError ? (
        <View style={styles.errorBlock}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {deviceError || refreshError}
          </Text>
          <Button variant="text" onPress={retryRefresh} disabled={refreshing}>
            Refresh devices
          </Button>
        </View>
      ) : null}
      {devices.length === 0 ? (
        <BentoCard compact>
          <Text style={Typography.cardTitle}>No paired devices</Text>
          <Text style={styles.secondaryText}>
            Use Add to connect a feeder to this installation.
          </Text>
        </BentoCard>
      ) : (
        devices.map((device) => {
          const selected = selectedDeviceId === device.deviceId;
          const name = device.alias?.trim() || device.model;
          const busy = pendingDeviceId !== null;
          return (
            <BentoCard key={device.deviceId} compact style={styles.deviceRow}>
              <View style={styles.identityRow}>
                <View style={styles.identityCopy}>
                  <Text numberOfLines={1} style={Typography.cardTitle}>
                    {name}
                  </Text>
                  {device.location ? (
                    <Text numberOfLines={1} style={styles.secondaryText}>
                      {device.location}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.markers}>
                  {selected ? (
                    <StatusLabel kind="completed">Selected</StatusLabel>
                  ) : null}
                  {device.isSimulated ? (
                    <StatusLabel kind="warning">Simulator</StatusLabel>
                  ) : null}
                </View>
              </View>
              <Text style={styles.metadata}>
                ID · {device.deviceId.slice(-6).toUpperCase()}
              </Text>
              <Text style={styles.metadata}>
                {contactLabel(device)}
                {device.lastAuthenticatedContactAt
                  ? ` · ${new Date(device.lastAuthenticatedContactAt).toLocaleString()}`
                  : ""}
              </Text>
              {actionErrors[device.deviceId] ? (
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {actionErrors[device.deviceId]}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <Button
                  icon="arrow-up-right"
                  loading={pendingDeviceId === device.deviceId}
                  disabled={busy}
                  onPress={() => void openDashboard(device)}
                  style={styles.dashboardButton}
                >
                  Open dashboard
                </Button>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Manage ${name}`}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => manageDevice(device)}
                  style={({ pressed }) => [
                    styles.manageButton,
                    pressed && !busy && styles.pressed,
                    busy && styles.disabledButton,
                  ]}
                >
                  <Text style={styles.manageText}>Manage</Text>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <Lucide
                      name="chevron-right"
                      size={18}
                      color={Colors.light.text}
                    />
                  </View>
                </Pressable>
              </View>
            </BentoCard>
          );
        })
      )}
    </AppPage>
  );
}

const styles = StyleSheet.create({
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  addButton: { width: "auto", minWidth: 72 },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 32,
  },
  count: { ...Typography.supporting, color: Colors.light.textSecondary },
  refreshing: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  refreshingText: { ...Typography.metadata, color: Colors.light.textSecondary },
  deviceRow: { gap: Spacing.two },
  identityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  identityCopy: { flex: 1, minWidth: 0, gap: Spacing.one },
  markers: { alignItems: "flex-end", gap: Spacing.one },
  secondaryText: {
    ...Typography.supporting,
    color: Colors.light.textSecondary,
  },
  metadata: { ...Typography.metadata, color: Colors.light.textSecondary },
  actions: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  dashboardButton: { width: "auto", flex: 1 },
  manageButton: {
    minWidth: 92,
    minHeight: ControlSize.minimumTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderColor: Colors.light.border,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: Colors.light.surface,
  },
  manageText: { ...Typography.button, color: Colors.light.text },
  pressed: { opacity: 0.76 },
  disabledButton: { backgroundColor: Colors.light.surfaceMuted },
  errorBlock: { gap: Spacing.one },
  errorText: { ...Typography.supporting, color: Colors.light.text },
});
