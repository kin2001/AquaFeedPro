import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "react-native";

import {
  AppPage,
  BackAction,
  BentoCard,
  Button,
  PageHeading,
  TextField,
} from "@/components/app-shell";
import { Colors, Typography } from "@/constants/theme";
import { useDeviceAccess } from "@/lib/device-access";
import type { DeviceRecord } from "@/lib/device-access";
import {
  isPairingSecret,
  isUuid,
  pairingFailureNeedsNewWindow,
  parsePairingQrPayload,
  validatePairingLabels,
} from "@/lib/device-access-state";

type PairingStage = "choose" | "scan" | "manual" | "name" | "added";

function errorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export default function AddDeviceScreen() {
  const { installationId } = useDeviceAccess();
  return (
    <PairingFlow
      key={installationId ?? "installation-unavailable"}
      installationId={installationId}
    />
  );
}

function PairingFlow({ installationId }: { installationId: string | null }) {
  const { devices, pairDevice, updateDeviceLabels, selectDevice } =
    useDeviceAccess();
  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<PairingStage>("choose");
  const [screenFocused, setScreenFocused] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [pairingSecret, setPairingSecret] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [deviceIdError, setDeviceIdError] = useState<string | undefined>();
  const [challengeIdError, setChallengeIdError] = useState<
    string | undefined
  >();
  const [secretError, setSecretError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [scanIsLocked, setScanIsLocked] = useState(false);
  const [pairedDeviceId, setPairedDeviceId] = useState<string | null>(null);
  const [pairedRecord, setPairedRecord] = useState<DeviceRecord | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [deviceLocation, setDeviceLocation] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();
  const [locationError, setLocationError] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [savedLabels, setSavedLabels] = useState<{
    alias: string;
    location: string;
  } | null>(null);
  const scanLocked = useRef(false);
  const busyRef = useRef(false);
  const labelsInitializedFor = useRef<string | null>(null);
  const mounted = useRef(true);
  const focused = useRef(false);
  const focusGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      focusGeneration.current += 1;
      setScreenFocused(true);
      return () => {
        focused.current = false;
        focusGeneration.current += 1;
        setScreenFocused(false);
      };
    }, []),
  );

  const clearPairingFields = () => {
    setDeviceId("");
    setChallengeId("");
    setPairingSecret("");
    setDeviceIdError(undefined);
    setChallengeIdError(undefined);
    setSecretError(undefined);
  };

  const startManual = () => {
    setPairError(null);
    setStage("manual");
  };

  const startScan = async () => {
    if (busyRef.current) return;
    const requestFocus = focusGeneration.current;
    setPairError(null);
    scanLocked.current = false;
    setScanIsLocked(false);
    try {
      const result = permission?.granted
        ? permission
        : await requestPermission();
      if (
        !mounted.current ||
        !focused.current ||
        focusGeneration.current !== requestFocus
      ) {
        return;
      }
      if (!result.granted) {
        setStage("manual");
        setPairError(
          "Camera access is off. Enter the pairing details instead.",
        );
        return;
      }
      setStage("scan");
    } catch {
      if (!mounted.current || focusGeneration.current !== requestFocus) return;
      setStage("manual");
      setPairError("Camera is unavailable. Enter the pairing details instead.");
    }
  };

  const handleQr = (value: string) => {
    if (!focused.current || scanLocked.current || busyRef.current) return;
    scanLocked.current = true;
    setScanIsLocked(true);
    const payload = parsePairingQrPayload(value);
    if (!payload) {
      setPairError(
        "That QR code isn't a valid pairing code. Rescan or enter the details manually.",
      );
      return;
    }
    setDeviceId(payload.device_id);
    setChallengeId(payload.challenge_id);
    setPairingSecret(payload.pairing_secret);
    setDeviceIdError(undefined);
    setChallengeIdError(undefined);
    setSecretError(undefined);
    setStage("manual");
    setPairError(null);
  };

  const submitPairing = async () => {
    if (busyRef.current) return;
    const normalizedDeviceId = deviceId.trim().toLowerCase();
    const normalizedChallengeId = challengeId.trim().toLowerCase();
    const idInvalid = !isUuid(normalizedDeviceId);
    const challengeInvalid = !isUuid(normalizedChallengeId);
    const secretInvalid = !isPairingSecret(pairingSecret);
    setDeviceIdError(idInvalid ? "Enter a valid device ID." : undefined);
    setChallengeIdError(
      challengeInvalid ? "Enter a valid challenge ID." : undefined,
    );
    setSecretError(secretInvalid ? "Enter the pairing secret." : undefined);
    if (idInvalid || challengeInvalid || secretInvalid) {
      setPairError(null);
      return;
    }
    if (!installationId) {
      setPairError("This installation isn't ready. Wait and try again.");
      return;
    }

    const requestInstallation = installationId;
    busyRef.current = true;
    setBusy(true);
    setPairError(null);
    try {
      const record = await pairDevice({
        device_id: normalizedDeviceId,
        challenge_id: normalizedChallengeId,
        pairing_secret: pairingSecret,
      });
      if (!mounted.current || installationId !== requestInstallation) return;
      setPairedRecord(record);
      setPairedDeviceId(record.deviceId);
      setPairingSecret("");
      if (labelsInitializedFor.current !== record.deviceId) {
        labelsInitializedFor.current = record.deviceId;
        setDeviceName(record.alias ?? "");
        setDeviceLocation(record.location ?? "");
      }
      setNameError(undefined);
      setLocationError(undefined);
      setSaveError(null);
      setStage("name");
    } catch (reason) {
      if (!mounted.current || installationId !== requestInstallation) return;
      const message =
        reason instanceof Error
          ? reason.message
          : "The pairing result could not be confirmed. Check Device before using this code again.";
      if (pairingFailureNeedsNewWindow(errorCode(reason))) {
        clearPairingFields();
        setStage("choose");
      }
      setPairError(message);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const saveLabels = async () => {
    if (busyRef.current || !pairedDeviceId || !installationId) return;
    const validation = validatePairingLabels(deviceName, deviceLocation);
    setNameError(validation.alias ?? undefined);
    setLocationError(validation.location ?? undefined);
    if (validation.alias || validation.location) {
      setSaveError(null);
      return;
    }
    const alias = deviceName.trim();
    const location = deviceLocation.trim();
    const requestInstallation = installationId;
    const requestDeviceId = pairedDeviceId;
    busyRef.current = true;
    setBusy(true);
    setSaveError(null);
    setDashboardError(null);
    try {
      await updateDeviceLabels(requestDeviceId, alias, location || null);
      if (
        !mounted.current ||
        installationId !== requestInstallation ||
        pairedDeviceId !== requestDeviceId
      )
        return;
      setDeviceName(alias);
      setDeviceLocation(location);
      setSavedLabels({ alias, location });
      setStage("added");
    } catch (reason) {
      if (
        !mounted.current ||
        installationId !== requestInstallation ||
        pairedDeviceId !== requestDeviceId
      )
        return;
      setSaveError(
        reason instanceof Error
          ? reason.message
          : "The name could not be saved. Your entries are still here; try again.",
      );
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const openDashboard = async () => {
    if (busyRef.current || !pairedDeviceId || !installationId) return;
    const navigationGeneration = focusGeneration.current;
    busyRef.current = true;
    setBusy(true);
    setDashboardError(null);
    try {
      await selectDevice(pairedDeviceId);
      if (!mounted.current) return;
      if (focused.current && focusGeneration.current === navigationGeneration) {
        busyRef.current = false;
        setBusy(false);
        router.replace("/");
      }
    } catch (reason) {
      if (
        !mounted.current ||
        !focused.current ||
        focusGeneration.current !== navigationGeneration
      )
        return;
      setDashboardError(
        reason instanceof Error
          ? reason.message
          : "The dashboard could not be opened. Try again.",
      );
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const pairedDevice =
    devices.find((device) => device.deviceId === pairedDeviceId) ??
    (pairedRecord?.deviceId === pairedDeviceId ? pairedRecord : null);

  return (
    <AppPage>
      <BackAction label="Back to devices" fallback="/device" />
      <PageHeading
        title={stage === "added" ? "Device added" : "Pair a device"}
        description={
          stage === "added"
            ? "Your feeder is ready to open."
            : stage === "name"
              ? "Choose a name for this feeder."
              : "Connect a feeder to this app."
        }
      />
      {pairError ? (
        <BentoCard compact>
          <Text accessibilityRole="alert" style={Typography.supporting}>
            {pairError}
          </Text>
        </BentoCard>
      ) : null}

      {stage === "choose" ? (
        <BentoCard compact>
          <Text style={Typography.cardTitle}>Choose how to connect</Text>
          <Text
            style={[
              Typography.supporting,
              { color: Colors.light.textSecondary },
            ]}
          >
            Scan the feeder&apos;s pairing QR code or enter its details.
          </Text>
          <Button icon="scan" onPress={() => void startScan()} disabled={busy}>
            Scan QR code
          </Button>
          <Button variant="secondary" onPress={startManual} disabled={busy}>
            Enter details manually
          </Button>
        </BentoCard>
      ) : null}

      {stage === "scan" ? (
        <BentoCard compact>
          <Text style={Typography.cardTitle}>Scan the pairing QR code</Text>
          {screenFocused && permission?.granted ? (
            <CameraView
              style={{ height: 280, width: "100%", borderRadius: 16 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={(result) => handleQr(result.data)}
              onMountError={() => {
                setStage("manual");
                setPairError(
                  "Camera could not start. Enter the pairing details instead.",
                );
              }}
            />
          ) : (
            <Text style={Typography.supporting}>Camera is waiting.</Text>
          )}
          {scanIsLocked && pairError ? (
            <Button
              variant="secondary"
              onPress={() => {
                scanLocked.current = false;
                setScanIsLocked(false);
                setPairError(null);
              }}
              disabled={busy}
            >
              Rescan QR code
            </Button>
          ) : null}
          <Button variant="text" onPress={startManual} disabled={busy}>
            Enter details manually
          </Button>
        </BentoCard>
      ) : null}

      {stage === "manual" ? (
        <BentoCard compact>
          <Text style={Typography.cardTitle}>Pairing details</Text>
          <Text
            style={[
              Typography.supporting,
              { color: Colors.light.textSecondary },
            ]}
          >
            Use the details from one active pairing window.
          </Text>
          <TextField
            label="Device ID"
            value={deviceId}
            onChangeText={(value) => {
              setDeviceId(value);
              setDeviceIdError(undefined);
            }}
            maxLength={36}
            autoCapitalize="none"
            autoCorrect={false}
            error={deviceIdError}
            disabled={busy}
          />
          <TextField
            label="Challenge ID"
            value={challengeId}
            onChangeText={(value) => {
              setChallengeId(value);
              setChallengeIdError(undefined);
            }}
            maxLength={36}
            autoCapitalize="none"
            autoCorrect={false}
            error={challengeIdError}
            disabled={busy}
          />
          <TextField
            label="Pairing secret"
            value={pairingSecret}
            onChangeText={(value) => {
              setPairingSecret(Array.from(value).slice(0, 512).join(""));
              setSecretError(undefined);
            }}
            maxLength={1024}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            error={secretError}
            disabled={busy}
          />
          <Button
            onPress={() => void submitPairing()}
            loading={busy}
            disabled={busy}
          >
            Verify and pair
          </Button>
          <Button
            variant="text"
            onPress={() => {
              clearPairingFields();
              setPairError(null);
              setStage("choose");
            }}
            disabled={busy}
          >
            Choose another method
          </Button>
        </BentoCard>
      ) : null}

      {stage === "name" ? (
        <BentoCard compact>
          <Text style={Typography.cardTitle}>Name your feeder</Text>
          {pairedDevice ? (
            <Text
              style={[
                Typography.metadata,
                { color: Colors.light.textSecondary },
              ]}
            >
              ID · {pairedDevice.deviceId.slice(-6).toUpperCase()}
            </Text>
          ) : null}
          <TextField
            label="Device name"
            hint="Required · up to 100 characters"
            value={deviceName}
            onChangeText={(value) => {
              setDeviceName(Array.from(value).slice(0, 100).join(""));
              setNameError(undefined);
            }}
            maxLength={200}
            autoCapitalize="words"
            error={nameError}
            disabled={busy}
          />
          <TextField
            label="Location (optional)"
            hint="Up to 160 characters"
            value={deviceLocation}
            onChangeText={(value) => {
              setDeviceLocation(Array.from(value).slice(0, 160).join(""));
              setLocationError(undefined);
            }}
            maxLength={320}
            autoCapitalize="words"
            error={locationError}
            disabled={busy}
          />
          {saveError ? (
            <Text accessibilityRole="alert" style={Typography.supporting}>
              {saveError}
            </Text>
          ) : null}
          <Button
            onPress={() => void saveLabels()}
            loading={busy}
            disabled={busy}
          >
            Save device name
          </Button>
        </BentoCard>
      ) : null}

      {stage === "added" ? (
        <BentoCard compact>
          <Text style={Typography.cardTitle}>
            {savedLabels?.alias || pairedDevice?.alias || "Device added"}
          </Text>
          {savedLabels?.location || pairedDevice?.location ? (
            <Text
              style={[
                Typography.supporting,
                { color: Colors.light.textSecondary },
              ]}
            >
              {savedLabels?.location || pairedDevice?.location}
            </Text>
          ) : null}
          {pairedDeviceId ? (
            <Text
              style={[
                Typography.metadata,
                { color: Colors.light.textSecondary },
              ]}
            >
              ID · {pairedDeviceId.slice(-6).toUpperCase()}
            </Text>
          ) : null}
          {dashboardError ? (
            <Text accessibilityRole="alert" style={Typography.supporting}>
              {dashboardError}
            </Text>
          ) : null}
          <Button
            icon="arrow-up-right"
            onPress={() => void openDashboard()}
            loading={busy}
            disabled={busy || !pairedDeviceId}
          >
            Open dashboard
          </Button>
          <Button
            variant="secondary"
            onPress={() => router.replace("/device")}
            disabled={busy}
          >
            Device list
          </Button>
        </BentoCard>
      ) : null}
    </AppPage>
  );
}
