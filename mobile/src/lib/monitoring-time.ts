const philippineZone = "Asia/Manila";

export function philippineDayBounds(date: string): {
  startUtc: string;
  endUtc: string;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error("Invalid Philippine date.");
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(midnight) ||
    new Date(midnight).toISOString().slice(0, 10) !== date
  )
    throw new Error("Invalid Philippine date.");
  const utc = (instant: number) =>
    new Date(instant).toISOString().replace(".000Z", "Z");
  return {
    startUtc: utc(midnight - 8 * 3600000),
    endUtc: utc(midnight + 16 * 3600000),
  };
}

export function formatPhilippineTime(instant: string): string {
  const date = new Date(instant);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(instant) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== instant.slice(0, 19)
  )
    throw new Error("Invalid UTC instant.");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: philippineZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function feedChronology(record: {
  occurred_at: string | null;
  time_basis: "measured" | "captured" | "unknown";
  received_at: string;
  started_at?: string | null;
}): { instant: string; label: string } {
  if (record.occurred_at === null || record.time_basis === "unknown")
    return {
      instant: record.received_at,
      label: "Received · execution time unknown",
    };
  return {
    instant: record.occurred_at,
    label:
      record.started_at === record.occurred_at
        ? "Execution started"
        : "Completion reported",
  };
}
