import type { StatusKind } from "./bento-kit";

const labels: Record<string, string> = {
  queued: "Queued",
  accepted: "Accepted",
  not_started: "Not started",
  running: "In progress",
  completed: "Completed",
  partial: "Partial",
  failed: "Failed",
  rejected: "Rejected",
  expired: "Expired",
  unknown: "Unknown",
};
const kinds: Record<string, StatusKind> = {
  queued: "pending",
  accepted: "pending",
  running: "running",
  completed: "completed",
  partial: "warning",
  failed: "failed",
  rejected: "failed",
  expired: "failed",
  unknown: "unknown",
};

export function statusText(status: string) {
  return labels[status] ?? status;
}

export function statusKind(status: string): StatusKind {
  return kinds[status] ?? "unknown";
}

/** "just now", "42 seconds ago", "5 min ago", "3 h ago", "2 d ago". */
export function agoText(seconds: number | null) {
  if (seconds === null) return "age unavailable";
  if (seconds < 1) return "just now";
  if (seconds < 60) return Math.floor(seconds) + " seconds ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + " h ago";
  return Math.floor(seconds / 86400) + " d ago";
}

/** "Completed · 35 g measured": the status, plus the dispensed total only when every targeted nozzle has a valid measurement. */
export function feedingSummary(
  record: {
    status: string;
    targets: { nozzle_number: number }[];
    nozzle_results: {
      nozzle_number: number;
      measurement_quality: string;
      measured_dispensed_g: number | null;
    }[];
  },
  simulated: boolean,
) {
  let total: number | null = record.targets.length ? 0 : null;
  for (const target of record.targets) {
    const result = record.nozzle_results.find(
      (item) => item.nozzle_number === target.nozzle_number,
    );
    total =
      total !== null &&
      result?.measurement_quality === "valid" &&
      result.measured_dispensed_g !== null
        ? total + result.measured_dispensed_g
        : null;
  }
  return total === null
    ? statusText(record.status)
    : statusText(record.status) +
        " · " +
        Math.round(total * 10) / 10 +
        " g " +
        (simulated ? "simulated" : "measured");
}

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/** "Today", "Yesterday", "Tomorrow", or a medium date, judged in the given time zone. */
export function relativeDayLabel(
  date: Date,
  timeZone: string,
  now: Date = new Date(),
) {
  const key = dayKey(date, timeZone);
  if (key === dayKey(now, timeZone)) return "Today";
  if (key === dayKey(new Date(now.getTime() - 86_400_000), timeZone))
    return "Yesterday";
  if (key === dayKey(new Date(now.getTime() + 86_400_000), timeZone))
    return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: "medium",
  }).format(date);
}

/** Splits a clock time into its digits and its AM/PM marker so they can be styled apart. */
export function clockParts(date: Date, timeZone: string) {
  const format = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  if (typeof format.formatToParts !== "function")
    return { time: format.format(date), period: "" };
  const parts = format.formatToParts(date);
  const hour = parts.findIndex((part) => part.type === "hour");
  const minute = parts.findIndex((part) => part.type === "minute");
  return {
    time: parts
      .slice(Math.min(hour, minute), Math.max(hour, minute) + 1)
      .map((part) => part.value)
      .join(""),
    period: parts.find((part) => part.type === "dayPeriod")?.value ?? "",
  };
}
