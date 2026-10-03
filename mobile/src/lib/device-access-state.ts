export type DeviceRequestScope = {
  installationId: string | null;
  revision: number;
  selectedDeviceId: string | null;
};

export function sameDeviceRequestScope(
  request: DeviceRequestScope,
  current: DeviceRequestScope,
) {
  return (
    request.installationId === current.installationId &&
    request.revision === current.revision &&
    request.selectedDeviceId === current.selectedDeviceId
  );
}

export function enqueueSelectionWrite<T>(
  previous: Promise<void>,
  operation: () => Promise<T>,
) {
  const result = previous.then(operation, operation);
  return {
    result,
    next: result.then(
      () => undefined,
      () => undefined,
    ),
  };
}

export type PairingQrPayload = {
  protocol_major: 2;
  device_id: string;
  challenge_id: string;
  pairing_secret: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function protocolStringLength(value: string) {
  return Array.from(value).length;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function parsePairingQrPayload(value: string): PairingQrPayload | null {
  if (value.length > 4096) return null;
  try {
    const payload: unknown = JSON.parse(value);
    if (typeof payload !== "object" || payload === null) return null;
    const record = payload as Record<string, unknown>;
    if (
      record.protocol_major !== 2 ||
      !isUuid(record.device_id) ||
      !isUuid(record.challenge_id) ||
      typeof record.pairing_secret !== "string" ||
      protocolStringLength(record.pairing_secret) < 1 ||
      protocolStringLength(record.pairing_secret) > 512 ||
      Object.keys(record).some(
        (key) =>
          key !== "protocol_major" &&
          key !== "device_id" &&
          key !== "challenge_id" &&
          key !== "pairing_secret",
      )
    ) {
      return null;
    }
    return {
      protocol_major: 2,
      device_id: record.device_id,
      challenge_id: record.challenge_id,
      pairing_secret: record.pairing_secret,
    };
  } catch {
    return null;
  }
}

export function isPairingSecret(value: string) {
  const length = protocolStringLength(value);
  return length >= 1 && length <= 512;
}
