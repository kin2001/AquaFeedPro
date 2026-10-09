import { router } from "expo-router";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AppPage,
  BentoCard,
  Button,
  EmptyState,
  ErrorState,
  LinkButton,
  PageHeading,
  StatusLabel,
} from "@/components/app-shell";
import { DevicePicker } from "@/components/device-picker";
import { Colors, InterFamilies, Spacing, Typography } from "@/constants/theme";
import { sameDeviceRequestScope } from "@/lib/device-access-state";
import { useDeviceAccess } from "@/lib/device-access";
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
function doseText(schedule: Schedule) {
  return schedule.dose.mode === "grams"
    ? `${schedule.dose.amount_g} g requested`
    : `Fixed portion ${schedule.dose.fixed_portion_id}`;
}
function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The schedule update could not be confirmed. Check the connection and status.";
}

export default function ScheduleScreen() {
  const access = useDeviceAccess();
  const device = access.selectedDevice;
  const deviceId = device?.deviceId ?? null;
  const currentScope = useMemo(
    () => ({
      installationId: access.installationId,
      revision: access.scopeRevision,
      selectedDeviceId: access.selectedDeviceId,
    }),
    [access.installationId, access.scopeRevision, access.selectedDeviceId],
  );
  const scopeRef = useRef(currentScope);
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useLayoutEffect(() => {
    // Clear the previous device's state before paint to prevent cross-device schedule flashes.
    /* eslint-disable react-hooks/set-state-in-effect -- Reset device-scoped state before paint. */
    setConfiguration(null);
    setNextOccurrence(null);
    setPendingLocal(false);
    setError(null);
    setNotice(null);
    setBusy(false);
    const installationId = currentScope.installationId;
    if (!installationId || !deviceId) return;
    const scope = { ...currentScope };
    let active = true;
    void Promise.all([
      readConfiguration(installationId, deviceId),
      readNextOccurrence(installationId, deviceId),
      loadPendingWrite(installationId, deviceId),
    ])
      .then(([value, next, pending]) => {
        if (!active || !sameDeviceRequestScope(scope, scopeRef.current)) return;
        setConfiguration(value);
        setNextOccurrence(next.occurrence);
        setPendingLocal(pending !== null);
      })
      .catch((reason: unknown) => {
        if (active && sameDeviceRequestScope(scope, scopeRef.current))
          setError(messageFor(reason));
      });
    return () => {
      active = false;
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [currentScope, deviceId, reload]);

  const refresh = () => setReload((current) => current + 1);
  const applied = configuration?.applied_snapshot;
  const requested =
    configuration?.current_state.last_attempt_status === "pending"
      ? configuration.desired_snapshot
      : null;
  const locked =
    pendingLocal ||
    configuration?.current_state.last_attempt_status === "pending" ||
    busy ||
    !configuration;
  const supported = !!device?.capabilities.localScheduleExecution;
  const schedules = [...(applied?.schedules ?? [])].sort(
    (left, right) =>
      left.local_time.localeCompare(right.local_time) ||
      left.nozzle_number - right.nozzle_number,
  );
  const enabledScheduleCount = schedules.filter(
    (schedule) => schedule.enabled,
  ).length;

  async function updateSchedule(id: string, action: "toggle" | "delete") {
    const scope = { ...currentScope };
    const installationId = scope.installationId;
    if (
      !device ||
      !installationId ||
      !configuration ||
      locked ||
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
      setNotice(
        action === "delete"
          ? "Delete submitted. The applied schedule remains until the feeder acknowledges the revision."
          : "Change submitted. The applied schedule remains until the feeder acknowledges the revision.",
      );
      refresh();
    } catch (reason) {
      if (!sameDeviceRequestScope(scope, scopeRef.current)) return;
      setPendingLocal(!isConfirmedScheduleRejection(reason));
      setError(messageFor(reason));
    } finally {
      if (sameDeviceRequestScope(scope, scopeRef.current)) setBusy(false);
    }
  }

  function askDelete(schedule: Schedule) {
    Alert.alert(
      "Delete schedule?",
      `Remove the ${schedule.local_time} Nozzle ${schedule.nozzle_number} schedule from ${device?.alias ?? device?.model ?? "this feeder"}?`,
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
    if (!installationId || !requestedDeviceId) return;
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
      else if (result.state?.request_status === "applied")
        setNotice("The feeder applied the original change.");
      else if (result.state?.request_status === "pending")
        setNotice(
          "The feeder has the original change and is still applying it.",
        );
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
      if (sameDeviceRequestScope(scope, scopeRef.current)) setBusy(false);
    }
  }

  async function retryOriginal() {
    const scope = { ...currentScope };
    const installationId = scope.installationId;
    const requestedDeviceId = scope.selectedDeviceId;
    if (!installationId || !requestedDeviceId) return;
    setBusy(true);
    setError(null);
    try {
      await retryPendingWrite(installationId, requestedDeviceId);
      if (!sameDeviceRequestScope(scope, scopeRef.current)) return;
      setPendingLocal(false);
      setNotice(
        "The original save was received. Waiting for the feeder to apply it.",
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
        if (pending === null) refresh();
      }
    } finally {
      if (sameDeviceRequestScope(scope, scopeRef.current)) setBusy(false);
    }
  }

  return (
    <AppPage edges={["top", "left", "right"]}>
      <PageHeading
        title="Schedule"
        description="Recurring feedings on the selected feeder."
      />
      <DevicePicker />
      {!device ? (
        <EmptyState
          icon="calendar-clock"
          title="No feeder selected"
          description="Pair and select a feeder to manage its schedules."
          action="Pair a feeder"
          href="/devices/add"
        />
      ) : null}
      {device && !supported ? (
        <EmptyState
          icon="calendar-clock"
          title="Local schedules unavailable"
          description="This feeder has no validated local schedule capability."
          action="Manage devices"
          href="/device"
        />
      ) : null}
      {device && supported && error ? (
        <ErrorState
          title="Schedules could not load"
          description={error}
          onRetry={refresh}
        />
      ) : null}
      {device && supported && !error && !configuration ? (
        <BentoCard>
          <Text style={Typography.body}>Loading applied schedules…</Text>
        </BentoCard>
      ) : null}
      {device && supported && configuration ? (
        <>
          <BentoCard>
            <StatusLabel
              kind={
                configuration.current_state.last_attempt_status === "rejected"
                  ? "warning"
                  : configuration.current_state.last_attempt_status ===
                      "pending"
                    ? "pending"
                    : configuration.current_state.last_attempt_status ===
                        "applied"
                      ? "completed"
                      : "offline"
              }
            >
              {configuration.current_state.last_attempt_status === "rejected"
                ? "Rejected"
                : configuration.current_state.last_attempt_status === "pending"
                  ? "Pending"
                  : configuration.current_state.last_attempt_status ===
                      "applied"
                    ? "Applied"
                    : "Not applied"}
            </StatusLabel>
            <Text style={Typography.cardTitle}>Device time zone</Text>
            <Text style={Typography.body}>
              {applied?.timezone ??
                "Choose an IANA time zone when adding the first schedule."}
            </Text>
            {configuration.current_state.last_attempt_status === "pending" ? (
              <Text style={Typography.supporting}>
                Revision {configuration.current_state.last_attempt_revision} is
                waiting for the feeder. The schedule below remains the last
                applied version.
              </Text>
            ) : null}
            {configuration.current_state.last_attempt_status === "rejected" ? (
              <Text style={Typography.supporting}>
                The feeder rejected revision{" "}
                {configuration.current_state.last_attempt_revision} (
                {configuration.current_state.error_code ??
                  "configuration error"}
                ). The prior applied configuration is retained.
              </Text>
            ) : null}
            {nextOccurrence ? (
              <View style={styles.next}>
                <Text style={styles.label}>Next applied feeding</Text>
                <Text style={Typography.body}>
                  {nextOccurrence.occurrence_local_date} at{" "}
                  {nextOccurrence.local_time} ({nextOccurrence.timezone})
                </Text>
                {nextOccurrence.targets.map((target) => (
                  <Text key={target.schedule_id} style={Typography.supporting}>
                    Nozzle {target.nozzle_number}:{" "}
                    {target.dose.mode === "grams"
                      ? `${target.dose.amount_g} g requested`
                      : `Fixed portion ${target.dose.fixed_portion_id}`}
                  </Text>
                ))}
                {nextOccurrence.targets.length === 2 ? (
                  <Text style={Typography.supporting}>
                    Nozzle 1, then Nozzle 2.
                  </Text>
                ) : null}
              </View>
            ) : null}
            {!nextOccurrence &&
            applied?.schedules.some((item) => item.enabled) ? (
              <Text style={Typography.supporting}>
                No upcoming occurrence was returned from the applied
                configuration.
              </Text>
            ) : null}
          </BentoCard>
          {pendingLocal ? (
            <BentoCard>
              <StatusLabel kind="warning">Save status uncertain</StatusLabel>
              <Text style={Typography.body}>
                Check the original request. An uncertain save is never repeated
                automatically.
              </Text>
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
            </BentoCard>
          ) : null}
          {error ? (
            <BentoCard>
              <StatusLabel kind="warning">Needs attention</StatusLabel>
              <Text style={Typography.body}>{error}</Text>
            </BentoCard>
          ) : null}
          {notice ? (
            <BentoCard>
              <StatusLabel kind="pending">Save status</StatusLabel>
              <Text style={Typography.body}>{notice}</Text>
            </BentoCard>
          ) : null}
          {requested ? (
            <BentoCard>
              <Text style={Typography.cardTitle}>
                Requested, waiting for device
              </Text>
              <Text style={Typography.supporting}>
                These changes are not active until the feeder acknowledges their
                revision.
              </Text>
              {requested.schedules.map((schedule) => (
                <Text key={schedule.schedule_id} style={Typography.body}>
                  Nozzle {schedule.nozzle_number} · {schedule.local_time} ·{" "}
                  {doseText(schedule)} ·{" "}
                  {schedule.enabled ? "Enabled" : "Paused"}
                </Text>
              ))}
            </BentoCard>
          ) : null}
          <BentoCard>
            <View style={styles.header}>
              <Text style={Typography.cardTitle}>Applied schedules</Text>
              <Text style={Typography.supporting}>
                {enabledScheduleCount} enabled · {schedules.length} /{" "}
                {device.capabilities.maxSchedules ?? "—"}
              </Text>
            </View>
            <Text style={Typography.supporting}>
              When both nozzles are due together, Nozzle 1 runs before Nozzle 2.
            </Text>
            {schedules.length ? (
              schedules.map((schedule) => (
                <View key={schedule.schedule_id} style={styles.schedule}>
                  <View style={styles.scheduleText}>
                    <Text style={Typography.cardTitle}>
                      {schedule.local_time} · Nozzle {schedule.nozzle_number}
                    </Text>
                    <Text style={Typography.supporting}>
                      {scheduleDays(schedule)} · {doseText(schedule)}
                    </Text>
                    <StatusLabel kind={schedule.enabled ? "online" : "offline"}>
                      {schedule.enabled ? "Enabled" : "Paused"}
                    </StatusLabel>
                  </View>
                  <View style={styles.actions}>
                    <Pressable
                      disabled={locked}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit Nozzle ${schedule.nozzle_number} schedule at ${schedule.local_time}`}
                      onPress={() =>
                        router.push({
                          pathname: "/schedules/[scheduleId]",
                          params: { scheduleId: schedule.schedule_id },
                        })
                      }
                      style={[styles.action, locked && styles.disabled]}
                    >
                      <Text style={styles.actionText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      disabled={locked}
                      accessibilityRole="button"
                      accessibilityLabel={`${schedule.enabled ? "Pause" : "Enable"} Nozzle ${schedule.nozzle_number} schedule`}
                      onPress={() =>
                        void updateSchedule(schedule.schedule_id, "toggle")
                      }
                      style={[styles.action, locked && styles.disabled]}
                    >
                      <Text style={styles.actionText}>
                        {schedule.enabled ? "Pause" : "Enable"}
                      </Text>
                    </Pressable>
                    <Pressable
                      disabled={locked}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete Nozzle ${schedule.nozzle_number} schedule`}
                      onPress={() => askDelete(schedule)}
                      style={[styles.action, locked && styles.disabled]}
                    >
                      <Text style={styles.actionText}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              <Text style={Typography.body}>
                No schedule has been applied to this feeder.
              </Text>
            )}
            {locked ||
            (applied?.schedules.length ?? 0) >=
              (device.capabilities.maxSchedules ?? 0) ? (
              <Button
                disabled
                accessibilityHint="Resolve a pending save or remove a schedule before adding another."
              >
                Add schedule
              </Button>
            ) : (
              <LinkButton href="/schedules/new" icon="plus">
                Add schedule
              </LinkButton>
            )}
          </BentoCard>
        </>
      ) : null}
    </AppPage>
  );
}

const styles = StyleSheet.create({
  next: { gap: Spacing.one, paddingTop: Spacing.two },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  schedule: {
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  scheduleText: { gap: Spacing.one },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.one },
  action: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.controlBorder,
  },
  actionText: {
    ...Typography.supporting,
    fontFamily: InterFamilies.medium,
    color: Colors.light.text,
  },
  disabled: { opacity: 0.5 },
  label: { ...Typography.supporting, color: Colors.light.textSecondary },
});
