import { Lucide } from "@react-native-vector-icons/lucide";
import { router, useFocusEffect } from "expo-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import {
  AppPage,
  BentoCard,
  Button,
  EmptyState,
  KeyValue,
  Notice,
  ScreenHeader,
  StatusLabel,
} from "@/components/app-shell";
import {
  Colors,
  ControlSize,
  IconSize,
  Radii,
  Spacing,
  Typography,
} from "@/constants/theme";
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

  const refreshMessage = deviceError || refreshError;

  return (
    <AppPage edges={["top", "left", "right"]} gap={0}>
      <ScreenHeader
        title="Device"
        action={
          <Button
            size="compact"
            variant="secondary"
            icon="plus"
            onPress={() => router.push("/devices/add")}
          >
            Add
          </Button>
        }
      />
      <View style={styles.countRow}>
        <Text style={Typography.metadata}>
          {devices.length} paired {devices.length === 1 ? "device" : "devices"}
        </Text>
        {refreshing ? (
          <View style={styles.refreshing}>
            <ActivityIndicator size="small" color={Colors.light.ink} />
            <Text style={Typography.metadata}>Checking access</Text>
          </View>
        ) : null}
      </View>
      {refreshMessage ? (
        <View style={styles.refreshError}>
          <Notice
            tone="error"
            actions={
              <Button
                variant="text"
                onPress={retryRefresh}
                disabled={refreshing}
              >
                Refresh devices
              </Button>
            }
          >
            {refreshMessage}
          </Notice>
        </View>
      ) : null}
      {devices.length === 0 ? (
        <View style={styles.firstBlock}>
          <EmptyState
            icon="cpu"
            title="No paired devices"
            description="Add a feeder to connect it to this app."
          />
        </View>
      ) : (
        devices.map((device, index) => {
          const selected = selectedDeviceId === device.deviceId;
          const name = device.alias?.trim() || device.model;
          const busy = pendingDeviceId !== null;
          return (
            <BentoCard
              key={device.deviceId}
              gap={0}
              style={index === 0 ? styles.firstBlock : styles.nextCard}
            >
              <View
                accessible
                accessibilityLabel={`Device ${name}${device.location ? `, ${device.location}` : ""}, ID ${device.deviceId}${selected ? ", selected" : ""}${device.isSimulated ? ", simulator" : ""}`}
                style={styles.identityRow}
              >
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.iconWell}
                >
                  <Lucide
                    name="cpu"
                    size={IconSize.default}
                    color={Colors.light.ink}
                  />
                </View>
                <View style={styles.identityCopy}>
                  <Text numberOfLines={1} style={Typography.cardTitle}>
                    {name}
                  </Text>
                  {device.location ? (
                    <Text numberOfLines={1} style={Typography.supporting}>
                      {device.location}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.markers}>
                  {selected ? (
                    <StatusLabel kind="selected">Selected</StatusLabel>
                  ) : null}
                  {device.isSimulated ? (
                    <StatusLabel kind="simulator">Simulator</StatusLabel>
                  ) : null}
                </View>
              </View>
              <View style={styles.idRow}>
                <KeyValue
                  label="ID"
                  value={"…" + device.deviceId.slice(-6).toUpperCase()}
                />
              </View>
              <View style={styles.connection}>
                {device.contactFreshness === "fresh" ? (
                  <StatusLabel kind="online">
                    {"Online · " + contactLabel(device).toLowerCase()}
                  </StatusLabel>
                ) : device.contactFreshness === "stale" ? (
                  <StatusLabel kind="offline">
                    {"Offline · " + contactLabel(device).toLowerCase()}
                  </StatusLabel>
                ) : (
                  <StatusLabel kind="outdated">
                    {contactLabel(device)}
                  </StatusLabel>
                )}
              </View>
              {device.lastAuthenticatedContactAt ? (
                <Text style={[Typography.metadata, styles.lastContact]}>
                  {"Last contact " +
                    new Date(
                      device.lastAuthenticatedContactAt,
                    ).toLocaleString()}
                </Text>
              ) : null}
              {actionErrors[device.deviceId] ? (
                <View style={styles.cardError}>
                  <Notice tone="error">{actionErrors[device.deviceId]}</Notice>
                </View>
              ) : null}
              <View style={styles.actions}>
                <Button
                  variant={selected ? "primary" : "secondary"}
                  loading={pendingDeviceId === device.deviceId}
                  disabled={busy}
                  accessibilityHint={`Opens ${name}${device.location ? `, ${device.location}` : ""}, device ID ${device.deviceId}, on Home.`}
                  onPress={() => void openDashboard(device)}
                  style={styles.dashboardButton}
                >
                  Open dashboard
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  accessibilityHint={`${name}${device.location ? `, ${device.location}` : ""}, device ID ${device.deviceId}`}
                  onPress={() => manageDevice(device)}
                  style={styles.manageButton}
                >
                  Manage
                </Button>
              </View>
            </BentoCard>
          );
        })
      )}
    </AppPage>
  );
}

const styles = StyleSheet.create({
  countRow: {
    marginTop: Spacing.two,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  refreshing: { flexDirection: "row", alignItems: "center", gap: Spacing.two },
  refreshError: { marginTop: Spacing.cardGap },
  firstBlock: { marginTop: Spacing.three },
  nextCard: { marginTop: Spacing.cardGap },
  identityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.cardGap,
  },
  iconWell: {
    width: ControlSize.iconWell,
    height: ControlSize.iconWell,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radii.pill,
    backgroundColor: Colors.light.surfaceMuted,
  },
  identityCopy: { flex: 1, minWidth: 0 },
  markers: {
    flexShrink: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: Spacing.two,
  },
  idRow: {
    marginTop: Spacing.cardGap,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  connection: { marginTop: Spacing.one, alignSelf: "flex-start" },
  lastContact: { marginTop: Spacing.one },
  cardError: { marginTop: Spacing.cardGap },
  actions: {
    marginTop: Spacing.three,
    flexDirection: "row",
    gap: Spacing.cardGap,
  },
  dashboardButton: { flex: 1, width: "auto" },
  manageButton: { width: "auto", paddingHorizontal: 20 },
});
