import {
  admin,
  apiError,
  characterLength,
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

function pairingWindowPath(request: Request) {
  const pathname = new URL(request.url).pathname;
  return /\/device-api\/v2\/pairing-window$/.test(pathname);
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
    const deviceId = authenticated.data;
    if (!isUuid(deviceId)) {
      return apiError(
        fallbackRequestId,
        401,
        "AUTH_REQUIRED",
        "A valid device credential is required.",
      );
    }
    if (!pairingWindowPath(request)) {
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
      p_request_id: body.request_id,
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
    if (result?.status !== "created" || typeof result.expires_at !== "string") {
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
        request_id: body.request_id,
        challenge_id: challengeId,
        pairing_secret: pairingSecret,
        expires_at: result.expires_at,
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
