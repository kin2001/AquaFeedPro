import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  isPairingSecret,
  isUuid,
  sameDeviceRequestScope,
  type DeviceRequestScope,
  type PairingQrPayload,
} from "./device-access-state";
import {
  getSecureStorageFailure,
  resetSecureStorageFailure,
  SecureSessionStorageError,
} from "./secure-session-storage";
import {
  removeLegacySqliteSession,
  secureSessionStorage,
  supabase,
} from "./supabase";

export type NozzleCapability = {
  enabled: boolean;
  doseModes: string[];
  minDoseG: number | null;
  maxDoseG: number | null;
};

export type DeviceCapabilities = {
  doMonitoring: boolean;
  feedRemainingMonitoring: boolean;
  localScheduleExecution: boolean;
  maxSchedules: number | null;
  nozzles: { "1": NozzleCapability; "2": NozzleCapability };
};

export type DeviceRecord = {
  deviceId: string;
  alias: string | null;
  location: string | null;
  model: string;
  firmwareVersion: string;
  protocolMajor: 2;
  isSimulated: boolean;
  capabilitiesRevision: number;
  capabilities: DeviceCapabilities;
  contactFreshness: string;
  lastAuthenticatedContactAt: string | null;
};

type AccessPhase = "loading" | "ready" | "error";

type PairingDetails = Pick<
  PairingQrPayload,
  "device_id" | "challenge_id" | "pairing_secret"
>;

type DeviceAccessContextValue = {
  phase: AccessPhase;
  bootstrapError: string | null;
  installationId: string | null;
  devices: DeviceRecord[];
  selectedDeviceId: string | null;
  selectedDevice: DeviceRecord | null;
  deviceError: string | null;
  refreshing: boolean;
  retryBootstrap: () => void;
  refreshDevices: () => Promise<DeviceRecord[]>;
  selectDevice: (deviceId: string | null) => Promise<void>;
  pairDevice: (pairing: PairingDetails) => Promise<string>;
  updateDeviceLabels: (
    deviceId: string,
    alias: string | null,
    location: string | null,
  ) => Promise<void>;
  revokeDevice: (deviceId: string) => Promise<void>;
};

class DeviceAccessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeviceAccessError";
    this.code = code;
  }
}

const DeviceAccessContext = createContext<DeviceAccessContextValue | null>(null);
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

function selectionKey(installationId: string) {
  return `aquafeed-selected-device-v2:${installationId}`;
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseCapabilities(value: unknown): DeviceCapabilities | null {
  const source = safeRecord(value);
  const nozzles = safeRecord(source?.nozzles);
  const first = safeRecord(nozzles?.["1"]);
  const second = safeRecord(nozzles?.["2"]);
  if (!first || !second) return null;

  const parseNozzle = (nozzle: Record<string, unknown>) => {
    if (
      typeof nozzle.enabled !== "boolean" ||
      !Array.isArray(nozzle.dose_modes) ||
      !nozzle.dose_modes.every((mode) => typeof mode === "string")
    ) {
      return null;
    }
    const minDose = nozzle.min_dose_g;
    const maxDose = nozzle.max_dose_g;
    if (
      (minDose !== null && minDose !== undefined &&
        (typeof minDose !== "number" || !Number.isFinite(minDose) || minDose < 0)) ||
      (maxDose !== null && maxDose !== undefined &&
        (typeof maxDose !== "number" || !Number.isFinite(maxDose) || maxDose < 0))
    ) {
      return null;
    }
    return {
      enabled: nozzle.enabled,
      doseModes: nozzle.dose_modes,
      minDoseG: typeof minDose === "number" ? minDose : null,
      maxDoseG: typeof maxDose === "number" ? maxDose : null,
    };
  };
  const parsedFirst = parseNozzle(first);
  const parsedSecond = parseNozzle(second);
  if (!parsedFirst || !parsedSecond) return null;

  const maxSchedules = source?.max_schedules;
  if (
    maxSchedules !== undefined && maxSchedules !== null &&
    (typeof maxSchedules !== "number" || !Number.isInteger(maxSchedules) || maxSchedules < 0)
  ) {
    return null;
  }
  return {
    doMonitoring: source?.do_monitoring === true,
    feedRemainingMonitoring: source?.feed_remaining_monitoring === true,
    localScheduleExecution: source?.local_schedule_execution === true,
    maxSchedules: typeof maxSchedules === "number" ? maxSchedules : null,
    nozzles: { "1": parsedFirst, "2": parsedSecond },
  };
}

function makeDeviceRecords(
  memberships: Array<{
    device_id: string;
    alias: string | null;
    location: string | null;
  }>,
  profiles: Array<{
    device_id: string;
    model: string;
    firmware_version: string;
    protocol_major: number;
    is_simulated: boolean;
    capabilities_revision: number;
    capabilities: unknown;
  }>,
  states: Array<{
    device_id: string;
    contact_freshness: string;
    last_authenticated_contact_at: string | null;
  }>,
) {
  const profileById = new Map(profiles.map((profile) => [profile.device_id, profile]));
  const stateById = new Map(states.map((state) => [state.device_id, state]));
  const records: DeviceRecord[] = [];

  for (const membership of memberships) {
    if (!isUuid(membership.device_id)) continue;
    const profile = profileById.get(membership.device_id);
    if (!profile) continue;
    const capabilities = parseCapabilities(profile.capabilities);
    if (
      profile.protocol_major !== 2 ||
      typeof profile.model !== "string" ||
      typeof profile.firmware_version !== "string" ||
      typeof profile.is_simulated !== "boolean" ||
      !Number.isInteger(profile.capabilities_revision) ||
      profile.capabilities_revision < 1 ||
      !capabilities
    ) {
      throw new DeviceAccessError(
        "INVALID_DEVICE_PROFILE",
        "A paired device returned an invalid protocol 2 profile. Its details are hidden until it can be checked.",
      );
    }
    const state = stateById.get(profile.device_id);
    records.push({
      deviceId: profile.device_id,
      alias: membership.alias,
      location: membership.location,
      model: profile.model,
      firmwareVersion: profile.firmware_version,
      protocolMajor: 2,
      isSimulated: profile.is_simulated,
      capabilitiesRevision: profile.capabilities_revision,
      capabilities,
      contactFreshness: state?.contact_freshness ?? "unknown",
      lastAuthenticatedContactAt: state?.last_authenticated_contact_at ?? null,
    });
  }
  return records;
}

function requestId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && "randomUUID" in cryptoApi) return cryptoApi.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (part) => {
    const value = Math.floor(Math.random() * 16);
    return (part === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function apiError(status: number, value: unknown) {
  const record = safeRecord(value);
  const code = typeof record?.code === "string" ? record.code : `HTTP_${status}`;
  const messages: Record<string, string> = {
    CHALLENGE_EXPIRED: "This pairing challenge expired. Open a new pairing window on the device.",
    CHALLENGE_CONSUMED: "This pairing challenge was already used. Open a new pairing window on the device.",
    PAIRING_DENIED: "The pairing details were not accepted. Check the QR code or enter a fresh code.",
    PAIRING_ATTEMPTS_EXCEEDED: "Too many pairing attempts. Open a new pairing window on the device.",
    RATE_LIMITED: "Too many requests. Wait briefly, then try again.",
    ACCESS_REVOKED: "This installation no longer has access to that device.",
    DEVICE_NOT_FOUND: "That device is not available for this installation.",
    INVALID_REQUEST: "The request is invalid. Check the device details and try again.",
    SERVICE_UNAVAILABLE: "The device service is temporarily unavailable. Try again shortly.",
  };
  return new DeviceAccessError(
    code,
    messages[code] ?? "The device request could not be completed. Try again.",
  );
}

async function callAppApi(
  session: NonNullable<Awaited<ReturnType<typeof currentSession>>>,
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  extraHeaders?: Record<string, string>,
) {
  const response = await fetch(`${supabaseUrl}/functions/v1/app-api/v2${path}`, {
    method,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (text.length > 16_384) {
    throw new DeviceAccessError("INVALID_RESPONSE", "The device service returned an invalid response.");
  }
  let value: unknown = null;
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new DeviceAccessError("INVALID_RESPONSE", "The device service returned an invalid response.");
    }
  }
  if (!response.ok) throw apiError(response.status, value);
  return value;
}

async function currentSession() {
  const { data, error } = await supabase.auth.getSession();
  const storageError = getSecureStorageFailure();
  if (storageError) throw storageError;
  if (error || !data.session || data.session.user.is_anonymous !== true) {
    throw new DeviceAccessError("SESSION_UNAVAILABLE", "The installation session expired. Restart the app to pair this installation again.");
  }
  return data.session;
}

export function DeviceAccessProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AccessPhase>("loading");
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const stateRef = useRef<DeviceRequestScope>({
    installationId: null,
    revision: 0,
    selectedDeviceId: null,
  });
  const devicesRef = useRef<DeviceRecord[]>([]);
  const bootstrapPromiseRef = useRef<Promise<void> | null>(null);
  const activationRef = useRef<{ id: string; promise: Promise<void> } | null>(null);
  const refreshRef = useRef<() => Promise<DeviceRecord[]>>(async () => []);

  const clearVisibleDevices = useCallback(() => {
    devicesRef.current = [];
    setDevices([]);
  }, []);

  const setBootstrapFailure = useCallback(
    (error: unknown) => {
      const storageFailure = getSecureStorageFailure();
      const message =
        storageFailure?.message ??
        (error instanceof SecureSessionStorageError
          ? error.message
          : error instanceof DeviceAccessError
            ? error.message
            : "The installation could not be started. Check the connection and try again.");
      stateRef.current = {
        installationId: null,
        revision: stateRef.current.revision + 1,
        selectedDeviceId: null,
      };
      setInstallationId(null);
      setSelectedDeviceId(null);
      clearVisibleDevices();
      activationRef.current = null;
      setBootstrapError(message);
      setPhase("error");
    },
    [clearVisibleDevices],
  );

  const deactivateInstallation = useCallback(
    (message: string) => {
      stateRef.current = {
        installationId: null,
        revision: stateRef.current.revision + 1,
        selectedDeviceId: null,
      };
      activationRef.current = null;
      setInstallationId(null);
      setSelectedDeviceId(null);
      clearVisibleDevices();
      setDeviceError(null);
      setBootstrapError(message);
      setPhase("error");
    },
    [clearVisibleDevices],
  );

  const activateInstallation = useCallback(
    (userId: string) => {
      if (!isUuid(userId)) {
        deactivateInstallation("The installation identity is invalid. Device access is blocked.");
        return Promise.resolve();
      }
      const current = stateRef.current;
      if (current.installationId === userId && phase === "ready") {
        return Promise.resolve();
      }
      if (activationRef.current?.id === userId) return activationRef.current.promise;

      const nextState: DeviceRequestScope = {
        installationId: userId,
        revision: current.revision + 1,
        selectedDeviceId: null,
      };
      stateRef.current = nextState;
      setInstallationId(userId);
      setSelectedDeviceId(null);
      setDeviceError(null);
      clearVisibleDevices();
      setPhase("loading");

      const promise = (async () => {
        try {
          const savedSelection = await secureSessionStorage.getItem(selectionKey(userId));
          if (getSecureStorageFailure()) throw getSecureStorageFailure();
          if (!sameDeviceRequestScope(nextState, stateRef.current)) return;
          if (savedSelection && isUuid(savedSelection)) {
            const selectedState = { ...stateRef.current, selectedDeviceId: savedSelection };
            stateRef.current = selectedState;
            setSelectedDeviceId(savedSelection);
          } else if (savedSelection !== null) {
            await secureSessionStorage.removeItem(selectionKey(userId));
          }
          setPhase("ready");
          await refreshRef.current();
        } catch (error) {
          setBootstrapFailure(error);
          throw error;
        }
      })();
      activationRef.current = { id: userId, promise };
      return promise;
    },
    [clearVisibleDevices, deactivateInstallation, phase, setBootstrapFailure],
  );

  const refreshDevices = useCallback(async () => {
    const scope = stateRef.current;
    const userId = scope.installationId;
    if (!userId) return [];
    setRefreshing(true);
    setDeviceError(null);
    clearVisibleDevices();
    try {
      const session = await currentSession();
      if (session.user.id !== userId || !sameDeviceRequestScope(scope, stateRef.current)) return [];

      const membershipsResult = await supabase
        .from("device_access")
        .select("device_id, alias, location")
        .eq("installation_id", userId)
        .eq("status", "active")
        .order("granted_at", { ascending: false });
      if (membershipsResult.error) throw new Error("membership query denied");
      const memberships = membershipsResult.data ?? [];
      if (!sameDeviceRequestScope(scope, stateRef.current)) return [];
      if (memberships.length === 0) {
        const savedKey = selectionKey(userId);
        await secureSessionStorage.removeItem(savedKey);
        if (getSecureStorageFailure()) throw getSecureStorageFailure();
        stateRef.current = {
          ...stateRef.current,
          revision: stateRef.current.revision + 1,
          selectedDeviceId: null,
        };
        setSelectedDeviceId(null);
        return [];
      }

      const ids = memberships.map((row) => row.device_id);
      const [profilesResult, statesResult] = await Promise.all([
        supabase
          .from("devices")
          .select("device_id, model, firmware_version, protocol_major, is_simulated, capabilities_revision, capabilities")
          .in("device_id", ids),
        supabase
          .from("device_state")
          .select("device_id, contact_freshness, last_authenticated_contact_at")
          .in("device_id", ids),
      ]);
      if (profilesResult.error || statesResult.error) throw new Error("device read denied");
      if (!sameDeviceRequestScope(scope, stateRef.current)) return [];
      const authorizedRecords = makeDeviceRecords(
        memberships,
        profilesResult.data ?? [],
        statesResult.data ?? [],
      );
      devicesRef.current = authorizedRecords;
      setDevices(authorizedRecords);
      const selected = stateRef.current.selectedDeviceId;
      if (selected && !authorizedRecords.some((device) => device.deviceId === selected)) {
        await secureSessionStorage.removeItem(selectionKey(userId));
        if (getSecureStorageFailure()) throw getSecureStorageFailure();
        stateRef.current = {
          ...stateRef.current,
          revision: stateRef.current.revision + 1,
          selectedDeviceId: null,
        };
        setSelectedDeviceId(null);
      }
      return authorizedRecords;
    } catch (error) {
      clearVisibleDevices();
      if (getSecureStorageFailure()) {
        setBootstrapFailure(error);
      } else if (sameDeviceRequestScope(scope, stateRef.current)) {
        setDeviceError(
          error instanceof DeviceAccessError
            ? error.message
            : "Authorized device data could not be read. Refresh when the connection is available.",
        );
      }
      if (getSecureStorageFailure()) throw getSecureStorageFailure();
      return [];
    } finally {
      setRefreshing(false);
    }
  }, [clearVisibleDevices, setBootstrapFailure]);
  refreshRef.current = refreshDevices;

  const selectDevice = useCallback(async (deviceId: string | null) => {
    const snapshot = stateRef.current;
    const userId = snapshot.installationId;
    if (!userId) throw new DeviceAccessError("SESSION_UNAVAILABLE", "The installation session is unavailable.");
    if (deviceId !== null && !devicesRef.current.some((device) => device.deviceId === deviceId)) {
      throw new DeviceAccessError("DEVICE_NOT_FOUND", "That device is not available for this installation.");
    }
    try {
      const key = selectionKey(userId);
      if (deviceId) await secureSessionStorage.setItem(key, deviceId);
      else await secureSessionStorage.removeItem(key);
      if (getSecureStorageFailure()) throw getSecureStorageFailure();
    } catch {
      const error = getSecureStorageFailure() ?? new SecureSessionStorageError("unavailable");
      deactivateInstallation(error.message);
      throw error;
    }
    if (!sameDeviceRequestScope(snapshot, stateRef.current)) return;
    stateRef.current = {
      ...stateRef.current,
      revision: stateRef.current.revision + 1,
      selectedDeviceId: deviceId,
    };
    setSelectedDeviceId(deviceId);
  }, [deactivateInstallation]);

  const pairDevice = useCallback(async (pairing: PairingDetails) => {
    if (!isUuid(pairing.device_id) || !isUuid(pairing.challenge_id) || !isPairingSecret(pairing.pairing_secret)) {
      throw new DeviceAccessError("INVALID_REQUEST", "Enter a valid protocol 2 pairing code.");
    }
    const scope = stateRef.current;
    const userId = scope.installationId;
    if (!userId) throw new DeviceAccessError("SESSION_UNAVAILABLE", "The installation session is unavailable.");
    const session = await currentSession();
    if (session.user.id !== userId) throw new DeviceAccessError("SESSION_CHANGED", "The installation changed. Start pairing again.");
    const value = await callAppApi(session, "/pair", "POST", {
      protocol_major: 2,
      request_id: requestId(),
      device_id: pairing.device_id,
      challenge_id: pairing.challenge_id,
      pairing_secret: pairing.pairing_secret,
    });
    if (!sameDeviceRequestScope(scope, stateRef.current)) {
      throw new DeviceAccessError("SESSION_CHANGED", "The installation or selected device changed. Start pairing again.");
    }
    const response = safeRecord(value);
    const pairedDevice = safeRecord(response?.device);
    if (!pairedDevice || pairedDevice.device_id !== pairing.device_id) {
      throw new DeviceAccessError("INVALID_RESPONSE", "The device service returned an invalid pairing result.");
    }
    await refreshDevices();
    if (!devicesRef.current.some((device) => device.deviceId === pairing.device_id)) {
      throw new DeviceAccessError("DEVICE_NOT_FOUND", "Pairing was accepted, but the active device list could not be refreshed. Open Device and retry.");
    }
    await selectDevice(pairing.device_id);
    return pairing.device_id;
  }, [refreshDevices, selectDevice]);

  const updateDeviceLabels = useCallback(async (
    deviceId: string,
    alias: string | null,
    location: string | null,
  ) => {
    if (!isUuid(deviceId)) throw new DeviceAccessError("INVALID_REQUEST", "The device identity is invalid.");
    if (alias !== null && (alias.trim().length < 1 || alias.trim().length > 80)) {
      throw new DeviceAccessError("INVALID_REQUEST", "Enter a device label up to 80 characters.");
    }
    if (location !== null && location.trim().length > 80) {
      throw new DeviceAccessError("INVALID_REQUEST", "Enter a location up to 80 characters.");
    }
    const scope = stateRef.current;
    const userId = scope.installationId;
    if (!userId) throw new DeviceAccessError("SESSION_UNAVAILABLE", "The installation session is unavailable.");
    const session = await currentSession();
    if (session.user.id !== userId) throw new DeviceAccessError("SESSION_CHANGED", "The installation changed. Try again.");
    await callAppApi(session, `/devices/${deviceId}/alias`, "PATCH", {
      alias,
      location,
    }, { "X-Protocol-Major": "2", "X-Request-Id": requestId() });
    if (!sameDeviceRequestScope(scope, stateRef.current)) return;
    await refreshDevices();
  }, [refreshDevices]);

  const revokeDevice = useCallback(async (deviceId: string) => {
    if (!isUuid(deviceId)) throw new DeviceAccessError("INVALID_REQUEST", "The device identity is invalid.");
    const scope = stateRef.current;
    const userId = scope.installationId;
    if (!userId) throw new DeviceAccessError("SESSION_UNAVAILABLE", "The installation session is unavailable.");
    const session = await currentSession();
    if (session.user.id !== userId) throw new DeviceAccessError("SESSION_CHANGED", "The installation changed. Try again.");
    await callAppApi(session, `/devices/${deviceId}/access`, "DELETE", undefined, {
      "X-Protocol-Major": "2",
      "X-Request-Id": requestId(),
    });
    if (!sameDeviceRequestScope(scope, stateRef.current)) return;
    const remaining = devicesRef.current.filter((device) => device.deviceId !== deviceId);
    devicesRef.current = remaining;
    setDevices(remaining);
    if (stateRef.current.selectedDeviceId === deviceId) await selectDevice(null);
  }, [selectDevice]);

  const runBootstrap = useCallback(() => {
    if (bootstrapPromiseRef.current) return bootstrapPromiseRef.current;
    const attempt = (async () => {
      setPhase("loading");
      setBootstrapError(null);
      clearVisibleDevices();
      try {
        resetSecureStorageFailure();
        const secureStoreAvailable = await SecureStore.isAvailableAsync().catch(() => false);
        if (Platform.OS === "web" || !secureStoreAvailable) {
          throw new SecureSessionStorageError("unavailable");
        }
        removeLegacySqliteSession();
        const current = await supabase.auth.getSession();
        if (getSecureStorageFailure()) throw getSecureStorageFailure();
        if (current.error) throw new Error("session restore failed");
        let session = current.data.session;
        if (!session) {
          const result = await supabase.auth.signInAnonymously();
          if (getSecureStorageFailure()) throw getSecureStorageFailure();
          if (result.error || !result.data.session) {
            throw new DeviceAccessError("AUTH_UNAVAILABLE", "Anonymous installation sign-in is unavailable. Check the connection and try again.");
          }
          session = result.data.session;
        }
        if (session.user.is_anonymous !== true) {
          throw new DeviceAccessError("INVALID_INSTALLATION", "This is not an anonymous installation session. Device access is blocked.");
        }
        await activateInstallation(session.user.id);
        if (!getSecureStorageFailure()) setPhase("ready");
      } catch (error) {
        setBootstrapFailure(error);
      }
    })();
    bootstrapPromiseRef.current = attempt;
    void attempt.finally(() => {
      bootstrapPromiseRef.current = null;
    });
    return attempt;
  }, [activateInstallation, clearVisibleDevices, setBootstrapFailure]);

  useEffect(() => {
    void runBootstrap();
  }, [bootstrapAttempt, runBootstrap]);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        deactivateInstallation("The installation session ended. Restart the app to pair this installation again.");
        return;
      }
      if (session.user.is_anonymous !== true) {
        deactivateInstallation("The installation session is invalid. Device access is blocked.");
        return;
      }
      if (session.user.id !== stateRef.current.installationId) {
        setTimeout(() => void activateInstallation(session.user.id).catch(() => {}), 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [activateInstallation, deactivateInstallation]);

  useEffect(() => {
    const refreshLifecycle = (state: string) => {
      if (state === "active") {
        void supabase.auth.startAutoRefresh();
        void refreshRef.current();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    };
    refreshLifecycle(AppState.currentState ?? "active");
    const subscription = AppState.addEventListener("change", refreshLifecycle);
    return () => {
      subscription.remove();
      void supabase.auth.stopAutoRefresh();
    };
  }, []);

  const retryBootstrap = useCallback(() => {
    setBootstrapAttempt((attempt) => attempt + 1);
  }, []);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.deviceId === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  const value = useMemo<DeviceAccessContextValue>(() => ({
    phase,
    bootstrapError,
    installationId,
    devices,
    selectedDeviceId,
    selectedDevice,
    deviceError,
    refreshing,
    retryBootstrap,
    refreshDevices,
    selectDevice,
    pairDevice,
    updateDeviceLabels,
    revokeDevice,
  }), [
    phase,
    bootstrapError,
    installationId,
    devices,
    selectedDeviceId,
    selectedDevice,
    deviceError,
    refreshing,
    retryBootstrap,
    refreshDevices,
    selectDevice,
    pairDevice,
    updateDeviceLabels,
    revokeDevice,
  ]);

  return <DeviceAccessContext.Provider value={value}>{children}</DeviceAccessContext.Provider>;
}

export function useDeviceAccess() {
  const value = useContext(DeviceAccessContext);
  if (!value) throw new Error("useDeviceAccess must be used inside DeviceAccessProvider");
  return value;
}
