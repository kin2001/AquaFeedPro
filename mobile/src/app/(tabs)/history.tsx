import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  AppPage,
  BentoCard,
  PageHeading,
  TextField,
  Button,
  EmptyState,
} from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import { Colors, ControlSize, Spacing, Typography } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";
import {
  readHistoryPage,
  type HistoryPage,
  type HistoryRecord,
} from "@/lib/manual-feed";

type Filter = {
  from: string;
  to: string;
  source: "all" | "manual" | "scheduled";
  status: "all" | "completed" | "failed" | "in_progress" | "unknown";
};

function FilterChoice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.filterChoice, selected && styles.filterSelected]}
    >
      <Text style={Typography.supporting}>{label}</Text>
    </Pressable>
  );
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

function requestedText(record: HistoryRecord) {
  return record.targets
    .map((target) =>
      target.dose.mode === "grams"
        ? `Nozzle ${target.nozzle_number}: ${target.dose.amount_g} g requested`
        : `Nozzle ${target.nozzle_number}: ${target.dose.fixed_portion_id} requested`,
    )
    .join(" · ");
}

function createdAtLabel(record: HistoryRecord, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(record.created_at));
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
  const run = useRef(0);
  const deviceId = selectedDeviceId;
  const scopeKey = `${installationId ?? ""}:${deviceId ?? ""}:${scopeRevision}`;
  const activePage = pageScope === scopeKey ? page : null;
  const activeError = pageScope === scopeKey ? error : null;

  const load = useCallback(
    async (cursor?: string | null, append = false) => {
      if (!deviceId || !installationId) return;
      const generation = ++run.current;
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
          setError(
            reason instanceof Error
              ? reason.message
              : "Feeding history could not be loaded.",
          );
        }
      } finally {
        if (generation === run.current) setLoading(false);
      }
    },
    [deviceId, filters, installationId, scopeKey, selectedDeviceId],
  );

  useFocusEffect(
    useCallback(() => {
      if (deviceId && installationId) void load(null, false);
      return () => {
        run.current += 1;
      };
    }, [deviceId, installationId, load]),
  );

  const setFilter = <K extends keyof Filter>(key: K, value: Filter[K]) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = () => {
    setPage(null);
    setRows([]);
    setFilters(draftFilters);
  };

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
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading
        title="History"
        description="Auditable feeding activity for the selected feeder."
      />
      <DevicePicker />
      {!selectedDevice ? (
        <EmptyState
          icon="history"
          title="No feeder selected"
          description="Pair a feeder, then select it to view its history."
          action="Pair a device"
          href="/devices/add"
        />
      ) : null}
      {selectedDevice ? (
        <>
          <BentoCard>
            <Text style={Typography.cardTitle}>
              {selectedDevice.alias || selectedDevice.model}
            </Text>
            <Text style={Typography.supporting}>
              Times follow the device timezone shown with results. An unknown
              timezone uses UTC and is labeled.
            </Text>
          </BentoCard>
          <BentoCard>
            <Text style={Typography.cardTitle}>Filters</Text>
            <TextField
              label="From date · YYYY-MM-DD"
              value={draftFilters.from}
              onChangeText={(value) => setFilter("from", value)}
              autoCapitalize="none"
            />
            <TextField
              label="To date · YYYY-MM-DD"
              value={draftFilters.to}
              onChangeText={(value) => setFilter("to", value)}
              autoCapitalize="none"
            />
            <Text style={Typography.supporting}>Source</Text>
            <View style={styles.filterRow}>
              {(["all", "manual", "scheduled"] as const).map((value) => (
                <FilterChoice
                  key={value}
                  label={value === "all" ? "All" : value}
                  selected={draftFilters.source === value}
                  onPress={() => setFilter("source", value)}
                />
              ))}
            </View>
            <Text style={Typography.supporting}>Status</Text>
            <View style={styles.filterRow}>
              {(
                [
                  "all",
                  "completed",
                  "failed",
                  "in_progress",
                  "unknown",
                ] as const
              ).map((value) => (
                <FilterChoice
                  key={value}
                  label={
                    value === "in_progress"
                      ? "In progress"
                      : value === "unknown"
                        ? "Partial / unknown"
                        : value
                  }
                  selected={draftFilters.status === value}
                  onPress={() => setFilter("status", value)}
                />
              ))}
            </View>
            <Button
              variant="secondary"
              onPress={applyFilters}
              loading={loading}
            >
              Apply filters
            </Button>
          </BentoCard>
          {activePage ? (
            <BentoCard>
              <Text style={Typography.cardTitle}>
                {activePage.totals.total} matching feedings
              </Text>
              <Text style={Typography.supporting}>
                {activePage.totals.completed} completed ·{" "}
                {activePage.totals.needs_attention} need attention ·{" "}
                {activePage.totals.in_progress} in progress
              </Text>
              <Text style={Typography.supporting}>
                Showing {activePage.from_date} through {activePage.to_date}
              </Text>
              <Text style={[Typography.supporting, styles.secondary]}>
                {activePage.timezone_known
                  ? activePage.timezone
                  : `${activePage.timezone} · device timezone unavailable`}
              </Text>
              {rows.length === 0 ? (
                <Text style={Typography.body}>
                  No records match these filters.
                </Text>
              ) : (
                rows.map((record) => (
                  <Pressable
                    key={record.sequence_id}
                    accessibilityRole="button"
                    onPress={() => openRecord(record)}
                    style={styles.record}
                  >
                    <Text style={Typography.cardTitle}>
                      {record.source === "manual"
                        ? "Manual feed"
                        : "Scheduled feed"}{" "}
                      · {statusText(record.status)}
                    </Text>
                    <Text style={Typography.supporting}>
                      {createdAtLabel(record, activePage.timezone)}
                    </Text>
                    <Text style={Typography.supporting}>
                      {requestedText(record)}
                    </Text>
                    <Text style={[Typography.supporting, styles.secondary]}>
                      {record.nozzle_results
                        .map((result) =>
                          result.measurement_quality === "valid" &&
                          result.measured_dispensed_g !== null
                            ? `Nozzle ${result.nozzle_number}: ${result.measured_dispensed_g} g ${selectedDevice.isSimulated ? "synthetic simulator reading" : "measured"}`
                            : `Nozzle ${result.nozzle_number}: not measured`,
                        )
                        .join(" · ")}
                    </Text>
                  </Pressable>
                ))
              )}
              {activePage.next_cursor ? (
                <Button
                  variant="secondary"
                  onPress={() => void load(activePage.next_cursor, true)}
                  loading={loading}
                >
                  Load next 50
                </Button>
              ) : null}
            </BentoCard>
          ) : null}
          {activeError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {activeError}
            </Text>
          ) : null}
        </>
      ) : null}
    </AppPage>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: "row", gap: Spacing.two, flexWrap: "wrap" },
  filterChoice: {
    minHeight: ControlSize.minimumTarget,
    minWidth: ControlSize.minimumTarget,
    justifyContent: "center",
    paddingHorizontal: Spacing.two,
    borderRadius: 12,
    borderColor: Colors.light.controlBorder,
    borderWidth: 1,
  },
  filterSelected: {
    borderColor: Colors.light.primary,
    borderWidth: 2,
    backgroundColor: Colors.light.surfaceMuted,
  },
  record: {
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    gap: Spacing.one,
  },
  secondary: { color: Colors.light.textSecondary },
  error: { ...Typography.supporting, color: Colors.light.text },
});
