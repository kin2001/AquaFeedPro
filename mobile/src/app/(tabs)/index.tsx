import { Lucide, type LucideIconName } from "@react-native-vector-icons/lucide";
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
import Svg, { Circle, Path } from "react-native-svg";
import {
  AnimatedNumber,
  Motion,
  MotionSection,
  MotionPressable,
  useEntryProgress,
} from "@/components/motion";

import {
  AppPage,
  BentoCard,
  DropdownPill,
  EmptyState,
  FeedingRow,
  Button,
  IconButton,
  ListRow,
  Notice,
  ProgressBar,
  ScreenHeader,
  SectionHeader,
  Sheet,
  Skeleton,
  StatusLabel,
} from "@/components/app-shell";
import {
  agoText,
  clockParts,
  relativeDayLabel,
} from "@/components/feed-status";
import { Colors, IconSize, Typography } from "@/constants/theme";
import { useUnreadCount } from "@/lib/alerts";
import { useDeviceAccess } from "@/lib/device-access";
import {
  useDeviceUpdates,
  type DeviceUpdateReadContext,
} from "@/lib/device-updates";
import { sameDeviceRequestScope } from "@/lib/device-access-state";
import { errorText } from "@/lib/error-text";
import {
  buildDoGraphShape,
  feedCapacityForDisplay,
  freshnessAfterElapsed,
  graphForWindow,
  readDoGraph,
  readMonitoringSnapshot,
  readMetricSnapshot,
  metricReportState,
  type MetricSnapshot,
  type MetricResource,
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

type HomeData = {
  scopeKey: string;
  snapshotFetchedAtMonotonicMs: number | null;
  snapshot: MonitoringSnapshot | null;
  metricSnapshot: MetricSnapshot | null;
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

type HomeRead = "monitoring" | "graph" | "configuration" | "next" | "history";

const windows: GraphWindow[] = ["1h", "6h", "24h"];
const rangeNames: Record<GraphWindow, string> = {
  "1h": "Last hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
};

function message(error: unknown, fallback: string) {
  return errorText(error, fallback);
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

const phoneZone = "Asia/Manila";

function graphClock(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function graphTime(value: string) {
  const date = new Date(value);
  const time = graphClock(value);
  const day = relativeDayLabel(date, phoneZone);
  return day === "Today" ? time : day + ", " + time;
}

function graphPointText(point: DoGraph["samples"][number]) {
  const at = graphTime(
    point.observed_at ?? point.measured_at ?? point.bucket_start,
  );
  return point.do_mg_l === null
    ? "Gap: " + gapText(point.gap_reason) + " · " + at
    : String(point.do_mg_l) +
        " mg/L · " +
        at +
        (point.time_basis === "captured" ? " · Captured" : " · Measured");
}

function activityTime(value: string, timezone: string) {
  const date = new Date(value);
  const day = relativeDayLabel(date, timezone);
  return day === "Today"
    ? new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        timeStyle: "short",
      }).format(date)
    : day;
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

function GraphReveal({
  children,
  scope,
  range,
}: {
  children: React.ReactNode;
  scope: string;
  range: GraphWindow;
}) {
  const progress = useEntryProgress(1, true, scope, 900, range);
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { right: undefined, width: `${progress * 100}%`, overflow: "hidden" },
      ]}
    >
      {children}
    </View>
  );
}

export default function HomeScreen() {
  const unread = useUnreadCount();
  const bell = (
    <IconButton
      icon="bell"
      radius={24}
      outlined
      badge={unread > 0}
      accessibilityLabel={
        unread ? `Notifications, ${unread} unread` : "Notifications"
      }
      onPress={() => router.push("/notifications")}
    />
  );
  const access = useDeviceAccess();
  const device = access.selectedDevice;
  const { reportDeviceAccessLoss } = access;
  const independentTelemetry =
    device?.capabilities.independentTelemetry ?? false;
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

  const providerUpdates = useDeviceUpdates();
  const providerLoadRef = useRef<
    | ((
        resource: HomeRead,
        context: DeviceUpdateReadContext,
      ) => Promise<void | "deferred">)
    | null
  >(null);
  const [window, setWindow] = useState<GraphWindow>("1h");
  const [inspected, setInspected] = useState(0);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [inspection, setInspection] = useState<{
    scope: string;
    open: boolean;
  } | null>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const [monotonicNowMs, setMonotonicNowMs] = useState(() => performance.now());
  const [clockOriginMs] = useState(
    () => new Date().getTime() - performance.now(),
  );
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
  const metrics = device?.capabilities.independentTelemetry
    ? activeData?.metricSnapshot
    : null;
  const doResource = metrics?.resources.do;
  const feedResource = metrics?.resources.feed;
  const legacySnapshot = device?.capabilities.independentTelemetry
    ? null
    : activeData?.snapshot;
  const legacySample = legacySnapshot?.latest_sample ?? null;
  // Only values are shared below; observation clocks remain separate.
  const sample = metrics
    ? {
        do_quality: doResource!.quality,
        do_mg_l: doResource!.latest?.observation.do_mg_l ?? null,
        feed_quality: feedResource!.quality,
        feed_remaining_g:
          feedResource!.latest?.observation.feed_remaining_g ?? null,
        feed_percent: feedResource!.latest?.observation.feed_percent ?? null,
      }
    : legacySample;
  const graph = graphForWindow(activeData?.graph, window);
  const graphError =
    activeData?.graphRequestedWindow === window ? activeData.graphError : null;
  const points = graph?.samples ?? [];
  const selectedIndex = Math.min(inspected, Math.max(0, points.length - 1));
  const selectedPoint = points[selectedIndex] ?? null;
  const validValues = points.flatMap((point) =>
    point.do_mg_l === null ? [] : [point.do_mg_l],
  );
  const applied = activeData?.configuration
    ? activeData.configuration.applied_snapshot
    : metrics?.configuration.applied_snapshot;
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
  const metricNow = metrics
    ? Date.parse(metrics.server_time) + elapsedSeconds * 1000
    : null;
  const contactAge = device?.lastAuthenticatedContactAt
    ? Math.max(
        0,
        (clockOriginMs +
          monotonicNowMs -
          Date.parse(device.lastAuthenticatedContactAt)) /
          1000,
      )
    : null;
  const contactFreshness = device?.contactFreshness ?? "unknown";
  const doFreshness = metrics
    ? doResource?.time_basis === "measured" && doResource.age_seconds !== null
      ? doResource.age_seconds + elapsedSeconds < 30
        ? "fresh"
        : "stale"
      : "unknown"
    : legacySample && legacySnapshot
      ? freshnessAfterElapsed(
          legacySample.do_freshness,
          legacySample.sample_age_seconds,
          elapsedSeconds,
          legacySnapshot.display_policy.metric_outdated_after_seconds,
        )
      : "unknown";
  const feedFreshness = metrics
    ? feedResource?.time_basis === "measured" &&
      feedResource.age_seconds !== null
      ? feedResource.age_seconds + elapsedSeconds < 30
        ? "fresh"
        : "stale"
      : "unknown"
    : legacySample && legacySnapshot
      ? freshnessAfterElapsed(
          legacySample.feed_freshness,
          legacySample.sample_age_seconds,
          elapsedSeconds,
          legacySnapshot.display_policy.metric_outdated_after_seconds,
        )
      : "unknown";
  const inspectionOpen = inspection?.scope === scopeKey && inspection.open;
  const plotHeight = 117;
  const shape = buildDoGraphShape(points, plotWidth, plotHeight, axisMax);
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
  const doAge = metrics
    ? doResource?.age_seconds == null
      ? null
      : doResource.age_seconds + elapsedSeconds
    : legacySample?.sample_age_seconds == null
      ? null
      : legacySample.sample_age_seconds + elapsedSeconds;
  const feedAge = metrics
    ? feedResource?.age_seconds == null
      ? null
      : feedResource.age_seconds + elapsedSeconds
    : doAge;
  const metricMetadata = (resource: MetricResource | undefined) => {
    const read = resource?.latest;
    if (!read) return "No observation received";
    const time = (instant: string) =>
      new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(instant));
    return (
      (read.observed_at
        ? `${read.time_basis === "captured" ? "Captured" : "Observed"} ${time(read.observed_at)}`
        : `Observation time unknown${read.observation.captured_at ? " · Capture recorded " + time(read.observation.captured_at) + " (unverified)" : ""}`) +
      ` · Received ${time(read.received_at)} · Asia/Manila`
    );
  };
  const reporting =
    metrics && metricNow !== null
      ? metricReportState(
          metricNow,
          doResource?.latest?.received_at ?? null,
          applied?.oxygen_report_interval_seconds ?? null,
        )
      : "unknown";
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
      if (!deviceId || !installationId) return;
      const scope = { ...currentScope };
      const requestedWindow = window;
      const requestedQuery =
        requestedWindow +
        ":" +
        (independentTelemetry ? "independent" : "legacy");
      let active = true;
      const isCurrent = () =>
        active &&
        sameDeviceRequestScope(scope, scopeRef.current) &&
        requestedWindow === requestedWindowRef.current;
      setMonotonicNowMs(performance.now());
      const clock = setInterval(() => {
        if (isCurrent()) setMonotonicNowMs(performance.now());
      }, 5_000);
      const readers: Record<HomeRead, () => Promise<Partial<HomeData>>> = {
        async monitoring() {
          const snapshotFetchedAtMonotonicMs = performance.now();
          const value = independentTelemetry
            ? await readMetricSnapshot(installationId, deviceId)
            : await readMonitoringSnapshot(installationId, deviceId);
          return {
            snapshotFetchedAtMonotonicMs,
            snapshot: "latest_sample" in value ? value : null,
            metricSnapshot: "resources" in value ? value : null,
            snapshotError: null,
          };
        },
        async graph() {
          return {
            graphRequestedWindow: requestedWindow,
            graph: await readDoGraph(installationId, deviceId, requestedWindow),
            graphError: null,
          };
        },
        async configuration() {
          return {
            configuration: await readConfiguration(installationId, deviceId),
            configurationError: null,
          };
        },
        async next() {
          return {
            next: await readNextOccurrence(installationId, deviceId),
            nextError: null,
          };
        },
        async history() {
          return {
            history: await readHistoryPage(installationId, deviceId, {
              source: "all",
              status: "all",
            }),
            historyError: null,
          };
        },
      };
      const errors = {
        monitoring: ["snapshotError", "Monitoring could not be loaded."],
        graph: ["graphError", "The oxygen graph could not be loaded."],
        configuration: [
          "configurationError",
          "Applied settings could not be checked.",
        ],
        next: ["nextError", "The next applied feeding could not be loaded."],
        history: [
          "historyError",
          "Recent feeding outcomes could not be loaded.",
        ],
      } as const;
      type Flight = {
        pending: boolean;
        published: boolean;
        result: Promise<PromiseSettledResult<Partial<HomeData>>>;
      };
      const flights = new Map<HomeRead, Flight>();
      const startRead = (resource: HomeRead) => {
        const current = flights.get(resource);
        if (current?.pending) return current;
        const flight: Flight = {
          pending: true,
          published: false,
          result: Promise.resolve().then(
            async (): Promise<PromiseSettledResult<Partial<HomeData>>> => {
              try {
                return {
                  status: "fulfilled",
                  value: await readers[resource](),
                };
              } catch (reason) {
                return { status: "rejected", reason };
              } finally {
                flight.pending = false;
              }
            },
          ),
        };
        flights.set(resource, flight);
        return flight;
      };
      const all = Object.keys(readers) as HomeRead[];
      const loadResources = async (
        resources: readonly HomeRead[],
        context?: DeviceUpdateReadContext,
      ): Promise<void | "deferred"> => {
        const current = () =>
          isCurrent() &&
          (!context ||
            (context.isCurrent() &&
              context.scope.installationId === installationId &&
              context.scope.deviceId === deviceId &&
              context.scope.scopeRevision === scope.revision &&
              context.binding.query === requestedQuery));
        if (!current()) return "deferred";
        const results = await Promise.all(
          resources.map(async (resource) => {
            const flight = startRead(resource);
            return { resource, flight, result: await flight.result };
          }),
        );
        if (!current()) return "deferred";
        const latestResults = results.filter(
          ({ resource, flight }) => flight === flights.get(resource),
        );
        if (context && latestResults.length !== results.length)
          return "deferred";
        const denial = latestResults.find(
          ({ result }) =>
            result.status === "rejected" &&
            (result.reason as { code?: string } | null)?.code ===
              "ACCESS_REVOKED",
        );
        if (denial?.result.status === "rejected") {
          if (!denial.flight.published) {
            denial.flight.published = true;
            reportDeviceAccessLoss({
              installationId,
              deviceId,
              scopeRevision: scope.revision,
            });
          }
          throw denial.result.reason;
        }
        const next: HomeData =
          dataRef.current?.scopeKey === scopeKey
            ? { ...dataRef.current }
            : {
                scopeKey,
                snapshotFetchedAtMonotonicMs: null,
                snapshot: null,
                metricSnapshot: null,
                snapshotError: null,
                graphRequestedWindow: requestedWindow,
                graph: null,
                graphError: null,
                configuration: null,
                configurationError: null,
                next: null,
                nextError: null,
                history: null,
                historyError: null,
              };
        let changed = false;
        for (const { resource, flight, result } of latestResults) {
          if (flight.published) continue;
          flight.published = true;
          changed = true;
          if (result.status === "fulfilled") {
            Object.assign(next, result.value);
          } else {
            const [field, fallback] = errors[resource];
            if (resource === "graph") {
              next.graphRequestedWindow = requestedWindow;
              if (next.graph?.window !== requestedWindow) next.graph = null;
            }
            next[field] = message(result.reason, fallback);
          }
        }
        if (changed) {
          dataRef.current = next;
          setData(next);
        }
        const failed = latestResults.find(
          ({ result }) => result.status === "rejected",
        );
        if (failed?.result.status === "rejected") throw failed.result.reason;
      };
      providerLoadRef.current = (resource, context) =>
        loadResources([resource], context);
      if (!providerUpdates) void loadResources(all).catch(() => {});
      const appState = AppState.addEventListener("change", (state) => {
        if (state === "active" && isCurrent()) {
          setMonotonicNowMs(performance.now());
        }
      });
      return () => {
        active = false;
        if (providerLoadRef.current) providerLoadRef.current = null;
        clearInterval(clock);
        appState.remove();
      };
    }, [
      currentScope,
      independentTelemetry,
      deviceId,
      installationId,
      providerUpdates,
      reportDeviceAccessLoss,
      scopeKey,
      window,
    ]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!providerUpdates || !deviceId) return;
      const binding = {
        focus: "home",
        query: window + ":" + (independentTelemetry ? "independent" : "legacy"),
      };
      const read = (resource: HomeRead) => (context: DeviceUpdateReadContext) =>
        providerLoadRef.current?.(resource, context) ??
        Promise.resolve("deferred" as const);
      const owners = [
        providerUpdates.registerDeviceUpdateReader(
          "monitoring",
          ["do", "feed"],
          binding,
          read("monitoring"),
        ),
        providerUpdates.registerDeviceUpdateReader(
          "graph",
          ["do", "history"],
          binding,
          read("graph"),
        ),
        providerUpdates.registerDeviceUpdateReader(
          "configuration",
          ["configuration"],
          binding,
          read("configuration"),
        ),
        providerUpdates.registerDeviceUpdateReader(
          "next",
          ["configuration", "feeding"],
          binding,
          read("next"),
        ),
        providerUpdates.registerDeviceUpdateReader(
          "history",
          ["feeding"],
          binding,
          read("history"),
        ),
      ];
      return () => owners.forEach((remove) => remove());
    }, [deviceId, independentTelemetry, providerUpdates, window]),
  );
  const chooseWindow = (next: GraphWindow) => {
    setWindow(next);
    setInspected(0);
  };

  if (!device) {
    return (
      <AppPage
        edges={["top", "left", "right"]}
        header={<ScreenHeader title="Home" action={bell} />}
      >
        <EmptyState
          icon="waves"
          title="Connect a feeder"
          description="Pair a feeder to see its status here."
          action="Pair feeder"
          href="/devices/add"
        />
      </AppPage>
    );
  }

  const contact = metrics
    ? { authenticated_at: metrics.contact.last_seen_at }
    : legacySnapshot?.contact;
  const offline = contactFreshness === "stale";
  const contactText =
    contactFreshness === "fresh"
      ? "Online"
      : contactFreshness === "stale"
        ? "Offline · last contact " + agoText(contactAge)
        : !contact
          ? "Contact status unavailable"
          : contact.authenticated_at === null
            ? "Contact not recorded"
            : "Contact time unknown";
  const feedSensor =
    legacySnapshot?.profile.capabilities.feed_remaining_monitoring ??
    device.capabilities.feedRemainingMonitoring;
  const feedCapacityG = feedCapacityForDisplay(
    legacySnapshot,
    device.capabilities.feedCapacityG,
  );
  const feedQuantityText = (grams: number) => {
    const value = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(grams);
    if (typeof feedCapacityG !== "number") return value + " g";
    const kilograms = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
    });
    return (
      kilograms.format(grams / 1000) +
      " of " +
      kilograms.format(feedCapacityG / 1000) +
      " kg"
    );
  };
  const doSensor =
    legacySnapshot?.profile.capabilities.do_monitoring ??
    device.capabilities.doMonitoring;
  const feedStatus = !feedSensor
    ? "No shared-container sensor is declared"
    : !sample
      ? offline
        ? "Feeder offline; inventory is unknown"
        : "No inventory sample yet"
      : sample.feed_quality !== "valid"
        ? sensorText(sample.feed_quality)
        : typeof sample.feed_remaining_g !== "number" ||
            typeof sample.feed_percent !== "number"
          ? "Inventory reading unavailable"
          : feedFreshness === "fresh"
            ? feedQuantityText(sample.feed_remaining_g)
            : (metrics && feedResource?.time_basis !== "measured"
                ? "Last reported "
                : "Last measured ") +
              feedQuantityText(sample.feed_remaining_g) +
              " · " +
              agoText(feedAge) +
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
          ? "Latest reading · " + agoText(doAge)
          : (metrics && doResource?.time_basis !== "measured"
              ? "Last reported "
              : "Last measured ") +
            sample.do_mg_l +
            " mg/L · " +
            agoText(doAge) +
            (doFreshness === "stale" ? " (outdated)" : " (freshness unknown)");
  const historyRows = activeData?.history?.records.slice(0, 3) ?? [];
  const inspectPoint = (index: number, announce = true) => {
    setInspection({ scope: scopeKey, open: true });
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
  const nextClock =
    nextAt && nextZone ? clockParts(nextAt, "Asia/Manila") : null;
  const lastAttempt = metrics
    ? metrics.configuration.current_state
    : activeData?.configuration?.current_state;
  const deviceName = device.alias?.trim() || device.model;
  const loadError =
    activeData?.snapshotError ??
    activeData?.configurationError ??
    activeData?.nextError ??
    graphError ??
    activeData?.historyError ??
    null;
  const simulated =
    device.isSimulated || legacySnapshot?.profile.is_simulated === true;

  return (
    <AppPage
      gap={12}
      edges={["top", "left", "right"]}
      header={
        <ScreenHeader
          title="Home"
          action={bell}
          status={
            <View style={styles.contact}>
              <View style={styles.contactRow}>
                <DecorativeIcon
                  name={contactFreshness === "fresh" ? "wifi" : "wifi-off"}
                  color={Colors.light.textSecondary}
                />
                <Text style={Typography.supporting}>{contactText}</Text>
              </View>
            </View>
          }
        />
      }
    >
      {loadError || lastAttempt?.last_attempt_status === "rejected" ? (
        <View style={styles.group}>
          {loadError ? <Notice tone="error">{loadError}</Notice> : null}
          {lastAttempt?.last_attempt_status === "rejected" ? (
            <Notice tone="warning">
              Settings update rejected. Previous settings remain active.
            </Notice>
          ) : null}
        </View>
      ) : null}

      <View style={styles.group}>
        <BentoCard gap={0} revealKey={scopeKey + ":oxygen"}>
          <View style={styles.doHeader}>
            <View style={styles.doTitle}>
              <DecorativeIcon name="waves" color={Colors.light.textTertiary} />
              <Text
                accessibilityRole="header"
                style={[Typography.supporting, { flexShrink: 1 }]}
              >
                Dissolved oxygen
              </Text>
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                minHeight: 48,
              }}
            >
              <MotionPressable
                accessibilityRole="button"
                accessibilityLabel="Inspect readings"
                accessibilityState={{ expanded: !!inspectionOpen }}
                aria-expanded={!!inspectionOpen}
                onPress={() =>
                  setInspection({ scope: scopeKey, open: !inspectionOpen })
                }
                style={{
                  minWidth: 48,
                  minHeight: 48,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <DecorativeIcon
                  name="crosshair"
                  color={Colors.light.textSecondary}
                />
              </MotionPressable>
              <DropdownPill
                value={window.toUpperCase()}
                accessibilityLabel={"Graph range, " + rangeNames[window]}
                onPress={() => setRangeOpen(true)}
              />
            </View>
          </View>
          <View style={styles.readingRow}>
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
              <AnimatedNumber
                style={Typography.display}
                decimals={1}
                value={doValue}
                eligible={
                  doFreshness === "fresh" &&
                  sample?.do_quality === "valid" &&
                  !activeData?.snapshotError
                }
                scope={scopeKey}
              />
              {doValue !== null ? (
                <Text style={Typography.unit}>mg/L</Text>
              ) : null}
            </View>
            {withinLimits ? (
              <StatusLabel kind="completed">Within limits</StatusLabel>
            ) : outsideLimits ? (
              <StatusLabel kind="warning">Outside limits</StatusLabel>
            ) : doValue !== null && doFreshness === "stale" ? (
              <StatusLabel kind="outdated">Outdated</StatusLabel>
            ) : null}
          </View>
          {doStatus ? (
            <Text style={[Typography.supporting, styles.doStatus]}>
              {doStatus}
            </Text>
          ) : null}
          {metrics ? (
            <View>
              <Text style={Typography.supporting}>
                {metricMetadata(doResource)}
              </Text>
              <Text style={Typography.supporting}>
                {applied?.oxygen_report_interval_seconds == null
                  ? "Reporting interval not configured"
                  : `Reporting every ${applied.oxygen_report_interval_seconds < 3600 ? applied.oxygen_report_interval_seconds + " seconds" : applied.oxygen_report_interval_seconds / 3600 + " hours"} · ${reporting.replace("_", " ")}. Cadence is not measurement freshness.`}
              </Text>
            </View>
          ) : null}
          {graph && points.length ? (
            <>
              <View style={styles.chart}>
                <View style={styles.graphRow}>
                  <View
                    style={[styles.axisLabels, { height: plotHeight + 16 }]}
                  >
                    <Text style={Typography.metadata}>{axisMax}</Text>
                    <Text style={Typography.metadata}>
                      {Math.round(axisMax / 2)}
                    </Text>
                    <Text style={Typography.metadata}>0</Text>
                  </View>
                  <View
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={`${window.toUpperCase()} dissolved oxygen graph, ${graph.valid_sample_count} valid samples, ${graph.gap_count} visible gaps, vertical scale from 0 to ${axisMax} mg/L, from ${graphTime(graph.window_start)} to ${graphTime(graph.window_end)}${graphLimits ? ". " + graphLimits : ""}. Use the previous and next point controls to inspect values.`}
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
                      </View>
                    ))}
                    {plotWidth > 0 ? (
                      <GraphReveal scope={scopeKey} range={window}>
                        <Svg
                          width={plotWidth}
                          height={plotHeight}
                          style={StyleSheet.absoluteFill}
                          pointerEvents="none"
                        >
                          {shape.paths.map((d, index) => (
                            <Path
                              key={"line-" + index}
                              d={d}
                              stroke={Colors.light.chartLine}
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              fill="none"
                            />
                          ))}
                          {shape.dots.map((dot, index) => (
                            <Circle
                              key={"dot-" + index}
                              cx={dot.x}
                              cy={dot.y}
                              r={2.5}
                              fill={Colors.light.chartLine}
                            />
                          ))}
                        </Svg>
                      </GraphReveal>
                    ) : null}
                    {inspectionOpen && selectedPoint ? (
                      <View
                        pointerEvents="none"
                        style={[styles.cursor, { left: pointX(selectedIndex) }]}
                      />
                    ) : null}
                    {inspectionOpen &&
                    selectedPoint &&
                    selectedPoint.do_mg_l !== null ? (
                      <View
                        pointerEvents="none"
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
                  <Text
                    accessibilityLabel={graphTime(graph.window_start)}
                    style={[Typography.metadata, styles.axisStart]}
                  >
                    {graphClock(graph.window_start)}
                  </Text>
                  <Text
                    accessibilityLabel={graphTime(
                      new Date(
                        (Date.parse(graph.window_start) +
                          Date.parse(graph.window_end)) /
                          2,
                      ).toISOString(),
                    )}
                    style={[
                      Typography.metadata,
                      { flex: 1, textAlign: "center" },
                    ]}
                  >
                    {graphClock(
                      new Date(
                        (Date.parse(graph.window_start) +
                          Date.parse(graph.window_end)) /
                          2,
                      ).toISOString(),
                    )}
                  </Text>
                  <Text
                    accessibilityLabel={graphTime(graph.window_end)}
                    style={[Typography.metadata, styles.axisEnd]}
                  >
                    {graphClock(graph.window_end)}
                  </Text>
                </View>
              </View>
              {inspectionOpen && selectedPoint ? (
                <View style={styles.inspection}>
                  <View style={styles.inspectText}>
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
                        selectedPoint.observed_at ??
                          selectedPoint.measured_at ??
                          selectedPoint.bucket_start,
                      ) +
                        (selectedPoint.observed_at || selectedPoint.measured_at
                          ? selectedPoint.time_basis === "captured"
                            ? " · Captured"
                            : " · Measured"
                          : " interval")}
                    </Text>
                  </View>
                  <View style={styles.inspectButtons}>
                    <IconButton
                      icon="chevron-left"
                      accessibilityLabel="Inspect previous graph point"
                      disabled={selectedIndex <= 0}
                      onPress={() => inspectPoint(selectedIndex - 1)}
                    />
                    <IconButton
                      icon="chevron-right"
                      accessibilityLabel="Inspect next graph point"
                      disabled={selectedIndex >= points.length - 1}
                      onPress={() => inspectPoint(selectedIndex + 1)}
                    />
                  </View>
                </View>
              ) : null}
            </>
          ) : graph ? (
            <Text style={[Typography.supporting, styles.graphNote]}>
              No readings in this range.
            </Text>
          ) : graphError ? (
            <Text style={[Typography.supporting, styles.graphNote]}>
              Graph unavailable.
            </Text>
          ) : (
            <View style={styles.graphNote}>
              <Skeleton height={168} />
            </View>
          )}
          {graph?.invalid_time_sample_count ? (
            <Text style={[Typography.metadata, styles.dataQuality]}>
              Time is invalid or uncertain for {graph.invalid_time_sample_count}{" "}
              samples.
            </Text>
          ) : null}
        </BentoCard>

        <Sheet
          visible={rangeOpen}
          title="Graph range"
          onClose={() => setRangeOpen(false)}
        >
          <BentoCard flush>
            {windows.map((choice, index) => (
              <ListRow
                key={choice}
                divider={index > 0}
                title={rangeNames[choice]}
                trailing={
                  choice === window ? (
                    <DecorativeIcon name="check" color={Colors.light.ink} />
                  ) : undefined
                }
                accessibilityLabel={
                  rangeNames[choice] + (choice === window ? ", selected" : "")
                }
                onPress={() => {
                  chooseWindow(choice);
                  setRangeOpen(false);
                }}
              />
            ))}
          </BentoCard>
        </Sheet>

        <MotionSection revealKey={scopeKey + ":metrics"} delay={Motion.stagger}>
          <BentoCard>
            <View
              accessible
              accessibilityLabel={
                "Feed remaining. " +
                feedStatus +
                (feedPercent !== null
                  ? `. ${feedPercent} percent. ${sample?.feed_remaining_g} g` +
                    (typeof feedCapacityG === "number"
                      ? ` of ${feedCapacityG} g capacity.`
                      : ".")
                  : "")
              }
            >
              <View style={styles.panelLabelRow}>
                <Lucide
                  name="container"
                  size={IconSize.default}
                  color={Colors.light.textTertiary}
                />
                <Text style={styles.panelLabel}>Feed remaining</Text>
              </View>
              <View style={styles.panelValueRow}>
                <View style={styles.panelValue}>
                  <Text
                    accessibilityLabel={
                      feedPercent === null ? "—" : String(feedPercent)
                    }
                    style={Typography.reading}
                  >
                    {feedPercent === null ? (
                      "—"
                    ) : (
                      <AnimatedNumber
                        value={feedPercent}
                        eligible={
                          feedFreshness === "fresh" &&
                          !activeData?.snapshotError
                        }
                        scope={scopeKey}
                      />
                    )}
                  </Text>
                  {feedPercent === null ? null : (
                    <Text style={Typography.unit}>%</Text>
                  )}
                </View>
                {feedPercent === null ? null : (
                  <View style={styles.panelMeter}>
                    <ProgressBar
                      scope={scopeKey}
                      value={feedPercent}
                      animated={
                        feedFreshness === "fresh" && !activeData?.snapshotError
                      }
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
                  </View>
                )}
              </View>
              <Text style={[Typography.supporting, styles.panelSection]}>
                {feedStatus}
              </Text>
              {metrics ? (
                <Text style={Typography.supporting}>
                  {metricMetadata(feedResource)}
                </Text>
              ) : null}
            </View>
            <View style={styles.panelDivider} />
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Next applied feeding. Opens Schedule."
              onPress={() => router.push("/(tabs)/schedule")}
            >
              <View style={styles.panelLabelRow}>
                <Lucide
                  name="calendar-clock"
                  size={IconSize.default}
                  color={Colors.light.textTertiary}
                />
                <Text style={styles.panelLabel}>Next feeding</Text>
              </View>
              <Text style={[Typography.title, styles.panelSection]}>
                {nextClock ? (
                  <>
                    {nextClock.time}
                    {nextClock.period ? (
                      <Text style={Typography.unit}>
                        {" " + nextClock.period}
                      </Text>
                    ) : null}{" "}
                  </>
                ) : (
                  "— "
                )}
                <Text style={Typography.supporting}>
                  {"· " +
                    (occurrence && nextAt && nextZone
                      ? relativeDayLabel(nextAt, "Asia/Manila") +
                        " · Asia/Manila" +
                        (nextZone !== "Asia/Manila"
                          ? ` · Applied schedule zone ${nextZone}; migration required`
                          : "")
                      : activeData?.next
                        ? "No upcoming feeding"
                        : "Unavailable")}
                </Text>
              </Text>
            </Pressable>
          </BentoCard>
        </MotionSection>
      </View>

      <MotionSection
        revealKey={scopeKey + ":feed-action"}
        delay={Motion.stagger * 3}
        style={styles.group}
      >
        <Button
          accessibilityHint={"Opens feeding for " + deviceName + "."}
          onPress={() => router.push("/feed/confirm")}
        >
          Feed now
        </Button>
      </MotionSection>

      <MotionSection
        revealKey={scopeKey + ":activity"}
        delay={Motion.stagger}
        style={styles.recent}
      >
        <SectionHeader
          title="Recent feedings"
          action={{
            label: "View all",
            onPress: () => router.push("/(tabs)/history"),
          }}
        />
        {historyRows.length ? (
          <BentoCard flush>
            {historyRows.map((record, index) => (
              <FeedingRow
                key={record.sequence_id}
                record={record}
                simulated={simulated}
                timeText={`${activityTime(record.occurred_at ?? record.received_at, "Asia/Manila")} · ${record.occurred_at ? (record.started_at === record.occurred_at ? "Execution started" : "Completion reported") : "Received · execution time unknown"}`}
                divider={index > 0}
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
          <Text style={Typography.supporting}>No feedings yet.</Text>
        ) : activeData?.historyError ? (
          <Text style={Typography.supporting}>
            Recent feedings unavailable.
          </Text>
        ) : (
          <View style={styles.recent}>
            <Skeleton height={72} />
            <Skeleton height={72} />
            <Skeleton height={72} />
          </View>
        )}
      </MotionSection>
    </AppPage>
  );
}

const styles = StyleSheet.create({
  group: { gap: 12 },
  contact: { gap: 4 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  recent: { gap: 8 },
  doHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
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
  readingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
  },
  reading: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 6,
  },
  doStatus: { marginTop: 4 },
  graphNote: { marginTop: 16 },
  dataQuality: { marginTop: 8 },
  chart: { marginTop: 16, paddingTop: 8 },
  graphRow: { flexDirection: "row", gap: 8 },
  axisLabels: {
    width: 24,
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
  axisEnds: { flexDirection: "row", marginTop: 8, paddingLeft: 32 },
  axisStart: { flex: 1, textAlign: "left" },
  axisEnd: { flex: 1, textAlign: "right" },
  inspection: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  inspectText: { flex: 1, minWidth: 0 },
  inspectButtons: { flexDirection: "row", marginRight: -12 },
  inspectValueRow: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  inspectValue: {
    ...Typography.cardTitle,
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
  },
  inspectUnit: { ...Typography.label, color: Colors.light.textSecondary },
  inspectTime: {
    ...Typography.metadata,
    color: Colors.light.textSecondary,
  },
  tiles: { flexDirection: "row", gap: 12 },
  tilesStacked: { flexDirection: "column" },
  tile: { flex: 1, minWidth: 0 },
  panelLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  panelLabel: {
    ...Typography.label,
    color: Colors.light.textSecondary,
    flex: 1,
  },
  panelValueRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  panelValue: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 4,
    flexShrink: 1,
  },
  panelMeter: { width: 84 },
  panelSection: { marginTop: 8 },
  panelDivider: {
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    marginVertical: 8,
  },
});
