import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import {
  createResourceUpdateState,
  DEVICE_RESOURCES,
  parseDeviceUpdateHint,
  reduceResourceUpdate,
  type DeviceResource,
  type DeviceUpdateHint,
  type ResourceUpdateState,
} from "./device-update-state";

export type DeviceUpdateScope = Readonly<{
  installationId: string;
  deviceId: string;
  scopeRevision: number;
}>;
export type DeviceUpdateBinding = Readonly<{ focus: string; query: string }>;
export type DeviceUpdateReaderKey =
  | "monitoring"
  | "configuration"
  | "next"
  | "graph"
  | "history"
  | "detail"
  | "command"
  | "contact"
  | "alerts";
export type DeviceUpdateReadContext = {
  isCurrent: () => boolean;
  scope: DeviceUpdateScope;
  binding: DeviceUpdateBinding;
};
export type DeviceUpdatesTransport = (
  name: string,
  deviceId: string,
  onHint: (hint: unknown) => void,
  onConnection: (status: "joined" | "degraded") => void,
) => () => void;
export type DeviceUpdateRegistration = {
  registerDeviceUpdateReader: (
    key: DeviceUpdateReaderKey,
    resources: readonly DeviceResource[],
    binding: DeviceUpdateBinding,
    read: (context: DeviceUpdateReadContext) => Promise<void | "deferred">,
  ) => () => void;
};

export type DeviceUpdateRecovery = {
  readRevisions(
    scope: DeviceUpdateScope,
    isCurrent: () => boolean,
  ): Promise<unknown>;
  readContact?: (
    context: DeviceUpdateReadContext,
  ) => Promise<void | "deferred">;
  readProfile?: (
    context: DeviceUpdateReadContext,
  ) => Promise<void | "deferred">;
};

export function createDeviceUpdates(
  input: DeviceUpdateScope,
  subscribe: DeviceUpdatesTransport,
  recovery?: DeviceUpdateRecovery,
) {
  const scope = Object.freeze({ ...input });
  type Owner = {
    token: number;
    binding: DeviceUpdateBinding;
    read: Parameters<DeviceUpdateRegistration["registerDeviceUpdateReader"]>[3];
    state: ResourceUpdateState;
    retry: boolean;
  };
  type Slot = {
    owner?: Owner;
    running: boolean;
    timer?: ReturnType<typeof setTimeout>;
  };
  type SlotKey = DeviceUpdateReaderKey | "access-contact" | "access-profile";
  const slots = new Map<SlotKey, Slot>();
  const highest: DeviceUpdateHint["revisions"] = {};
  let active = false;
  let denied = false;
  let epoch = 0;
  let nextToken = 0;
  let channelGeneration = 0;
  let unsubscribe: (() => void) | undefined;
  let appStateSub: { remove(): void } | undefined;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let transportDegraded = false;
  let snapshotDegraded = false;
  let recoveryAttempt = 0;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryMode: "healthy" | "degraded" | undefined;
  let snapshotPending = false;
  let reconcileFlight: Promise<void> | undefined;
  const reconnectDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
  const recoveryDelays = [30_000, 60_000, 120_000, 300_000];

  const jitter = (ms: number) => Math.round(ms * (0.9 + Math.random() * 0.2));
  const clearReconnect = () => {
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  };
  const cancelRecovery = () => {
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
  };
  const cancelTimer = (slot: Slot) => {
    if (slot.timer !== undefined) clearTimeout(slot.timer);
    slot.timer = undefined;
  };
  function schedule(slot: Slot, delay: number, retry = false) {
    if (
      !active ||
      !slot.owner ||
      (slot.owner.retry && !retry) ||
      slot.running ||
      slot.timer !== undefined ||
      slot.owner.state.generation === slot.owner.state.completed
    )
      return;
    slot.timer = setTimeout(() => {
      slot.timer = undefined;
      const owner = slot.owner;
      if (!active || !owner || slot.running) return;
      const capturedEpoch = epoch;
      const isCurrent = () =>
        active && epoch === capturedEpoch && slot.owner?.token === owner.token;
      slot.running = true;
      owner.state = reduceResourceUpdate(owner.state, { type: "start" });
      const finish = (success: boolean) => {
        slot.running = false;
        const current = isCurrent();
        if (slot.owner === owner) {
          owner.state = reduceResourceUpdate(owner.state, {
            type: current && success ? "success" : "failure",
          });
          if (current) owner.retry = !success && Boolean(recovery);
        }
        if (success || !current) schedule(slot, 0);
        scheduleRecovery();
      };
      void Promise.resolve()
        .then(() =>
          isCurrent()
            ? owner.read({ isCurrent, scope, binding: owner.binding })
            : "deferred",
        )
        .then(
          (result) => finish(result !== "deferred"),
          () => finish(false),
        );
    }, delay);
  }

  function handleHint(hint: DeviceUpdateHint, immediate = false) {
    for (const resource of hint.resources)
      highest[resource] = Math.max(
        highest[resource] ?? 0,
        hint.revisions[resource]!,
      );
    for (const slot of slots.values()) {
      if (!slot.owner) continue;
      const before = slot.owner.state;
      slot.owner.state = reduceResourceUpdate(before, { type: "hint", hint });
      if (slot.owner.state !== before) {
        if (immediate) schedule(slot, 0);
        else schedule(slot, 250);
      }
    }
  }

  function invalidate() {
    for (const slot of slots.values()) {
      if (!slot.owner) continue;
      slot.owner.retry = false;
      slot.owner.state = reduceResourceUpdate(slot.owner.state, {
        type: "invalidate",
      });
      cancelTimer(slot);
      schedule(slot, 0);
    }
  }

  function reconcile() {
    if (!active || !recovery || reconcileFlight) return;
    const capturedEpoch = epoch;
    const isCurrent = () => active && epoch === capturedEpoch;
    snapshotPending = false;
    reconcileFlight = Promise.resolve()
      .then(() => recovery.readRevisions(scope, isCurrent))
      .then((value) => {
        if (!isCurrent()) return;
        if (value === "denied") {
          denied = true;
          suspend();
          return;
        }
        const hint = parseDeviceUpdateHint(
          {
            device_id: scope.deviceId,
            resources: DEVICE_RESOURCES,
            revisions: value,
          },
          scope.deviceId,
        );
        if (!hint) throw new Error("Device revisions are unavailable.");
        snapshotDegraded = false;
        handleHint(hint, true);
      })
      .catch(() => {
        if (isCurrent()) snapshotDegraded = true;
      })
      .finally(() => {
        reconcileFlight = undefined;
        if (snapshotPending) reconcile();
        scheduleRecovery();
      });
  }

  function scheduleRecovery() {
    if (!active || !recovery) return;
    const degraded =
      transportDegraded ||
      snapshotDegraded ||
      [...slots.values()].some((slot) => slot.owner?.retry);
    const mode = degraded ? "degraded" : "healthy";
    if (mode !== recoveryMode) {
      cancelRecovery();
      recoveryAttempt = 0;
      recoveryMode = mode;
    }
    if (recoveryTimer !== undefined) return;
    const delay = degraded
      ? recoveryDelays[Math.min(recoveryAttempt, recoveryDelays.length - 1)]
      : 300_000;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      if (degraded) {
        recoveryAttempt = Math.min(
          recoveryAttempt + 1,
          recoveryDelays.length - 1,
        );
        for (const slot of slots.values()) {
          if (!slot.owner?.retry) continue;
          schedule(slot, 0, true);
        }
      }
      reconcile();
    }, jitter(delay));
  }

  const registerDeviceUpdateReader = (
    key: SlotKey,
    resources: readonly DeviceResource[],
    binding: DeviceUpdateBinding,
    read: Owner["read"],
  ) => {
    let slot = slots.get(key);
    if (!slot) {
      slot = { running: false };
      slots.set(key, slot);
    }
    cancelTimer(slot);
    const token = ++nextToken;
    slot.owner = {
      token,
      binding: Object.freeze({ ...binding }),
      read,
      retry: false,
      state: reduceResourceUpdate(createResourceUpdateState(resources), {
        type: "hint",
        hint: {
          device_id: scope.deviceId,
          resources: Object.keys(highest) as DeviceResource[],
          revisions: highest,
        },
      }),
    };
    schedule(slot, 0);
    return () => {
      if (slot.owner?.token !== token) return;
      cancelTimer(slot);
      slot.owner = undefined;
      scheduleRecovery();
    };
  };

  function disconnect() {
    channelGeneration++;
    const remove = unsubscribe;
    unsubscribe = undefined;
    remove?.();
  }

  function connect() {
    const channel = ++channelGeneration;
    const isCurrent = () => active && channel === channelGeneration;
    const remove = subscribe(
      "device-updates",
      scope.deviceId,
      (value) => {
        if (!isCurrent()) return;
        const hint = parseDeviceUpdateHint(value, scope.deviceId);
        if (hint) handleHint(hint);
      },
      (status) => {
        if (!isCurrent()) return;
        if (status === "joined") {
          const rejoined = transportDegraded;
          transportDegraded = false;
          reconnectAttempt = 0;
          clearReconnect();
          if (rejoined || !recovery) invalidate();
          reconcile();
          scheduleRecovery();
        } else {
          transportDegraded = true;
          disconnect();
          const delay =
            reconnectDelays[
              Math.min(reconnectAttempt++, reconnectDelays.length - 1)
            ];
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            if (active) connect();
          }, jitter(delay));
          scheduleRecovery();
        }
      },
    );
    if (isCurrent()) unsubscribe = remove;
    else remove();
  }

  function resume() {
    if (active || denied) return;
    active = true;
    epoch++;
    reconnectAttempt = 0;
    transportDegraded = false;
    snapshotDegraded = false;
    snapshotPending = true;
    connect();
    // Subscribe before the first read so an in-flight snapshot cannot hide a newer hint.
    invalidate();
    reconcile();
  }

  function suspend() {
    active = false;
    epoch++;
    snapshotPending = false;
    recoveryMode = undefined;
    clearReconnect();
    cancelRecovery();
    for (const slot of slots.values()) cancelTimer(slot);
    disconnect();
  }

  const accessBinding = { focus: "access", query: scope.deviceId };
  if (recovery?.readContact)
    registerDeviceUpdateReader(
      "access-contact",
      ["contact"],
      accessBinding,
      recovery.readContact,
    );
  if (recovery?.readProfile)
    registerDeviceUpdateReader(
      "access-profile",
      ["configuration"],
      accessBinding,
      recovery.readProfile,
    );

  return {
    registerDeviceUpdateReader,
    start() {
      if (appStateSub) return;
      appStateSub = AppState.addEventListener("change", (state) => {
        if (state === "active") resume();
        else suspend();
      });
      if (AppState.currentState === "active") resume();
    },
    stop() {
      appStateSub?.remove();
      appStateSub = undefined;
      suspend();
    },
  };
}
const DeviceUpdatesContext = createContext<
  DeviceUpdateRegistration | null | undefined
>(undefined);
export function DeviceUpdatesProvider({
  scope,
  active,
  subscribe,
  recovery,
  children,
}: {
  scope: DeviceUpdateScope | null;
  active: boolean;
  subscribe: DeviceUpdatesTransport;
  recovery?: DeviceUpdateRecovery;
  children: ReactNode;
}) {
  const installationId = scope?.installationId,
    deviceId = scope?.deviceId,
    scopeRevision = scope?.scopeRevision;
  const updates = useMemo(
    () =>
      active &&
      installationId !== undefined &&
      deviceId !== undefined &&
      scopeRevision !== undefined
        ? createDeviceUpdates(
            { installationId, deviceId, scopeRevision },
            subscribe,
            recovery,
          )
        : null,
    [installationId, deviceId, scopeRevision, active, subscribe, recovery],
  );
  useEffect(() => {
    updates?.start();
    return () => updates?.stop();
  }, [updates]);
  return createElement(
    DeviceUpdatesContext.Provider,
    { value: updates },
    children,
  );
}
export function useDeviceUpdates() {
  const updates = useContext(DeviceUpdatesContext);
  if (updates === undefined)
    throw new Error("DeviceUpdatesProvider is required.");
  return updates;
}
