type TelemetryQuality = "valid" | "unavailable" | "uncalibrated" | "error";

const TELEMETRY_VALUE_KEYS = [
  "measured_at",
  "time_quality",
  "do_mg_l",
  "do_quality",
  "feed_remaining_g",
  "feed_percent",
  "feed_quality",
  "calibration_revision",
] as const;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function utcTimestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/.test(
      value,
    )
  )
    return false;
  const date = new Date(value);
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  return (
    !!parts &&
    !Number.isNaN(date.valueOf()) &&
    date.getUTCFullYear() === Number(parts[1]) &&
    date.getUTCMonth() + 1 === Number(parts[2]) &&
    date.getUTCDate() === Number(parts[3]) &&
    date.getUTCHours() === Number(parts[4]) &&
    date.getUTCMinutes() === Number(parts[5]) &&
    date.getUTCSeconds() === Number(parts[6])
  );
}

function nullableFinite(value: unknown, maximum?: number) {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      (maximum === undefined || value <= maximum))
  );
}

function telemetryFields(sample: Record<string, unknown>) {
  return Object.fromEntries(TELEMETRY_VALUE_KEYS.map((key) => [key, sample[key]]));
}

function quality(value: unknown): value is TelemetryQuality {
  return (
    value === "valid" ||
    value === "unavailable" ||
    value === "uncalibrated" ||
    value === "error"
  );
}

export function validTelemetryValues(value: unknown): boolean {
  const sample = object(value);
  if (
    !sample ||
    !onlyKeys(sample, TELEMETRY_VALUE_KEYS) ||
    !(
      sample.time_quality === "synced" ||
      sample.time_quality === "rtc" ||
      sample.time_quality === "uncertain" ||
      sample.time_quality === "invalid"
    ) ||
    !quality(sample.do_quality) ||
    !quality(sample.feed_quality) ||
    !nullableFinite(sample.do_mg_l) ||
    !nullableFinite(sample.feed_remaining_g) ||
    !nullableFinite(sample.feed_percent, 100) ||
    !(
      sample.calibration_revision === null ||
      (typeof sample.calibration_revision === "number" &&
        Number.isSafeInteger(sample.calibration_revision) &&
        sample.calibration_revision > 0)
    )
  )
    return false;

  if (
    sample.time_quality === "invalid"
      ? sample.measured_at !== null
      : !utcTimestamp(sample.measured_at)
  )
    return false;
  if (
    sample.do_quality === "valid"
      ? typeof sample.do_mg_l !== "number"
      : sample.do_mg_l !== null
  )
    return false;
  if (
    sample.feed_quality === "valid"
      ? typeof sample.feed_remaining_g !== "number" ||
        typeof sample.feed_percent !== "number" ||
        typeof sample.calibration_revision !== "number"
      : sample.feed_remaining_g !== null ||
        sample.feed_percent !== null ||
        sample.calibration_revision !== null
  )
    return false;
  return true;
}

export function validLiveTelemetrySample(
  value: unknown,
  liveSequence: number,
): boolean {
  const sample = object(value);
  return (
    !!sample &&
    onlyKeys(sample, [...TELEMETRY_VALUE_KEYS, "sequence"]) &&
    Number.isSafeInteger(sample.sequence) &&
    sample.sequence === liveSequence &&
    validTelemetryValues(telemetryFields(sample))
  );
}

export function validHistoricalTelemetrySample(value: unknown): boolean {
  const sample = object(value);
  return (
    !!sample &&
    onlyKeys(sample, [...TELEMETRY_VALUE_KEYS, "boot_id", "sequence"]) &&
    uuid(sample.boot_id) &&
    Number.isSafeInteger(sample.sequence) &&
    Number(sample.sequence) >= 0 &&
    validTelemetryValues(telemetryFields(sample))
  );
}

export function validTelemetryBatch(
  bootId: unknown,
  liveSequence: number,
  latestSample: unknown,
  backlogSamples: unknown,
): boolean {
  if (
    !uuid(bootId) ||
    !Number.isSafeInteger(liveSequence) ||
    liveSequence < 0 ||
    (latestSample !== null &&
      !validLiveTelemetrySample(latestSample, liveSequence)) ||
    !Array.isArray(backlogSamples) ||
    backlogSamples.length > (latestSample === null ? 100 : 99) ||
    !backlogSamples.every(validHistoricalTelemetrySample)
  )
    return false;

  const identities = new Set<string>();
  if (latestSample !== null)
    identities.add(bootId.toLowerCase() + ":" + liveSequence);
  for (const value of backlogSamples) {
    const sample = object(value)!;
    const identity =
      String(sample.boot_id).toLowerCase() + ":" + String(sample.sequence);
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

const METRIC_OBSERVATION_KEYS = [
  "metric",
  "boot_id",
  "sequence",
  "measured_at",
  "captured_at",
  "time_quality",
  "quality",
  "do_mg_l",
  "feed_remaining_g",
  "feed_percent",
  "calibration_revision",
] as const;

export function validOxygenReportInterval(value: unknown): boolean {
  return (
    typeof value === "number" &&
    [15, 30, 60, 3600, 7200, 14400, 28800].includes(value)
  );
}

export function validMetricObservation(value: unknown): boolean {
  const sample = object(value);
  if (
    !sample ||
    !onlyKeys(sample, METRIC_OBSERVATION_KEYS) ||
    !METRIC_OBSERVATION_KEYS.every((key) => Object.hasOwn(sample, key)) ||
    !(sample.metric === "do" || sample.metric === "feed") ||
    !uuid(sample.boot_id) ||
    !Number.isSafeInteger(sample.sequence) ||
    Number(sample.sequence) < 0 ||
    !(sample.captured_at === null || utcTimestamp(sample.captured_at)) ||
    !quality(sample.quality)
  )
    return false;

  // Reuse legacy quality/null rules without coupling the two metric clocks.
  return validTelemetryValues({
    measured_at: sample.measured_at,
    time_quality: sample.time_quality,
    do_mg_l: sample.do_mg_l,
    do_quality: sample.metric === "do" ? sample.quality : "unavailable",
    feed_remaining_g: sample.feed_remaining_g,
    feed_percent: sample.feed_percent,
    feed_quality: sample.metric === "feed" ? sample.quality : "unavailable",
    calibration_revision: sample.calibration_revision,
  });
}

export function validMetricTelemetryBatch(
  bootId: unknown,
  liveSequence: unknown,
  value: unknown,
): boolean {
  const envelope = object(value);
  const live = object(envelope?.live);
  if (
    !uuid(bootId) ||
    !Number.isSafeInteger(liveSequence) ||
    Number(liveSequence) < 0 ||
    !envelope ||
    !onlyKeys(envelope, ["live", "backlog"]) ||
    !live ||
    !onlyKeys(live, ["do", "feed"]) ||
    !Array.isArray(envelope.backlog)
  )
    return false;
  const observations: unknown[] = [...envelope.backlog];
  for (const metric of ["do", "feed"] as const) {
    if (live[metric] === null) continue;
    const sample = object(live[metric]);
    if (
      !sample ||
      sample.metric !== metric ||
      sample.sequence !== liveSequence ||
      typeof sample.boot_id !== "string" ||
      sample.boot_id.toLowerCase() !== bootId.toLowerCase()
    )
      return false;
    observations.push(sample);
  }
  if (observations.length > 100 || !observations.every(validMetricObservation))
    return false;
  const identities = new Set<string>();
  for (const value of observations) {
    const sample = object(value)!;
    const identity = `${sample.metric}:${String(sample.boot_id).toLowerCase()}:${sample.sequence}`;
    // Cross-request replay/content checks need immutable persistence (T04).
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

/** Telemetry-only boundary; the route still validates/authenticates the rest of sync. */
export function validSyncTelemetry(
  value: unknown,
  capabilities: unknown,
): boolean {
  const body = object(value);
  if (!body || !Number.isSafeInteger(body.live_sequence)) return false;
  if (!Object.hasOwn(body, "metric_telemetry")) {
    return validTelemetryBatch(
      body.boot_id,
      Number(body.live_sequence),
      body.latest_sample,
      body.backlog_samples,
    );
  }
  return (
    object(capabilities)?.independent_telemetry_v1 === true &&
    body.latest_sample === null &&
    Array.isArray(body.backlog_samples) &&
    body.backlog_samples.length === 0 &&
    validMetricTelemetryBatch(
      body.boot_id,
      body.live_sequence,
      body.metric_telemetry,
    )
  );
}

/** Negotiation only; full snapshot, revision/access and profile validation remain mandatory. */
export function reportingConfigurationError(
  contractVersion: unknown,
  independentTelemetry: unknown,
  currentSnapshot: unknown,
  nextSnapshot: unknown,
): "CONFIG_UPGRADE_REQUIRED" | "CAPABILITY_MISMATCH" | "INVALID_INPUT" | null {
  const current = object(currentSnapshot);
  const next = object(nextSnapshot);
  if (
    !next ||
    (contractVersion !== undefined &&
      contractVersion !== null &&
      contractVersion !== "2.8.0")
  )
    return "INVALID_INPUT";
  const hasInterval = Object.hasOwn(next, "oxygen_report_interval_seconds");
  if (contractVersion !== "2.8.0") {
    return hasInterval ||
      (current && Object.hasOwn(current, "oxygen_report_interval_seconds"))
      ? "CONFIG_UPGRADE_REQUIRED"
      : null;
  }
  if (
    !hasInterval ||
    ![
      "timezone",
      "monitoring_limits",
      "low_feed_threshold_pct",
      "schedules",
    ].every((key) => Object.hasOwn(next, key))
  )
    return "INVALID_INPUT";
  if (
    independentTelemetry !== true &&
    (next.oxygen_report_interval_seconds !== null ||
      current?.oxygen_report_interval_seconds != null)
  )
    return "CAPABILITY_MISMATCH";
  if (next.oxygen_report_interval_seconds === null) return null;
  return validOxygenReportInterval(next.oxygen_report_interval_seconds)
    ? null
    : "INVALID_INPUT";
}

export function telemetryRows(body: {
  boot_id: string;
  live_sequence: number;
  latest_sample: unknown;
  backlog_samples: unknown[];
}) {
  const rows: Record<string, unknown>[] = [];
  if (body.latest_sample !== null) {
    rows.push({
      ...object(body.latest_sample)!,
      boot_id: body.boot_id.toLowerCase(),
      live_sequence: body.live_sequence,
    });
  }
  for (const value of body.backlog_samples) {
    rows.push({ ...object(value)!, live_sequence: null });
  }
  return rows;
}
