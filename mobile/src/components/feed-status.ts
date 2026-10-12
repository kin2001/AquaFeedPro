import type { StatusKind } from "./bento-kit";

const labels: Record<string, string> = {
  queued: "Queued",
  accepted: "Accepted",
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
