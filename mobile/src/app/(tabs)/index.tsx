import { Lucide, type LucideIconName } from "@react-native-vector-icons/lucide";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  AppIcon,
  AppPage,
  BentoCard,
  Button,
  EmptyState,
  IconButton,
  ListRow,
  Notice,
  ProgressBar,
  ScreenHeader,
  SectionHeader,
  Segmented,
  Skeleton,
  Stat,
  StatusLabel,
  statusIcons,
} from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import {
  clockParts,
  relativeDayLabel,
  statusKind,
  statusText,
} from "@/components/feed-status";
import {
  Colors,
  ControlSize,
  IconSize,
  Radii,
  Typography,
} from "@/constants/theme";
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
import { readHistoryPage, type HistoryPage } from "@/lib/manual-feed";
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

function activityTime(value: string, timezone: string) {
  const date = new Date(value);
  return (
    relativeDayLabel(date, timezone) +
    ", " +
    new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      timeStyle: "short",
    }).format(date)
  );
}

function DecorativeIcon({
  name,
  color,
}: {
  name: LucideIconName;
  color: string;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Lucide name={name} size={IconSize.default} color={color} />
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
  const [aboutOpen, setAboutOpen] = useState(false);
  const { fontScale, width } = useWindowDimensions();
  const stackTiles = fontScale > 1.3 || width < 360;
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
  const plotHeight = 144;
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
        <View style={styles.group}>
          <ScreenHeader title="Home" action={<AppIcon size={32} />} />
          <DevicePicker />
        </View>
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

  const pointX = (index: number) =>
    points.length < 2
      ? plotWidth / 2
      : (index * plotWidth) / (points.length - 1);
  const limitLines = (
    [
      ["Low", limits?.do_low_mg_l],
      ["High", limits?.do_high_mg_l],
    ] as const
  ).flatMap(([name, value]) =>
    value === null || value === undefined
      ? []
      : [
          {
            name,
            value,
            top: Math.min(plotHeight - 1, plotHeight * (1 - value / axisMax)),
          },
        ],
  );
  const feedPercent =
    feedSensor &&
    sample?.feed_quality === "valid" &&
    typeof sample.feed_percent === "number"
      ? sample.feed_percent
      : null;
  const occurrence = activeData?.next?.occurrence ?? null;
  const nextZone = occurrence
    ? (activeData?.next?.timezone ?? occurrence.timezone)
    : null;
  const nextAt = occurrence ? new Date(occurrence.at) : null;
  const nextClock = nextAt && nextZone ? clockParts(nextAt, nextZone) : null;
  const lastAttempt = activeData?.configuration?.current_state;
  const deviceName = device.alias?.trim() || device.model;

  return (
    <AppPage edges={["top", "left", "right"]}>
      <View style={styles.group}>
        <ScreenHeader title="Home" action={<AppIcon size={32} />} />
        <DevicePicker />
        <View style={styles.pills}>
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
            <StatusLabel kind="simulator">
              Simulator data · not a hardware measurement
            </StatusLabel>
          ) : null}
        </View>
        {activeData?.snapshotError ? (
          <Notice tone="error">{activeData.snapshotError}</Notice>
        ) : null}
        {lastAttempt?.last_attempt_status === "pending" ? (
          <Notice tone="pending">
            {"Configuration revision " +
              String(lastAttempt.last_attempt_revision) +
              " is pending"}
          </Notice>
        ) : null}
        {lastAttempt?.last_attempt_status === "rejected" ? (
          <Notice tone="warning">
            Latest settings were rejected; the prior applied revision remains
            active
          </Notice>
        ) : null}
        {activeData?.configurationError ? (
          <Notice tone="error">{activeData.configurationError}</Notice>
        ) : null}
        {activeData?.nextError ? (
          <Notice tone="error">{activeData.nextError}</Notice>
        ) : null}
      </View>

      <View style={styles.group}>
        <BentoCard gap={0} style={styles.doCard}>
          <View style={styles.doHeader}>
            <View style={styles.doTitle}>
              <DecorativeIcon name="waves" color={Colors.light.textTertiary} />
              <Text accessibilityRole="header" style={Typography.overline}>
                Dissolved oxygen
              </Text>
            </View>
            {withinLimits ? (
              <StatusLabel kind="completed">Within limits</StatusLabel>
            ) : outsideLimits ? (
              <StatusLabel kind="warning">Outside limits</StatusLabel>
            ) : doValue !== null && doFreshness === "stale" ? (
              <StatusLabel kind="outdated">Outdated</StatusLabel>
            ) : null}
          </View>
          <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={
              doValue === null
                ? "Dissolved oxygen unavailable"
                : doValue + " milligrams per litre"
            }
            style={styles.reading}
          >
            <Text style={Typography.display}>
              {doValue === null ? "—" : String(doValue)}
            </Text>
            {doValue !== null ? (
              <Text style={Typography.unit}>mg/L</Text>
            ) : null}
          </View>
          <Text style={[Typography.supporting, styles.doStatus]}>
            {doStatus}
          </Text>
          <View style={styles.range}>
            <Segmented
              accessibilityLabel="Graph time window"
              value={window}
              onChange={chooseWindow}
              options={windows.map((choice) => ({
                value: choice,
                label: choice.toUpperCase(),
              }))}
            />
          </View>
          {graphError ? (
            <View style={styles.graphError}>
              <Notice tone="error">
                {graphError +
                  " " +
                  (graph
                    ? "The displayed graph is still for the selected range."
                    : "No graph for this range is available; the latest value above remains separate.")}
              </Notice>
            </View>
          ) : null}
          {graph && points.length ? (
            <>
              <View style={styles.chart}>
                <View style={styles.graphRow}>
                  <View
                    style={[styles.axisLabels, { height: plotHeight + 16 }]}
                  >
                    <Text style={Typography.metadata}>{axisMax} mg/L</Text>
                    <Text style={Typography.metadata}>
                      {Math.round(axisMax / 2)}
                    </Text>
                    <Text style={Typography.metadata}>0</Text>
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
                    style={[styles.plot, { height: plotHeight }]}
                  >
                    <View style={[styles.gridLine, { top: 0 }]} />
                    <View style={[styles.gridLine, { top: plotHeight / 2 }]} />
                    {limitLines.map((line) => (
                      <View
                        key={line.name}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        pointerEvents="none"
                        style={styles.limitMark}
                      >
                        <View style={[styles.limitLine, { top: line.top }]} />
                        <Text
                          style={[
                            styles.limitLabel,
                            {
                              top:
                                line.top + 20 > plotHeight
                                  ? line.top - 20
                                  : line.top + 4,
                            },
                          ]}
                        >
                          {line.name + " limit " + line.value + " mg/L"}
                        </Text>
                      </View>
                    ))}
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
                    {points.map((point, index) =>
                      point.do_mg_l === null ? null : (
                        <View
                          key={point.bucket_start + "-" + index}
                          style={[
                            styles.point,
                            {
                              left: pointX(index) - 2.5,
                              top: Math.max(
                                0,
                                Math.min(
                                  plotHeight - 5,
                                  plotHeight * (1 - point.do_mg_l / axisMax) -
                                    2.5,
                                ),
                              ),
                            },
                          ]}
                        />
                      ),
                    )}
                    {selectedPoint ? (
                      <View
                        style={[styles.cursor, { left: pointX(selectedIndex) }]}
                      />
                    ) : null}
                    {selectedPoint && selectedPoint.do_mg_l !== null ? (
                      <View
                        style={[
                          styles.marker,
                          {
                            left: pointX(selectedIndex) - 6,
                            top:
                              plotHeight *
                                (1 - selectedPoint.do_mg_l / axisMax) -
                              6,
                          },
                        ]}
                      />
                    ) : null}
                  </View>
                </View>
                <View style={styles.axisEnds}>
                  <Text style={[Typography.metadata, styles.axisStart]}>
                    {graphTime(graph.window_start)}
                  </Text>
                  <Text style={[Typography.metadata, styles.axisEnd]}>
                    {graphTime(graph.window_end)}
                  </Text>
                </View>
              </View>
              {selectedPoint ? (
                <View style={styles.inspection}>
                  <IconButton
                    icon="chevron-left"
                    radius={Radii.segment}
                    accessibilityLabel="Inspect previous graph point"
                    disabled={selectedIndex <= 0}
                    onPress={() => inspectPoint(selectedIndex - 1)}
                  />
                  <View style={styles.inspectCenter}>
                    <View style={styles.inspectValueRow}>
                      <Text style={styles.inspectValue}>
                        {selectedPoint.do_mg_l === null
                          ? "Gap: " + gapText(selectedPoint.gap_reason)
                          : String(selectedPoint.do_mg_l)}
                      </Text>
                      {selectedPoint.do_mg_l === null ? null : (
                        <Text style={styles.inspectUnit}>mg/L</Text>
                      )}
                    </View>
                    <Text style={styles.inspectTime}>
                      {graphTime(
                        selectedPoint.measured_at ?? selectedPoint.bucket_start,
                      ) + (selectedPoint.measured_at ? "" : " interval")}
                    </Text>
                  </View>
                  <IconButton
                    icon="chevron-right"
                    radius={Radii.segment}
                    accessibilityLabel="Inspect next graph point"
                    disabled={selectedIndex >= points.length - 1}
                    onPress={() => inspectPoint(selectedIndex + 1)}
                  />
                </View>
              ) : null}
            </>
          ) : graph ? (
            <Text style={[Typography.supporting, styles.graphNote]}>
              No historical intervals are available in this range. The latest
              reading remains above.
            </Text>
          ) : graphError ? (
            <Text style={[Typography.supporting, styles.graphNote]}>
              No {window.toUpperCase()} graph is available yet.
            </Text>
          ) : (
            <View style={styles.graphNote}>
              <Skeleton height={168} />
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: aboutOpen }}
            onPress={() => setAboutOpen((open) => !open)}
            android_ripple={{ color: Colors.light.rippleOnSurface }}
            style={styles.about}
          >
            <Text style={styles.aboutLabel}>About this reading</Text>
            <DecorativeIcon
              name={aboutOpen ? "chevron-up" : "chevron-down"}
              color={Colors.light.textSecondary}
            />
          </Pressable>
          {aboutOpen ? (
            <View style={styles.aboutBody}>
              <Text style={Typography.supporting}>
                {!applied
                  ? "Applied DO limits are unavailable."
                  : hasDoLimits
                    ? "Dashed graph limits come from applied settings only."
                    : "No applied DO limits are set."}
              </Text>
              {activeData?.snapshot?.display_policy ? (
                <Text style={Typography.supporting}>
                  Display policy: contact 45 seconds; readings 30 seconds.
                  Planning defaults, not hardware guarantees.
                </Text>
              ) : null}
              {graph?.invalid_time_sample_count ? (
                <Text style={Typography.supporting}>
                  {graph.invalid_time_sample_count} sample(s) with invalid or
                  uncertain device time were counted separately.
                </Text>
              ) : null}
            </View>
          ) : null}
        </BentoCard>

        <View style={[styles.tiles, stackTiles && styles.tilesStacked]}>
          <Stat
            icon="container"
            label="Feed"
            value={feedPercent === null ? "—" : String(feedPercent)}
            unit={feedPercent === null ? undefined : "%"}
            captions={[feedStatus, "Shared by Nozzle 1 and Nozzle 2"]}
            accessibilityLabel={"Feed remaining. " + feedStatus}
            style={stackTiles ? undefined : styles.tile}
          >
            {feedPercent === null ? null : (
              <ProgressBar
                value={feedPercent}
                accessibilityLabel="Shared-container feed remaining"
                accessibilityText={
                  String(feedPercent) +
                  "% remaining, " +
                  (feedFreshness === "fresh"
                    ? "fresh"
                    : feedFreshness === "stale"
                      ? "outdated"
                      : "age unknown")
                }
              />
            )}
          </Stat>
          <Stat
            icon="calendar-clock"
            label="Next"
            value={nextClock ? nextClock.time : "—"}
            unit={nextClock?.period || undefined}
            captions={
              occurrence && nextAt && nextZone
                ? [
                    relativeDayLabel(nextAt, nextZone) + " · " + nextZone,
                    ...nozzles.map(
                      (target) =>
                        "Nozzle " +
                        target.nozzle_number +
                        " · " +
                        doseText(target.dose),
                    ),
                    nozzles.length === 2 && "Nozzle 1, then Nozzle 2",
                  ]
                : [
                    activeData?.next
                      ? "No upcoming applied feeding."
                      : "Applied schedule is not available yet.",
                  ]
            }
            onPress={() => router.push("/(tabs)/schedule")}
            accessibilityLabel="Next applied feeding. Opens Schedule."
            style={stackTiles ? undefined : styles.tile}
          />
        </View>

        <BentoCard tone="inverse" gap={0}>
          <View style={styles.manualHeader}>
            <DecorativeIcon name="utensils" color={Colors.light.onInk} />
            <Text
              accessibilityRole="header"
              style={[Typography.cardTitle, { color: Colors.light.onInk }]}
            >
              Manual feeding
            </Text>
          </View>
          <Text style={[Typography.supporting, styles.manualText]}>
            Start a feeding on {deviceName}.
          </Text>
          <View style={styles.manualAction}>
            <Button
              variant="inverse"
              onPress={() => router.push("/feed/confirm")}
            >
              Feed now
            </Button>
          </View>
        </BentoCard>
      </View>

      <View style={styles.recent}>
        <SectionHeader
          title="Recent activity"
          action={{
            label: "View all",
            onPress: () => router.push("/(tabs)/history"),
          }}
        />
        {activeData?.historyError ? (
          <Notice tone="error">{activeData.historyError}</Notice>
        ) : null}
        {historyRows.length ? (
          <BentoCard flush>
            {historyRows.map((record, index) => (
              <ListRow
                key={record.sequence_id}
                divider={index > 0}
                icon={statusIcons[statusKind(record.status)]}
                title={
                  record.source === "scheduled"
                    ? "Scheduled feeding"
                    : "Manual feeding"
                }
                lines={[
                  statusText(record.status) +
                    " · " +
                    activityTime(record.created_at, historyTimezone),
                  ...record.targets.map((target) => {
                    const result = record.nozzle_results.find(
                      (item) => item.nozzle_number === target.nozzle_number,
                    );
                    const measurement =
                      result?.measurement_quality === "valid" &&
                      result.measured_dispensed_g !== null
                        ? " · measured " + result.measured_dispensed_g + " g"
                        : " · no measured amount";
                    return (
                      "Nozzle " +
                      target.nozzle_number +
                      ": " +
                      statusText(result?.status ?? record.status) +
                      measurement
                    );
                  }),
                ]}
                trailing="chevron"
                onPress={() =>
                  router.push({
                    pathname: "/history/[runId]",
                    params: {
                      runId: record.sequence_id,
                      device_id: device.deviceId,
                    },
                  })
                }
              />
            ))}
          </BentoCard>
        ) : activeData?.history ? (
          <Text style={Typography.supporting}>
            No feeding outcomes recorded yet.
          </Text>
        ) : (
          <View style={styles.recent}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </View>
        )}
      </View>
    </AppPage>
  );
}

const styles = StyleSheet.create({
  group: { gap: 12 },
  recent: { gap: 8 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  doCard: { paddingBottom: 2 },
  doHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 28,
  },
  doTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  reading: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  doStatus: { marginTop: 4 },
  range: { marginTop: 16 },
  graphError: { marginTop: 12 },
  graphNote: { marginTop: 16 },
  chart: { marginTop: 16, paddingTop: 8 },
  graphRow: { flexDirection: "row", gap: 8 },
  axisLabels: {
    width: 44,
    marginVertical: -8,
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  plot: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.chartGrid,
    overflow: "visible",
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.chartGrid,
  },
  limitMark: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  limitLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderBottomWidth: 1,
    borderStyle: "dashed",
    borderBottomColor: Colors.light.textSecondary,
  },
  limitLabel: {
    ...Typography.metadata,
    position: "absolute",
    left: 4,
    color: Colors.light.textSecondary,
  },
  line: {
    position: "absolute",
    height: 2,
    backgroundColor: Colors.light.chartLine,
  },
  point: {
    position: "absolute",
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.light.chartLine,
  },
  cursor: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: Colors.light.ink,
  },
  marker: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.light.surface,
    borderWidth: 2,
    borderColor: Colors.light.ink,
  },
  axisEnds: { flexDirection: "row", marginTop: 8, paddingLeft: 52 },
  axisStart: { flex: 1, textAlign: "left" },
  axisEnd: { flex: 1, textAlign: "right" },
  inspection: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 4,
    backgroundColor: Colors.light.surfaceMuted,
    borderRadius: Radii.control,
  },
  inspectCenter: { flex: 1, alignItems: "center" },
  inspectValueRow: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  inspectValue: {
    ...Typography.cardTitle,
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
    textAlign: "center",
  },
  inspectUnit: { ...Typography.label, color: Colors.light.textSecondary },
  inspectTime: {
    ...Typography.metadata,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  about: {
    marginTop: 8,
    minHeight: ControlSize.minimumTarget,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  aboutLabel: {
    ...Typography.button,
    color: Colors.light.ink,
    flexShrink: 1,
  },
  aboutBody: { gap: 4, paddingBottom: 14 },
  tiles: { flexDirection: "row", gap: 12 },
  tilesStacked: { flexDirection: "column" },
  tile: { flex: 1, minWidth: 0 },
  manualHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  manualText: { color: Colors.light.onInkSecondary, marginTop: 4 },
  manualAction: { marginTop: 16 },
});
