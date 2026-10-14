import { useSyncExternalStore } from "react";

// shortcut: the list lives on this phone only and alerts are found only while the app is open; UI3-06 moves both to the server.

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

const LIST_KEY = "aquafeed-alerts-v1";
const STATE_KEY = "aquafeed-alert-state-v1.";
const MAX_ENTRIES = 50;
const EMPTY: AlertEntry[] = [];
const listeners = new Set<() => void>();
let entries: AlertEntry[] | null = null;

function readJson(key: string): unknown {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the list still works for this session.
  }
}

function load() {
  if (!entries) {
    const stored = readJson(LIST_KEY);
    // Drop anything malformed so a damaged entry cannot throw while rendering.
    entries = Array.isArray(stored)
      ? (stored as AlertEntry[]).filter(
          (entry) =>
            typeof entry?.id === "string" &&
            typeof entry.value === "number" &&
            typeof entry.limit === "number" &&
            typeof entry.at === "string",
        )
      : EMPTY;
  }
  return entries;
}

function save(next: AlertEntry[]) {
  entries = next.slice(0, MAX_ENTRIES);
  writeJson(LIST_KEY, entries);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readAlertState(deviceId: string): AlertState {
  const stored = readJson(STATE_KEY + deviceId);
  return stored && typeof stored === "object" ? (stored as AlertState) : {};
}

export function writeAlertState(deviceId: string, state: AlertState) {
  writeJson(STATE_KEY + deviceId, state);
}

/** Saves new alerts at the top of the list and returns them. */
export function addAlerts(items: Omit<AlertEntry, "id" | "read">[]) {
  const added = items.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    read: false,
  }));
  save([...added, ...load()]);
  return added;
}

export function markRead(id: string) {
  save(
    load().map((entry) => (entry.id === id ? { ...entry, read: true } : entry)),
  );
}

export function markAllRead() {
  save(load().map((entry) => ({ ...entry, read: true })));
}

export function remove(id: string) {
  save(load().filter((entry) => entry.id !== id));
}

export function clear() {
  save([]);
}

/** Entries, newest first. */
export function useAlerts() {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}

export function useUnreadCount() {
  return useAlerts().filter((entry) => !entry.read).length;
}
