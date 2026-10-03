import {
  admin,
  apiError,
  characterLength,
  installationId,
  isUuid,
  json,
  onlyKeys,
  protocolMajor,
  readJson,
  record,
  requestIdFrom,
  sha256Hex,
  takeRateLimit,
} from "../_shared/device-access.ts";

const UUID_IN_PATH = /^\/devices\/([0-9a-f-]{36})\/(alias|access)$/i;

function nullableNumber(value: unknown, positive = false) {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      (positive ? value > 0 : value >= 0))
  );
}

function nullableInteger(value: unknown, positive = false) {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      (positive ? value > 0 : value >= 0))
  );
}

function validCapabilities(value: unknown) {
  const profile = record(value);
  const nozzles = record(profile?.nozzles);
  if (
    !profile ||
    !nozzles ||
    typeof profile.do_monitoring !== "boolean" ||
    typeof profile.feed_remaining_monitoring !== "boolean" ||
    typeof profile.local_schedule_execution !== "boolean" ||
    !nullableInteger(profile.max_schedules, true) ||
    !nullableInteger(profile.max_clock_uncertainty_ms) ||
    !nullableInteger(profile.scheduler_wake_grace_ms) ||
    !nullableInteger(profile.maximum_settling_ms, true)
  )
    return false;
  if (
    profile.local_schedule_execution
      ? typeof profile.max_schedules !== "number" || profile.max_schedules < 1
      : profile.max_schedules !== null
  )
    return false;

  return (["1", "2"] as const).every((number) => {
    const nozzle = record(nozzles[number]);
    if (
      !nozzle ||
      typeof nozzle.enabled !== "boolean" ||
      !Array.isArray(nozzle.dose_modes) ||
      !nozzle.dose_modes.every(
        (mode) => mode === "grams" || mode === "fixed_portion",
      ) ||
      new Set(nozzle.dose_modes).size !== nozzle.dose_modes.length ||
      !Array.isArray(nozzle.fixed_portion_ids) ||
      !nozzle.fixed_portion_ids.every(
        (id) =>
          typeof id === "string" &&
          characterLength(id) >= 1 &&
          characterLength(id) <= 80,
      ) ||
      new Set(nozzle.fixed_portion_ids).size !==
        nozzle.fixed_portion_ids.length ||
      typeof nozzle.measured_dispensed_g !== "boolean" ||
      !nullableInteger(nozzle.max_actuation_ms, true) ||
      !nullableInteger(nozzle.minimum_cooldown_ms)
    )
      return false;
    const supportsGrams = nozzle.dose_modes.includes("grams");
    const supportsFixed = nozzle.dose_modes.includes("fixed_portion");
    return (
      nullableNumber(nozzle.min_dose_g, true) &&
      nullableNumber(nozzle.max_dose_g, true) &&
      nullableNumber(nozzle.dose_step_g, true) &&
      (supportsGrams
        ? typeof nozzle.min_dose_g === "number" &&
          typeof nozzle.max_dose_g === "number" &&
          typeof nozzle.dose_step_g === "number" &&
          nozzle.min_dose_g <= nozzle.max_dose_g
        : nozzle.min_dose_g === null &&
          nozzle.max_dose_g === null &&
          nozzle.dose_step_g === null) &&
      supportsFixed === nozzle.fixed_portion_ids.length > 0 &&
      nozzle.enabled === nozzle.dose_modes.length > 0 &&
      (nozzle.enabled || nozzle.measured_dispensed_g === false)
    );
  });
}

function validDeviceDescriptor(value: unknown, expectedDeviceId: string) {
  const device = record(value);
  return (
    !!device &&
    device.device_id === expectedDeviceId &&
    typeof device.model === "string" &&
    characterLength(device.model) >= 1 &&
    characterLength(device.model) <= 100 &&
    typeof device.firmware_version === "string" &&
    characterLength(device.firmware_version) >= 1 &&
    characterLength(device.firmware_version) <= 100 &&
    device.protocol_major === 2 &&
    typeof device.is_simulated === "boolean" &&
    typeof device.capabilities_revision === "number" &&
    Number.isSafeInteger(device.capabilities_revision) &&
    device.capabilities_revision > 0 &&
    validCapabilities(device.capabilities)
  );
}

function routePath(request: Request) {
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(/\/app-api\/v2(\/.*)?$/);
  return match ? match[1] || "/" : null;
}

function badMethod(requestId: string) {
  return apiError(
    requestId,
    405,
    "INVALID_INPUT",
    "This method is not available for the requested route.",
  );
}

async function pairInstallation(request: Request, installation: string) {
  const parsed = await readJson(request, crypto.randomUUID());
  if (parsed.response) return parsed.response;
  const body = record(parsed.value);
  const requestId = requestIdFrom(body);
  if (
    !body ||
    !onlyKeys(body, [
      "protocol_major",
      "request_id",
      "device_id",
      "challenge_id",
      "pairing_secret",
    ])
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_INPUT",
      "The pairing request is invalid.",
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
  if (
    !isUuid(body.request_id) ||
    !isUuid(body.device_id) ||
    !isUuid(body.challenge_id) ||
    typeof body.pairing_secret !== "string" ||
    characterLength(body.pairing_secret) < 1 ||
    characterLength(body.pairing_secret) > 512
  ) {
    return apiError(
      requestId,
      422,
      "VALIDATION_FAILED",
      "The pairing request is invalid.",
    );
  }
  try {
    if (!(await takeRateLimit("pair", installation))) {
      return apiError(
        requestId,
        429,
        "RATE_LIMITED",
        "Pairing requests are temporarily limited.",
        true,
      );
    }
    const { data, error } = await admin.rpc("art38_redeem_pairing_challenge", {
      p_device_id: body.device_id,
      p_challenge_id: body.challenge_id,
      p_installation_id: installation,
      p_verifier_hex: await sha256Hex(body.pairing_secret),
    });
    if (error)
      return apiError(
        requestId,
        503,
        "SERVICE_UNAVAILABLE",
        "The pairing service is temporarily unavailable.",
        true,
      );
    const result = record(data);
    switch (result?.status) {
      case "paired": {
        const device = record(result.device);
        const access = record(result.access);
        if (
          !validDeviceDescriptor(device, body.device_id) ||
          !access ||
          access.device_id !== body.device_id ||
          !(
            access.alias === null ||
            (typeof access.alias === "string" &&
              characterLength(access.alias) <= 100)
          ) ||
          !(
            access.location === null ||
            (typeof access.location === "string" &&
              characterLength(access.location) <= 160)
          ) ||
          typeof access.granted_at !== "string"
        ) {
          return apiError(
            requestId,
            503,
            "SERVICE_UNAVAILABLE",
            "The paired device profile could not be verified.",
            true,
          );
        }
        return json({ request_id: requestId, device, access }, 201);
      }
      case "expired":
        return apiError(
          requestId,
          422,
          "PAIRING_EXPIRED",
          "The pairing challenge expired. Open a new pairing window on the device.",
        );
      case "attempts_exceeded":
        return apiError(
          requestId,
          429,
          "RATE_LIMITED",
          "Too many pairing attempts. Open a new pairing window on the device.",
        );
      case "already_paired":
        return apiError(
          requestId,
          409,
          "ACCESS_DENIED",
          "This installation already has access to the device.",
        );
      default:
        return apiError(
          requestId,
          422,
          "PAIRING_INVALID",
          "The pairing challenge is invalid or was already used.",
        );
    }
  } catch {
    return apiError(
      requestId,
      503,
      "SERVICE_UNAVAILABLE",
      "The pairing service is temporarily unavailable.",
      true,
    );
  }
}

async function updateDeviceLabels(
  request: Request,
  installation: string,
  deviceId: string,
) {
  const parsed = await readJson(request, crypto.randomUUID());
  if (parsed.response) return parsed.response;
  const body = record(parsed.value);
  const requestId = requestIdFrom(body);
  const hasAlias =
    !!body && Object.prototype.hasOwnProperty.call(body, "alias");
  const hasLocation =
    !!body && Object.prototype.hasOwnProperty.call(body, "location");
  if (
    !body ||
    !onlyKeys(body, ["protocol_major", "request_id", "alias", "location"]) ||
    (!hasAlias && !hasLocation)
  ) {
    return apiError(
      requestId,
      400,
      "INVALID_INPUT",
      "Provide a device label or location to update.",
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
  const validLabel = (value: unknown, maximum: number) =>
    value === null ||
    (typeof value === "string" && characterLength(value) <= maximum);
  if (
    (hasAlias && !validLabel(body.alias, 100)) ||
    (hasLocation && !validLabel(body.location, 160))
  ) {
    return apiError(
      requestId,
      422,
      "VALIDATION_FAILED",
      "The device label or location is too long.",
    );
  }
  try {
    if (!(await takeRateLimit("device_write", installation))) {
      return apiError(
        requestId,
        429,
        "RATE_LIMITED",
        "Device changes are temporarily limited.",
        true,
      );
    }
    const { data, error } = await admin.rpc("art38_update_device_alias", {
      p_device_id: deviceId,
      p_installation_id: installation,
      p_alias: typeof body.alias === "string" ? body.alias : null,
      p_location: typeof body.location === "string" ? body.location : null,
      p_update_alias: hasAlias,
      p_update_location: hasLocation,
    });
    if (error)
      return apiError(
        requestId,
        503,
        "SERVICE_UNAVAILABLE",
        "The device service is temporarily unavailable.",
        true,
      );
    const result = record(data);
    if (result?.status === "not_active") {
      return apiError(
        requestId,
        403,
        "ACCESS_REVOKED",
        "This installation no longer has access to the device.",
      );
    }
    if (result?.status === "invalid") {
      return apiError(
        requestId,
        422,
        "VALIDATION_FAILED",
        "The device label or location is invalid.",
      );
    }
    if (
      result?.status !== "updated" ||
      result.device_id !== deviceId ||
      typeof result.granted_at !== "string"
    ) {
      return apiError(
        requestId,
        503,
        "SERVICE_UNAVAILABLE",
        "The updated device access could not be verified.",
        true,
      );
    }
    return json({
      request_id: requestId,
      access: {
        device_id: deviceId,
        alias: result.alias,
        location: result.location,
        granted_at: result.granted_at,
      },
    });
  } catch {
    return apiError(
      requestId,
      503,
      "SERVICE_UNAVAILABLE",
      "The device service is temporarily unavailable.",
      true,
    );
  }
}

async function revokeDeviceAccess(
  request: Request,
  installation: string,
  deviceId: string,
) {
  const requestId = request.headers.get("x-request-id") ?? "";
  if (request.headers.get("x-protocol-major") !== "2") {
    return apiError(
      isUuid(requestId) ? requestId : crypto.randomUUID(),
      422,
      "PROTOCOL_UNSUPPORTED",
      "Protocol major 2 is required.",
    );
  }
  if (!isUuid(requestId)) {
    return apiError(
      crypto.randomUUID(),
      400,
      "INVALID_INPUT",
      "A valid request identifier is required.",
    );
  }
  try {
    if (!(await takeRateLimit("device_write", installation))) {
      return apiError(
        requestId,
        429,
        "RATE_LIMITED",
        "Device changes are temporarily limited.",
        true,
      );
    }
    const { data, error } = await admin.rpc("art38_revoke_device_access", {
      p_device_id: deviceId,
      p_installation_id: installation,
    });
    if (error)
      return apiError(
        requestId,
        503,
        "SERVICE_UNAVAILABLE",
        "The device service is temporarily unavailable.",
        true,
      );
    const result = record(data);
    if (result?.status === "not_active") {
      return apiError(
        requestId,
        403,
        "ACCESS_REVOKED",
        "This installation no longer has access to the device.",
      );
    }
    if (result?.status !== "revoked" || typeof result.revoked_at !== "string") {
      return apiError(
        requestId,
        503,
        "SERVICE_UNAVAILABLE",
        "The device access change could not be verified.",
        true,
      );
    }
    return json({
      request_id: requestId,
      device_id: deviceId,
      revoked_at: result.revoked_at,
    });
  } catch {
    return apiError(
      requestId,
      503,
      "SERVICE_UNAVAILABLE",
      "The device service is temporarily unavailable.",
      true,
    );
  }
}

Deno.serve(async (request: Request) => {
  const fallbackRequestId = crypto.randomUUID();
  try {
    const installation = await installationId(request);
    if (!installation) {
      return apiError(
        fallbackRequestId,
        401,
        "AUTH_REQUIRED",
        "A verified anonymous installation session is required.",
      );
    }
    const path = routePath(request);
    if (path === "/pair") {
      return request.method === "POST"
        ? await pairInstallation(request, installation)
        : badMethod(fallbackRequestId);
    }
    const match = path?.match(UUID_IN_PATH);
    if (match && isUuid(match[1])) {
      if (match[2] === "alias") {
        return request.method === "PATCH"
          ? await updateDeviceLabels(request, installation, match[1])
          : badMethod(fallbackRequestId);
      }
      return request.method === "DELETE"
        ? await revokeDeviceAccess(request, installation, match[1])
        : badMethod(fallbackRequestId);
    }
    return apiError(
      fallbackRequestId,
      404,
      "RESOURCE_NOT_FOUND",
      "The requested device route was not found.",
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
