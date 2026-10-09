import { router } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  AppPage,
  BackAction,
  BentoCard,
  Button,
  EmptyState,
  PageHeading,
  StatusLabel,
  TextField,
} from "@/components/app-shell";
import { Colors, InterFamilies, Spacing, Typography } from "@/constants/theme";
import { sameDeviceRequestScope } from "@/lib/device-access-state";
import { useDeviceAccess } from "@/lib/device-access";
import {
  checkPendingWrite,
  isConfirmedScheduleRejection,
  loadPendingWrite,
  newScheduleId,
  readConfiguration,
  retryPendingWrite,
  saveConfiguration,
  validateSchedule,
  type ConfigurationRead,
  type Schedule,
} from "@/lib/schedules";

const weekdays = [
  [1, "M"],
  [2, "T"],
  [3, "W"],
  [4, "T"],
  [5, "F"],
  [6, "S"],
  [7, "S"],
] as const;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The schedule could not be saved. Check the connection and try again.";
}

export function ScheduleEditor({ scheduleId }: { scheduleId?: string }) {
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
  const [reload, setReload] = useState(0);
  const [configuration, setConfiguration] = useState<ConfigurationRead | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingLocal, setPendingLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [scheduleKey, setScheduleKey] = useState("");
  const [nozzle, setNozzle] = useState<1 | 2>(1);
  const [localTime, setLocalTime] = useState("08:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [doseMode, setDoseMode] = useState<"grams" | "fixed_portion">("grams");
  const [amount, setAmount] = useState("");
  const [fixedPortion, setFixedPortion] = useState("");
  const [timezone, setTimezone] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [initializedKey, setInitializedKey] = useState("");
  const key = `${currentScope.installationId ?? ""}:${currentScope.revision}:${deviceId ?? ""}:${scheduleId ?? "new"}`;
  const formSchedule = useMemo<Schedule>(
    () => ({
      schedule_id: scheduleKey,
      nozzle_number: nozzle,
      local_time: localTime,
      weekdays: days,
      enabled,
      dose:
        doseMode === "grams"
          ? { mode: "grams", amount_g: Number(amount) }
          : { mode: "fixed_portion", fixed_portion_id: fixedPortion.trim() },
    }),
    [
      scheduleKey,
      nozzle,
      localTime,
      days,
      enabled,
      doseMode,
      amount,
      fixedPortion,
    ],
  );
  const nozzleCapability =
    device?.capabilities.nozzles[String(nozzle) as "1" | "2"];

  useLayoutEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- Clear device-scoped draft state before paint. */
    setConfiguration(null);
    setLoadError(null);
    setMessage(null);
    setPendingLocal(false);
    setBusy(false);
    setScheduleKey("");
    setNozzle(1);
    setLocalTime("08:00");
    setDays([1, 2, 3, 4, 5, 6, 7]);
    setDoseMode("grams");
    setAmount("");
    setFixedPortion("");
    setTimezone("");
    setEnabled(true);
    setInitializedKey("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [key]);

  useEffect(() => {
    const scope = currentScope;
    const installationId = scope.installationId;
    if (!installationId || !deviceId || scope.selectedDeviceId !== deviceId)
      return;
    let active = true;
    void Promise.all([
      readConfiguration(installationId, deviceId),
      loadPendingWrite(installationId, deviceId),
    ])
      .then(([value, pending]) => {
        if (!active || !sameDeviceRequestScope(scope, scopeRef.current)) return;
        setConfiguration(value);
        setPendingLocal(pending !== null);
      })
      .catch((error: unknown) => {
        if (active && sameDeviceRequestScope(scope, scopeRef.current))
          setLoadError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [currentScope, deviceId, reload]);

  useLayoutEffect(() => {
    if (!configuration || initializedKey === key) return;
    /* eslint-disable react-hooks/set-state-in-effect -- Initialize the scoped form from its applied snapshot. */
    const values = configuration.applied_snapshot;
    const found = scheduleId
      ? values?.schedules.find((item) => item.schedule_id === scheduleId)
      : null;
    const id = found?.schedule_id ?? newScheduleId();
    setScheduleKey(id);
    setNozzle(found?.nozzle_number ?? 1);
    setLocalTime(found?.local_time ?? "08:00");
    setDays(found?.weekdays ?? [1, 2, 3, 4, 5, 6, 7]);
    setDoseMode(found?.dose.mode ?? "grams");
    setAmount(found?.dose.mode === "grams" ? String(found.dose.amount_g) : "");
    setFixedPortion(
      found?.dose.mode === "fixed_portion" ? found.dose.fixed_portion_id : "",
    );
    setTimezone(values?.timezone ?? "");
    setEnabled(found?.enabled ?? true);
    setInitializedKey(key);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [configuration, initializedKey, key, scheduleId]);

  const refresh = () => setReload((value) => value + 1);
  const canEdit =
    !!configuration &&
    !pendingLocal &&
    configuration.current_state.last_attempt_status !== "pending";

  async function resolvePending() {
    const scope = { ...currentScope };
    const installationId = scope.installationId;
    const requestedDeviceId = scope.selectedDeviceId;
    if (!installationId || !requestedDeviceId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await checkPendingWrite(installationId, requestedDeviceId);
      if (!sameDeviceRequestScope(scope, scopeRef.current)) return;
      if (result.conflict) {
        setPendingLocal(false);
        setMessage(
          "The original change was not recorded because another revision moved ahead. Your form values are still here; review the applied schedule before saving again.",
        );
      } else if (result.state?.request_status) {
        setPendingLocal(false);
        setMessage(
          result.state.request_status === "rejected"
            ? `The device rejected this save (${result.state.request_error_code ?? "configuration error"}). The applied schedule is still active.`
            : result.state.request_status === "applied"
              ? "The device applied this save."
              : "The original save is pending on the device.",
        );
      } else {
        setMessage(
          "The original save has no confirmed receipt yet. Retry only this original request or check again later.",
        );
      }
      refresh();
    } catch (error) {
      const pending = await loadPendingWrite(
        installationId,
        requestedDeviceId,
      ).catch(() => undefined);
      if (sameDeviceRequestScope(scope, scopeRef.current)) {
        setPendingLocal(pending !== null);
        setMessage(errorMessage(error));
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
    setMessage(null);
    try {
      await retryPendingWrite(installationId, requestedDeviceId);
      if (!sameDeviceRequestScope(scope, scopeRef.current)) return;
      setPendingLocal(false);
      setMessage(
        "The original save was received. It remains pending until the feeder applies it.",
      );
      refresh();
    } catch (error) {
      const pending = await loadPendingWrite(
        installationId,
        requestedDeviceId,
      ).catch(() => undefined);
      if (sameDeviceRequestScope(scope, scopeRef.current)) {
        setPendingLocal(pending !== null);
        setMessage(errorMessage(error));
        if (pending === null) refresh();
      }
    } finally {
      if (sameDeviceRequestScope(scope, scopeRef.current)) setBusy(false);
    }
  }

  async function submit() {
    const scope = currentScope;
    const installationId = scope.installationId;
    if (
      !installationId ||
      !device ||
      device.deviceId !== scope.selectedDeviceId ||
      !configuration ||
      !canEdit
    )
      return;
    setMessage(null);
    const nextTimezone = timezone.trim();
    try {
      new Intl.DateTimeFormat("en", { timeZone: nextTimezone });
    } catch {
      setMessage("Enter a valid IANA time zone, such as Asia/Manila.");
      return;
    }
    if (days.length === 0) {
      setMessage("Choose at least one repeat day.");
      return;
    }
    const activeSchedules = configuration.applied_snapshot?.schedules ?? [];
    const rest = activeSchedules.filter(
      (item) => item.schedule_id !== scheduleId,
    );
    const scheduleError = validateSchedule(
      formSchedule,
      rest,
      device.capabilities,
    );
    if (scheduleError) {
      setMessage(scheduleError);
      return;
    }
    if (
      !scheduleId &&
      activeSchedules.length >= (device.capabilities.maxSchedules ?? 0)
    ) {
      setMessage("This feeder has reached its approved schedule limit.");
      return;
    }
    if (
      !device.capabilities.nozzles[
        String(nozzle) as "1" | "2"
      ].doseModes.includes(doseMode)
    ) {
      setMessage(`Nozzle ${nozzle} does not support that dose mode.`);
      return;
    }
    const values = {
      timezone: nextTimezone,
      monitoring_limits: configuration.applied_snapshot?.monitoring_limits ?? {
        do_low_mg_l: null,
        do_high_mg_l: null,
      },
      low_feed_threshold_pct:
        configuration.applied_snapshot?.low_feed_threshold_pct ?? null,
      schedules: [
        ...rest,
        {
          ...formSchedule,
          dose:
            doseMode === "grams"
              ? { mode: "grams" as const, amount_g: Number(amount) }
              : {
                  mode: "fixed_portion" as const,
                  fixed_portion_id: fixedPortion.trim(),
                },
        },
      ],
    };
    if (values.schedules.length > (device.capabilities.maxSchedules ?? 0)) {
      setMessage("This feeder has reached its approved schedule limit.");
      return;
    }
    setBusy(true);
    try {
      await saveConfiguration(
        installationId,
        device.deviceId,
        configuration.current_state.desired_revision ?? 0,
        values,
      );
      if (!sameDeviceRequestScope(scope, scopeRef.current)) return;
      setMessage(
        "Saved. Waiting for the feeder to apply the complete schedule configuration.",
      );
      router.replace("/schedule");
    } catch (error) {
      if (!sameDeviceRequestScope(scope, scopeRef.current)) return;
      setPendingLocal(!isConfirmedScheduleRejection(error));
      setMessage(errorMessage(error));
    } finally {
      if (sameDeviceRequestScope(scope, scopeRef.current)) setBusy(false);
    }
  }

  if (!device)
    return (
      <AppPage>
        <BackAction label="Back" fallback="/schedule" />
        <PageHeading title={scheduleId ? "Edit schedule" : "Add schedule"} />
        <EmptyState
          icon="calendar-clock"
          title="Choose a feeder"
          description="Pair and select a feeder before changing its schedules."
          action="Pair a feeder"
          href="/devices/add"
        />
      </AppPage>
    );
  if (!device.capabilities.localScheduleExecution)
    return (
      <AppPage>
        <BackAction label="Back" fallback="/schedule" />
        <PageHeading title="Schedules unavailable" />
        <EmptyState
          icon="calendar-clock"
          title="Local scheduling is not supported"
          description="This feeder has no validated local schedule capability."
          action="Back to Schedule"
          href="/schedule"
        />
      </AppPage>
    );
  if (
    scheduleId &&
    configuration &&
    !configuration.applied_snapshot?.schedules.some(
      (item) => item.schedule_id === scheduleId,
    )
  ) {
    return (
      <AppPage>
        <BackAction label="Back" fallback="/schedule" />
        <PageHeading title="Schedule unavailable" />
        <EmptyState
          icon="calendar-clock"
          title="This schedule is not applied"
          description="Only schedules in the feeder's applied configuration can be edited."
          action="Back to Schedule"
          href="/schedule"
        />
      </AppPage>
    );
  }

  const editing = !!scheduleId;
  const messageIsError =
    !!message &&
    /invalid|rejected|could not|cannot|already|limit|does not|unavailable|pending request|retry only/i.test(
      message,
    );
  return (
    <AppPage>
      <BackAction label="Back" fallback="/schedule" />
      <PageHeading
        title={editing ? "Edit schedule" : "Add schedule"}
        description={`Selected feeder: ${device.alias ?? device.model}`}
      />
      {loadError ? (
        <BentoCard>
          <StatusLabel kind="failed">Unavailable</StatusLabel>
          <Text style={Typography.body}>{loadError}</Text>
          <Button variant="secondary" onPress={refresh}>
            Try again
          </Button>
        </BentoCard>
      ) : null}
      {configuration?.current_state.last_attempt_status === "pending" ? (
        <BentoCard>
          <StatusLabel kind="pending">Pending</StatusLabel>
          <Text style={Typography.body}>
            The feeder has not resolved the complete configuration yet. Your
            previously applied schedule remains active.
          </Text>
        </BentoCard>
      ) : null}
      {configuration?.current_state.last_attempt_status === "rejected" ? (
        <BentoCard>
          <StatusLabel kind="warning">Rejected</StatusLabel>
          <Text style={Typography.body}>
            The feeder rejected revision{" "}
            {configuration.current_state.last_attempt_revision}. The previous
            applied schedule remains active.
          </Text>
        </BentoCard>
      ) : null}
      {pendingLocal ? (
        <BentoCard>
          <StatusLabel kind="warning">Save status uncertain</StatusLabel>
          <Text style={Typography.body}>
            Check the original request first. The app will not create a new
            schedule revision automatically.
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
      {!configuration && !loadError ? (
        <BentoCard>
          <Text style={Typography.body}>
            Loading this feeder&apos;s applied configuration…
          </Text>
        </BentoCard>
      ) : null}
      <BentoCard>
        <Text style={Typography.cardTitle}>Feeding time</Text>
        <TextField
          label="Time (24 hour)"
          value={localTime}
          onChangeText={setLocalTime}
          placeholder="08:00"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          hint="Uses the feeder's configured time zone."
        />
        <Text style={styles.label}>Repeat days</Text>
        <View style={styles.days}>
          {weekdays.map(([day, label]) => {
            const selected = days.includes(day);
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityLabel={`Repeat on ${["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day]}`}
                accessibilityState={{ selected }}
                onPress={() =>
                  setDays((current) =>
                    selected
                      ? current.filter((item) => item !== day)
                      : [...current, day].sort(),
                  )
                }
                style={[styles.day, selected && styles.daySelected]}
              >
                <Text
                  style={[styles.dayText, selected && styles.dayTextSelected]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextField
          label="Time zone (IANA)"
          value={timezone}
          onChangeText={setTimezone}
          placeholder="Asia/Manila"
          autoCapitalize="none"
          hint="This exact zone is stored with the full device configuration."
        />
      </BentoCard>
      <BentoCard>
        <Text style={Typography.cardTitle}>Nozzle and dose</Text>
        <View style={styles.row}>
          {[1, 2].map((value) => {
            const selected = nozzle === value;
            const available =
              device.capabilities.nozzles[String(value) as "1" | "2"].enabled;
            return (
              <Pressable
                key={value}
                disabled={!available}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !available }}
                onPress={() => setNozzle(value as 1 | 2)}
                style={[
                  styles.choice,
                  selected && styles.choiceSelected,
                  !available && styles.disabled,
                ]}
              >
                <Text
                  style={[
                    styles.choiceText,
                    selected && styles.choiceTextSelected,
                  ]}
                >
                  Nozzle {value}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.row}>
          {nozzleCapability?.doseModes.includes("grams") ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: doseMode === "grams" }}
              onPress={() => setDoseMode("grams")}
              style={[
                styles.choice,
                doseMode === "grams" && styles.choiceSelected,
              ]}
            >
              <Text
                style={[
                  styles.choiceText,
                  doseMode === "grams" && styles.choiceTextSelected,
                ]}
              >
                Grams
              </Text>
            </Pressable>
          ) : null}
          {nozzleCapability?.doseModes.includes("fixed_portion") ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: doseMode === "fixed_portion" }}
              onPress={() => setDoseMode("fixed_portion")}
              style={[
                styles.choice,
                doseMode === "fixed_portion" && styles.choiceSelected,
              ]}
            >
              <Text
                style={[
                  styles.choiceText,
                  doseMode === "fixed_portion" && styles.choiceTextSelected,
                ]}
              >
                Fixed portion
              </Text>
            </Pressable>
          ) : null}
        </View>
        {doseMode === "grams" ? (
          <TextField
            label="Requested amount (g)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder={
              nozzleCapability?.minDoseG === null
                ? "Amount"
                : String(nozzleCapability?.minDoseG ?? "")
            }
            hint={`Supported ${nozzleCapability?.minDoseG ?? "unknown"}–${nozzleCapability?.maxDoseG ?? "unknown"} g, step ${nozzleCapability?.doseStepG ?? "unknown"} g.`}
          />
        ) : (
          <>
            {nozzleCapability?.fixedPortionIds.map((id) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected: fixedPortion === id }}
                onPress={() => setFixedPortion(id)}
                style={[
                  styles.choice,
                  fixedPortion === id && styles.choiceSelected,
                ]}
              >
                <Text
                  style={[
                    styles.choiceText,
                    fixedPortion === id && styles.choiceTextSelected,
                  ]}
                >
                  {id}
                </Text>
              </Pressable>
            ))}
            {nozzleCapability?.fixedPortionIds.length === 0 ? (
              <Text style={Typography.supporting}>
                No fixed portions are approved for this nozzle.
              </Text>
            ) : null}
          </>
        )}
        {editing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: enabled }}
            onPress={() => setEnabled((value) => !value)}
            style={styles.switch}
          >
            <StatusLabel kind={enabled ? "online" : "offline"}>
              {enabled ? "Enabled" : "Paused"}
            </StatusLabel>
            <Text style={Typography.supporting}>
              Tap to {enabled ? "pause" : "enable"} this schedule.
            </Text>
          </Pressable>
        ) : null}
      </BentoCard>
      {message ? (
        <BentoCard>
          <StatusLabel kind={messageIsError ? "warning" : "pending"}>
            {messageIsError ? "Needs attention" : "Save status"}
          </StatusLabel>
          <Text style={Typography.body}>{message}</Text>
        </BentoCard>
      ) : null}
      {configuration ? (
        <BentoCard>
          <Text style={Typography.supporting}>
            Changes are sent as a full configuration revision. The feeder&apos;s
            applied schedule remains active until it acknowledges the new
            revision.
          </Text>
          <Button
            loading={busy}
            disabled={!canEdit || !scheduleKey}
            onPress={() => void submit()}
          >
            {editing ? "Save schedule" : "Add schedule"}
          </Button>
        </BentoCard>
      ) : null}
    </AppPage>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  days: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  day: {
    width: 44,
    height: 44,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.light.controlBorder,
    backgroundColor: Colors.light.surface,
  },
  daySelected: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  dayText: {
    ...Typography.supporting,
    fontFamily: InterFamilies.medium,
    color: Colors.light.text,
  },
  dayTextSelected: { color: "#FFFFFF" },
  choice: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.controlBorder,
    backgroundColor: Colors.light.surface,
  },
  choiceSelected: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  choiceText: {
    ...Typography.supporting,
    fontFamily: InterFamilies.medium,
    color: Colors.light.text,
  },
  choiceTextSelected: { color: "#FFFFFF" },
  disabled: { opacity: 0.5 },
  label: {
    ...Typography.supporting,
    color: Colors.light.text,
    fontFamily: InterFamilies.medium,
  },
  switch: { gap: Spacing.two, paddingVertical: Spacing.two },
});
