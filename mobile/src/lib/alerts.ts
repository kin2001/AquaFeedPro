import { useSyncExternalStore } from "react";
import { requestAppApi } from "./device-access";

export type AlertKind = "do_low" | "do_high" | "feed_low";
export type AlertState = Partial<Record<AlertKind, boolean>>;

export type AlertEntry = {
  id: string;
  deviceId: string;
  deviceName: string;
  kind: AlertKind;
  value: number;
  limit: number;
  simulated: boolean;
  at: string;
  read: boolean;
};

/** Which alerts start now. A value of null means "not known right now" and changes nothing. */
export function detectAlerts(
  reading: { doMgL: number | null; feedPercent: number | null },
  limits: {
    doLow: number | null;
    doHigh: number | null;
    feedLow: number | null;
  },
  previous: AlertState,
): { state: AlertState; raised: AlertKind[] } {
  const rules = [
    ["do_low", reading.doMgL, limits.doLow, (v: number, l: number) => v < l],
    ["do_high", reading.doMgL, limits.doHigh, (v: number, l: number) => v > l],
    [
      "feed_low",
      reading.feedPercent,
      limits.feedLow,
      (v: number, l: number) => v < l,
    ],
  ] as const;
  const state: AlertState = {};
  const raised: AlertKind[] = [];
  for (const [kind, value, limit, outside] of rules) {
    if (limit === null) state[kind] = false;
    else if (value === null) state[kind] = previous[kind] === true;
    else {
      state[kind] = outside(value, limit);
      if (state[kind] && !previous[kind]) raised.push(kind);
    }
  }
  return { state, raised };
}

export function alertTitle(kind: AlertKind) {
  return kind === "do_low"
    ? "Oxygen below limit"
    : kind === "do_high"
      ? "Oxygen above limit"
      : "Feed is low";
}

export function alertLine(entry: AlertEntry) {
  const value = Number(entry.value.toFixed(1));
  return [
    entry.kind === "feed_low"
      ? `${value}% · alert below ${entry.limit}%`
      : `${value} mg/L · limit ${entry.limit}`,
    entry.deviceName,
    entry.simulated && "Simulator",
  ]
    .filter(Boolean)
    .join(" · ");
}

type AlertDevice = {
  deviceId: string;
  alias: string | null;
  model: string;
  isSimulated: boolean;
};
type AlertEventDTO = {
  event_id: string;
  device_id: string;
  kind: AlertKind;
  value: number;
  limit: number;
  measured_at: string;
  raised_at: string;
  applied_revision: number;
  boot_id: string;
  sample_sequence: number;
  is_simulated: boolean;
  is_read: boolean;
  is_dismissed: false;
};
type AlertHistoryDTO = {
  request_id: string;
  device_id: string;
  events: AlertEventDTO[];
  has_more: boolean;
  next_cursor: string | null;
  unread_count: number;
};
type DeviceListState = { rows: AlertEntry[]; unreadCount: number };

const MAX_ENTRIES = 50;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY: AlertEntry[] = [];
const listeners = new Set<() => void>();
let entries: AlertEntry[] = EMPTY;
let unreadCount = 0;
let deviceStates = new Map<string, DeviceListState>();
let alertDevices = new Map<string, AlertDevice>();
let pinnedEvents = new Map<string, Map<string, AlertEntry>>();
let dismissedEvents = new Map<string, Set<string>>();
let dismissedThrough = new Map<string, { raisedAt: string; eventId: string }>();
let currentInstallation: string | null = null;
let currentScope = "";
let scopeEpoch = 0;
let operationQueue: Promise<unknown> = Promise.resolve();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish() {
  listeners.forEach((listener) => listener());
}

function timestampMicros(value: string): bigint | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(
    value,
  );
  if (!match) return null;
  const millis = Date.parse(`${match[1]}Z`);
  if (
    !Number.isFinite(millis) ||
    new Date(millis).toISOString().slice(0, 19) !== match[1]
  )
    return null;
  return BigInt(millis) * 1000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function compareAlerts(a: AlertEntry, b: AlertEntry) {
  const left = timestampMicros(a.at) ?? 0n;
  const right = timestampMicros(b.at) ?? 0n;
  if (left !== right) return left > right ? -1 : 1;
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
}

function refreshSnapshot() {
  entries = [...deviceStates.values()]
    .flatMap((state) => state.rows)
    .concat(
      [...pinnedEvents.values()].flatMap((pinned) => [...pinned.values()]),
    )
    .filter(
      (entry, index, rows) =>
        rows.findIndex((item) => item.id === entry.id) === index,
    )
    .sort(compareAlerts)
    .slice(0, MAX_ENTRIES);
  unreadCount = [...deviceStates.values()].reduce(
    (total, state) => total + state.unreadCount,
    0,
  );
  publish();
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function eventDto(value: unknown, deviceId: string): value is AlertEventDTO {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    onlyKeys(item, [
      "event_id",
      "device_id",
      "kind",
      "value",
      "limit",
      "measured_at",
      "raised_at",
      "applied_revision",
      "boot_id",
      "sample_sequence",
      "is_simulated",
      "is_read",
      "is_dismissed",
    ]) &&
    isUuid(item.event_id) &&
    isUuid(item.device_id) &&
    item.device_id.toLowerCase() === deviceId &&
    isUuid(item.boot_id) &&
    (item.kind === "do_low" ||
      item.kind === "do_high" ||
      item.kind === "feed_low") &&
    typeof item.value === "number" &&
    Number.isFinite(item.value) &&
    typeof item.limit === "number" &&
    Number.isFinite(item.limit) &&
    typeof item.measured_at === "string" &&
    timestampMicros(item.measured_at) !== null &&
    typeof item.raised_at === "string" &&
    timestampMicros(item.raised_at) !== null &&
    typeof item.applied_revision === "number" &&
    Number.isSafeInteger(item.applied_revision) &&
    item.applied_revision > 0 &&
    typeof item.sample_sequence === "number" &&
    Number.isSafeInteger(item.sample_sequence) &&
    item.sample_sequence >= 0 &&
    typeof item.is_simulated === "boolean" &&
    typeof item.is_read === "boolean" &&
    item.is_dismissed === false
  );
}

function historyDto(
  value: unknown,
  requestId: string,
  deviceId: string,
): value is AlertHistoryDTO {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (
    !onlyKeys(response, [
      "request_id",
      "device_id",
      "events",
      "has_more",
      "next_cursor",
      "unread_count",
    ]) ||
    response.request_id !== requestId ||
    !isUuid(response.request_id) ||
    typeof response.device_id !== "string" ||
    response.device_id.toLowerCase() !== deviceId ||
    !Array.isArray(response.events) ||
    response.events.length > MAX_ENTRIES ||
    typeof response.has_more !== "boolean" ||
    (response.has_more && response.events.length !== MAX_ENTRIES) ||
    (response.has_more &&
      (typeof response.next_cursor !== "string" ||
        response.next_cursor.length > 1024 ||
        !/^[A-Za-z0-9_-]+$/.test(response.next_cursor))) ||
    (!response.has_more && response.next_cursor !== null) ||
    typeof response.unread_count !== "number" ||
    !Number.isSafeInteger(response.unread_count) ||
    response.unread_count < 0 ||
    response.unread_count > 2_147_483_647
  )
    return false;
  const events = response.events;
  if (!events.every((event) => eventDto(event, deviceId))) return false;
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1] as AlertEventDTO;
    const current = events[index] as AlertEventDTO;
    const previousAt = timestampMicros(previous.raised_at)!;
    const currentAt = timestampMicros(current.raised_at)!;
    if (
      previousAt < currentAt ||
      (previousAt === currentAt &&
        previous.event_id.toLowerCase() <= current.event_id.toLowerCase())
    )
      return false;
  }
  return true;
}

function singleActionDto(
  value: unknown,
  requestId: string,
  deviceId: string,
  eventId: string,
  action: "read" | "dismiss",
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return (
    onlyKeys(response, [
      "request_id",
      "device_id",
      "event_id",
      "is_read",
      "is_dismissed",
    ]) &&
    response.request_id === requestId &&
    response.device_id === deviceId &&
    response.event_id === eventId &&
    response.is_read === true &&
    response.is_dismissed === (action === "dismiss")
  );
}

function bulkActionDto(
  value: unknown,
  requestId: string,
  deviceId: string,
  action: "mark_read" | "dismiss",
  cutoff: { raisedAt: string; eventId: string },
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  const through = response.through;
  if (!through || typeof through !== "object" || Array.isArray(through))
    return false;
  const result = through as Record<string, unknown>;
  return (
    onlyKeys(response, ["request_id", "device_id", "action", "through"]) &&
    response.request_id === requestId &&
    response.device_id === deviceId &&
    response.action === action &&
    onlyKeys(result, ["raised_at", "event_id"]) &&
    result.event_id === cutoff.eventId &&
    typeof result.raised_at === "string" &&
    timestampMicros(result.raised_at) === timestampMicros(cutoff.raisedAt)
  );
}

function accessRevoked(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ACCESS_REVOKED"
  );
}

function requestStatus(error: unknown) {
  return !!error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : undefined;
}

function mapEvent(item: AlertEventDTO, device: AlertDevice): AlertEntry {
  return {
    id: item.event_id.toLowerCase(),
    deviceId: item.device_id.toLowerCase(),
    deviceName: device.alias?.trim() || device.model,
    kind: item.kind,
    value: item.value,
    limit: item.limit,
    simulated: device.isSimulated || item.is_simulated,
    at: item.raised_at,
    read: item.is_read,
  };
}

function queued<T>(work: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(work, work);
  operationQueue = result.catch(() => undefined);
  return result;
}

function headers(requestId: string) {
  return { "X-Protocol-Major": "2", "X-Request-Id": requestId };
}

async function requestWithOneRetry<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const status = requestStatus(error);
    if (
      accessRevoked(error) ||
      (status !== undefined && status !== 429 && status < 500)
    )
      throw error;
    return await work();
  }
}

function purgeDevice(deviceId: string) {
  deviceStates.delete(deviceId);
  alertDevices.delete(deviceId);
  pinnedEvents.delete(deviceId);
  dismissedEvents.delete(deviceId);
  dismissedThrough.delete(deviceId);
  refreshSnapshot();
}

function atOrBefore(
  entry: AlertEntry,
  cutoff: { raisedAt: string; eventId: string },
) {
  const at = timestampMicros(entry.at);
  const cutoffAt = timestampMicros(cutoff.raisedAt);
  return (
    at !== null &&
    cutoffAt !== null &&
    (at < cutoffAt || (at === cutoffAt && entry.id <= cutoff.eventId))
  );
}

function locallyDismissed(entry: AlertEntry) {
  if (dismissedEvents.get(entry.deviceId)?.has(entry.id)) return true;
  const cutoff = dismissedThrough.get(entry.deviceId);
  return !!cutoff && atOrBefore(entry, cutoff);
}

function rememberDismissed(entry: AlertEntry) {
  const hidden = dismissedEvents.get(entry.deviceId) ?? new Set<string>();
  hidden.add(entry.id);
  dismissedEvents.set(entry.deviceId, hidden);
}

function rememberDismissedThrough(
  deviceId: string,
  cutoff: { raisedAt: string; eventId: string },
) {
  const current = dismissedThrough.get(deviceId);
  const currentAt = current ? timestampMicros(current.raisedAt) : null;
  const cutoffAt = timestampMicros(cutoff.raisedAt);
  if (
    !current ||
    (cutoffAt !== null &&
      currentAt !== null &&
      (cutoffAt > currentAt ||
        (cutoffAt === currentAt && cutoff.eventId > current.eventId)))
  ) {
    dismissedThrough.set(deviceId, cutoff);
  }
}

type ReadResult = "ok" | "revoked" | "stale" | "unavailable";

async function readDevice(
  installationId: string,
  device: AlertDevice,
  epoch: number,
): Promise<ReadResult> {
  const deviceId = device.deviceId.toLowerCase();
  const requestId = crypto.randomUUID();
  try {
    const response = await requestWithOneRetry(() =>
      requestAppApi(
        installationId,
        `/devices/${deviceId}/notifications`,
        "GET",
        undefined,
        headers(requestId),
      ),
    );
    if (
      epoch !== scopeEpoch ||
      installationId.toLowerCase() !== currentInstallation
    )
      return "stale";
    if (!historyDto(response, requestId, deviceId)) return "unavailable";
    const rows = response.events.map((event) => mapEvent(event, device));
    const pinned = pinnedEvents.get(deviceId);
    for (const item of pinned?.values() ?? []) {
      if (!locallyDismissed(item) && !rows.some((row) => row.id === item.id))
        rows.push(item);
    }
    deviceStates.set(deviceId, {
      rows: rows.sort(compareAlerts),
      unreadCount: response.unread_count,
    });
    refreshSnapshot();
    return "ok";
  } catch (error) {
    if (
      epoch === scopeEpoch &&
      installationId.toLowerCase() === currentInstallation &&
      accessRevoked(error)
    ) {
      purgeDevice(deviceId);
      return "revoked";
    }
    return "unavailable";
  }
}

/** Drop cached rows on every installation or membership-scope change. */
export function setAlertScope(installationId: string | null, scope: string) {
  const normalized = installationId?.toLowerCase() ?? null;
  const key = `${normalized ?? "none"}:${scope}`;
  if (key === currentScope) return scopeEpoch;
  currentScope = key;
  currentInstallation = normalized;
  scopeEpoch += 1;
  deviceStates = new Map();
  alertDevices = new Map();
  pinnedEvents = new Map();
  dismissedEvents = new Map();
  dismissedThrough = new Map();
  entries = EMPTY;
  unreadCount = 0;
  publish();
  return scopeEpoch;
}

/** Re-read only authorized server pages; realtime payloads never become rows. */
export function refreshAlerts(
  installationId: string,
  devices: AlertDevice[],
): Promise<string[]> {
  const epoch = scopeEpoch;
  return queued(async () => {
    if (
      epoch !== scopeEpoch ||
      installationId.toLowerCase() !== currentInstallation
    )
      return [];
    const activeIds = new Set(
      devices.map((device) => device.deviceId.toLowerCase()),
    );
    for (const id of deviceStates.keys())
      if (!activeIds.has(id)) deviceStates.delete(id);
    for (const id of pinnedEvents.keys())
      if (!activeIds.has(id)) pinnedEvents.delete(id);
    for (const id of alertDevices.keys())
      if (!activeIds.has(id)) alertDevices.delete(id);
    for (const id of dismissedEvents.keys())
      if (!activeIds.has(id)) dismissedEvents.delete(id);
    for (const id of dismissedThrough.keys())
      if (!activeIds.has(id)) dismissedThrough.delete(id);
    const revoked: string[] = [];
    for (const device of devices) {
      if (epoch !== scopeEpoch) return [];
      const deviceId = device.deviceId.toLowerCase();
      alertDevices.set(deviceId, device);
      if ((await readDevice(installationId, device, epoch)) === "revoked")
        revoked.push(deviceId);
    }
    if (epoch === scopeEpoch) refreshSnapshot();
    return revoked;
  });
}

/** Used only after the tap resolver has re-read the event from app-api. */
export function pinVerifiedAlert(
  entry: AlertEntry,
  installationId: string,
  expectedEpoch?: number,
  isCurrent?: () => boolean,
) {
  const epoch = scopeEpoch;
  return queued(async () => {
    if (
      epoch !== scopeEpoch ||
      (expectedEpoch !== undefined && expectedEpoch !== epoch) ||
      installationId.toLowerCase() !== currentInstallation ||
      (isCurrent && !isCurrent())
    )
      return;
    const id = entry.deviceId.toLowerCase();
    const state = deviceStates.get(id) ?? { rows: [], unreadCount: 0 };
    const existing =
      state.rows.find((row) => row.id === entry.id) ??
      pinnedEvents.get(id)?.get(entry.id);
    const verified =
      existing?.read && !entry.read ? { ...entry, read: true } : entry;
    if (locallyDismissed(verified)) return;
    const pinned = pinnedEvents.get(id) ?? new Map<string, AlertEntry>();
    pinned.set(verified.id, verified);
    pinnedEvents.set(id, pinned);
    deviceStates.set(id, {
      ...state,
      rows: [
        verified,
        ...state.rows.filter((row) => row.id !== verified.id),
      ].sort(compareAlerts),
    });
    refreshSnapshot();
  });
}

async function updateOne(id: string, action: "read" | "dismiss") {
  const installationId = currentInstallation;
  const epoch = scopeEpoch;
  if (!installationId) return;
  await queued(async () => {
    if (epoch !== scopeEpoch || installationId !== currentInstallation) return;
    const entry = [...deviceStates.values()]
      .flatMap((state) => state.rows)
      .find((row) => row.id === id);
    if (!entry || (action === "read" && entry.read)) return;
    const requestId = crypto.randomUUID();
    const body = { protocol_major: 2, request_id: requestId, action };
    let response: unknown;
    try {
      response = await requestWithOneRetry(() =>
        requestAppApi(
          installationId,
          `/devices/${entry.deviceId}/notifications/${entry.id}`,
          "PATCH",
          body,
          headers(requestId),
        ),
      );
    } catch (error) {
      if (
        epoch === scopeEpoch &&
        installationId === currentInstallation &&
        accessRevoked(error)
      )
        purgeDevice(entry.deviceId);
      return;
    }
    if (epoch !== scopeEpoch || installationId !== currentInstallation) return;
    if (!singleActionDto(response, requestId, entry.deviceId, entry.id, action))
      return;
    const state = deviceStates.get(entry.deviceId);
    if (!state) return;
    const current = state.rows.find((row) => row.id === id);
    if (!current) return;
    if (action === "dismiss") {
      rememberDismissed(current);
      pinnedEvents.get(entry.deviceId)?.delete(id);
      deviceStates.set(entry.deviceId, {
        ...state,
        rows: state.rows.filter((row) => row.id !== id),
        unreadCount: Math.max(0, state.unreadCount - (current.read ? 0 : 1)),
      });
    } else {
      const readEntry = { ...current, read: true };
      if (pinnedEvents.get(entry.deviceId)?.has(id))
        pinnedEvents.get(entry.deviceId)?.set(id, readEntry);
      deviceStates.set(entry.deviceId, {
        ...state,
        rows: state.rows.map((row) => (row.id === id ? readEntry : row)),
        unreadCount: Math.max(0, state.unreadCount - (current.read ? 0 : 1)),
      });
    }
    refreshSnapshot();
  }).catch(() => undefined);
}

async function bulk(action: "mark_read" | "dismiss") {
  const installationId = currentInstallation;
  const epoch = scopeEpoch;
  if (!installationId) return;
  const cutoffs = [...deviceStates].flatMap(([deviceId, state]) => {
    const newest = [...state.rows].sort(compareAlerts)[0];
    return newest
      ? [{ deviceId, raisedAt: newest.at, eventId: newest.id }]
      : [];
  });
  await queued(async () => {
    if (epoch !== scopeEpoch || installationId !== currentInstallation) return;
    for (const cutoff of cutoffs) {
      if (epoch !== scopeEpoch || installationId !== currentInstallation)
        return;
      const { deviceId } = cutoff;
      if (!deviceStates.has(deviceId)) continue;
      const requestId = crypto.randomUUID();
      const body = {
        protocol_major: 2,
        request_id: requestId,
        action,
        through: { raised_at: cutoff.raisedAt, event_id: cutoff.eventId },
      };
      let response: unknown;
      try {
        response = await requestWithOneRetry(() =>
          requestAppApi(
            installationId,
            `/devices/${deviceId}/notifications/actions`,
            "POST",
            body,
            headers(requestId),
          ),
        );
      } catch (error) {
        if (
          epoch === scopeEpoch &&
          installationId === currentInstallation &&
          accessRevoked(error)
        )
          purgeDevice(deviceId);
        continue;
      }
      if (epoch !== scopeEpoch || installationId !== currentInstallation)
        return;
      if (!bulkActionDto(response, requestId, deviceId, action, cutoff))
        continue;
      const state = deviceStates.get(deviceId);
      if (action === "dismiss") {
        rememberDismissedThrough(deviceId, cutoff);
        for (const [id, row] of pinnedEvents.get(deviceId) ?? []) {
          if (atOrBefore(row, cutoff)) pinnedEvents.get(deviceId)?.delete(id);
        }
        if (state)
          deviceStates.set(deviceId, {
            ...state,
            rows: state.rows.filter((row) => !atOrBefore(row, cutoff)),
          });
      } else if (state) {
        const readRows = state.rows.map((row) =>
          atOrBefore(row, cutoff) ? { ...row, read: true } : row,
        );
        deviceStates.set(deviceId, { ...state, rows: readRows });
        for (const [id, row] of pinnedEvents.get(deviceId) ?? []) {
          if (atOrBefore(row, cutoff))
            pinnedEvents.get(deviceId)?.set(id, { ...row, read: true });
        }
      }
      refreshSnapshot();
      const device = alertDevices.get(deviceId);
      if (device) await readDevice(installationId, device, epoch);
    }
  }).catch(() => undefined);
}

export function markRead(id: string) {
  return updateOne(id, "read");
}
export function remove(id: string) {
  return updateOne(id, "dismiss");
}
export function markAllRead() {
  return bulk("mark_read");
}
export function clear() {
  return bulk("dismiss");
}

function getEntries() {
  return entries;
}
function getUnreadCount() {
  return unreadCount;
}

/** Entries, newest first. */
export function useAlerts() {
  return useSyncExternalStore(subscribe, getEntries, () => EMPTY);
}
export function useUnreadCount() {
  return useSyncExternalStore(subscribe, getUnreadCount, () => 0);
}
