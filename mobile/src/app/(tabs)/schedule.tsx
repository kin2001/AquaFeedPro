import { router, useFocusEffect } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import {
  AppPage,
  BentoCard,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  Notice,
  ScreenHeader,
  SectionHeader,
  Sheet,
  Skeleton,
  Toggle,
} from "@/components/app-shell";
import { displayTime } from "@/components/feed-status";
import { Colors, Typography } from "@/constants/theme";
import { sameDeviceRequestScope } from "@/lib/device-access-state";
import { subscribeDeviceChanges } from "@/lib/device-changes";
import { useDeviceAccess } from "@/lib/device-access";
import { errorText } from "@/lib/error-text";
import {
  checkPendingWrite,
  isConfirmedScheduleRejection,
  loadPendingWrite,
  readConfiguration,
  readNextOccurrence,
  retryPendingWrite,
  saveConfiguration,
  type ConfigurationRead,
  type NextOccurrence,
  type Schedule,
} from "@/lib/schedules";

const dayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function scheduleDays(schedule: Schedule) {
  return schedule.weekdays.length === 7
    ? "Every day"
    : schedule.weekdays.map((day) => dayNames[day]).join(", ");
}
function nozzleText(schedule: Schedule) {
  return schedule.targets.length === 2
    ? "Both nozzles"
    : `Nozzle ${schedule.targets[0].nozzle_number}`;
}
function doseText(schedule: Schedule) {
  return schedule.targets
    .map(
      ({ nozzle_number, dose }) =>
        (schedule.targets.length === 2 ? `N${nozzle_number} ` : "") +
        (dose.mode === "grams"
          ? `${dose.amount_g} g`
          : `Fixed portion ${dose.fixed_portion_id}`),
    )
    .join(" · ");
}
function messageFor(error: unknown) {
  return errorText(
    error,
    "The schedule update could not be confirmed. Check the connection and status.",
  );
}
const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function ScheduleScreen() {
  const access = useDeviceAccess();
  const device = access.selectedDevice;
  const deviceId = device?.deviceId ?? null;
  const motionScope = [
    access.installationId,
    deviceId,
    access.scopeRevision,
  ].join(":");
  const currentScope = useMemo(
    () => ({
      installationId: access.installationId,
      revision: access.scopeRevision,
      selectedDeviceId: access.selectedDeviceId,
    }),
    [access.installationId, access.scopeRevision, access.selectedDeviceId],
  );
  const scopeRef = useRef(currentScope);
  const focused = useRef(false);
  const focusGeneration = useRef(0);
  const readCurrentScopeRef = useRef<
    ((focusGeneration?: number, blockEditing?: boolean) => void) | null
  >(null);
  useLayoutEffect(() => {
    scopeRef.current = currentScope;
  }, [currentScope]);
  const [configuration, setConfiguration] = useState<ConfigurationRead | null>(
    null,
  );
  const [nextOccurrence, setNextOccurrence] = useState<NextOccurrence | null>(
    null,
  );
  const [pendingLocal, setPendingLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<Schedule | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [localChange, setLocalChange] = useState<{
    id: string;
    target: "enabled" | "paused" | "removed";
  } | null>(null);

  useLayoutEffect(() => {
    // Clear the previous device's state before paint to prevent cross-device schedule flashes.
    /* eslint-disable react-hooks/set-state-in-effect -- Reset device-scoped state before paint. */
    setConfiguration(null);
    setNextOccurrence(null);
    setPendingLocal(false);
    setError(null);
    setNotice(null);
    setRecoveryOpen(false);
    setLocalChange(null);
    setBusy(false);
    setRefreshing(false);
    const installationId = currentScope.installationId;
    if (!installationId || !deviceId) return;
    const scope = { ...currentScope };
    let active = true;
    let loading = false;
    let refreshQueued = false;
    let queuedFocusGeneration: number | undefined;
    const isCurrent = (requestedFocusGeneration?: number) =>
      active &&
      sameDeviceRequestScope(scope, scopeRef.current) &&
      (requestedFocusGeneration === undefined ||
        (focused.current &&
          focusGeneration.current === requestedFocusGeneration));
    const hasCurrentQueuedRefresh = () =>
      refreshQueued &&
      (queuedFocusGeneration === undefined ||
        (focused.current && focusGeneration.current === queuedFocusGeneration));
    const read = (requestedFocusGeneration?: number, blockEditing = false) => {
      if (!isCurrent(requestedFocusGeneration)) return;
      // Routine Realtime reads keep controls steady; explicit saves/retries lock editing.
      if (blockEditing) setRefreshing(true);
      if (loading) {
        refreshQueued = true;
        queuedFocusGeneration = requestedFocusGeneration;
        return;
      }
      loading = true;
      void Promise.all([
        readConfiguration(installationId, deviceId),
        readNextOccurrence(installationId, deviceId),
        loadPendingWrite(installationId, deviceId),
      ])
        .then(([value, next, pending]) => {
          if (!isCurrent(requestedFocusGeneration) || hasCurrentQueuedRefresh())
            return;
          setConfiguration(value);
          setNextOccurrence(next.occurrence);
          setPendingLocal(pending !== null);
          setError(null);
          setNotice(null);
        })
        .catch((reason: unknown) => {
          if (!isCurrent(requestedFocusGeneration) || hasCurrentQueuedRefresh())
            return;
          setError(
            errorText(
              reason,
              "The schedules could not be loaded. Check the connection and try again.",
            ),
          );
        })
        .finally(() => {
          loading = false;
          if (refreshQueued) {
            const nextFocusGeneration = queuedFocusGeneration;
            refreshQueued = false;
            queuedFocusGeneration = undefined;
            if (isCurrent(nextFocusGeneration)) read(nextFocusGeneration);
          }
          if (isCurrent() && !loading) setRefreshing(false);
        });
    };
    readCurrentScopeRef.current = read;
    read();
    return () => {
      active = false;
      if (readCurrentScopeRef.current === read)
        readCurrentScopeRef.current = null;
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [currentScope, deviceId]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const currentFocusGeneration = ++focusGeneration.current;
      if (!deviceId || !currentScope.installationId)
        return () => {
          focused.current = false;
          focusGeneration.current += 1;
        };
      const scope = { ...currentScope };
      const stopListening = subscribeDeviceChanges(
        "schedule-configuration-" +
          scope.installationId +
          "-" +
          scope.revision +
          "-" +
          (scope.selectedDeviceId ?? ""),
        deviceId,
        ["device_config_revisions"],
        () => {
          if (
            sameDeviceRequestScope(scope, scopeRef.current) &&
            focused.current &&
            focusGeneration.current === currentFocusGeneration
          )
            readCurrentScopeRef.current?.(currentFocusGeneration);
        },
      );
      return () => {
        focused.current = false;
        focusGeneration.current += 1;
        stopListening();
      };
    }, [currentScope, deviceId]),
  );

  const refresh = () => readCurrentScopeRef.current?.(undefined, true);
  const applied = configuration?.applied_snapshot;
  const requested =
    configuration?.current_state.last_attempt_status === "pending"
      ? configuration.desired_snapshot
      : null;
  const locked =
    pendingLocal ||
    configuration?.current_state.last_attempt_status === "pending" ||
    busy ||
    refreshing ||
    !!error ||
    !configuration;
  const supported = !!device?.capabilities.localScheduleExecution;
  const schedules = [...(applied?.schedules ?? [])].sort(
    (left, right) =>
      left.local_time.localeCompare(right.local_time) ||
      left.targets[0].nozzle_number - right.targets[0].nozzle_number,
  );

  async function updateSchedule(id: string, action: "toggle" | "delete") {
    const scope = { ...currentScope };
    const installationId = scope.installationId;
    if (
      !device ||
      !installationId ||
      !configuration ||
      locked ||
      writing.current ||
      !applied ||
      !sameDeviceRequestScope(scope, scopeRef.current) ||
      device.deviceId !== scope.selectedDeviceId
    )
      return;
    const requestedDeviceId = device.deviceId;
    const schedule = applied.schedules.find((item) => item.schedule_id === id);
    if (!schedule) return;
    const schedules = applied.schedules.flatMap((item) => {
      if (item.schedule_id !== id) return [item];
      return action === "delete" ? [] : [{ ...item, enabled: !item.enabled }];
    });
    writing.current = true;
    setLocalChange({
      id,
      target:
        action === "delete"
          ? "removed"
          : schedule.enabled
            ? "paused"
            : "enabled",
    });
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveConfiguration(
        installationId,
        requestedDeviceId,
        configuration.current_state.desired_revision ?? applied.revision,
        {
          timezone: applied.timezone,
          monitoring_limits: applied.monitoring_limits,
          low_feed_threshold_pct: applied.low_feed_threshold_pct,
          schedules,
        },
      );
      if (!sameDeviceRequestScope(scope, scopeRef.current)) return;
      setNotice(null);
      refresh();
    } catch (reason) {
      if (!sameDeviceRequestScope(scope, scopeRef.current)) return;
      setPendingLocal(!isConfirmedScheduleRejection(reason));
      setError(messageFor(reason));
    } finally {
      writing.current = false;
      if (sameDeviceRequestScope(scope, scopeRef.current)) setBusy(false);
    }
  }

  function askDelete(schedule: Schedule) {
    Alert.alert(
      "Delete schedule?",
      `Remove the ${schedule.local_time} ${nozzleText(schedule)} schedule from ${device?.alias ?? device?.model ?? "this feeder"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void updateSchedule(schedule.schedule_id, "delete"),
        },
      ],
    );
  }

  async function resolvePending() {
    const scope = { ...currentScope };
    const installationId = scope.installationId;
    const requestedDeviceId = scope.selectedDeviceId;
    if (!installationId || !requestedDeviceId || writing.current || busy)
      return;
    writing.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await checkPendingWrite(installationId, requestedDeviceId);
      if (!sameDeviceRequestScope(scope, scopeRef.current)) return;
      setPendingLocal(
        result.state?.request_status === null && result.pending !== null,
      );
      if (result.conflict)
        setNotice(
          "The original change was not recorded because another revision moved ahead. Review the applied schedule before making a new change.",
        );
      else if (result.state?.request_status === "rejected")
        setNotice(
          `The feeder rejected the original change (${result.state.request_error_code ?? "configuration error"}). The applied schedules remain active.`,
        );
      else if (
        result.state?.request_status === "applied" ||
        result.state?.request_status === "pending"
      )
        setNotice(null);
      else
        setNotice(
          "No receipt is confirmed yet. Keep the original request and check again later.",
        );
      refresh();
    } catch (reason) {
      const pending = await loadPendingWrite(
        installationId,
        requestedDeviceId,
      ).catch(() => undefined);
      if (sameDeviceRequestScope(scope, scopeRef.current)) {
        setPendingLocal(pending !== null);
        setError(messageFor(reason));
      }
    } finally {
      writing.current = false;
      if (sameDeviceRequestScope(scope, scopeRef.current)) setBusy(false);
    }
  }

  async function retryOriginal() {
    const scope = { ...currentScope };
    const installationId = scope.installationId;
    const requestedDeviceId = scope.selectedDeviceId;
    if (!installationId || !requestedDeviceId || writing.current || busy)
      return;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      await retryPendingWrite(installationId, requestedDeviceId);
      if (!sameDeviceRequestScope(scope, scopeRef.current)) return;
      setPendingLocal(false);
      setNotice(null);
      refresh();
    } catch (reason) {
      const pending = await loadPendingWrite(
        installationId,
        requestedDeviceId,
      ).catch(() => undefined);
      if (sameDeviceRequestScope(scope, scopeRef.current)) {
        setPendingLocal(pending !== null);
        setError(messageFor(reason));
        if (pending === null) refresh();
      }
    } finally {
      writing.current = false;
      if (sameDeviceRequestScope(scope, scopeRef.current)) setBusy(false);
    }
  }

  const attempt = configuration?.current_state;
  const hasNextNotice =
    !nextOccurrence && !!applied?.schedules.some((item) => item.enabled);
  const wrongZone = !!applied?.timezone && applied.timezone !== phoneZone;
  const recoveryTitle = pendingLocal
    ? "Save status uncertain"
    : attempt?.last_attempt_status === "rejected"
      ? "Save rejected"
      : error || notice
        ? "Save needs attention"
        : null;
  const rejectedReason =
    attempt?.last_attempt_status === "rejected"
      ? `The feeder rejected the last change (${attempt.error_code ?? "configuration error"}). Applied schedules remain active.`
      : null;
  const changedRows = requested
    ? schedules.filter(
        (schedule) =>
          JSON.stringify(
            requested.schedules.find(
              (next) => next.schedule_id === schedule.schedule_id,
            ),
          ) !== JSON.stringify(schedule),
      )
    : [];
  const additions =
    requested?.schedules.filter(
      (next) =>
        !schedules.some(
          (schedule) => schedule.schedule_id === next.schedule_id,
        ),
    ) ?? [];
  const removals = requested
    ? schedules.filter(
        (schedule) =>
          !requested.schedules.some(
            (next) => next.schedule_id === schedule.schedule_id,
          ),
      )
    : [];
  // Only offer actions for a schedule that is still in the applied list.
  const menu =
    menuFor &&
    schedules.some((item) => item.schedule_id === menuFor.schedule_id)
      ? menuFor
      : null;
  const canAdd = !!device && supported && !!configuration;
  const addBlocked =
    locked ||
    (applied?.schedules.length ?? 0) >=
      (device?.capabilities.maxSchedules ?? 0);

  return (
    <AppPage
      edges={["top", "left", "right"]}
      header={
        <ScreenHeader
          title="Schedule"
          action={
            canAdd ? (
              <IconButton
                icon="plus"
                radius={24}
                outlined
                accessibilityLabel="Add schedule"
                disabled={addBlocked}
                onPress={() => router.push("/schedules/new")}
              />
            ) : undefined
          }
        />
      }
    >
      {!device ? (
        <EmptyState
          icon="calendar-clock"
          title="Select a feeder"
          description="Pair then select a feeder to view its schedules."
          action="Pair feeder"
          href="/devices/add"
        />
      ) : null}
      {device && !supported ? (
        <EmptyState
          icon="calendar-clock"
          title="Scheduling unavailable"
          description="This feeder has no validated local scheduling capability."
          action="Open Settings"
          href="/device"
        />
      ) : null}
      {device && supported && error && !configuration ? (
        <ErrorState
          title="Schedules could not load"
          description={error}
          onRetry={refresh}
        />
      ) : null}
      {device && supported && !error && !configuration ? (
        <View style={styles.group}>
          <Skeleton height={112} />
          <Skeleton height={112} />
          <Skeleton height={112} />
        </View>
      ) : null}
      {device && supported && configuration ? (
        <>
          {!applied?.timezone ? (
            <Notice tone="info">
              Set the time zone when you add the first schedule.
            </Notice>
          ) : wrongZone ? (
            <Text
              style={Typography.metadata}
            >{`Feeder time · ${applied.timezone} · Different from your phone`}</Text>
          ) : null}
          {recoveryTitle ? (
            <BentoCard flush>
              <ListRow
                icon="circle-alert"
                title={recoveryTitle}
                meta="Review save status"
                trailing="chevron"
                onPress={() => setRecoveryOpen(true)}
                accessibilityLabel={`${recoveryTitle}. Open original save recovery. Applied schedules remain active.`}
              />
            </BentoCard>
          ) : null}
          {requested &&
          (additions.length || removals.length || !changedRows.length) ? (
            <View style={styles.group}>
              {additions.map((schedule) => (
                <Text
                  key={schedule.schedule_id}
                  style={Typography.metadata}
                >{`Waiting to add ${displayTime(schedule.local_time)} · ${nozzleText(schedule)} · ${doseText(schedule)}. Not active yet.`}</Text>
              ))}
              {removals.length ? (
                <Text
                  style={Typography.metadata}
                >{`${removals.length} removal${removals.length === 1 ? "" : "s"} waiting for the feeder. Applied schedules remain active.`}</Text>
              ) : null}
              {!additions.length && !removals.length && !changedRows.length ? (
                <Text style={Typography.metadata}>
                  Configuration update waiting for the feeder.
                </Text>
              ) : null}
            </View>
          ) : null}
          {hasNextNotice ? (
            <Text style={Typography.metadata}>
              No upcoming feeding was found for the enabled schedules.
            </Text>
          ) : null}
          <Sheet
            visible={recoveryOpen && recoveryTitle !== null}
            title={recoveryTitle ?? "Save status"}
            onClose={() => setRecoveryOpen(false)}
          >
            <Text style={Typography.supporting}>
              {[
                error,
                rejectedReason,
                notice,
                pendingLocal
                  ? "Check the original request. An uncertain save is never repeated automatically."
                  : null,
              ]
                .filter(Boolean)
                .join(" ")}
            </Text>
            {pendingLocal ? (
              <>
                <Button
                  variant="secondary"
                  loading={busy}
                  onPress={() => void resolvePending()}
                >
                  Check original save
                </Button>
                <Button
                  variant="text"
                  loading={busy}
                  onPress={() => void retryOriginal()}
                >
                  Retry the same save
                </Button>
              </>
            ) : null}
            <Button variant="text" disabled={busy} onPress={refresh}>
              Refresh
            </Button>
          </Sheet>
          <View style={styles.section}>
            <SectionHeader title="Schedules" />
            {schedules.length === 0 ? (
              locked ? (
                <Text style={Typography.supporting}>No schedules yet</Text>
              ) : (
                <EmptyState
                  icon="calendar-clock"
                  title="No schedules yet"
                  description="Use + to add a time."
                  action={null}
                />
              )
            ) : (
              <View style={styles.group}>
                {schedules.map((schedule, index) => (
                  <BentoCard
                    key={schedule.schedule_id}
                    delay={Math.min(index, 3) * 55}
                    revealKey={
                      motionScope + ":schedule:" + schedule.schedule_id
                    }
                    gap={0}
                  >
                    <View style={styles.cardTop}>
                      <Text
                        accessibilityRole="header"
                        style={[
                          Typography.title,
                          !schedule.enabled && {
                            color: Colors.light.textSecondary,
                          },
                        ]}
                      >
                        {displayTime(schedule.local_time)}
                      </Text>
                      <View style={styles.toggleSlot}>
                        <Toggle
                          value={schedule.enabled}
                          busy={
                            !pendingLocal &&
                            !error &&
                            (changedRows.some(
                              (row) => row.schedule_id === schedule.schedule_id,
                            ) ||
                              ((busy || refreshing) &&
                                localChange?.id === schedule.schedule_id))
                          }
                          disabled={locked}
                          accessibilityHint={`Applied ${schedule.enabled ? "enabled" : "paused"}; requested ${requested ? (requested.schedules.find((row) => row.schedule_id === schedule.schedule_id)?.enabled === undefined ? "removed" : requested.schedules.find((row) => row.schedule_id === schedule.schedule_id)?.enabled ? "enabled" : "paused") : (busy || refreshing) && localChange?.id === schedule.schedule_id ? localChange.target : schedule.enabled ? "enabled" : "paused"}. Feeder time ${applied?.timezone ?? "unavailable"}.`}
                          onValueChange={() =>
                            void updateSchedule(schedule.schedule_id, "toggle")
                          }
                          accessibilityLabel={
                            (schedule.enabled ? "Pause" : "Enable") +
                            " " +
                            nozzleText(schedule) +
                            " schedule"
                          }
                        />
                      </View>
                    </View>
                    <Text style={[Typography.supporting, styles.tightTop]}>
                      {nozzleText(schedule) +
                        " · " +
                        scheduleDays(schedule) +
                        " · " +
                        doseText(schedule)}
                    </Text>
                    {schedule.targets.length === 1 &&
                    schedule.targets[0].nozzle_number === 2 &&
                    schedules.some(
                      (other) =>
                        other.targets.some(
                          (target) => target.nozzle_number === 1,
                        ) &&
                        other.local_time === schedule.local_time &&
                        other.weekdays.some((day) =>
                          schedule.weekdays.includes(day),
                        ),
                    ) ? (
                      <Text style={[Typography.metadata, styles.tightTop]}>
                        Runs after Nozzle 1
                      </Text>
                    ) : null}
                    <View style={styles.cardBottom}>
                      <View style={styles.menuSlot}>
                        <IconButton
                          icon="ellipsis"
                          disabled={locked}
                          accessibilityLabel={
                            "More actions for " +
                            nozzleText(schedule) +
                            " schedule at " +
                            schedule.local_time
                          }
                          onPress={() => setMenuFor(schedule)}
                        />
                      </View>
                    </View>
                  </BentoCard>
                ))}
              </View>
            )}
          </View>
          <Sheet
            visible={menu !== null}
            onClose={() => setMenuFor(null)}
            title={
              menu
                ? displayTime(menu.local_time) + " · " + nozzleText(menu)
                : ""
            }
          >
            <BentoCard flush>
              <ListRow
                icon="pencil"
                title="Edit"
                trailing="chevron"
                accessibilityLabel={
                  menu
                    ? `Edit ${nozzleText(menu)} schedule at ${menu.local_time}`
                    : undefined
                }
                onPress={() => {
                  const target = menu;
                  setMenuFor(null);
                  if (target)
                    router.push({
                      pathname: "/schedules/[scheduleId]",
                      params: { scheduleId: target.schedule_id },
                    });
                }}
              />
              <ListRow
                divider
                icon="trash-2"
                title="Delete"
                accessibilityLabel={
                  menu ? `Delete ${nozzleText(menu)} schedule` : undefined
                }
                onPress={() => {
                  const target = menu;
                  setMenuFor(null);
                  if (target) askDelete(target);
                }}
              />
            </BentoCard>
          </Sheet>
        </>
      ) : null}
    </AppPage>
  );
}

const styles = StyleSheet.create({
  group: { gap: 12 },
  section: { gap: 8 },
  tightTop: { marginTop: 4 },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 32,
  },
  toggleSlot: { marginVertical: -8 },
  cardBottom: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    minHeight: 28,
  },
  menuSlot: { marginVertical: -10, marginRight: -14 },
});
