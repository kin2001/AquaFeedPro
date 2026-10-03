import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
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
import {
  isPairingSecret,
  isUuid,
  parsePairingQrPayload,
} from "@/lib/device-access-state";

type EntryMode = "choose" | "scan" | "manual";

export default function AddDeviceScreen() {
  const { pairDevice } = useDeviceAccess();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = useState<EntryMode>("choose");
  const [screenFocused, setScreenFocused] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [pairingSecret, setPairingSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanIsLocked, setScanIsLocked] = useState(false);
  const scanLocked = useRef(false);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => {
        setScreenFocused(false);
        setMode((current) => (current === "scan" ? "choose" : current));
      };
    }, []),
  );

  const startScan = async () => {
    setError(null);
    scanLocked.current = false;
    setScanIsLocked(false);
    try {
      const result = permission?.granted
        ? permission
        : await requestPermission();
      if (!result.granted) {
        setMode("manual");
        setError(
          "Camera access was denied. Enter the protocol 2 pairing details manually.",
        );
        return;
      }
      setMode("scan");
    } catch {
      setMode("manual");
      setError(
        "Camera access is unavailable. Enter the protocol 2 pairing details manually.",
      );
    }
  };

  const handleQr = (value: string) => {
    if (scanLocked.current) return;
    scanLocked.current = true;
    setScanIsLocked(true);
    const payload = parsePairingQrPayload(value);
    if (!payload) {
      setError(
        "This QR code is not a valid protocol 2 pairing code. Rescan or enter the details manually.",
      );
      return;
    }
    setDeviceId(payload.device_id);
    setChallengeId(payload.challenge_id);
    setPairingSecret(payload.pairing_secret);
    setMode("manual");
    setError(null);
  };

  const submitPairing = async () => {
    const normalizedDeviceId = deviceId.trim().toLowerCase();
    const normalizedChallengeId = challengeId.trim().toLowerCase();
    if (
      !isUuid(normalizedDeviceId) ||
      !isUuid(normalizedChallengeId) ||
      !isPairingSecret(pairingSecret)
    ) {
      setError(
        "Enter the device ID, challenge ID, and pairing secret from one active protocol 2 pairing window.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const pairedDeviceId = await pairDevice({
        device_id: normalizedDeviceId,
        challenge_id: normalizedChallengeId,
        pairing_secret: pairingSecret,
      });
      setPairingSecret("");
      router.replace({
        pathname: "/devices/[deviceId]",
        params: { deviceId: pairedDeviceId },
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The device could not be paired. Check the code and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppPage>
      <BackAction label="Back to devices" fallback="/device" />
      <PageHeading
        title="Pair a device"
        description="Pair a protocol 2 feeder with this anonymous installation. No email or password is required."
      />
      {error ? (
        <BentoCard compact>
          <Text accessibilityRole="alert" style={Typography.supporting}>
            {error}
          </Text>
        </BentoCard>
      ) : null}

      {mode === "choose" ? (
        <BentoCard>
          <Text style={Typography.cardTitle}>
            Choose how to enter the pairing code
          </Text>
          <Text
            style={[
              Typography.supporting,
              { color: Colors.light.textSecondary },
            ]}
          >
            Use the short lived QR code shown by the feeder or enter its
            protocol 2 details.
          </Text>
          <Button icon="scan" onPress={() => void startScan()}>
            Scan QR code
          </Button>
          <Button
            variant="secondary"
            onPress={() => {
              setError(null);
              setMode("manual");
            }}
          >
            Enter pairing details
          </Button>
        </BentoCard>
      ) : null}

      {mode === "scan" ? (
        <BentoCard>
          <Text style={Typography.cardTitle}>
            Scan the feeder pairing QR code
          </Text>
          <Text
            style={[
              Typography.supporting,
              { color: Colors.light.textSecondary },
            ]}
          >
            This reads a protocol 2 pairing code. The secret is sent securely
            for one-time verification and is never displayed or logged.
          </Text>
          {screenFocused && permission?.granted ? (
            <CameraView
              style={{
                height: 300,
                width: "100%",
                overflow: "hidden",
                borderRadius: 16,
              }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={(result) => handleQr(result.data)}
            />
          ) : (
            <Text style={Typography.supporting}>
              Camera is waiting for permission.
            </Text>
          )}
          {scanIsLocked && error ? (
            <Button
              variant="secondary"
              onPress={() => {
                scanLocked.current = false;
                setScanIsLocked(false);
                setError(null);
              }}
            >
              Rescan QR code
            </Button>
          ) : null}
          <Button
            variant="text"
            onPress={() => {
              setMode("manual");
              setError(null);
            }}
          >
            Enter details manually
          </Button>
        </BentoCard>
      ) : null}

      {mode === "manual" ? (
        <BentoCard>
          <Text style={Typography.cardTitle}>Protocol 2 pairing details</Text>
          <Text
            style={[
              Typography.supporting,
              { color: Colors.light.textSecondary },
            ]}
          >
            Enter values from the same active pairing window. Each code can be
            used once and expires automatically.
          </Text>
          <TextField
            label="Device ID"
            value={deviceId}
            onChangeText={setDeviceId}
            maxLength={36}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField
            label="Challenge ID"
            value={challengeId}
            onChangeText={setChallengeId}
            maxLength={36}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField
            label="Pairing secret"
            value={pairingSecret}
            onChangeText={setPairingSecret}
            maxLength={1024}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
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
              setMode("choose");
              setError(null);
              setPairingSecret("");
            }}
            disabled={busy}
          >
            Choose another method
          </Button>
        </BentoCard>
      ) : null}
    </AppPage>
  );
}
