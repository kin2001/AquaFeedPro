import Constants from "expo-constants";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  AppPage,
  BentoCard,
  Button,
  EmptyState,
  KeyValue,
  ListRow,
  Notice,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  StatusLabel,
} from "@/components/app-shell";
import { MotionSection } from "@/components/motion";
import { Spacing } from "@/constants/theme";
import { useDeviceAccess, type DeviceRecord } from "@/lib/device-access";
import { readConfiguration, type ConfigurationRead } from "@/lib/schedules";

function connection(device: DeviceRecord) {
  return device.contactFreshness === "fresh"
    ? ({ kind: "online", text: "Online" } as const)
    : device.contactFreshness === "stale"
      ? ({ kind: "offline", text: "Offline" } as const)
      : ({ kind: "outdated", text: "No contact yet" } as const);
}

function oxygenText(low: number | null, high: number | null) {
  if (low !== null && high !== null) return `${low} to ${high} mg/L`;
  if (low !== null) return `Below ${low} mg/L`;
  if (high !== null) return `Above ${high} mg/L`;
  return "Off";
}

export default function DeviceScreen() {
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const {
    installationId,
    devices,
    selectedDeviceId,
    selectedDevice,
    scopeRevision,
    deviceError,
    refreshing,
    refreshDevices,
  } = useDeviceAccess();
  const mounted = useRef(true);
  const focused = useRef(false);
  const focusGeneration = useRef(0);

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

  const scopeKey = `${installationId ?? ""}:${selectedDeviceId ?? ""}:${scopeRevision}`;
  const [applied, setApplied] = useState<{
    key: string;
    configuration: ConfigurationRead | null;
    error: string | null;
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!installationId || !selectedDeviceId) return;
      let active = true;
      void readConfiguration(installationId, selectedDeviceId)
        .then((configuration) => {
          if (active)
            setApplied({
              key: scopeKey,
              configuration,
              error: null,
            });
        })
        .catch((reason) => {
          if (active)
            setApplied((previous) => ({
              key: scopeKey,
              configuration:
                previous?.key === scopeKey ? previous.configuration : null,
              error:
                reason instanceof Error
                  ? reason.message
                  : "Feeder settings could not be loaded. Open a setting to refresh its status.",
            }));
        });
      return () => {
        active = false;
      };
    }, [installationId, scopeKey, selectedDeviceId]),
  );
  const current = applied?.key === scopeKey ? applied : null;
  const configuration = current?.configuration;
  const values = configuration?.applied_snapshot;
  const unavailable = !current
    ? "Loading…"
    : current.error
      ? "Unverified"
      : "Not available";

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
  const actionError = Object.values(actionErrors).find(Boolean);
  const selectedName = selectedDevice
    ? selectedDevice.alias?.trim() || selectedDevice.model
    : "";

  return (
    <AppPage
      edges={["top", "left", "right"]}
      header={<ScreenHeader title="Settings" />}
    >
      {refreshMessage ? (
        <Notice
          tone="error"
          actions={
            <Button variant="text" onPress={retryRefresh} disabled={refreshing}>
              Refresh devices
            </Button>
          }
        >
          {refreshMessage}
        </Notice>
      ) : null}

      <View style={styles.section}>
        <SectionHeader
          title="Feeders"
          action={{ label: "Add", onPress: () => router.push("/devices/add") }}
        />
        {devices.length === 0 && refreshing ? (
          <>
            <Skeleton height={72} />
            <Skeleton height={72} />
          </>
        ) : devices.length === 0 ? (
          <EmptyState
            icon="cpu"
            title="No feeders yet"
            description="Pair a feeder to manage it here."
            action="Pair feeder"
            href="/devices/add"
          />
        ) : (
          <BentoCard flush>
            {devices.map((device, index) => {
              const selected = selectedDeviceId === device.deviceId;
              const name = device.alias?.trim() || device.model;
              const status = connection(device);
              return (
                <ListRow
                  key={device.deviceId}
                  revealKey={installationId + ":device:" + device.deviceId}
                  divider={index > 0}
                  icon="cpu"
                  title={name}
                  lines={[
                    [device.location, device.isSimulated && "Simulator"]
                      .filter(Boolean)
                      .join(" · "),
                  ]}
                  footer={
                    <View style={styles.pills}>
                      <StatusLabel kind={status.kind}>
                        {status.text}
                      </StatusLabel>
                      {selected ? (
                        <StatusLabel kind="selected">Selected</StatusLabel>
                      ) : null}
                    </View>
                  }
                  trailing="chevron"
                  onPress={() => manageDevice(device)}
                  accessibilityLabel={`${name}${device.location ? `, ${device.location}` : ""}, ${status.text}${selected ? ", selected" : ""}${device.isSimulated ? ", simulator" : ""}`}
                  accessibilityHint="Opens this feeder."
                />
              );
            })}
          </BentoCard>
        )}
        {actionError ? <Notice tone="error">{actionError}</Notice> : null}
      </View>

      {selectedDevice ? (
        <MotionSection
          key={installationId + ":" + selectedDeviceId + ":settings"}
          style={styles.section}
        >
          <SectionHeader
            title={
              "Feeder settings" +
              (devices.length > 1 ? " · " + selectedName : "")
            }
          />
          {current?.error ? (
            <Notice tone="error">{current.error}</Notice>
          ) : null}
          {configuration?.current_state.last_attempt_status === "pending" ? (
            <StatusLabel kind="pending">
              {`Revision ${configuration.current_state.last_attempt_revision} is pending; applied values shown`}
            </StatusLabel>
          ) : configuration?.current_state.last_attempt_status ===
            "rejected" ? (
            <StatusLabel kind="warning">
              Latest revision rejected; the prior applied settings remain active
            </StatusLabel>
          ) : null}
          <BentoCard flush>
            <ListRow
              icon="globe"
              title="Time zone"
              lines={
                values
                  ? [
                      values.timezone +
                        (current?.error ? " · May be outdated" : ""),
                    ]
                  : [unavailable]
              }
              trailing="chevron"
              onPress={() => router.push("/settings/timezone")}
            />
            <ListRow
              divider
              icon="waves"
              title="Oxygen limits"
              lines={
                values
                  ? [
                      oxygenText(
                        values.monitoring_limits.do_low_mg_l,
                        values.monitoring_limits.do_high_mg_l,
                      ),
                    ]
                  : [unavailable]
              }
              trailing="chevron"
              onPress={() => router.push("/settings/oxygen")}
            />
            <ListRow
              divider
              icon="container"
              title="Low-feed alert"
              lines={
                values
                  ? [
                      values.low_feed_threshold_pct === null
                        ? "Off"
                        : `Below ${values.low_feed_threshold_pct}%`,
                    ]
                  : [unavailable]
              }
              trailing="chevron"
              onPress={() => router.push("/settings/feed")}
            />
          </BentoCard>
        </MotionSection>
      ) : null}

      <MotionSection key="about" style={styles.section}>
        <SectionHeader title="About" />
        <BentoCard gap={0}>
          <KeyValue
            label="Version"
            value={Constants.expoConfig?.version ?? "—"}
          />
        </BentoCard>
      </MotionSection>
    </AppPage>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
});
