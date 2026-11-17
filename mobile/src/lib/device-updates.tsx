import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  createResourceUpdateState,
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
    read: (context: DeviceUpdateReadContext) => Promise<void>,
  ) => () => void;
};

export function createDeviceUpdates(
  input: DeviceUpdateScope,
  subscribe: DeviceUpdatesTransport,
) {
  const scope = Object.freeze({ ...input });
  type Owner = {
    token: number;
    binding: DeviceUpdateBinding;
    read: Parameters<DeviceUpdateRegistration["registerDeviceUpdateReader"]>[3];
    state: ResourceUpdateState;
  };
  type Slot = {
    owner?: Owner;
    running: boolean;
    timer?: ReturnType<typeof setTimeout>;
  };
  const slots = new Map<DeviceUpdateReaderKey, Slot>();
  const highest: DeviceUpdateHint["revisions"] = {};
  let active = false,
    epoch = 0,
    nextToken = 0;
  let unsubscribe: (() => void) | undefined;
  const cancelTimer = (slot: Slot) => {
    if (slot.timer !== undefined) clearTimeout(slot.timer);
    slot.timer = undefined;
  };
  function schedule(slot: Slot, delay: number) {
    if (
      !active ||
      !slot.owner ||
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
        if (slot.owner === owner)
          owner.state = reduceResourceUpdate(owner.state, {
            type: isCurrent() && success ? "success" : "failure",
          });
        // A retired promise never acknowledges a replacement, nor frees its slot early.
        if (success || !isCurrent()) schedule(slot, 0);
      };
      void Promise.resolve()
        .then(() => {
          if (isCurrent())
            return owner.read({ isCurrent, scope, binding: owner.binding });
        })
        .then(
          () => finish(true),
          () => finish(false),
        );
    }, delay);
  }
  const invalidate = () => {
    for (const slot of slots.values())
      if (slot.owner) {
        slot.owner.state = reduceResourceUpdate(slot.owner.state, {
          type: "invalidate",
        });
        cancelTimer(slot);
        schedule(slot, 0);
      }
  };
  const registerDeviceUpdateReader: DeviceUpdateRegistration["registerDeviceUpdateReader"] =
    (key, resources, binding, read) => {
      let slot = slots.get(key);
      if (!slot) {
        slot = { running: false };
        slots.set(key, slot);
      }
      cancelTimer(slot);
      const token = ++nextToken;
      const owner: Owner = {
        token,
        binding: Object.freeze({ ...binding }),
        read,
        state: createResourceUpdateState(resources),
      };
      owner.state = reduceResourceUpdate(owner.state, {
        type: "hint",
        hint: {
          device_id: scope.deviceId,
          resources: Object.keys(highest) as DeviceResource[],
          revisions: highest,
        },
      });
      slot.owner = owner;
      schedule(slot, 0);
      return () => {
        if (slot.owner?.token !== token) return;
        cancelTimer(slot);
        slot.owner = undefined;
      };
    };
  return {
    registerDeviceUpdateReader,
    start() {
      if (active) return;
      active = true;
      const capturedEpoch = ++epoch;
      const current = () => active && epoch === capturedEpoch;
      unsubscribe = subscribe(
        "device-updates",
        scope.deviceId,
        (value) => {
          if (!current()) return;
          const hint = parseDeviceUpdateHint(value, scope.deviceId);
          if (!hint) return;
          for (const resource of hint.resources)
            highest[resource] = Math.max(
              highest[resource] ?? 0,
              hint.revisions[resource]!,
            );
          for (const slot of slots.values())
            if (slot.owner) {
              const before = slot.owner.state;
              slot.owner.state = reduceResourceUpdate(before, {
                type: "hint",
                hint,
              });
              if (slot.owner.state !== before) schedule(slot, 250);
            }
        },
        (status) => {
          if (current() && status === "joined") invalidate();
        },
      );
      // Subscribe first: equal/zero counters cannot substitute for a verified snapshot.
      invalidate();
    },
    stop() {
      active = false;
      epoch++;
      const remove = unsubscribe;
      unsubscribe = undefined;
      for (const slot of slots.values()) cancelTimer(slot);
      remove?.();
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
  children,
}: {
  scope: DeviceUpdateScope | null;
  active: boolean;
  subscribe: DeviceUpdatesTransport;
  children: ReactNode;
}) {
  const updates = useMemo(
    () => (scope && active ? createDeviceUpdates(scope, subscribe) : null),
    [
      scope?.installationId,
      scope?.deviceId,
      scope?.scopeRevision,
      active,
      subscribe,
    ],
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
