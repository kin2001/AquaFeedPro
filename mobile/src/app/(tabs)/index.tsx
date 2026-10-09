import { router, useFocusEffect } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  AppPage,
  BentoCard,
  Button,
  EmptyState,
  LinkButton,
  PageHeading,
  StatusLabel,
} from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import { Colors, ControlSize, Spacing, Typography } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";
import { sameDeviceRequestScope } from "@/lib/device-access-state";
import {
  buildDoGraphSegments,
  freshnessAfterElapsed,
  graphForWindow,
  readDoGraph,
  readMonitoringSnapshot,
  type DoGraph,
  type GraphWindow,
  type MonitoringSnapshot,
} from "@/lib/monitoring";
import {
  readHistoryPage,
  type HistoryPage,
  type HistoryRecord,
} from "@/lib/manual-feed";
import {
  readConfiguration,
  readNextOccurrence,
  type ConfigurationRead,
  type NextOccurrence,
} from "@/lib/schedules";
import { supabase } from "@/lib/supabase";

type HomeData = {
  scopeKey: string;
  snapshotFetchedAtMonotonicMs: number | null;
  snapshot: MonitoringSnapshot | null;
  snapshotError: string | null;
  graphRequestedWindow: GraphWindow;
  graph: DoGraph | null;
  graphError: string | null;
  configuration: ConfigurationRead | null;
  configurationError: string | null;
  next: { timezone: string | null; occurrence: NextOccurrence | null } | null;
  nextError: string | null;
  history: HistoryPage | null;
  historyError: string | null;
};

const windows: GraphWindow[] = ["1h", "6h", "24h"];

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function sensorText(quality: string | undefined) {
  switch (quality) {
    case "uncalibrated":
      return "Sensor needs calibration";
    case "error":
      return "Sensor reported an error";
    case "unavailable":
      return "Reading unavailable";
    default:
      return "No reading yet";
  }
}

function gapText(reason: string | null | undefined) {
  switch (reason) {
    case "unsupported":
      return "DO sensor not supported";
    case "untrusted_time":
      return "Device time is untrusted";
    case "unavailable":
      return "Reading unavailable";
    case "uncalibrated":
      return "Calibration unavailable";
    case "error":
      return "Sensor error";
    default:
      return "No sample in this interval";
  }
}

function statusText(status: string) {
  const labels: Record<string, string> = {
    queued: "Queued",
    accepted: "Accepted",
    running: "In progress",
    completed: "Completed",
    partial: "Partial",
    failed: "Failed",
    rejected: "Rejected",
    expired: "Expired",
    unknown: "Unknown",
  };
  return labels[status] ?? status;
}

function doseText(
  dose:
    | { mode: "grams"; amount_g: number }
    | { mode: "fixed_portion"; fixed_portion_id: string },
) {
  return dose.mode === "grams"
    ? String(dose.amount_g) + " g"
    : "Fixed portion " + dose.fixed_portion_id;
}

function localTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function graphTime(value: string) {
  return (
    new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value)) + " UTC"
  );
}

function ageText(seconds: number | null) {
  if (seconds === null) return "age unavailable";
  if (seconds < 1) return "just now";
  return String(Math.floor(seconds)) + " seconds ago";
}

function graphPointText(point: DoGraph["samples"][number]) {
  const at = graphTime(point.measured_at ?? point.bucket_start);
  return point.do_mg_l === null
    ? "Gap: " + gapText(point.gap_reason) + " · " + at
    : String(point.do_mg_l) + " mg/L · " + at;
}

function Outcome({
  record,
  timezone,
  deviceId,
}: {
  record: HistoryRecord;
  timezone: string;
  deviceId: string;
}) {
  return (
    <View style={styles.outcome}>
      <Text style={Typography.cardTitle}>{statusText(record.status)}</Text>
      <Text style={[Typography.metadata, styles.secondary]}>
        {record.source === "scheduled" ? "Scheduled" : "Manual"} ·{" "}
        {localTime(record.created_at, timezone)}
      </Text>
      {record.targets.map((target) => {
        const result = record.nozzle_results.find(
          (item) => item.nozzle_number === target.nozzle_number,
        );
        const measurement =
          result?.measurement_quality === "valid" &&
          result.measured_dispensed_g !== null
            ? " · measured " + result.measured_dispensed_g + " g"
            : " · no measured amount";
        return (
          <Text key={target.nozzle_number} style={Typography.supporting}>
            Nozzle {target.nozzle_number}:{" "}
            {statusText(result?.status ?? record.status)}
            {measurement}
          </Text>
        );
      })}
      <LinkButton
        variant="text"
        href={{
          pathname: "/history/[runId]",
          params: { runId: record.sequence_id, device_id: deviceId },
        }}
      >
        View details
      </LinkButton>
    </View>
  );
}

export default function HomeScreen() {
  const access = useDeviceAccess();
  const device = access.selectedDevice;
  const deviceId = access.selectedDeviceId;
  const installationId = access.installationId;
  const currentScope = useMemo(
    () => ({
      installationId,
      revision: access.scopeRevision,
      selectedDeviceId: deviceId,
    }),
    [access.scopeRevision, deviceId, installationId],
  );
  const scopeRef = useRef(currentScope);
  const requestedWindowRef = useRef<GraphWindow>("1h");
  const [window, setWindow] = useState<GraphWindow>("1h");
  const [inspected, setInspected] = useState(0);
  const [plotWidth, setPlotWidth] = useState(0);
  const [monotonicNowMs, setMonotonicNowMs] = useState(() => performance.now());
  const [data, setData] = useState<HomeData | null>(null);
  const dataRef = useRef<HomeData | null>(null);
  useLayoutEffect(() => {
    scopeRef.current = currentScope;
    requestedWindowRef.current = window;
  }, [currentScope, window]);
  const scopeKey =
    String(installationId ?? "") +
    ":" +
    String(deviceId ?? "") +
    ":" +
    access.scopeRevision;
  const activeData = data?.scopeKey === scopeKey ? data : null;
  const sample = activeData?.snapshot?.latest_sample ?? null;
  const graph = graphForWindow(activeData?.graph, window);
  const graphError =
    activeData?.graphRequestedWindow === window ? activeData.graphError : null;
  const points = graph?.samples ?? [];
  const selectedIndex = Math.min(inspected, Math.max(0, points.length - 1));
  const selectedPoint = points[selectedIndex] ?? null;
  const validValues = points.flatMap((point) =>
    point.do_mg_l === null ? [] : [point.do_mg_l],
  );
  const applied = activeData?.configuration?.applied_snapshot;
  const limits = applied?.monitoring_limits;
  const axisMax = Math.max(
    10,
    Math.ceil(
      Math.max(
        0,
        ...validValues,
        limits?.do_low_mg_l ?? 0,
        limits?.do_high_mg_l ?? 0,
      ),
    ),
  );
  const elapsedSeconds =
    activeData?.snapshotFetchedAtMonotonicMs === null ||
    activeData?.snapshotFetchedAtMonotonicMs === undefined
      ? 0
      : Math.max(
          0,
          (monotonicNowMs - activeData.snapshotFetchedAtMonotonicMs) / 1000,
        );
  const contactAge =
    activeData?.snapshot?.contact.age_seconds === null ||
    activeData?.snapshot?.contact.age_seconds === undefined
      ? null
      : activeData.snapshot.contact.age_seconds + elapsedSeconds;
  const contactFreshness = activeData?.snapshot
    ? freshnessAfterElapsed(
        activeData.snapshot.contact.freshness,
        activeData.snapshot.contact.age_seconds,
        elapsedSeconds,
        activeData.snapshot.display_policy.device_offline_after_seconds,
      )
    : "unknown";
  const doFreshness =
    sample && activeData?.snapshot
      ? freshnessAfterElapsed(
          sample.do_freshness,
          sample.sample_age_seconds,
          elapsedSeconds,
          activeData.snapshot.display_policy.metric_outdated_after_seconds,
        )
      : "unknown";
  const feedFreshness =
    sample && activeData?.snapshot
      ? freshnessAfterElapsed(
          sample.feed_freshness,
          sample.sample_age_seconds,
          elapsedSeconds,
          activeData.snapshot.display_policy.metric_outdated_after_seconds,
        )
      : "unknown";
  const plotHeight = 180;
  const segments = buildDoGraphSegments(points, plotWidth, plotHeight, axisMax);
  const graphLimits = [
    limits?.do_low_mg_l === null || limits?.do_low_mg_l === undefined
      ? null
      : "configured low limit " + limits.do_low_mg_l + " mg/L",
    limits?.do_high_mg_l === null || limits?.do_high_mg_l === undefined
      ? null
      : "configured high limit " + limits.do_high_mg_l + " mg/L",
  ]
    .filter((value): value is string => value !== null)
    .join(" and ");
  const hasDoLimits =
    limits !== undefined &&
    (limits.do_low_mg_l !== null || limits.do_high_mg_l !== null);
  const doValue = sample?.do_quality === "valid" ? sample.do_mg_l : null;
  const sampleAge =
    sample?.sample_age_seconds === null ||
    sample?.sample_age_seconds === undefined
      ? null
      : sample.sample_age_seconds + elapsedSeconds;
  const freshDo = doValue !== null && doFreshness === "fresh";
  const outsideLimits =
    freshDo &&
    hasDoLimits &&
    ((limits?.do_low_mg_l !== null &&
      limits?.do_low_mg_l !== undefined &&
      doValue < limits.do_low_mg_l) ||
      (limits?.do_high_mg_l !== null &&
        limits?.do_high_mg_l !== undefined &&
        doValue > limits.do_high_mg_l));
  const withinLimits = freshDo && hasDoLimits && !outsideLimits;

  useFocusEffect(
    useCallback(() => {
      if (!deviceId || !installationId || !device) return;
      const scope = { ...currentScope };
      const requestedWindow = window;
      let active = true;
      let loading = false;
      let debounce: ReturnType<typeof setTimeout> | undefined;
      const isCurrent = () =>
        active &&
        sameDeviceRequestScope(scope, scopeRef.current) &&
        requestedWindow === requestedWindowRef.current;
      setMonotonicNowMs(performance.now());
      const clock = setInterval(() => {
        if (isCurrent()) setMonotonicNowMs(performance.now());
      }, 5_000);
      const load = async () => {
        if (loading || !isCurrent()) return;
        loading = true;
        const prior =
          dataRef.current?.scopeKey === scopeKey ? dataRef.current : null;
        const snapshotRequestedAt = performance.now();
        const results = await Promise.allSettled([
          readMonitoringSnapshot(installationId, deviceId),
          readDoGraph(installationId, deviceId, window),
          readConfiguration(installationId, deviceId),
          readNextOccurrence(installationId, deviceId),
          readHistoryPage(installationId, deviceId, {
            source: "all",
            status: "all",
          }),
        ]);
        if (isCurrent()) {
          const next: HomeData = {
            scopeKey,
            snapshotFetchedAtMonotonicMs:
              results[0].status === "fulfilled"
                ? snapshotRequestedAt
                : (prior?.snapshotFetchedAtMonotonicMs ?? null),
            snapshot:
              results[0].status === "fulfilled"
                ? results[0].value
                : (prior?.snapshot ?? null),
            snapshotError:
              results[0].status === "rejected"
                ? message(results[0].reason, "Monitoring could not be loaded.")
                : null,
            graphRequestedWindow: requestedWindow,
            graph:
              results[1].status === "fulfilled"
                ? results[1].value
                : prior?.graph?.window === window
                  ? prior.graph
                  : null,
            graphError:
              results[1].status === "rejected"
                ? message(
                    results[1].reason,
                    "The oxygen graph could not be loaded.",
                  )
                : null,
            configuration:
              results[2].status === "fulfilled"
                ? results[2].value
                : (prior?.configuration ?? null),
            configurationError:
              results[2].status === "rejected"
                ? message(
                    results[2].reason,
                    "Applied settings could not be checked.",
                  )
                : null,
            next:
              results[3].status === "fulfilled"
                ? results[3].value
                : (prior?.next ?? null),
            nextError:
              results[3].status === "rejected"
                ? message(
                    results[3].reason,
                    "The next applied feeding could not be loaded.",
                  )
                : null,
            history:
              results[4].status === "fulfilled"
                ? results[4].value
                : (prior?.history ?? null),
            historyError:
              results[4].status === "rejected"
                ? message(
                    results[4].reason,
                    "Recent feeding outcomes could not be loaded.",
                  )
                : null,
          };
          dataRef.current = next;
          setData(next);
        }
        loading = false;
      };
      const scheduleLoad = () => {
        if (!isCurrent()) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          debounce = undefined;
          if (isCurrent()) void load();
        }, 250);
      };
      void load();
      const channel = supabase
        .channel(
          "home-monitoring-" +
            deviceId +
            "-" +
            scope.revision +
            "-" +
            requestedWindow,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "device_telemetry",
            filter: "device_id=eq." + deviceId,
          },
          scheduleLoad,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "device_state",
            filter: "device_id=eq." + deviceId,
          },
          scheduleLoad,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "device_events",
            filter: "device_id=eq." + deviceId,
          },
          scheduleLoad,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "device_config_revisions",
            filter: "device_id=eq." + deviceId,
          },
          scheduleLoad,
        )
        .subscribe();
      const poll = setInterval(() => {
        if (AppState.currentState === "active") void load();
      }, 15_000);
      const appState = AppState.addEventListener("change", (state) => {
        if (state === "active" && isCurrent()) {
          setMonotonicNowMs(performance.now());
          void load();
        }
      });
      return () => {
        active = false;
        if (debounce) clearTimeout(debounce);
        clearInterval(poll);
        clearInterval(clock);
        appState.remove();
        void supabase.removeChannel(channel);
      };
    }, [currentScope, device, deviceId, installationId, scopeKey, window]),
  );

  const chooseWindow = (next: GraphWindow) => {
    setWindow(next);
    setInspected(0);
  };

  if (!device) {
    return (
      <AppPage edges={["top", "left", "right"]}>
        <PageHeading title="Home" />
        <DevicePicker />
        <EmptyState
          icon="waves"
          title="Pair a feeder to get started"
          description="Add a feeder from Device to connect it to this app."
        />
      </AppPage>
    );
  }

  const contact = activeData?.snapshot?.contact;
  const offline = contactFreshness === "stale";
  const contactText =
    contactFreshness === "fresh"
      ? "Online · last contact " + ageText(contactAge)
      : contactFreshness === "stale"
        ? "Offline · last contact " + ageText(contactAge)
        : contact
          ? "Contact time unknown"
          : "Contact not recorded";
  const feedSensor =
    activeData?.snapshot?.profile.capabilities.feed_remaining_monitoring ??
    device.capabilities.feedRemainingMonitoring;
  const doSensor =
    activeData?.snapshot?.profile.capabilities.do_monitoring ??
    device.capabilities.doMonitoring;
  const feedStatus = !feedSensor
    ? "No shared-container sensor is declared"
    : !sample
      ? offline
        ? "Feeder offline; inventory is unknown"
        : "No inventory sample yet"
      : sample.feed_quality !== "valid"
        ? sensorText(sample.feed_quality)
        : feedFreshness === "fresh"
          ? String(sample.feed_remaining_g) +
            " g remaining · " +
            String(sample.feed_percent) +
            "% · " +
            ageText(sampleAge)
          : "Last measured " +
            sample.feed_remaining_g +
            " g · " +
            sample.feed_percent +
            "% · " +
            ageText(sampleAge) +
            (feedFreshness === "stale"
              ? " (outdated)"
              : " (freshness unknown)");
  const doStatus = !doSensor
    ? "This feeder has no DO sensor"
    : !sample
      ? offline
        ? "Feeder offline; oxygen reading is unknown"
        : "No oxygen sample yet"
      : sample.do_quality !== "valid"
        ? sensorText(sample.do_quality)
        : doFreshness === "fresh"
          ? "Latest reading · " + ageText(sampleAge)
          : "Last measured " +
            sample.do_mg_l +
            " mg/L · " +
            ageText(sampleAge) +
            (doFreshness === "stale" ? " (outdated)" : " (freshness unknown)");
  const nozzles = activeData?.next?.occurrence?.targets ?? [];
  const historyRows = activeData?.history?.records.slice(0, 3) ?? [];
  const historyTimezone = activeData?.history?.timezone ?? "UTC";
  const inspectPoint = (index: number, announce = true) => {
    const nextIndex = Math.min(Math.max(0, index), points.length - 1);
    setInspected(nextIndex);
    if (announce && points[nextIndex])
      AccessibilityInfo.announceForAccessibility(
        graphPointText(points[nextIndex]),
      );
  };
  const inspectAt = (x: number, announce = true) => {
    if (plotWidth <= 0 || points.length === 0) return;
    inspectPoint(
      Math.round(
        (Math.max(0, Math.min(plotWidth, x)) / plotWidth) * (points.length - 1),
      ),
      announce,
    );
  };

  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading title="Home" />
      <DevicePicker />
      <BentoCard>
        <Text style={Typography.cardTitle}>
          {device.alias?.trim() || device.model}
        </Text>
        <StatusLabel
          kind={
            contactFreshness === "fresh"
              ? "online"
              : contactFreshness === "stale"
                ? "offline"
                : "outdated"
          }
        >
          {contactText}
        </StatusLabel>
        {device.isSimulated || activeData?.snapshot?.profile.is_simulated ? (
          <Text style={[Typography.metadata, styles.secondary]}>
            Simulator data · not a hardware measurement
          </Text>
        ) : null}
        {activeData?.snapshotError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {activeData.snapshotError}
          </Text>
        ) : null}
      </BentoCard>

      <BentoCard>
        <Text style={Typography.cardTitle}>Dissolved oxygen</Text>
        <Text accessibilityRole="text" style={Typography.reading}>
          {doValue === null ? "—" : String(doValue) + " mg/L"}
        </Text>
        <Text style={Typography.supporting}>{doStatus}</Text>
        {withinLimits ? (
          <StatusLabel kind="completed">Within configured limits</StatusLabel>
        ) : null}
        {outsideLimits ? (
          <StatusLabel kind="warning">Outside configured limits</StatusLabel>
        ) : null}
        {!applied ? (
          <Text style={[Typography.metadata, styles.secondary]}>
            Applied DO limits are unavailable.
          </Text>
        ) : hasDoLimits ? (
          <Text style={[Typography.metadata, styles.secondary]}>
            Dashed graph limits come from applied settings only.
          </Text>
        ) : (
          <Text style={[Typography.metadata, styles.secondary]}>
            No applied DO limits are set.
          </Text>
        )}
        {activeData?.snapshot?.display_policy ? (
          <Text style={[Typography.metadata, styles.secondary]}>
            Display policy: contact 45 seconds; readings 30 seconds. Planning
            defaults, not hardware guarantees.
          </Text>
        ) : null}
        <View
          style={styles.windowChoices}
          accessibilityRole="radiogroup"
          accessibilityLabel="Graph time window"
        >
          {windows.map((choice) => (
            <Pressable
              key={choice}
              accessibilityRole="radio"
              accessibilityState={{ checked: choice === window }}
              onPress={() => chooseWindow(choice)}
              style={[
                styles.windowChoice,
                choice === window && styles.windowSelected,
              ]}
            >
              <Text style={Typography.supporting}>{choice.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        {graphError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {graphError}{" "}
            {graph
              ? "The displayed graph is still for the selected range."
              : "No graph for this range is available; the latest value above remains separate."}
          </Text>
        ) : null}
        {graph && points.length ? (
          <>
            <Text style={Typography.metadata}>
              Dissolved oxygen (mg/L) · time in UTC
            </Text>
            <View style={styles.graphRow}>
              <View style={styles.axisLabels}>
                <Text style={styles.axisText}>{axisMax} mg/L</Text>
                <Text style={styles.axisText}>
                  {Math.round(axisMax / 2)} mg/L
                </Text>
                <Text style={styles.axisText}>0</Text>
              </View>
              <View
                accessible
                accessibilityRole="image"
                accessibilityLabel={`${window.toUpperCase()} dissolved oxygen graph, ${graph.valid_sample_count} valid samples, ${graph.gap_count} visible gaps, vertical scale from 0 to ${axisMax} mg/L, UTC time from ${graphTime(graph.window_start)} to ${graphTime(graph.window_end)}${graphLimits ? ". " + graphLimits : ""}. Use the previous and next point controls to inspect values.`}
                onLayout={(event) =>
                  setPlotWidth(event.nativeEvent.layout.width)
                }
                onStartShouldSetResponder={() => true}
                onResponderGrant={(event) =>
                  inspectAt(event.nativeEvent.locationX, false)
                }
                onResponderMove={(event) =>
                  inspectAt(event.nativeEvent.locationX, false)
                }
                onResponderRelease={(event) =>
                  inspectAt(event.nativeEvent.locationX)
                }
                style={styles.plot}
              >
                <View style={[styles.gridLine, { top: 0 }]} />
                <View style={[styles.gridLine, { top: plotHeight / 2 }]} />
                {limits?.do_low_mg_l !== null &&
                limits?.do_low_mg_l !== undefined ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                      styles.limitLine,
                      {
                        top: Math.min(
                          plotHeight - 1,
                          plotHeight * (1 - limits.do_low_mg_l / axisMax),
                        ),
                      },
                    ]}
                  />
                ) : null}
                {limits?.do_high_mg_l !== null &&
                limits?.do_high_mg_l !== undefined ? (
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                      styles.limitLine,
                      {
                        top: Math.min(
                          plotHeight - 1,
                          plotHeight * (1 - limits.do_high_mg_l / axisMax),
                        ),
                      },
                    ]}
                  />
                ) : null}
                {segments.map((segment, index) => (
                  <View
                    key={"line-" + index}
                    style={[
                      styles.line,
                      {
                        left: segment.left,
                        top: segment.top - 1,
                        width: segment.width,
                        transform: [{ rotate: `${segment.angle}rad` }],
                      },
                    ]}
                  />
                ))}
                {points.map((point, index) => {
                  const x =
                    points.length < 2
                      ? plotWidth / 2
                      : (index * plotWidth) / (points.length - 1);
                  if (point.do_mg_l === null)
                    return (
                      <View
                        key={point.bucket_start + "-" + index}
                        style={[styles.gapMarker, { left: x - 1.5 }]}
                      />
                    );
                  const y = Math.max(
                    0,
                    Math.min(
                      plotHeight - 6,
                      plotHeight * (1 - point.do_mg_l / axisMax) - 3,
                    ),
                  );
                  return (
                    <View
                      key={point.bucket_start + "-" + index}
                      style={[styles.point, { left: x - 3, top: y }]}
                    />
                  );
                })}
              </View>
            </View>
            <View style={styles.axisEnds}>
              <Text style={[styles.axisText, styles.axisStart]}>
                {graphTime(graph.window_start)}
              </Text>
              <Text style={[styles.axisText, styles.axisEnd]}>
                {graphTime(graph.window_end)}
              </Text>
            </View>
            {hasDoLimits ? (
              <View style={styles.limitLegend}>
                {limits?.do_low_mg_l !== null &&
                limits?.do_low_mg_l !== undefined ? (
                  <View style={styles.limitLegendItem}>
                    <View style={styles.limitLegendLine} />
                    <Text style={styles.axisText}>
                      Low {limits.do_low_mg_l} mg/L
                    </Text>
                  </View>
                ) : null}
                {limits?.do_high_mg_l !== null &&
                limits?.do_high_mg_l !== undefined ? (
                  <View style={styles.limitLegendItem}>
                    <View style={styles.limitLegendLine} />
                    <Text style={styles.axisText}>
                      High {limits.do_high_mg_l} mg/L
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {selectedPoint ? (
              <View style={styles.inspection}>
                <Text style={Typography.cardTitle}>
                  {selectedPoint.do_mg_l === null
                    ? "Gap: " + gapText(selectedPoint.gap_reason)
                    : String(selectedPoint.do_mg_l) + " mg/L"}
                </Text>
                <Text style={Typography.supporting}>
                  {graphTime(
                    selectedPoint.measured_at ?? selectedPoint.bucket_start,
                  )}
                  {selectedPoint.measured_at ? "" : " interval"}
                </Text>
              </View>
            ) : null}
            <View style={styles.inspectActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Inspect previous graph point"
                accessibilityState={{ disabled: selectedIndex <= 0 }}
                disabled={selectedIndex <= 0}
                onPress={() => inspectPoint(selectedIndex - 1)}
                style={styles.inspectButton}
              >
                <Text style={Typography.supporting}>Previous point</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Inspect next graph point"
                accessibilityState={{
                  disabled: selectedIndex >= points.length - 1,
                }}
                disabled={selectedIndex >= points.length - 1}
                onPress={() => inspectPoint(selectedIndex + 1)}
                style={styles.inspectButton}
              >
                <Text style={Typography.supporting}>Next point</Text>
              </Pressable>
            </View>
          </>
        ) : graph ? (
          <Text style={Typography.supporting}>
            No historical intervals are available in this range. The latest
            reading remains above.
          </Text>
        ) : graphError ? (
          <Text style={Typography.supporting}>
            No {window.toUpperCase()} graph is available yet.
          </Text>
        ) : (
          <Text style={Typography.supporting}>
            Loading {window.toUpperCase()} oxygen history…
          </Text>
        )}
        {graph?.invalid_time_sample_count ? (
          <Text style={Typography.supporting}>
            {graph.invalid_time_sample_count} sample(s) with invalid or
            uncertain device time were counted separately.
          </Text>
        ) : null}
      </BentoCard>

      <BentoCard>
        <Text style={Typography.cardTitle}>Shared container</Text>
        <Text style={Typography.supporting}>
          One remaining-feed measurement is shared by Nozzle 1 and Nozzle 2.
        </Text>
        <Text accessibilityRole="text" style={Typography.reading}>
          {feedSensor && sample?.feed_quality === "valid"
            ? sample.feed_percent === 0
              ? "0%"
              : String(sample.feed_percent) + "%"
            : "Unknown"}
        </Text>
        {feedSensor &&
        sample?.feed_quality === "valid" &&
        typeof sample.feed_percent === "number" ? (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Shared-container feed remaining"
            accessibilityValue={{
              min: 0,
              max: 100,
              now: sample.feed_percent,
              text:
                String(sample.feed_percent) +
                "% remaining, " +
                (feedFreshness === "fresh"
                  ? "fresh"
                  : feedFreshness === "stale"
                    ? "outdated"
                    : "age unknown"),
            }}
            style={styles.feedProgress}
          >
            <View
              style={[
                styles.feedProgressFill,
                { width: `${sample.feed_percent}%` },
              ]}
            />
          </View>
        ) : null}
        <Text style={Typography.supporting}>{feedStatus}</Text>
      </BentoCard>

      <BentoCard>
        <Text style={Typography.cardTitle}>Next applied feeding</Text>
        {activeData?.nextError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {activeData.nextError}
          </Text>
        ) : null}
        {activeData?.next?.occurrence ? (
          <>
            <Text style={Typography.supporting}>
              {localTime(
                activeData.next.occurrence.at,
                activeData.next.timezone ?? activeData.next.occurrence.timezone,
              )}{" "}
              ·{" "}
              {activeData.next.timezone ?? activeData.next.occurrence.timezone}
            </Text>
            {nozzles.map((target) => (
              <Text key={target.schedule_id} style={Typography.supporting}>
                Nozzle {target.nozzle_number}: {doseText(target.dose)}
              </Text>
            ))}
          </>
        ) : (
          <Text style={Typography.supporting}>
            {activeData?.next
              ? "No upcoming applied feeding."
              : "Applied schedule is not available yet."}
          </Text>
        )}
        {activeData?.configuration?.current_state.last_attempt_status ===
        "pending" ? (
          <StatusLabel kind="pending">
            {"Configuration revision " +
              String(
                activeData.configuration.current_state.last_attempt_revision,
              ) +
              " is pending"}
          </StatusLabel>
        ) : null}
        {activeData?.configuration?.current_state.last_attempt_status ===
        "rejected" ? (
          <StatusLabel kind="warning">
            Latest settings were rejected; the prior applied revision remains
            active
          </StatusLabel>
        ) : null}
        {activeData?.configurationError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {activeData.configurationError}
          </Text>
        ) : null}
        <LinkButton variant="text" href="/(tabs)/schedule">
          View schedule
        </LinkButton>
      </BentoCard>

      <BentoCard>
        <Text style={Typography.cardTitle}>Manual feeding</Text>
        <Text style={Typography.supporting}>
          Start a feeding on {device.alias?.trim() || device.model}.
        </Text>
        <Button icon="utensils" onPress={() => router.push("/feed/confirm")}>
          Feed now
        </Button>
      </BentoCard>

      <BentoCard>
        <Text style={Typography.cardTitle}>Recent feeding outcomes</Text>
        {activeData?.historyError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {activeData.historyError}
          </Text>
        ) : null}
        {historyRows.length ? (
          historyRows.map((record) => (
            <Outcome
              key={record.sequence_id}
              record={record}
              timezone={historyTimezone}
              deviceId={device.deviceId}
            />
          ))
        ) : (
          <Text style={Typography.supporting}>
            {activeData?.history
              ? "No feeding outcomes recorded yet."
              : "Feeding history is loading."}
          </Text>
        )}
        <LinkButton variant="text" href="/(tabs)/history">
          View all history
        </LinkButton>
      </BentoCard>
    </AppPage>
  );
}

const styles = StyleSheet.create({
  secondary: { color: Colors.light.textSecondary },
  error: { ...Typography.supporting, color: Colors.light.text },
  outcome: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  windowChoices: { flexDirection: "row", gap: Spacing.two },
  windowChoice: {
    flex: 1,
    minHeight: ControlSize.minimumTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
  },
  windowSelected: {
    backgroundColor: Colors.light.backgroundSelected,
    borderColor: Colors.light.controlBorder,
  },
  feedProgress: {
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    backgroundColor: Colors.light.progressTrack,
  },
  feedProgressFill: { height: "100%", backgroundColor: Colors.light.primary },
  graphRow: { flexDirection: "row", gap: Spacing.two },
  axisLabels: {
    width: 52,
    height: 180,
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  axisText: { ...Typography.metadata, color: Colors.light.textSecondary },
  plot: {
    flex: 1,
    height: 180,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.chartGrid,
    overflow: "hidden",
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.chartGrid,
  },
  limitLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderBottomWidth: 1,
    borderStyle: "dashed",
    borderBottomColor: Colors.light.textSecondary,
  },
  line: {
    position: "absolute",
    height: 2,
    backgroundColor: Colors.light.chartLine,
  },
  point: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.light.chartLine,
  },
  gapMarker: {
    position: "absolute",
    bottom: 0,
    width: 3,
    height: 8,
    backgroundColor: Colors.light.controlBorder,
  },
  axisEnds: { flexDirection: "row", paddingLeft: 60, gap: Spacing.one },
  axisStart: { flex: 1, textAlign: "left" },
  axisEnd: { flex: 1, textAlign: "right" },
  limitLegend: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  limitLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  limitLegendLine: {
    width: 20,
    borderBottomWidth: 1,
    borderStyle: "dashed",
    borderBottomColor: Colors.light.textSecondary,
  },
  inspection: {
    padding: Spacing.two,
    backgroundColor: Colors.light.surfaceMuted,
    borderRadius: 12,
    gap: Spacing.one,
  },
  inspectActions: { flexDirection: "row", gap: Spacing.two },
  inspectButton: {
    flex: 1,
    minHeight: ControlSize.minimumTarget,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.two,
  },
});
