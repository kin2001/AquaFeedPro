import { createClient } from "npm:@supabase/supabase-js@2.117.2";

export type ErrorCode =
  | "INVALID_INPUT"
  | "AUTH_REQUIRED"
  | "ACCESS_DENIED"
  | "RESOURCE_NOT_FOUND"
  | "PAIRING_EXPIRED"
  | "PAIRING_INVALID"
  | "ACCESS_REVOKED"
  | "IDEMPOTENCY_CONFLICT"
  | "PROTOCOL_UNSUPPORTED"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "VALIDATION_FAILED";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8_192;
const NO_STORE = { "Cache-Control": "no-store" };

function requiredEnv(...names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  throw new Error("Supabase Edge Function environment is incomplete.");
}

const supabaseUrl = requiredEnv("SUPABASE_URL");
const publishableKey = requiredEnv(
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
);
const serviceKey = requiredEnv(
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
);

export const admin = createClient(supabaseUrl, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

const authClient = createClient(supabaseUrl, publishableKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function characterLength(value: string) {
  return Array.from(value).length;
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: NO_STORE });
}

export function apiError(
  requestId: string,
  status: number,
  code: ErrorCode,
  message: string,
  retryable = false,
) {
  return json(
    {
      error: { code, message, request_id: requestId, retryable },
    },
    status,
  );
}

export function requestIdFrom(value: unknown) {
  const body = record(value);
  return isUuid(body?.request_id) ? body.request_id : crypto.randomUUID();
}

export async function readJson(request: Request, requestId: string) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return {
      value: null,
      response: apiError(
        requestId,
        400,
        "INVALID_INPUT",
        "A JSON request body is required.",
      ),
    };
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return {
      value: null,
      response: apiError(
        requestId,
        413,
        "PAYLOAD_TOO_LARGE",
        "The request body is too large.",
      ),
    };
  }
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) {
      return {
        value: null,
        response: apiError(
          requestId,
          413,
          "PAYLOAD_TOO_LARGE",
          "The request body is too large.",
        ),
      };
    }
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    return { value, response: null };
  } catch {
    return {
      value: null,
      response: apiError(
        requestId,
        400,
        "INVALID_INPUT",
        "The request body is not valid JSON.",
      ),
    };
  }
}

export async function installationId(request: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) return null;
  try {
    const { data, error } = await authClient.auth.getUser(match[1]);
    const user = data.user;
    return !error && user?.is_anonymous === true && isUuid(user.id)
      ? user.id
      : null;
  } catch {
    return null;
  }
}

export async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function takeRateLimit(
  endpoint: "pair" | "device_write" | "pairing_window",
  subject: string,
) {
  const { data, error } = await admin.rpc("art38_take_rate_limit", {
    p_endpoint: endpoint,
    p_subject: subject,
  });
  if (error || typeof data !== "boolean")
    throw new Error("rate limiter unavailable");
  return data;
}

export function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function protocolMajor(value: unknown) {
  const body = record(value);
  return body?.protocol_major === 2;
}
