import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";

import {
  AppPage,
  BackAction,
  BentoCard,
  PageHeading,
} from "@/components/app-shell";
import { Typography } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";
import { isUuid } from "@/lib/device-access-state";
import { readHistoryDetail } from "@/lib/manual-feed";

export default function FeedingDetailsScreen() {
  const { runId, device_id: rawDeviceId } = useLocalSearchParams<{
    runId?: string;
    device_id?: string;
  }>();
  const routeDeviceId = Array.isArray(rawDeviceId)
    ? rawDeviceId[0]
    : rawDeviceId;
  const canonicalRouteDeviceId = isUuid(routeDeviceId)
    ? routeDeviceId.toLowerCase()
    : null;
  const { installationId, selectedDevice, selectedDeviceId, scopeRevision } =
    useDeviceAccess();
  const [targetScope] = useState(() => ({
    deviceId: canonicalRouteDeviceId ?? selectedDevice?.deviceId ?? null,
    installationId,
    selectedDeviceId,
    scopeRevision,
    simulated:
      selectedDevice?.deviceId === canonicalRouteDeviceId
        ? selectedDevice.isSimulated
        : (selectedDevice?.isSimulated ?? false),
  }));
  const targetDeviceId = targetScope.deviceId;
  const targetSimulated = targetScope.simulated;
  const [loaded, setLoaded] = useState<{
    key: string;
    detail: Awaited<ReturnType<typeof readHistoryDetail>>;
  } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const validRoute = Boolean(
    installationId &&
    targetDeviceId &&
    installationId === targetScope.installationId &&
    selectedDeviceId === targetDeviceId &&
    scopeRevision === targetScope.scopeRevision &&
    (routeDeviceId === undefined ||
      canonicalRouteDeviceId === targetDeviceId) &&
    typeof runId === "string" &&
    /^[0-9a-f-]{36}$/i.test(runId),
  );
  const requestKey = `${installationId ?? ""}:${selectedDeviceId ?? ""}:${scopeRevision}:${String(runId ?? "")}`;

  useEffect(() => {
    let active = true;
    if (
      !validRoute ||
      !installationId ||
      !targetDeviceId ||
      typeof runId !== "string"
    )
      return () => {
        active = false;
      };
    void readHistoryDetail(installationId, targetDeviceId, runId)
      .then((detail) => {
        if (active) setLoaded({ key: requestKey, detail });
      })
      .catch(() => {
        if (active) setFailedKey(requestKey);
      });
    return () => {
      active = false;
    };
  }, [
    installationId,
    requestKey,
    runId,
    scopeRevision,
    selectedDeviceId,
    targetDeviceId,
    targetScope,
    validRoute,
  ]);

  const detail = loaded?.key === requestKey ? loaded.detail : null;
  const record = detail?.record ?? null;
  const timezone = detail?.timezone ?? "UTC";
  const timezoneKnown = detail?.timezone_known ?? false;
  const error =
    !validRoute || failedKey === requestKey
      ? "This feeding record is not available for the selected feeder."
      : null;

  return (
    <AppPage>
      <BackAction label="Back to History" fallback="/history" />
      <PageHeading
        title="Feeding details"
        description="Saved result for the selected feeder."
      />
      {error ? (
        <BentoCard>
          <Text accessibilityRole="alert" style={Typography.body}>
            {error}
          </Text>
        </BentoCard>
      ) : null}
      {record ? (
        <>
          <BentoCard>
            <Text style={Typography.cardTitle}>
              {record.source === "manual" ? "Manual feed" : "Scheduled feed"} ·{" "}
              {record.status}
            </Text>
            <Text style={Typography.supporting}>
              {new Date(record.created_at).toLocaleString(undefined, {
                timeZone: timezone,
              })}{" "}
              ·{" "}
              {timezoneKnown
                ? timezone
                : `${timezone} · device timezone unavailable`}
            </Text>
            {record.reason_code ? (
              <Text style={Typography.supporting}>
                Reason: {record.reason_code}
              </Text>
            ) : null}
            {record.safety_lockout ? (
              <Text style={styles.warning}>
                A safety lockout is active. The feeder needs an in-person safety
                check.
              </Text>
            ) : null}
            {record.lockout_resolution ? (
              <Text style={Typography.supporting}>
                Maintenance recorded:{" "}
                {record.lockout_resolution.resolution_reason}. This does not
                change the unknown feed outcome.
              </Text>
            ) : null}
          </BentoCard>
          {record.nozzle_results.map((result) => {
            const requested =
              result.requested_dose.mode === "grams"
                ? `${result.requested_dose.amount_g} g requested`
                : `Portion ${result.requested_dose.fixed_portion_id} requested`;
            const measured =
              result.measurement_quality === "valid" &&
              result.measured_dispensed_g !== null
                ? targetSimulated
                  ? `${result.measured_dispensed_g} g synthetic simulator reading`
                  : `${result.measured_dispensed_g} g measured`
                : "Not measured";
            return (
              <BentoCard key={result.nozzle_number}>
                <Text style={Typography.cardTitle}>
                  Nozzle {result.nozzle_number} · {result.status}
                </Text>
                <Text style={Typography.body}>{requested}</Text>
                <Text style={Typography.supporting}>{measured}</Text>
                {result.estimated_dispensed_g !== null ? (
                  <Text style={Typography.supporting}>
                    Estimated {result.estimated_dispensed_g} g · simulator
                    estimate
                  </Text>
                ) : null}
              </BentoCard>
            );
          })}
          <Text style={styles.note}>
            {targetSimulated
              ? "Simulator values are deterministic test data, not physical weighing."
              : ""}{" "}
            This page only reads the saved result. Opening a link never starts a
            feed.
          </Text>
        </>
      ) : null}
    </AppPage>
  );
}

const styles = StyleSheet.create({
  warning: { ...Typography.supporting },
  note: { ...Typography.supporting, color: "#62626B" },
});
