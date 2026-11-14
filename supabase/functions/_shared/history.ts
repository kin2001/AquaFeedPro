import { validMetricReadObservation } from "./telemetry.ts";

/** Preserve source microseconds while accepting PostgreSQL's offset serialization. */
export function historyUtc(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(\.\d{1,6})?(Z|[+-]\d\d(?::?\d\d)?)$/.exec(value);
  if (!match) return null;
  const local = new Date(`${match[1]}T${match[2]}Z`);
  if (!Number.isFinite(local.getTime()) || local.toISOString().slice(0, 19) !== `${match[1]}T${match[2]}`) return null;
  const offset = match[4] === "Z" ? "Z" : match[4].length === 3 ? `${match[4]}:00` : match[4].replace(/^([+-]\d\d)(\d\d)$/, "$1:$2");
  const instant = new Date(`${match[1]}T${match[2]}${offset}`);
  return Number.isFinite(instant.getTime()) ? instant.toISOString().slice(0, 19) + (match[3] ?? "") + "Z" : null;
}

export function normalizedMetricReading(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const read = value as Record<string, unknown>;
  if (!read.observation || typeof read.observation !== "object" || Array.isArray(read.observation)) return null;
  const sample = { ...read.observation } as Record<string, unknown>;
  for (const key of ["measured_at", "captured_at"]) {
    if (sample[key] === null) continue;
    const time = historyUtc(sample[key]);
    if (!time) return null;
    sample[key] = time;
  }
  const observedAt = read.observed_at === null ? null : historyUtc(read.observed_at);
  const receivedAt = historyUtc(read.received_at);
  const result = { ...read, observation: sample, observed_at: observedAt, received_at: receivedAt };
  return receivedAt && (read.observed_at === null || observedAt) && validMetricReadObservation(result) ? result : null;
}

export type MetricCursor = {
  device: string; date: string | null; metric: string; mode: string; time: string; identity: string;
};
export function encodeMetricCursor(value: MetricCursor): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeMetricCursor(value: string | null): MetricCursor | null {
  if (!value || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const base = value.replace(/-/g, "+").replace(/_/g, "/");
    const item = JSON.parse(atob(base.padEnd(Math.ceil(base.length / 4) * 4, "=")));
    if (!item || typeof item !== "object" || Object.keys(item).length !== 6 ||
      typeof item.device !== "string" || !/^[0-9a-f-]{36}$/.test(item.device) ||
      !["all", "do", "feed"].includes(item.metric) || !["known", "unknown"].includes(item.mode) ||
      (item.mode === "known" ? typeof item.date !== "string" || !/^\d{4}-\d\d-\d\d$/.test(item.date) : item.date !== null) ||
      !historyUtc(item.time) || typeof item.identity !== "string" ||
      !/^(metric|legacy):(do|feed):[0-9a-f-]{36}:[0-9]+$/.test(item.identity)) return null;
    return item;
  } catch { return null; }
}
