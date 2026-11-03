import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Lucide } from "@react-native-vector-icons/lucide";

import {
  AppPage,
  BentoCard,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  FeedingRow,
  Notice,
  ProgressBar,
  ScreenHeader,
  SectionHeader,
  Segmented,
  Sheet,
  Skeleton,
} from "@/components/app-shell";
import { AnimatedNumber, MotionSection } from "@/components/motion";
import { calendarDate, DateField } from "@/components/date-field";
import {
  HistoryStatusSelect,
  type HistoryStatus,
} from "@/components/history-status-select";
import { relativeDayLabel } from "@/components/feed-status";
import { Colors, IconSize, Spacing, Typography } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";
import { errorText } from "@/lib/error-text";
import {
  readHistoryPage,
  type HistoryPage,
  type HistoryRecord,
} from "@/lib/manual-feed";

type Filter = {
  from: string;
  to: string;
  source: "all" | "manual" | "scheduled";
  status: HistoryStatus;
};

// from_date and to_date are calendar dates, so UTC midnight prints the same day everywhere.
const shortDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T00:00:00Z"));

/** Dark accent summary card (owner-approved History G). Same totals, motion and
 * accessibility facts as the previous light tiles; depth only, never color. */
function HistorySummaryCard({
  icon,
  label,
  value,
  count,
  total,
  eligible,
  scope,
  caption,
}: {
  icon: "circle-check" | "triangle-alert";
  label: string;
  value: string;
  count: number;
  total: number;
  eligible: boolean;
  scope: string;
  caption?: string;
}) {
  const share = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <BentoCard tone="inverse" style={styles.darkCard}>
      <View style={styles.darkLabelRow}>
        <Lucide
          name={icon}
          size={IconSize.default}
          color={Colors.light.onInkSecondary}
        />
        <Text style={styles.darkLabel}>{label}</Text>
      </View>
      <Text accessibilityLabel={value} style={styles.darkValue}>
        <AnimatedNumber value={count} eligible={eligible} scope={scope} />
      </Text>
      <ProgressBar
        tone="dark"
        scope={scope}
        value={share}
        animated={eligible}
        accessibilityLabel={label + " share of total"}
        accessibilityText={`${count} of ${total}`}
      />
      <Text style={styles.darkCaption}>
        {`${count} of ${total}` + (caption ? ` · ${caption}` : "")}
      </Text>
    </BentoCard>
  );
}

export default function HistoryScreen() {
  const { selectedDevice, selectedDeviceId, installationId, scopeRevision } =
    useDeviceAccess();
  const [draftFilters, setDraftFilters] = useState<Filter>({
    from: "",
    to: "",
    source: "all",
    status: "all",
  });
  const [filters, setFilters] = useState<Filter>({
    from: "",
    to: "",
    source: "all",
    status: "all",
  });
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [rows, setRows] = useState<HistoryRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pageScope, setPageScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const { fontScale, width } = useWindowDimensions();
  const stackTiles = fontScale > 1.3 || width < 360;
  const run = useRef(0);
  const dataScope = useRef<string | null>(null);
  const deviceId = selectedDeviceId;
  const scopeKey = `${installationId ?? ""}:${deviceId ?? ""}:${scopeRevision}`;
  const activePage = pageScope === scopeKey ? page : null;
  const activeError = pageScope === scopeKey ? error : null;
  const dateError =
    (draftFilters.from && !calendarDate(draftFilters.from)) ||
    (draftFilters.to && !calendarDate(draftFilters.to))
      ? "Choose a valid date."
      : draftFilters.from &&
          draftFilters.to &&
          draftFilters.from > draftFilters.to
        ? "To date must be on or after From date."
        : null;

  const load = useCallback(
    async (cursor?: string | null, append = false) => {
      if (!deviceId || !installationId) return;
      const generation = ++run.current;
      if (dataScope.current !== scopeKey) {
        dataScope.current = scopeKey;
        setPage(null);
        setRows([]);
      }
      setLoading(true);
      setError(null);
      try {
        const next = await readHistoryPage(installationId, deviceId, {
          from: filters.from || undefined,
          to: filters.to || undefined,
          source: filters.source,
          status: filters.status,
          cursor,
        });
        if (generation !== run.current || deviceId !== selectedDeviceId) return;
        setPageScope(scopeKey);
        setPage(next);
        setRows((current) =>
          append
            ? [
                ...current,
                ...next.records.filter(
                  (record) =>
                    !current.some(
                      (item) => item.sequence_id === record.sequence_id,
                    ),
                ),
              ]
            : next.records,
        );
      } catch (reason) {
        if (generation === run.current) {
          setPageScope(scopeKey);
          setError(errorText(reason, "Feeding history could not be loaded."));
        }
      } finally {
        if (generation === run.current) setLoading(false);
      }
    },
    [deviceId, filters, installationId, scopeKey, selectedDeviceId],
  );

  // Returning from a record or another tab keeps pagination and scroll intact.
  useEffect(() => {
    // A new device/filter query must enter loading before its asynchronous read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (deviceId && installationId) void load(null, false);
    return () => {
      run.current += 1;
    };
  }, [deviceId, installationId, load]);

  const setFilter = <K extends keyof Filter>(key: K, value: Filter[K]) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = () => {
    setPage(null);
    setRows([]);
    setFilters(draftFilters);
  };

  const emptyFilter: Filter = {
    from: "",
    to: "",
    source: "all",
    status: "all",
  };
  const clearFilters = () => {
    setDraftFilters(emptyFilter);
    setPage(null);
    setRows([]);
    setFilters(emptyFilter);
  };

  const activeFilterCount =
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0) +
    (filters.source !== "all" ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0);

  // rows are newest first, so consecutive grouping is enough.
  const groups: { label: string; records: HistoryRecord[] }[] = [];
  if (activePage) {
    for (const record of rows) {
      const label = relativeDayLabel(
        new Date(record.created_at),
        activePage.timezone,
      );
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.records.push(record);
      else groups.push({ label, records: [record] });
    }
  }

  const openRecord = (record: HistoryRecord) => {
    router.push({
      pathname: "/history/[runId]",
      params: {
        runId: record.sequence_id,
        device_id: selectedDevice?.deviceId ?? "",
      },
    });
  };

  return (
    <AppPage
      onRefresh={selectedDevice ? () => load(null, false) : undefined}
      refreshing={loading}
      refreshKey={scopeKey}
      refreshLabel="Refresh history"
      edges={["top", "left", "right"]}
      header={
        <ScreenHeader
          title="History"
          subtitle={`${filters.from || filters.to ? "Custom dates" : "Last 7 days"} · ${activePage?.timezone_known ? activePage.timezone : "Phone time · feeder zone unavailable"}`}
          action={
            selectedDevice ? (
              <>
                <IconButton
                  icon="sliders-horizontal"
                  radius={24}
                  outlined
                  badge={activeFilterCount > 0}
                  accessibilityLabel={
                    activeFilterCount
                      ? "Filters, " + activeFilterCount + " active"
                      : "Filters"
                  }
                  onPress={() => {
                    setDraftFilters({
                      ...filters,
                      from: filters.from || activePage?.from_date || "",
                      to: filters.to || activePage?.to_date || "",
                    });
                    setFilterOpen(true);
                  }}
                />
              </>
            ) : undefined
          }
        />
      }
    >
      {!selectedDevice ? (
        <EmptyState
          icon="history"
          title="Select a feeder"
          description="Pair then select a feeder to view history."
          action="Pair feeder"
          href="/devices/add"
        />
      ) : activeError && !activePage ? (
        <ErrorState
          title="Couldn't load history"
          description={activeError}
          onRetry={() => void load(null, false)}
        />
      ) : !activePage ? (
        <View style={styles.loading}>
          <View style={styles.tiles}>
            <View style={styles.tile}>
              <Skeleton height={104} />
            </View>
            <View style={styles.tile}>
              <Skeleton height={104} />
            </View>
          </View>
          <Skeleton height={120} />
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      ) : (
        <>
          {activeError ? (
            <Notice
              tone="error"
              title="Couldn't load history"
              actions={
                <Button variant="text" onPress={() => void load(null, false)}>
                  Try again
                </Button>
              }
            >
              {activeError + " Records below may be outdated."}
            </Notice>
          ) : null}
          <MotionSection revealKey={scopeKey + ":totals"} style={styles.stats}>
            <SectionHeader
              title={
                filters.from || filters.to
                  ? shortDate(activePage.from_date) +
                    " – " +
                    shortDate(activePage.to_date)
                  : "Last 7 days"
              }
            />
            <View style={stackTiles ? styles.stackedTiles : styles.tiles}>
              <HistorySummaryCard
                icon="circle-check"
                label="Completed"
                value={String(activePage.totals.completed)}
                count={activePage.totals.completed}
                total={
                  activePage.totals.completed +
                  activePage.totals.needs_attention
                }
                eligible={!activeError}
                scope={scopeKey}
              />
              <HistorySummaryCard
                icon="triangle-alert"
                label="Needs attention"
                value={String(activePage.totals.needs_attention)}
                count={activePage.totals.needs_attention}
                total={
                  activePage.totals.completed +
                  activePage.totals.needs_attention
                }
                eligible={!activeError}
                scope={scopeKey}
                caption="Includes failed and unknown outcomes."
              />
            </View>
            <Text style={Typography.metadata}>
              {activePage.timezone_known
                ? "Times shown in " + activePage.timezone
                : "Times are in UTC because the feeder's time zone is not set."}
            </Text>
          </MotionSection>
          {groups.map((group) => (
            <View key={group.label} style={styles.stats}>
              <SectionHeader title={group.label} />
              <BentoCard flush>
                {group.records.map((record, index) => (
                  <FeedingRow
                    key={record.sequence_id}
                    revealKey={scopeKey + ":run:" + record.sequence_id}
                    record={record}
                    simulated={selectedDevice.isSimulated}
                    divider={index > 0}
                    timeText={new Intl.DateTimeFormat(undefined, {
                      timeZone: activePage.timezone,
                      timeStyle: "short",
                    }).format(new Date(record.created_at))}
                    onPress={() => openRecord(record)}
                  />
                ))}
              </BentoCard>
            </View>
          ))}
          {rows.length === 0 ? (
            activeFilterCount === 0 ? (
              <Text style={Typography.cardTitle}>No feeding records yet</Text>
            ) : (
              <View style={styles.stats}>
                <Text style={Typography.supporting}>
                  No records match these filters.
                </Text>
                <Button variant="text" onPress={clearFilters}>
                  Clear filters
                </Button>
              </View>
            )
          ) : null}
          {activePage.next_cursor ? (
            <Button
              variant="secondary"
              onPress={() => void load(activePage.next_cursor, true)}
              loading={loading}
            >
              Load more
            </Button>
          ) : null}
        </>
      )}
      <Sheet
        visible={filterOpen}
        title="Filters"
        onClose={() => setFilterOpen(false)}
        headerAction={
          <Button
            variant="text"
            size="compact"
            style={styles.resetAction}
            accessibilityHint="Resets your selections. Tap Apply filters to update history."
            onPress={() => setDraftFilters(emptyFilter)}
          >
            Reset
          </Button>
        }
        footer={
          <Button
            loading={loading}
            disabled={!!dateError}
            onPress={() => {
              applyFilters();
              setFilterOpen(false);
            }}
          >
            Apply filters
          </Button>
        }
      >
        <View style={styles.filterSection}>
          <SectionHeader title="Date range" />
          {filterOpen ? (
            <View style={stackTiles ? styles.stats : styles.dateRange}>
              <DateField
                label="From"
                value={draftFilters.from}
                maximum={draftFilters.to}
                onChange={(value) => setFilter("from", value)}
              />
              <DateField
                label="To"
                value={draftFilters.to}
                minimum={draftFilters.from}
                onChange={(value) => setFilter("to", value)}
              />
            </View>
          ) : null}
          {dateError ? (
            <Text accessibilityRole="alert" style={Typography.supporting}>
              {dateError}
            </Text>
          ) : null}
        </View>
        <View style={styles.filterSection}>
          <SectionHeader title="Source" />
          <Segmented
            accessibilityLabel="Source"
            value={draftFilters.source}
            onChange={(value) => setFilter("source", value)}
            options={[
              { value: "all", label: "All" },
              { value: "manual", label: "Manual" },
              { value: "scheduled", label: "Scheduled" },
            ]}
          />
        </View>
        <View style={styles.filterSection}>
          <SectionHeader title="Status" />
          <HistoryStatusSelect
            value={draftFilters.status}
            onChange={(value) => setFilter("status", value)}
          />
        </View>
      </Sheet>
    </AppPage>
  );
}

const styles = StyleSheet.create({
  stats: { gap: Spacing.two },
  tiles: { flexDirection: "row", gap: Spacing.cardGap },
  stackedTiles: { gap: Spacing.cardGap },
  tile: { flex: 1, minWidth: 0 },
  darkCard: {
    flex: 1,
    minWidth: 0,
    ...Platform.select({
      ios: {
        shadowColor: "#18181B",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.35,
        shadowRadius: 20,
      },
      android: { elevation: 8 },
      default: { boxShadow: "0px 12px 26px rgba(24,24,27,0.38)" },
    }),
  },
  darkLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  darkLabel: {
    ...Typography.label,
    color: Colors.light.onInkSecondary,
    flex: 1,
  },
  darkValue: {
    ...Typography.reading,
    color: Colors.light.onInk,
    marginTop: 8,
    fontVariant: ["tabular-nums"],
  },
  darkCaption: {
    ...Typography.supporting,
    color: Colors.light.onInkSecondary,
    marginTop: 8,
  },
  loading: { gap: Spacing.cardGap },
  dateRange: { flexDirection: "row", gap: Spacing.cardGap },
  filterSection: { gap: Spacing.two, marginBottom: Spacing.two },
  resetAction: { minHeight: 48, paddingRight: 0 },
});
