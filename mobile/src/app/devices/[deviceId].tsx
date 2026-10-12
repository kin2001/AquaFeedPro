import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";

import {
  AppPage,
  BentoCard,
  Button,
  EmptyState,
  ErrorState,
  KeyValue,
  ListRow,
  Notice,
  ScreenHeader,
  SectionHeader,
  StatusLabel,
  TextField,
} from "@/components/app-shell";
import { Spacing, Typography } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";
import {
  isUuid,
  sameDeviceRequestScope,
  validatePairingLabels,
} from "@/lib/device-access-state";
import {
  monitoringSettingsRecoveryStatus,
  withMonitoringLimits,
  type MonitoringSettingsRecoveryStatus,
} from "@/lib/monitoring";
import {
  checkPendingWrite,
  loadPendingWrite,
  readConfiguration,
  saveConfiguration,
  type ConfigurationRead,
} from "@/lib/schedules";

type SettingsView = {
  scopeKey: string;
  configuration: ConfigurationRead | null;
  pendingLocal: boolean;
  recoveryStatus: MonitoringSettingsRecoveryStatus;
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  doLow: string;
  doHigh: string;
  feedLow: string;
};

function numericLimit(
  value: string,
  maximum?: number,
): number | null | undefined {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) &&
    parsed >= 0 &&
    (maximum === undefined || parsed <= maximum)
    ? parsed
    : undefined;
}

function limitText(value: number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function contactDescription(freshness: string) {
  switch (freshness) {
    case "fresh":
      return "Contact is recent";
    case "stale":
      return "Last contact is out of date";
    default:
      return "No contact time recorded";
  }
}

export default function DeviceDetailsScreen() {
  const { deviceId: rawDeviceId } = useLocalSearchParams<{
    deviceId: string;
  }>();
  const routeDeviceId = Array.isArray(rawDeviceId)
    ? rawDeviceId[0]
    : rawDeviceId;
  const deviceId = isUuid(routeDeviceId)
    ? routeDeviceId.toLowerCase()
    : routeDeviceId;
  const {
    devices,
    installationId,
    selectedDeviceId,
    scopeRevision,
    deviceError,
    refreshing,
    refreshDevices,
    selectDevice,
    updateDeviceLabels,
    revokeDevice,
  } = useDeviceAccess();
  const device = useMemo(
    () => devices.find((candidate) => candidate.deviceId === deviceId) ?? null,
    [deviceId, devices],
  );
  const [alias, setAlias] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const [locationError, setLocationError] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const initializedScope = useRef<string | null>(null);
  const mounted = useRef(true);
  const focused = useRef(false);
  const focusGeneration = useRef(0);
  const savingRef = useRef(false);
  const selectingRef = useRef(false);
  const removingRef = useRef(false);
  const currentScope = useRef({ installationId, deviceId });
  const settingsScope = useMemo(
    () => ({ installationId, revision: scopeRevision, selectedDeviceId }),
    [installationId, scopeRevision, selectedDeviceId],
  );
  const settingsScopeRef = useRef(settingsScope);
  const settingsKey = [
    installationId ?? "",
    selectedDeviceId ?? "",
    scopeRevision,
    deviceId ?? "",
  ].join(":");
  const activeSettings = settings?.scopeKey === settingsKey ? settings : null;
  const actionIsCurrent = useCallback(
    (
      generation: number,
      expectedInstallation: string | null,
      expectedDeviceId: string | undefined,
    ) =>
      mounted.current &&
      focused.current &&
      focusGeneration.current === generation &&
      currentScope.current.installationId === expectedInstallation &&
      currentScope.current.deviceId === expectedDeviceId,
    [],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    currentScope.current = { installationId, deviceId };
  }, [installationId, deviceId]);

  useEffect(() => {
    settingsScopeRef.current = settingsScope;
  }, [settingsScope]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      const generation = ++focusGeneration.current;
      const expectedInstallation = installationId;
      setRefreshError(null);
      void refreshDevices().catch((reason) => {
        if (actionIsCurrent(generation, expectedInstallation, deviceId)) {
          setRefreshError(
            reason instanceof Error
              ? reason.message
              : "Device details could not be refreshed.",
          );
        }
      });
      return () => {
        focused.current = false;
        focusGeneration.current += 1;
      };
    }, [refreshDevices, installationId, deviceId, actionIsCurrent]),
  );

  useFocusEffect(
    useCallback(() => {
      if (!device || !installationId || !deviceId) return;
      const scope = { ...settingsScope };
      const requestDeviceId = device.deviceId;
      let active = true;
      const isCurrent = () =>
        active &&
        mounted.current &&
        focused.current &&
        currentScope.current.installationId === installationId &&
        currentScope.current.deviceId === deviceId &&
        sameDeviceRequestScope(scope, settingsScopeRef.current);
      setSettings({
        scopeKey: settingsKey,
        configuration: null,
        pendingLocal: false,
        recoveryStatus: "unverified",
        loading: true,
        busy: false,
        error: null,
        notice: null,
        doLow: "",
        doHigh: "",
        feedLow: "",
      });
      void Promise.all([
        readConfiguration(installationId, requestDeviceId),
        loadPendingWrite(installationId, requestDeviceId),
      ])
        .then(([configuration, pending]) => {
          if (!isCurrent()) return;
          const applied = configuration.applied_snapshot;
          setSettings({
            scopeKey: settingsKey,
            configuration,
            pendingLocal: pending !== null,
            recoveryStatus: monitoringSettingsRecoveryStatus(
              true,
              true,
              pending !== null,
              configuration.current_state.last_attempt_status,
            ),
            loading: false,
            busy: false,
            error: null,
            notice: null,
            doLow: limitText(applied?.monitoring_limits.do_low_mg_l),
            doHigh: limitText(applied?.monitoring_limits.do_high_mg_l),
            feedLow: limitText(applied?.low_feed_threshold_pct),
          });
        })
        .catch((reason: unknown) => {
          if (isCurrent())
            setSettings({
              scopeKey: settingsKey,
              configuration: null,
              pendingLocal: false,
              recoveryStatus: "unverified",
              loading: false,
              busy: false,
              error:
                reason instanceof Error
                  ? reason.message
                  : "Monitoring settings could not be loaded.",
              notice: null,
              doLow: "",
              doHigh: "",
              feedLow: "",
            });
        });
      return () => {
        active = false;
      };
    }, [device, deviceId, installationId, settingsKey, settingsScope]),
  );

  useEffect(() => {
    if (!device) {
      initializedScope.current = null;
      return;
    }
    const nextScope = `${installationId ?? ""}:${device.deviceId}`;
    if (initializedScope.current !== nextScope) {
      initializedScope.current = nextScope;
      setAlias(device.alias ?? "");
      setLocation(device.location ?? "");
      setNameError(undefined);
      setLocationError(undefined);
      setSaveError(null);
      setSaveMessage(null);
      setSelectError(null);
      setRemoveError(null);
    }
  }, [device, installationId]);

  const refreshDetails = async () => {
    const generation = focusGeneration.current;
    const expectedInstallation = installationId;
    setRefreshError(null);
    try {
      await refreshDevices();
    } catch (reason) {
      if (actionIsCurrent(generation, expectedInstallation, deviceId)) {
        setRefreshError(
          reason instanceof Error
            ? reason.message
            : "Device details could not be refreshed.",
        );
      }
    }
  };

  const updateSettingsField = (
    field: "doLow" | "doHigh" | "feedLow",
    value: string,
  ) => {
    setSettings((current) =>
      current?.scopeKey === settingsKey
        ? { ...current, [field]: value, error: null, notice: null }
        : current,
    );
  };

  const saveMonitoringSettings = async () => {
    const state = activeSettings;
    const applied = state?.configuration?.applied_snapshot;
    if (
      !device ||
      !installationId ||
      !state ||
      !applied ||
      state.loading ||
      state.busy ||
      state.recoveryStatus !== "resolved"
    )
      return;
    const low = numericLimit(state.doLow);
    const high = numericLimit(state.doHigh);
    const feed = numericLimit(state.feedLow, 100);
    const badOrder =
      low !== undefined &&
      high !== undefined &&
      low !== null &&
      high !== null &&
      low > high;
    if (
      low === undefined ||
      high === undefined ||
      feed === undefined ||
      badOrder
    ) {
      setSettings({
        ...state,
        error: badOrder
          ? "The low DO limit must not exceed the high limit."
          : "Enter non-negative numeric limits; feed threshold must be 0 to 100 percent.",
        notice: null,
      });
      return;
    }
    const scope = { ...settingsScopeRef.current };
    const targetDeviceId = device.deviceId;
    const current = () =>
      mounted.current &&
      focused.current &&
      currentScope.current.installationId === installationId &&
      currentScope.current.deviceId === deviceId &&
      sameDeviceRequestScope(scope, settingsScopeRef.current);
    setSettings({ ...state, busy: true, error: null, notice: null });
    try {
      await saveConfiguration(
        installationId,
        targetDeviceId,
        state.configuration?.current_state.desired_revision ?? applied.revision,
        withMonitoringLimits(applied, low, high, feed),
      );
      if (!current()) return;
      const refreshed = await readConfiguration(
        installationId,
        targetDeviceId,
      ).catch(() => null);
      if (!current()) return;
      setSettings((latest) =>
        latest?.scopeKey === settingsKey
          ? {
              ...latest,
              configuration: refreshed ?? latest.configuration,
              pendingLocal: false,
              recoveryStatus: monitoringSettingsRecoveryStatus(
                refreshed !== null,
                true,
                refreshed?.request_status === "pending",
                refreshed?.current_state.last_attempt_status,
              ),
              busy: false,
              error: refreshed
                ? null
                : "The settings request was recorded, but its current status could not be refreshed. Refresh status before editing.",
              notice: refreshed
                ? refreshed.current_state.last_attempt_status === "pending"
                  ? "Settings request was recorded. The applied values remain active until the feeder acknowledges the revision."
                  : "Settings request was recorded. Current applied values were refreshed."
                : null,
            }
          : latest,
      );
    } catch (reason) {
      if (!current()) return;
      let pending: Awaited<ReturnType<typeof loadPendingWrite>> = null;
      let pendingStatusKnown = true;
      try {
        pending = await loadPendingWrite(installationId, targetDeviceId);
      } catch {
        pendingStatusKnown = false;
      }
      if (!current()) return;
      setSettings((latest) =>
        latest?.scopeKey === settingsKey
          ? {
              ...latest,
              pendingLocal: pending !== null,
              recoveryStatus: monitoringSettingsRecoveryStatus(
                false,
                pendingStatusKnown,
                pending !== null,
                null,
              ),
              busy: false,
              error: !pendingStatusKnown
                ? "The save failed and its saved request status could not be verified. Refresh status before editing."
                : reason instanceof Error
                  ? reason.message
                  : "Settings could not be confirmed. Check the original request before editing again.",
            }
          : latest,
      );
    }
  };

  const checkMonitoringSettings = async () => {
    const state = activeSettings;
    if (
      !device ||
      !installationId ||
      !state ||
      state.busy ||
      state.loading ||
      state.recoveryStatus === "resolved"
    )
      return;
    const scope = { ...settingsScopeRef.current };
    const targetDeviceId = device.deviceId;
    const current = () =>
      mounted.current &&
      focused.current &&
      currentScope.current.installationId === installationId &&
      currentScope.current.deviceId === deviceId &&
      sameDeviceRequestScope(scope, settingsScopeRef.current);
    setSettings({ ...state, busy: true, error: null, notice: null });
    let result: Awaited<ReturnType<typeof checkPendingWrite>> | undefined;
    let refreshed: ConfigurationRead | null = null;
    try {
      const checked = await checkPendingWrite(installationId, targetDeviceId);
      result = checked;
      if (!current()) return;
      const refreshedCurrent =
        checked.state ??
        (await readConfiguration(installationId, targetDeviceId));
      if (!current()) return;
      const status = checked.state?.request_status;
      const notice =
        status === "applied"
          ? "The original settings request was applied."
          : status === "rejected"
            ? "The feeder rejected the original settings request; previous applied values remain active."
            : status === "pending"
              ? "The original settings request is still pending."
              : refreshedCurrent.current_state.last_attempt_status === "pending"
                ? "The latest settings revision is still pending."
                : checked.conflict
                  ? "The original request conflicted with a newer revision. Review the current applied values before editing."
                  : checked.pending !== null
                    ? "No receipt is confirmed yet. Keep the original request and check again later."
                    : "Current applied settings were refreshed.";
      const recoveryStatus = monitoringSettingsRecoveryStatus(
        true,
        true,
        checked.pending !== null || checked.state?.request_status === "pending",
        refreshedCurrent.current_state.last_attempt_status,
      );
      setSettings((latest) =>
        latest?.scopeKey === settingsKey
          ? {
              ...latest,
              configuration: refreshedCurrent,
              pendingLocal: checked.pending !== null,
              recoveryStatus,
              busy: false,
              error: null,
              notice,
              doLow:
                recoveryStatus === "resolved"
                  ? limitText(
                      refreshedCurrent.applied_snapshot?.monitoring_limits
                        .do_low_mg_l,
                    )
                  : latest.doLow,
              doHigh:
                recoveryStatus === "resolved"
                  ? limitText(
                      refreshedCurrent.applied_snapshot?.monitoring_limits
                        .do_high_mg_l,
                    )
                  : latest.doHigh,
              feedLow:
                recoveryStatus === "resolved"
                  ? limitText(
                      refreshedCurrent.applied_snapshot?.low_feed_threshold_pct,
                    )
                  : latest.feedLow,
            }
          : latest,
      );
    } catch (reason) {
      if (!current()) return;
      if (!result)
        refreshed = await readConfiguration(
          installationId,
          targetDeviceId,
        ).catch(() => null);
      if (!current()) return;
      setSettings((latest) =>
        latest?.scopeKey === settingsKey
          ? {
              ...latest,
              configuration: refreshed ?? latest.configuration,
              recoveryStatus: monitoringSettingsRecoveryStatus(
                refreshed !== null,
                false,
                latest.pendingLocal,
                refreshed?.current_state.last_attempt_status,
              ),
              busy: false,
              error:
                reason instanceof Error
                  ? reason.message
                  : "The original settings request could not be checked.",
            }
          : latest,
      );
    }
  };

  const saveLabels = async () => {
    if (
      !device ||
      savingRef.current ||
      selectingRef.current ||
      removingRef.current
    )
      return;
    const validation = validatePairingLabels(alias, location);
    setNameError(validation.alias ?? undefined);
    setLocationError(validation.location ?? undefined);
    if (validation.alias || validation.location) {
      setSaveError(null);
      setSaveMessage(null);
      return;
    }
    const requestGeneration = focusGeneration.current;
    const expectedInstallation = installationId;
    const requestDeviceId = device.deviceId;
    const name = alias.trim();
    const nextLocation = location.trim();
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      await updateDeviceLabels(requestDeviceId, name, nextLocation || null);
      if (
        !actionIsCurrent(
          requestGeneration,
          expectedInstallation,
          requestDeviceId,
        )
      )
        return;
      setAlias(name);
      setLocation(nextLocation);
      setSaveMessage("Name and location saved.");
    } catch (reason) {
      if (
        actionIsCurrent(
          requestGeneration,
          expectedInstallation,
          requestDeviceId,
        )
      ) {
        setSaveError(
          reason instanceof Error
            ? reason.message
            : "The name and location could not be saved. Try again.",
        );
      }
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const selectThisDevice = async () => {
    if (
      !device ||
      savingRef.current ||
      selectingRef.current ||
      removingRef.current
    )
      return;
    const requestGeneration = focusGeneration.current;
    const expectedInstallation = installationId;
    const requestDeviceId = device.deviceId;
    selectingRef.current = true;
    setSelecting(true);
    setSelectError(null);
    try {
      await selectDevice(requestDeviceId);
    } catch (reason) {
      if (
        actionIsCurrent(
          requestGeneration,
          expectedInstallation,
          requestDeviceId,
        )
      ) {
        setSelectError(
          reason instanceof Error
            ? reason.message
            : "This device could not be selected. Try again.",
        );
      }
    } finally {
      selectingRef.current = false;
      if (mounted.current) setSelecting(false);
    }
  };

  const removeAccess = async (intent: {
    generation: number;
    installationId: string | null;
    deviceId: string;
  }) => {
    if (
      !device ||
      device.deviceId !== intent.deviceId ||
      !actionIsCurrent(
        intent.generation,
        intent.installationId,
        intent.deviceId,
      ) ||
      savingRef.current ||
      selectingRef.current ||
      removingRef.current
    )
      return;
    removingRef.current = true;
    setRemoving(true);
    setRemoveError(null);
    try {
      await revokeDevice(intent.deviceId);
      if (
        actionIsCurrent(
          intent.generation,
          intent.installationId,
          intent.deviceId,
        )
      )
        router.replace("/device");
    } catch (reason) {
      if (
        actionIsCurrent(
          intent.generation,
          intent.installationId,
          intent.deviceId,
        )
      ) {
        setRemoveError(
          reason instanceof Error
            ? reason.message
            : "Access could not be removed. Try again.",
        );
      }
    } finally {
      removingRef.current = false;
      if (mounted.current) setRemoving(false);
    }
  };

  const confirmRemoval = () => {
    if (!device || !focused.current) return;
    const intent = {
      generation: focusGeneration.current,
      installationId,
      deviceId: device.deviceId,
    };
    const confirmIntent = () => {
      if (
        actionIsCurrent(
          intent.generation,
          intent.installationId,
          intent.deviceId,
        )
      )
        void removeAccess(intent);
    };
    const deviceName = device.alias?.trim() || device.model;
    const description =
      "This removes pairing from this app. It does not delete schedules, history, or settings stored on the feeder; schedules already on the controller may continue. You can pair it again by opening a new pairing window.";
    if (Platform.OS === "web") {
      if (
        globalThis.confirm(`Remove ${deviceName} from this app? ${description}`)
      )
        confirmIntent();
      return;
    }
    Alert.alert(`Remove ${deviceName} from this app?`, description, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove access",
        style: "destructive",
        onPress: confirmIntent,
      },
    ]);
  };

  if (!isUuid(deviceId)) {
    return (
      <AppPage>
        <ScreenHeader
          title="Device details"
          back={{ label: "Back", fallback: "/device" }}
        />
        <EmptyState
          icon="cpu"
          title="Device unavailable"
          description="This device link is invalid or no longer available."
          action="Go to Device"
          href="/device"
        />
      </AppPage>
    );
  }

  if (!device) {
    const unavailableError = deviceError ?? refreshError;
    return (
      <AppPage>
        <ScreenHeader
          title="Device details"
          back={{ label: "Back", fallback: "/device" }}
        />
        {unavailableError ? (
          <ErrorState
            title="Device access could not be verified"
            description={unavailableError}
            onRetry={() => void refreshDetails()}
          />
        ) : (
          <EmptyState
            icon="cpu"
            title="Device unavailable"
            description="This installation has no active access to the device, or the device list is still refreshing."
            action="Go to Device"
            href="/device"
          />
        )}
      </AppPage>
    );
  }

  const actionBusy = saving || selecting || removing;
  const contactKind =
    device.contactFreshness === "fresh"
      ? "online"
      : device.contactFreshness === "stale"
        ? "offline"
        : "outdated";
  const monitoringDisabled =
    !activeSettings ||
    activeSettings.loading ||
    activeSettings.busy ||
    activeSettings.recoveryStatus !== "resolved";
  const capabilityRows = [
    ["DO monitoring", device.capabilities.doMonitoring],
    ["Remaining-feed monitoring", device.capabilities.feedRemainingMonitoring],
    ["Local schedule execution", device.capabilities.localScheduleExecution],
  ] as const;

  return (
    <AppPage>
      <View style={styles.header}>
        <ScreenHeader
          title={device.alias ?? device.model}
          back={{ label: "Back", fallback: "/device" }}
        />
        {selectedDeviceId !== device.deviceId ? (
          <Notice
            tone="info"
            actions={
              <Button
                variant="secondary"
                onPress={() => void selectThisDevice()}
                loading={selecting}
                disabled={actionBusy}
              >
                Select this device
              </Button>
            }
          >
            This feeder is not the selected device.
          </Notice>
        ) : null}
        {selectError ? <Notice tone="error">{selectError}</Notice> : null}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Identity" />
        <BentoCard gap={0} style={styles.rows}>
          <KeyValue label="Name" value={device.alias ?? device.model} />
          {device.location ? (
            <KeyValue divider label="Location" value={device.location} />
          ) : null}
          <KeyValue
            divider
            stacked
            selectable
            label="Device ID"
            value={device.deviceId}
          />
          <KeyValue divider label="Model" value={device.model} />
          <KeyValue divider label="Firmware" value={device.firmwareVersion} />
          <KeyValue divider label="Protocol" value="Major 2" />
          <KeyValue
            divider
            label="Type"
            value={
              device.isSimulated
                ? "Simulator · values are simulated."
                : "Registered feeder profile."
            }
          />
        </BentoCard>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Connection" />
        <BentoCard gap={0} style={styles.rows}>
          <KeyValue
            label="Status"
            value={
              <StatusLabel kind={contactKind}>
                {contactDescription(device.contactFreshness)}
              </StatusLabel>
            }
          />
          <KeyValue
            divider
            label="Last contact"
            value={
              device.lastAuthenticatedContactAt
                ? new Date(device.lastAuthenticatedContactAt).toLocaleString()
                : "unknown"
            }
          />
        </BentoCard>
        {deviceError || refreshError ? (
          <Notice tone="error">{refreshError ?? deviceError ?? ""}</Notice>
        ) : null}
        <Button
          variant="text"
          onPress={() => void refreshDetails()}
          loading={refreshing}
          disabled={refreshing || actionBusy}
        >
          Refresh device details
        </Button>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Nozzles and sensors" />
        <Text style={Typography.supporting}>
          Both nozzles use the same continuously weighed container.
        </Text>
        <BentoCard flush>
          {(["1", "2"] as const).map((number) => {
            const nozzle = device.capabilities.nozzles[number];
            const range =
              nozzle.minDoseG !== null && nozzle.maxDoseG !== null
                ? "; declared range " +
                  nozzle.minDoseG +
                  "–" +
                  nozzle.maxDoseG +
                  " g" +
                  (device.isSimulated ? " (simulator fixture)" : "")
                : "";
            const status = nozzle.enabled
              ? "enabled; " +
                (nozzle.doseModes.join(", ") || "no dose mode declared") +
                range
              : "disabled";
            return (
              <ListRow
                key={number}
                divider={number === "2"}
                icon={nozzle.enabled ? "circle-check" : "circle-x"}
                title={"Nozzle " + number}
                lines={[status.charAt(0).toUpperCase() + status.slice(1)]}
              />
            );
          })}
          {capabilityRows.map(([title, declared]) => (
            <ListRow
              key={title}
              divider
              icon={declared ? "circle-check" : "circle-x"}
              title={title}
              lines={[declared ? "Declared by this feeder" : "Not declared"]}
            />
          ))}
        </BentoCard>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Monitoring settings" />
        <Text style={Typography.supporting}>
          These limits are display settings. Saving submits the complete
          configuration and preserves the applied timezone and schedules.
        </Text>
        {activeSettings?.configuration?.applied_snapshot ? (
          <Text style={Typography.metadata}>
            {(activeSettings.recoveryStatus === "unverified"
              ? "Last confirmed applied revision"
              : "Applied revision") +
              " " +
              activeSettings.configuration.applied_snapshot.revision}
          </Text>
        ) : activeSettings?.configuration ? (
          <Notice tone="info">
            No applied configuration is available to preserve yet. Add or apply
            a schedule first.
          </Notice>
        ) : activeSettings && !activeSettings.loading ? (
          <Notice tone="info">
            The current applied configuration could not be verified. Refresh
            status before editing.
          </Notice>
        ) : null}
        {activeSettings?.configuration?.current_state.last_attempt_status ===
        "pending" ? (
          <StatusLabel kind="pending">
            {"Revision " +
              String(
                activeSettings.configuration.current_state
                  .last_attempt_revision,
              ) +
              " is pending"}
          </StatusLabel>
        ) : null}
        {activeSettings?.configuration?.current_state.last_attempt_status ===
        "rejected" ? (
          <StatusLabel kind="warning">
            Latest revision rejected; the prior applied settings remain active
          </StatusLabel>
        ) : null}
        {activeSettings &&
        !activeSettings.loading &&
        activeSettings.recoveryStatus !== "resolved" ? (
          <Notice
            tone="warning"
            actions={
              <Button
                variant="secondary"
                onPress={() => void checkMonitoringSettings()}
                loading={activeSettings.busy}
                disabled={activeSettings.busy || activeSettings.loading}
              >
                {activeSettings.pendingLocal
                  ? "Check original request"
                  : "Refresh settings status"}
              </Button>
            }
          >
            {activeSettings.pendingLocal
              ? "The original settings request may be unresolved. Check its status before editing or submitting another revision."
              : activeSettings.recoveryStatus === "unverified"
                ? "Settings status is unverified. Refresh it before editing."
                : "The latest settings revision is pending. Refresh its status before editing."}
          </Notice>
        ) : null}
        {activeSettings?.configuration?.applied_snapshot ? (
          <View style={styles.fields}>
            <TextField
              label="DO low limit"
              suffix="mg/L"
              hint="Leave blank to disable this limit."
              value={activeSettings.doLow}
              onChangeText={(value) => updateSettingsField("doLow", value)}
              keyboardType="decimal-pad"
              disabled={monitoringDisabled}
            />
            <TextField
              label="DO high limit"
              suffix="mg/L"
              hint="Leave blank to disable this limit."
              value={activeSettings.doHigh}
              onChangeText={(value) => updateSettingsField("doHigh", value)}
              keyboardType="decimal-pad"
              disabled={monitoringDisabled}
            />
            <TextField
              label="Low-feed threshold"
              suffix="%"
              hint="0 to 100; leave blank to disable."
              value={activeSettings.feedLow}
              onChangeText={(value) => updateSettingsField("feedLow", value)}
              keyboardType="decimal-pad"
              disabled={monitoringDisabled}
            />
            <Button
              onPress={() => void saveMonitoringSettings()}
              loading={activeSettings.busy}
              disabled={monitoringDisabled}
            >
              Save monitoring settings
            </Button>
          </View>
        ) : null}
        {!activeSettings || activeSettings.loading ? (
          <Notice tone="info">Loading current applied settings…</Notice>
        ) : null}
        {activeSettings?.error ? (
          <Notice tone="error">{activeSettings.error}</Notice>
        ) : null}
        {activeSettings?.notice ? (
          <Notice tone="info">{activeSettings.notice}</Notice>
        ) : null}
        {activeSettings?.configuration?.current_state.error_code ? (
          <Text style={Typography.metadata}>
            Device response:{" "}
            {activeSettings.configuration.current_state.error_code}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Name and location" />
        <Text style={Typography.supporting}>
          Labels and locations apply only to this installation.
        </Text>
        <View style={styles.fields}>
          <TextField
            label="Device name"
            value={alias}
            onChangeText={(value) => {
              setAlias(Array.from(value).slice(0, 100).join(""));
              setNameError(undefined);
              setSaveError(null);
              setSaveMessage(null);
            }}
            maxLength={200}
            autoCapitalize="words"
            error={nameError}
            disabled={saving}
          />
          <TextField
            label="Location (optional)"
            value={location}
            onChangeText={(value) => {
              setLocation(Array.from(value).slice(0, 160).join(""));
              setLocationError(undefined);
              setSaveError(null);
              setSaveMessage(null);
            }}
            maxLength={320}
            autoCapitalize="words"
            error={locationError}
            disabled={saving}
          />
          <Button
            variant="secondary"
            onPress={() => void saveLabels()}
            loading={saving}
            disabled={actionBusy}
          >
            Save name
          </Button>
        </View>
        {saveError ? <Notice tone="error">{saveError}</Notice> : null}
        {saveMessage ? <Notice tone="info">{saveMessage}</Notice> : null}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Remove access" />
        <Text style={Typography.supporting}>
          Removal clears this installation&apos;s cached device profile. Applied
          feeder schedules remain on the controller and may continue.
        </Text>
        <Button
          variant="secondary"
          icon="unlink"
          onPress={confirmRemoval}
          loading={removing}
          disabled={actionBusy}
        >
          Remove this device
        </Button>
        {removeError ? <Notice tone="error">{removeError}</Notice> : null}
      </View>
    </AppPage>
  );
}

const styles = StyleSheet.create({
  header: { gap: Spacing.cardGap },
  section: { gap: Spacing.two },
  rows: { paddingVertical: Spacing.one },
  fields: { gap: Spacing.three },
});
