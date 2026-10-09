import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import {
  AppPage,
  BackAction,
  BentoCard,
  Button,
  PageHeading,
  TextField,
} from "@/components/app-shell";
import { Colors, ControlSize, Spacing, Typography } from "@/constants/theme";
import { useDeviceAccess, type NozzleCapability } from "@/lib/device-access";
import {
  loadPendingManualFeed,
  reconcileManualFeed,
  submitManualFeed,
  type ManualCommand,
  type ManualTarget,
} from "@/lib/manual-feed";

type NozzleChoice = "1" | "2" | "both";
type LegDose =
  { mode: "grams"; amount: string } | { mode: "fixed_portion"; id: string };

function supported(nozzle: NozzleCapability) {
  if (nozzle.doseModes.includes("grams")) {
    return { mode: "grams" as const, amount: String(nozzle.minDoseG ?? "") };
  }
  return {
    mode: "fixed_portion" as const,
    id: nozzle.fixedPortionIds[0] ?? "",
  };
}

function makeTarget(
  nozzleNumber: 1 | 2,
  capability: NozzleCapability,
  dose: LegDose,
): ManualTarget | null {
  if (dose.mode === "fixed_portion") {
    return capability.doseModes.includes("fixed_portion") &&
      capability.fixedPortionIds.includes(dose.id)
      ? {
          nozzle_number: nozzleNumber,
          dose: { mode: "fixed_portion", fixed_portion_id: dose.id },
        }
      : null;
  }
  const amount = Number(dose.amount);
  const min = capability.minDoseG;
  const max = capability.maxDoseG;
  const step = capability.doseStepG;
  if (
    !capability.doseModes.includes("grams") ||
    !Number.isFinite(amount) ||
    min === null ||
    max === null ||
    step === null ||
    amount < min ||
    amount > max ||
    Math.abs((amount - min) / step - Math.round((amount - min) / step)) > 1e-7
  )
    return null;
  return {
    nozzle_number: nozzleNumber,
    dose: { mode: "grams", amount_g: amount },
  };
}

function resultStatus(value: string) {
  const labels: Record<string, string> = {
    queued: "Waiting for the simulator",
    accepted: "Accepted by the simulator",
    running: "In progress",
    completed: "Completed",
    failed: "Failed",
    rejected: "Rejected",
    expired: "Expired before starting",
    unknown: "Outcome unknown",
    not_started: "Not started",
  };
  return labels[value] ?? "Status unavailable";
}

function isTerminal(status: string) {
  return [
    "completed",
    "partial",
    "failed",
    "rejected",
    "expired",
    "unknown",
  ].includes(status);
}

function DoseControl({
  label,
  capability,
  value,
  onChange,
}: {
  label: string;
  capability: NozzleCapability;
  value: LegDose;
  onChange: (next: LegDose) => void;
}) {
  if (capability.doseModes.includes("grams")) {
    return (
      <TextField
        label={`${label} dose in grams`}
        value={
          value.mode === "grams"
            ? value.amount
            : String(capability.minDoseG ?? "")
        }
        onChangeText={(amount) => onChange({ mode: "grams", amount })}
        keyboardType="decimal-pad"
        inputMode="decimal"
        hint={`Supported range ${capability.minDoseG} to ${capability.maxDoseG} grams in ${capability.doseStepG} gram steps.`}
      />
    );
  }
  return (
    <View style={styles.doseField}>
      <Text style={Typography.supporting}>{label} portion</Text>
      <View style={styles.choiceRow}>
        {capability.fixedPortionIds.map((id) => (
          <ChoiceButton
            key={id}
            label={id}
            selected={value.mode === "fixed_portion" && value.id === id}
            onPress={() => onChange({ mode: "fixed_portion", id })}
          />
        ))}
      </View>
    </View>
  );
}

function ChoiceButton({
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
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      <Text style={Typography.supporting}>{label}</Text>
    </Pressable>
  );
}

export default function FeedConfirmationScreen() {
  const {
    installationId,
    scopeRevision,
    selectedDevice,
    selectedDeviceId,
    devices,
  } = useDeviceAccess();
  const [targetScope] = useState(() => ({
    deviceId: selectedDevice?.deviceId ?? null,
    installationId,
    scopeRevision,
    selectedDeviceId,
  }));
  const targetDeviceId = targetScope.deviceId;
  const currentScope = useRef({
    installationId,
    scopeRevision,
    selectedDeviceId,
  });
  useLayoutEffect(() => {
    currentScope.current = { installationId, scopeRevision, selectedDeviceId };
  }, [installationId, scopeRevision, selectedDeviceId]);
  const device =
    devices.find((candidate) => candidate.deviceId === targetDeviceId) ?? null;
  const targetChanged =
    !targetDeviceId ||
    targetDeviceId !== selectedDeviceId ||
    targetScope.installationId !== installationId ||
    targetScope.scopeRevision !== scopeRevision ||
    targetScope.selectedDeviceId !== selectedDeviceId;
  const [choice, setChoice] = useState<NozzleChoice>("1");
  const [dose1, setDose1] = useState<LegDose>(() =>
    device
      ? supported(device.capabilities.nozzles["1"])
      : { mode: "grams", amount: "" },
  );
  const [dose2, setDose2] = useState<LegDose>(() =>
    device
      ? supported(device.capabilities.nozzles["2"])
      : { mode: "grams", amount: "" },
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [command, setCommand] = useState<ManualCommand | null>(null);
  const submitting = useRef(false);
  const requestGeneration = useRef(0);
  const scopeIsCurrent = useCallback(
    () =>
      currentScope.current.installationId === targetScope.installationId &&
      currentScope.current.scopeRevision === targetScope.scopeRevision &&
      currentScope.current.selectedDeviceId === targetDeviceId,
    [targetDeviceId, targetScope],
  );

  const refreshPending = useCallback(async () => {
    if (!installationId || !targetDeviceId || targetChanged) return;
    try {
      const saved = await loadPendingManualFeed(installationId, targetDeviceId);
      if (!saved || !scopeIsCurrent()) return;
      const restored = await reconcileManualFeed(
        installationId,
        targetDeviceId,
        saved.idempotency_key,
      );
      if (scopeIsCurrent()) setCommand(restored);
    } catch {
      if (scopeIsCurrent())
        setMessage("A saved feed needs a status check. No new feed was sent.");
    }
  }, [installationId, scopeIsCurrent, targetChanged, targetDeviceId]);

  useFocusEffect(
    useCallback(() => {
      void refreshPending();
    }, [refreshPending]),
  );

  const targetRows: ManualTarget[] = [];
  const nozzle1 = device?.capabilities.nozzles["1"];
  const nozzle2 = device?.capabilities.nozzles["2"];
  const firstTarget = nozzle1 ? makeTarget(1, nozzle1, dose1) : null;
  const secondTarget = nozzle2 ? makeTarget(2, nozzle2, dose2) : null;
  if ((choice === "1" || choice === "both") && firstTarget)
    targetRows.push(firstTarget);
  if ((choice === "2" || choice === "both") && secondTarget)
    targetRows.push(secondTarget);

  const online = device?.contactFreshness === "fresh";
  const lockout = command?.safety_lockout === true;
  const valid = targetRows.length === (choice === "both" ? 2 : 1);

  const checkStatus = async () => {
    if (
      !installationId ||
      !device ||
      busy ||
      targetChanged ||
      submitting.current
    )
      return;
    submitting.current = true;
    const generation = ++requestGeneration.current;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await loadPendingManualFeed(
        installationId,
        device.deviceId,
      );
      if (!saved) {
        setMessage("There is no saved request to check.");
        return;
      }
      if (!scopeIsCurrent()) return;
      const result = await reconcileManualFeed(
        installationId,
        device.deviceId,
        saved.idempotency_key,
      );
      if (generation === requestGeneration.current && scopeIsCurrent())
        setCommand(result);
    } catch (reason) {
      if (generation === requestGeneration.current && scopeIsCurrent())
        setMessage(
          reason instanceof Error
            ? reason.message
            : "Feed status is not available yet.",
        );
    } finally {
      submitting.current = false;
      if (generation === requestGeneration.current) setBusy(false);
    }
  };

  const confirmFeed = async () => {
    if (
      !installationId ||
      !device ||
      !valid ||
      !online ||
      targetChanged ||
      lockout ||
      submitting.current
    )
      return;
    submitting.current = true;
    const generation = ++requestGeneration.current;
    const scopeDeviceId = device.deviceId;
    const scopeInstallationId = installationId;
    const targets = targetRows;
    setBusy(true);
    setMessage(null);
    try {
      let result = await submitManualFeed(
        scopeInstallationId,
        scopeDeviceId,
        device.capabilitiesRevision,
        targets,
        scopeIsCurrent,
      );
      if (generation === requestGeneration.current && scopeIsCurrent())
        setCommand(result);
      for (
        let attempt = 0;
        attempt < 12 && !isTerminal(result.status);
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!scopeIsCurrent() || generation !== requestGeneration.current)
          return;
        result = await checkSavedStatus(scopeInstallationId, scopeDeviceId);
        if (generation === requestGeneration.current && scopeIsCurrent())
          setCommand(result);
      }
    } catch (reason) {
      if (generation === requestGeneration.current && scopeIsCurrent())
        setMessage(
          reason instanceof Error
            ? reason.message
            : "Feed status could not be confirmed.",
        );
    } finally {
      submitting.current = false;
      if (generation === requestGeneration.current) setBusy(false);
    }
  };

  if (!device || !installationId) {
    return (
      <AppPage>
        <BackAction label="Back" fallback="/" />
        <PageHeading title="Feed now" />
        <BentoCard>
          <Text style={Typography.body}>
            Select a paired feeder before choosing a feed.
          </Text>
        </BentoCard>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <BackAction label="Cancel" fallback="/" />
      <PageHeading
        title="Feed now"
        description="Choose each nozzle and dose, then confirm this exact feeder."
      />
      <BentoCard>
        <Text style={Typography.cardTitle}>{device.alias || device.model}</Text>
        <Text style={Typography.supporting}>
          {device.isSimulated ? "Simulator" : "Paired feeder"} ·{" "}
          {device.contactFreshness === "fresh"
            ? "Contact recent"
            : "Contact not recent"}
        </Text>
        {!online ? (
          <Text accessibilityRole="alert" style={styles.warning}>
            A recent authenticated device contact is required before a new feed
            can be confirmed.
          </Text>
        ) : null}
        {targetChanged ? (
          <Text accessibilityRole="alert" style={styles.warning}>
            The selected feeder changed. Cancel and reopen Feed now to choose a
            new target.
          </Text>
        ) : null}
      </BentoCard>
      <BentoCard>
        <Text style={Typography.cardTitle}>Nozzles</Text>
        <View style={styles.choiceRow}>
          {(["1", "2", "both"] as const).map((item) => {
            const enabled =
              item === "both"
                ? nozzle1?.enabled &&
                  nozzle2?.enabled &&
                  device.capabilities.schedulerWakeGraceMs !== null
                : device.capabilities.nozzles[item].enabled;
            return (
              <ChoiceButton
                key={item}
                label={item === "both" ? "Both · 1 then 2" : `Nozzle ${item}`}
                selected={choice === item}
                onPress={() => enabled && setChoice(item)}
              />
            );
          })}
        </View>
        {(choice === "1" || choice === "both") && nozzle1 ? (
          <DoseControl
            label="Nozzle 1"
            capability={nozzle1}
            value={dose1}
            onChange={setDose1}
          />
        ) : null}
        {(choice === "2" || choice === "both") && nozzle2 ? (
          <DoseControl
            label="Nozzle 2"
            capability={nozzle2}
            value={dose2}
            onChange={setDose2}
          />
        ) : null}
      </BentoCard>
      {command ? (
        <BentoCard>
          <Text accessibilityRole="header" style={Typography.cardTitle}>
            Feed progress · {resultStatus(command.status)}
          </Text>
          {command.nozzle_results.map((result) => {
            const measured =
              result.measurement_quality === "valid" &&
              typeof result.measured_dispensed_g === "number"
                ? device.isSimulated
                  ? `${result.measured_dispensed_g} g synthetic simulator reading`
                  : `${result.measured_dispensed_g} g measured`
                : "Amount not measured";
            const requested =
              result.requested_dose.mode === "grams"
                ? `${result.requested_dose.amount_g} g requested`
                : `Portion ${result.requested_dose.fixed_portion_id} requested`;
            return (
              <View key={result.nozzle_number} style={styles.resultRow}>
                <Text style={Typography.body}>
                  Nozzle {result.nozzle_number}: {resultStatus(result.status)}
                </Text>
                <Text style={[Typography.supporting, styles.secondary]}>
                  {requested} · {measured}
                </Text>
              </View>
            );
          })}
          {command.safety_lockout ? (
            <Text accessibilityRole="alert" style={styles.warning}>
              The feeder needs an in-person safety check before another feed.
            </Text>
          ) : null}
          {!isTerminal(command.status) || command.safety_lockout ? (
            <Button
              variant="secondary"
              onPress={() => void checkStatus()}
              loading={busy}
            >
              Check status
            </Button>
          ) : null}
        </BentoCard>
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" style={styles.warning}>
          {message}
        </Text>
      ) : null}
      {!command?.status || isTerminal(command.status) ? (
        <Button
          icon="utensils"
          onPress={() => void confirmFeed()}
          loading={busy}
          disabled={!valid || !online || targetChanged || lockout || busy}
          accessibilityHint="Submits the displayed nozzles and doses to the displayed feeder once."
        >
          Confirm feed
        </Button>
      ) : null}
      {command && !isTerminal(command.status) ? (
        <Text style={[Typography.supporting, styles.secondary]}>
          This feed is saved. Status checks only read the original request; they
          do not send another feed.
        </Text>
      ) : null}
    </AppPage>
  );
}

async function checkSavedStatus(installationId: string, deviceId: string) {
  const saved = await loadPendingManualFeed(installationId, deviceId);
  if (!saved) throw new Error("The saved feed request is no longer available.");
  return reconcileManualFeed(installationId, deviceId, saved.idempotency_key);
}

const styles = StyleSheet.create({
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  choice: {
    minHeight: ControlSize.minimumTarget,
    minWidth: ControlSize.minimumTarget,
    justifyContent: "center",
    paddingHorizontal: Spacing.three,
    borderWidth: 1,
    borderColor: Colors.light.controlBorder,
    borderRadius: 12,
    backgroundColor: Colors.light.surface,
  },
  choiceSelected: {
    borderWidth: 2,
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.surfaceMuted,
  },
  doseField: { gap: Spacing.two },
  resultRow: { gap: Spacing.one, paddingVertical: Spacing.one },
  warning: { ...Typography.supporting, color: Colors.light.text },
  secondary: { color: Colors.light.textSecondary },
});
