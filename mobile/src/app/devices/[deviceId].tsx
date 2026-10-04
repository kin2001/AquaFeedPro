import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Text } from "react-native";

import {
  AppPage,
  BackAction,
  BentoCard,
  Button,
  EmptyState,
  ErrorState,
  PageHeading,
  TextField,
} from "@/components/app-shell";
import { Colors, Typography } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";
import { isUuid, validatePairingLabels } from "@/lib/device-access-state";

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
  const initializedScope = useRef<string | null>(null);
  const mounted = useRef(true);
  const focused = useRef(false);
  const focusGeneration = useRef(0);
  const savingRef = useRef(false);
  const selectingRef = useRef(false);
  const removingRef = useRef(false);
  const currentScope = useRef({ installationId, deviceId });
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
        <BackAction label="Back" fallback="/device" />
        <PageHeading title="Device details" />
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
        <BackAction label="Back" fallback="/device" />
        <PageHeading title="Device details" />
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

  return (
    <AppPage>
      <BackAction label="Back" fallback="/device" />
      <PageHeading
        title="Device details"
        description="Identity, contact, and declared capabilities."
      />
      {selectedDeviceId !== device.deviceId ? (
        <Button
          variant="secondary"
          onPress={() => void selectThisDevice()}
          loading={selecting}
          disabled={actionBusy}
        >
          Select this device
        </Button>
      ) : null}
      {selectError ? (
        <Text accessibilityRole="alert" style={Typography.supporting}>
          {selectError}
        </Text>
      ) : null}
      <BentoCard>
        <Text style={Typography.cardTitle}>{device.alias ?? device.model}</Text>
        {device.location ? (
          <Text
            style={[
              Typography.supporting,
              { color: Colors.light.textSecondary },
            ]}
          >
            {device.location}
          </Text>
        ) : null}
        <Text
          style={[Typography.metadata, { color: Colors.light.textSecondary }]}
        >
          {device.deviceId}
        </Text>
        <Text style={Typography.supporting}>Model: {device.model}</Text>
        <Text style={Typography.supporting}>
          Firmware: {device.firmwareVersion}
        </Text>
        <Text style={Typography.supporting}>Protocol major: 2</Text>
        <Text style={Typography.supporting}>
          {device.isSimulated
            ? "Simulator · values are simulated."
            : "Registered feeder profile."}
        </Text>
        <Text style={Typography.supporting}>
          {contactDescription(device.contactFreshness)}
        </Text>
        <Text style={Typography.supporting}>
          Last contact:{" "}
          {device.lastAuthenticatedContactAt
            ? new Date(device.lastAuthenticatedContactAt).toLocaleString()
            : "unknown"}
        </Text>
        {deviceError || refreshError ? (
          <Text accessibilityRole="alert" style={Typography.supporting}>
            {refreshError ?? deviceError}
          </Text>
        ) : null}
        <Button
          variant="text"
          onPress={() => void refreshDetails()}
          loading={refreshing}
          disabled={refreshing || actionBusy}
        >
          Refresh device details
        </Button>
      </BentoCard>
      <BentoCard>
        <Text style={Typography.cardTitle}>Shared container and nozzles</Text>
        <Text style={Typography.supporting}>
          Both nozzles use the same continuously weighed container.
        </Text>
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
            <Text key={number} style={Typography.supporting}>
              Nozzle {number}: {status}
            </Text>
          );
        })}
        <Text
          style={[Typography.supporting, { color: Colors.light.textSecondary }]}
        >
          Declared capabilities:{" "}
          {[
            device.capabilities.doMonitoring ? "DO monitoring" : null,
            device.capabilities.feedRemainingMonitoring
              ? "remaining-feed monitoring"
              : null,
            device.capabilities.localScheduleExecution
              ? "local schedule execution"
              : null,
          ]
            .filter(Boolean)
            .join(", ") || "none"}
          .
        </Text>
      </BentoCard>
      <BentoCard>
        <Text style={Typography.cardTitle}>Device name and location</Text>
        <Text
          style={[Typography.supporting, { color: Colors.light.textSecondary }]}
        >
          Labels and locations apply only to this installation.
        </Text>
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
          onPress={() => void saveLabels()}
          loading={saving}
          disabled={actionBusy}
        >
          Save name
        </Button>
        {saveError ? (
          <Text accessibilityRole="alert" style={Typography.supporting}>
            {saveError}
          </Text>
        ) : null}
        {saveMessage ? (
          <Text style={Typography.supporting}>{saveMessage}</Text>
        ) : null}
      </BentoCard>
      <BentoCard>
        <Text style={Typography.cardTitle}>Remove access</Text>
        <Text
          style={[Typography.supporting, { color: Colors.light.textSecondary }]}
        >
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
        {removeError ? (
          <Text accessibilityRole="alert" style={Typography.supporting}>
            {removeError}
          </Text>
        ) : null}
      </BentoCard>
    </AppPage>
  );
}
