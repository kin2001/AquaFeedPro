import {
  admin,
  apiError,
  characterLength,
  isUuid,
  json,
  normalizeUtcTimestamp,
  onlyKeys,
  protocolMajor,
  readJson,
  record,
  requestIdFrom,
  sha256Hex,
  takeRateLimit,
} from "../_shared/device-access.ts";

function pairingWindowPath(request: Request) {
  const pathname = new URL(request.url).pathname;
  return /\/device-api\/v2\/pairing-window$/.test(pathname);
}

function deviceSyncPath(request: Request) {
  const pathname = new URL(request.url).pathname;
  return /\/device-api\/v2\/sync$/.test(pathname);
}

const MAX_SYNC_BODY_BYTES = 262_144;
const ERROR_CODES = new Set([
  "INVALID_INPUT", "AUTH_REQUIRED", "ACCESS_DENIED", "RESOURCE_NOT_FOUND",
  "DEVICE_OFFLINE", "DEVICE_BUSY", "DOSE_UNSUPPORTED", "DOSE_OUT_OF_RANGE",
  "CONFIG_CONFLICT", "CONFIG_PENDING", "CLOCK_UNTRUSTED", "PAIRING_EXPIRED",
  "PAIRING_INVALID", "ACCESS_REVOKED", "COMMAND_EXPIRED", "IDEMPOTENCY_CONFLICT",
  "SAFETY_LOCKOUT", "PROTOCOL_UNSUPPORTED", "PAYLOAD_TOO_LARGE", "RATE_LIMITED",
  "SERVICE_UNAVAILABLE", "CAPABILITY_MISMATCH", "VALIDATION_FAILED",
]);

function validDose(value: unknown) {
  const dose = record(value);
  if (!dose) return false;
  if (
    dose.mode === "grams" && onlyKeys(dose, ["mode", "amount_g"]) &&
    typeof dose.amount_g === "number" && Number.isFinite(dose.amount_g) && dose.amount_g > 0
  ) return true;
  return dose.mode === "fixed_portion" && onlyKeys(dose, ["mode", "fixed_portion_id"]) &&
    typeof dose.fixed_portion_id === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(dose.fixed_portion_id);
}

function validRunEvent(value: unknown) {
  const event = record(value);
  const keys = [
    "sequence_id", "event_sequence", "event_type", "outcome_status", "source", "device_at",
    "time_quality", "command_id", "schedule_id", "configuration_revision", "occurrence_local_date",
    "requested_dose", "estimated_dispensed_g", "measured_dispensed_g", "measurement_quality",
    "reason_code", "maintenance_resolution", "lockout_cleared", "nozzle_number", "step_index",
  ];
  if (!event || !onlyKeys(event, keys) || !isUuid(event.sequence_id) ||
      !Number.isSafeInteger(event.event_sequence) || Number(event.event_sequence) < 1 ||
      !isUuid(event.command_id) || event.source !== "manual" || event.schedule_id !== null ||
      event.configuration_revision !== null || event.occurrence_local_date !== null ||
      (event.nozzle_number !== 1 && event.nozzle_number !== 2) ||
      (event.step_index !== 1 && event.step_index !== 2) || !validDose(event.requested_dose) ||
      !["queued", "accepted", "running", "completed", "failed", "rejected", "expired", "unknown", "not_started", "maintenance_acknowledged"].includes(String(event.event_type)) ||
      !["queued", "accepted", "running", "completed", "failed", "rejected", "expired", "unknown", "not_started", "skipped"].includes(String(event.outcome_status)) ||
      event.outcome_status !== (event.event_type === "maintenance_acknowledged" ? "unknown" : event.event_type) ||
      !["synced", "rtc", "uncertain", "invalid"].includes(String(event.time_quality)) ||
      !["valid", "unavailable", "uncalibrated", "error"].includes(String(event.measurement_quality)) ||
      typeof event.lockout_cleared !== "boolean" ||
      !(event.reason_code === null || typeof event.reason_code === "string" && event.reason_code.length <= 128) ||
      !(event.estimated_dispensed_g === null || typeof event.estimated_dispensed_g === "number" && Number.isFinite(event.estimated_dispensed_g) && event.estimated_dispensed_g >= 0) ||
      !(event.measured_dispensed_g === null || typeof event.measured_dispensed_g === "number" && Number.isFinite(event.measured_dispensed_g) && event.measured_dispensed_g >= 0)
  ) return false;

  const invalidTime = event.time_quality === "invalid";
  if (invalidTime ? event.device_at !== null : normalizeUtcTimestamp(event.device_at) === null) return false;
  if (event.measurement_quality === "valid" ? typeof event.measured_dispensed_g !== "number" : event.measured_dispensed_g !== null) return false;
  if (["queued", "accepted", "rejected", "expired", "unknown", "not_started"].includes(String(event.outcome_status)) &&
      (event.measured_dispensed_g !== null || event.measurement_quality === "valid")) return false;
  if (event.event_type === "not_started" && (typeof event.reason_code !== "string" || event.reason_code.length === 0)) return false;

  const resolution = record(event.maintenance_resolution);
  if (event.event_type === "maintenance_acknowledged") {
    if (!resolution || !onlyKeys(resolution, ["resolution_at", "resolution_reason"]) ||
        !(resolution.resolution_at === null || normalizeUtcTimestamp(resolution.resolution_at) !== null) ||
        typeof resolution.resolution_reason !== "string" || resolution.resolution_reason.length < 1 ||
        resolution.resolution_reason.length > 256 ||
        event.lockout_cleared !== true || event.measured_dispensed_g !== null || event.measurement_quality === "valid") return false;
  } else if (event.maintenance_resolution !== null || event.lockout_cleared !== false) return false;
  return true;
}

function validDeviceSync(value: unknown): value is Record<string, unknown> {
  const body = record(value);
  if (!body || !onlyKeys(body, [
    "protocol_major", "request_id", "boot_id", "live_sequence", "firmware_version",
    "capabilities_revision", "clock", "actuator", "configuration", "latest_sample",
    "backlog_samples", "events",
  ]) || body.protocol_major !== 2 || !isUuid(body.request_id) || !isUuid(body.boot_id) ||
      !Number.isSafeInteger(body.live_sequence) || Number(body.live_sequence) < 0 ||
      typeof body.firmware_version !== "string" || body.firmware_version.length < 1 || body.firmware_version.length > 100 ||
      !Number.isSafeInteger(body.capabilities_revision) || Number(body.capabilities_revision) < 1 ||
      body.latest_sample !== null || !Array.isArray(body.backlog_samples) || body.backlog_samples.length !== 0 ||
      !Array.isArray(body.events) || body.events.length > 100 || !body.events.every(validRunEvent)) return false;

  const clock = record(body.clock);
  const actuator = record(body.actuator);
  const configuration = record(body.configuration);
  if (!clock || !onlyKeys(clock, ["quality", "uncertainty_ms"]) ||
      !["synced", "rtc", "uncertain", "invalid"].includes(String(clock.quality)) ||
      (clock.quality === "invalid" ? clock.uncertainty_ms !== null : !Number.isSafeInteger(clock.uncertainty_ms) || Number(clock.uncertainty_ms) < 0) ||
      !actuator || !onlyKeys(actuator, ["state", "active_sequence_id", "fault_code"]) ||
      !["idle", "feeding", "fault", "unknown"].includes(String(actuator.state)) ||
      !(actuator.active_sequence_id === null || isUuid(actuator.active_sequence_id)) ||
      !(actuator.fault_code === null || typeof actuator.fault_code === "string" && actuator.fault_code.length <= 128) ||
      actuator.state === "idle" && actuator.active_sequence_id !== null ||
      actuator.state === "feeding" && actuator.active_sequence_id === null ||
      !configuration || !onlyKeys(configuration, ["applied_revision", "last_attempt_revision", "last_attempt_status", "error_code"]) ||
      !(configuration.applied_revision === null || Number.isSafeInteger(configuration.applied_revision) && Number(configuration.applied_revision) >= 0) ||
      !(configuration.last_attempt_revision === null || Number.isSafeInteger(configuration.last_attempt_revision) && Number(configuration.last_attempt_revision) >= 1) ||
      !(configuration.last_attempt_status === null || ["pending", "applied", "rejected"].includes(String(configuration.last_attempt_status))) ||
      !(configuration.error_code === null || typeof configuration.error_code === "string" && ERROR_CODES.has(configuration.error_code))) return false;
  return true;
}

async function syncManualFeed(request: Request, authenticatedDeviceId: string, deviceVerifier: string) {
  const fallbackRequestId = crypto.randomUUID();
  const parsed = await readJson(request, fallbackRequestId, MAX_SYNC_BODY_BYTES);
  if (parsed.response) return parsed.response;
  const body = record(parsed.value);
  const requestId = requestIdFrom(body);
  if (!body || body.protocol_major !== 2) {
    return apiError(requestId, 422, "PROTOCOL_UNSUPPORTED", "Protocol major 2 is required.");
  }
  if (!validDeviceSync(body)) {
    return apiError(requestId, 422, "VALIDATION_FAILED", "The device sync payload is invalid or includes a flow that is not enabled yet.");
  }
  const actuator = record(body.actuator)!;
  const clock = record(body.clock)!;
  const { data, error } = await admin.rpc("art31_sync_manual_feed", {
    p_device_id: authenticatedDeviceId,
    p_device_verifier_hex: deviceVerifier,
    p_capabilities_revision: body.capabilities_revision,
    p_events: body.events,
    p_actuator_state: actuator.state,
    p_active_sequence_id: actuator.active_sequence_id,
    p_clock_quality: clock.quality,
    p_clock_uncertainty_ms: clock.uncertainty_ms,
  });
  if (error) {
    if (error.code === "23505") return apiError(requestId, 409, "IDEMPOTENCY_CONFLICT", "A device event identity was reused with different content.");
    if (error.code === "22023") return apiError(requestId, 422, "VALIDATION_FAILED", "Device events are invalid or out of order.");
    return apiError(requestId, 503, "SERVICE_UNAVAILABLE", "Device sync could not be safely recorded.", true);
  }
  const result = record(data);
  if (result?.status === "auth_required") return apiError(requestId, 401, "AUTH_REQUIRED", "A valid device credential is required.");
  if (result?.status !== "ok") return apiError(requestId, 503, "SERVICE_UNAVAILABLE", "Device sync could not be safely recorded.", true);
  return json({
    protocol_major: 2,
    request_id: requestId,
    server_time: result.server_time,
    acknowledged_samples: [],
    acknowledged_events: result.acknowledged_events,
    desired_configuration: null,
    command: result.command,
    next_sync_after_ms: result.next_sync_after_ms,
  });
}

function newPairingSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

Deno.serve(async (request: Request) => {
  const fallbackRequestId = crypto.randomUUID();
  try {
    const match = /^Bearer\s+(\S+)$/i.exec(
      request.headers.get("authorization") ?? "",
    );
    if (
      !match ||
      characterLength(match[1]) < 1 ||
      characterLength(match[1]) > 512
    ) {
      return apiError(
        fallbackRequestId,
        401,
        "AUTH_REQUIRED",
        "A valid device credential is required.",
      );
    }
    const deviceVerifier = await sha256Hex(match[1]);
    const authenticated = await admin.rpc("art38_authenticate_device", {
      p_verifier_hex: deviceVerifier,
    });
    if (authenticated.error) {
      return apiError(
        fallbackRequestId,
        503,
        "SERVICE_UNAVAILABLE",
        "The device service is temporarily unavailable.",
        true,
      );
    }
    const authenticatedDeviceId = authenticated.data;
    if (!isUuid(authenticatedDeviceId)) {
      return apiError(
        fallbackRequestId,
        401,
        "AUTH_REQUIRED",
        "A valid device credential is required.",
      );
    }
    const deviceId = authenticatedDeviceId.toLowerCase();
    const syncPath = deviceSyncPath(request);
    const pairPath = pairingWindowPath(request);
    if (!syncPath && !pairPath) {
      return apiError(
        fallbackRequestId,
        404,
        "RESOURCE_NOT_FOUND",
        "The requested device route was not found.",
      );
    }
    if (request.method !== "POST") {
      return apiError(
        fallbackRequestId,
        405,
        "INVALID_INPUT",
        "This method is not available for the requested route.",
      );
    }
    if (syncPath) return await syncManualFeed(request, deviceId, deviceVerifier);

    const parsed = await readJson(request, crypto.randomUUID());
    if (parsed.response) return parsed.response;
    const body = record(parsed.value);
    const requestId = requestIdFrom(body);
    if (!body || !onlyKeys(body, ["protocol_major", "request_id"])) {
      return apiError(
        requestId,
        400,
        "INVALID_INPUT",
        "The pairing-window request is invalid.",
      );
    }
    if (!protocolMajor(body)) {
      return apiError(
        requestId,
        422,
        "PROTOCOL_UNSUPPORTED",
        "Protocol major 2 is required.",
      );
    }
    if (!isUuid(body.request_id)) {
      return apiError(
        requestId,
        422,
        "VALIDATION_FAILED",
        "The request identifier is invalid.",
      );
    }
    if (!(await takeRateLimit("pairing_window", deviceId))) {
      return apiError(
        requestId,
        429,
        "RATE_LIMITED",
        "Pairing windows are temporarily limited.",
        true,
      );
    }

    const pairingSecret = newPairingSecret();
    const challengeId = crypto.randomUUID();
    const created = await admin.rpc("art38_create_pairing_challenge", {
      p_device_id: deviceId,
      p_challenge_id: challengeId,
      p_request_id: requestId,
      p_verifier_hex: await sha256Hex(pairingSecret),
      p_device_verifier_hex: deviceVerifier,
    });
    if (created.error) {
      return apiError(
        requestId,
        503,
        "SERVICE_UNAVAILABLE",
        "The pairing service is temporarily unavailable.",
        true,
      );
    }
    const result = record(created.data);
    if (result?.status === "request_reused") {
      return apiError(
        requestId,
        409,
        "IDEMPOTENCY_CONFLICT",
        "This request identifier was already used.",
      );
    }
    if (result?.status === "not_active") {
      return apiError(
        requestId,
        401,
        "AUTH_REQUIRED",
        "The device credential is no longer active.",
      );
    }
    const expiresAt = normalizeUtcTimestamp(result?.expires_at);
    if (result?.status !== "created" || expiresAt === null) {
      return apiError(
        requestId,
        503,
        "SERVICE_UNAVAILABLE",
        "The pairing window could not be verified.",
        true,
      );
    }
    return json(
      {
        request_id: requestId,
        challenge_id: challengeId,
        pairing_secret: pairingSecret,
        expires_at: expiresAt,
      },
      201,
    );
  } catch {
    return apiError(
      fallbackRequestId,
      503,
      "SERVICE_UNAVAILABLE",
      "The device service is temporarily unavailable.",
      true,
    );
  }
});
