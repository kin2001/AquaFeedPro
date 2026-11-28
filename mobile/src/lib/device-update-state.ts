export const DEVICE_RESOURCES = [
  "do",
  "feed",
  "history",
  "configuration",
  "feeding",
  "contact",
  "alerts",
] as const;
export type DeviceResource = (typeof DEVICE_RESOURCES)[number];
export type DeviceUpdateHint = {
  device_id: string;
  resources: DeviceResource[];
  revisions: Partial<Record<DeviceResource, number>>;
};

export type ResourceUpdateState = {
  resources: readonly DeviceResource[];
  highest: Partial<Record<DeviceResource, number>>;
  read: Partial<Record<DeviceResource, number>>;
  generation: number;
  completed: number;
  flight: {
    generation: number;
    revisions: Partial<Record<DeviceResource, number>>;
  } | null;
};
export type ResourceUpdateEvent =
  | { type: "hint"; hint: DeviceUpdateHint }
  | { type: "invalidate" | "start" | "success" | "failure" | "reset" };

export function createResourceUpdateState(
  resources: readonly DeviceResource[],
): ResourceUpdateState {
  const highest = Object.fromEntries(
    resources.map((resource) => [resource, 0]),
  );
  return {
    resources: [...resources],
    highest,
    read: {},
    generation: 1,
    completed: 0,
    flight: null,
  };
}
export function reduceResourceUpdate(
  state: ResourceUpdateState,
  event: ResourceUpdateEvent,
): ResourceUpdateState {
  switch (event.type) {
    case "reset":
      return createResourceUpdateState(state.resources);
    case "invalidate":
      return { ...state, generation: state.generation + 1 };
    case "hint": {
      const highest = { ...state.highest };
      let changed = false;
      for (const resource of state.resources) {
        const revision = event.hint.revisions[resource];
        if (revision !== undefined && revision > (highest[resource] ?? 0)) {
          highest[resource] = revision;
          changed = true;
        }
      }
      return changed
        ? { ...state, highest, generation: state.generation + 1 }
        : state;
    }
    case "start":
      return state.flight || state.generation === state.completed
        ? state
        : {
            ...state,
            flight: {
              generation: state.generation,
              revisions: { ...state.highest },
            },
          };
    case "success":
      return state.flight
        ? {
            ...state,
            completed: state.flight.generation,
            read: state.flight.revisions,
            flight: null,
          }
        : state;
    case "failure":
      return state.flight ? { ...state, flight: null } : state;
  }
}

export function parseDeviceUpdateHint(
  value: unknown,
  deviceId: string,
): DeviceUpdateHint | null {
  const object = (item: unknown): item is Record<string, unknown> =>
    item !== null && typeof item === "object" && !Array.isArray(item);
  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
  if (
    !uuid.test(deviceId) ||
    !object(value) ||
    Object.keys(value).length !== 3 ||
    !["device_id", "resources", "revisions"].every((key) =>
      Object.hasOwn(value, key),
    ) ||
    value.device_id !== deviceId ||
    !Array.isArray(value.resources) ||
    value.resources.length === 0 ||
    value.resources.length > 7 ||
    new Set(value.resources).size !== value.resources.length ||
    !object(value.revisions)
  )
    return null;
  const revisions = value.revisions;
  if (
    Object.keys(revisions).length !== value.resources.length ||
    !value.resources.every(
      (resource) =>
        DEVICE_RESOURCES.includes(resource) &&
        Object.hasOwn(revisions, resource) &&
        Number.isSafeInteger(revisions[resource]) &&
        (revisions[resource] as number) >= 0,
    )
  )
    return null;
  return {
    device_id: deviceId,
    resources: [...value.resources] as DeviceResource[],
    revisions: { ...revisions } as DeviceUpdateHint["revisions"],
  };
}
