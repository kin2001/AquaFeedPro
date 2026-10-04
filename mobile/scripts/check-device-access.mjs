import assert from "node:assert/strict";

import {
  canonicalUuid,
  clearPersistedSelectionSafely,
  enqueueSelectionWrite,
  isPairingSecret,
  normalizeUtcTimestamp,
  pairingFailureNeedsNewWindow,
  parsePairingQrPayload,
  sameDeviceRequestScope,
  validatePairingLabels,
} from "../src/lib/device-access-state.ts";
import {
  createSecureSessionStorage,
  getSecureStorageFailure,
  resetSecureStorageFailure,
  secureUtf8ByteLength,
  SESSION_STORAGE_KEY,
} from "../src/lib/secure-session-storage.ts";

const deviceId = "22222222-2222-4222-8222-222222222222";
const challengeId = "33333333-3333-4333-8333-333333333333";
const pairing = {
  protocol_major: 2,
  device_id: deviceId,
  challenge_id: challengeId,
};

assert.deepEqual(
  parsePairingQrPayload(JSON.stringify({ ...pairing, pairing_secret: "x" })),
  { ...pairing, pairing_secret: "x" },
);
assert.equal(isPairingSecret("x"), true);
assert.equal(isPairingSecret("x".repeat(512)), true);
assert.equal(isPairingSecret("x".repeat(513)), false);
assert.equal(pairingFailureNeedsNewWindow("PAIRING_UNCONFIRMED"), true);
assert.equal(pairingFailureNeedsNewWindow("PAIRING_INVALID"), true);
assert.equal(pairingFailureNeedsNewWindow("RATE_LIMITED"), false);
assert.deepEqual(validatePairingLabels("  ", ""), {
  alias: "Enter a name for this device.",
  location: null,
});
assert.deepEqual(validatePairingLabels("Pond feeder", "Main pond"), {
  alias: null,
  location: null,
});
assert.deepEqual(
  validatePairingLabels("🐟".repeat(100), "pond 🐟".repeat(20)),
  { alias: null, location: null },
);
assert.equal(
  validatePairingLabels("🐟".repeat(101), "").alias,
  "Use 100 characters or fewer.",
);
assert.equal(
  validatePairingLabels("Pond feeder", "🐟".repeat(161)).location,
  "Use 160 characters or fewer.",
);
assert.equal(
  parsePairingQrPayload(JSON.stringify({ ...pairing, pairing_secret: "" })),
  null,
);
assert.equal(
  parsePairingQrPayload(
    JSON.stringify({ ...pairing, pairing_secret: "x".repeat(513) }),
  ),
  null,
);
assert.equal(
  parsePairingQrPayload(
    JSON.stringify({ ...pairing, protocol_major: 1, pairing_secret: "x" }),
  ),
  null,
);
assert.equal(
  parsePairingQrPayload(
    JSON.stringify({ ...pairing, pairing_secret: "x", unexpected: true }),
  ),
  null,
);
assert.equal(parsePairingQrPayload("not-json"), null);
assert.equal(isPairingSecret("😀".repeat(512)), true);
assert.equal(isPairingSecret("😀".repeat(513)), false);
assert.equal(canonicalUuid(deviceId.toUpperCase()), deviceId);
assert.equal(
  normalizeUtcTimestamp("2026-10-03T05:20:11+00:00"),
  "2026-10-03T05:20:11.000Z",
);
assert.equal(normalizeUtcTimestamp("2026-10-03T05:20:11+01:00"), null);
assert.equal(normalizeUtcTimestamp("2026-02-31T05:20:11Z"), null);

const escapedAstralSecret = "\\udbff\\udfff".repeat(512);
const escapedQr = `{"protocol_major":2,"device_id":"${deviceId.toUpperCase()}","challenge_id":"${challengeId.toUpperCase()}","pairing_secret":"${escapedAstralSecret}"}`;
const decodedQr = parsePairingQrPayload(escapedQr);
assert.ok(escapedQr.length > 4096 && escapedQr.length <= 8192);
assert.equal(decodedQr?.pairing_secret, "\u{10ffff}".repeat(512));
assert.equal(decodedQr?.device_id, deviceId);
assert.equal(decodedQr?.challenge_id, challengeId);

const scope = {
  installationId: deviceId,
  revision: 4,
  selectedDeviceId: challengeId,
};
assert.equal(sameDeviceRequestScope(scope, { ...scope }), true);
assert.equal(sameDeviceRequestScope(scope, { ...scope, revision: 5 }), false);
assert.equal(
  sameDeviceRequestScope(scope, { ...scope, selectedDeviceId: null }),
  false,
);
assert.equal(
  sameDeviceRequestScope(scope, { ...scope, installationId: challengeId }),
  false,
);

const writeOrder = [];
let releaseFirstWrite;
const firstWriteGate = new Promise((resolve) => {
  releaseFirstWrite = resolve;
});
const firstWrite = enqueueSelectionWrite(Promise.resolve(), async () => {
  writeOrder.push("persist:first");
  await firstWriteGate;
  writeOrder.push("visible:first");
});
const secondWrite = enqueueSelectionWrite(firstWrite.next, async () => {
  writeOrder.push("persist:second");
  writeOrder.push("visible:second");
});
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(writeOrder, ["persist:first"]);
releaseFirstWrite();
await Promise.all([firstWrite.result, secondWrite.result]);
assert.deepEqual(writeOrder, [
  "persist:first",
  "visible:first",
  "persist:second",
  "visible:second",
]);

const failedWrite = enqueueSelectionWrite(secondWrite.next, async () => {
  throw new Error("storage unavailable");
});
const afterFailure = enqueueSelectionWrite(failedWrite.next, async () => {
  writeOrder.push("after:failure");
});
await assert.rejects(failedWrite.result, /storage unavailable/);
await afterFailure.result;
assert.equal(writeOrder.at(-1), "after:failure");

const selectedKey = `selection.${deviceId}`;
const selectedStorage = new Map([[selectedKey, challengeId]]);
let currentSelection = {
  installationId: deviceId,
  selectedDeviceId: challengeId,
};
let clearIsCurrent = true;
let clearVisibleCalls = 0;
let finishDelete;
const deleteGate = new Promise((resolve) => {
  finishDelete = resolve;
});
const staleClear = clearPersistedSelectionSafely(
  deviceId,
  async () => {
    selectedStorage.delete(selectedKey);
    await deleteGate;
  },
  async (value) => selectedStorage.set(selectedKey, value),
  () => clearIsCurrent,
  () => currentSelection,
  () => {
    clearVisibleCalls += 1;
    currentSelection = { ...currentSelection, selectedDeviceId: null };
  },
);
await new Promise((resolve) => setImmediate(resolve));
clearIsCurrent = false;
finishDelete();
assert.equal(await staleClear, false);
assert.equal(selectedStorage.get(selectedKey), challengeId);
assert.equal(currentSelection.selectedDeviceId, challengeId);
assert.equal(clearVisibleCalls, 0);

const switchedKey = `selection.${deviceId}`;
const switchedStorage = new Map();
let selectionDuringRestore = {
  installationId: deviceId,
  selectedDeviceId: challengeId,
};
let restoreIsCurrent = true;
let releaseRestore;
const restoreGate = new Promise((resolve) => {
  releaseRestore = resolve;
});
const staleRestore = clearPersistedSelectionSafely(
  deviceId,
  async () => {
    switchedStorage.delete(switchedKey);
    restoreIsCurrent = false;
  },
  async (value) => {
    switchedStorage.set(switchedKey, value);
    await restoreGate;
  },
  () => restoreIsCurrent,
  () => selectionDuringRestore,
  () => {},
);
await new Promise((resolve) => setImmediate(resolve));
restoreIsCurrent = false;
selectionDuringRestore = {
  installationId: "44444444-4444-4444-8444-444444444444",
  selectedDeviceId: null,
};
releaseRestore();
assert.equal(await staleRestore, false);
assert.equal(switchedStorage.has(switchedKey), false);

const session = JSON.stringify({
  access_token: "opaque-session-token",
  refresh_token: "opaque-refresh-token",
  expires_at: 1_900_000_000,
  user: { id: deviceId, is_anonymous: true },
  utf8_sample: "pond 🐟",
});
const nativeValues = new Map();
const secureStore = {
  async getItemAsync(key) {
    return nativeValues.get(key) ?? null;
  },
  async setItemAsync(key, value) {
    nativeValues.set(key, value);
  },
  async deleteItemAsync(key) {
    nativeValues.delete(key);
  },
};
resetSecureStorageFailure();
const storage = createSecureSessionStorage(secureStore);
await storage.setItem(SESSION_STORAGE_KEY, session);
assert.equal(await storage.getItem(SESSION_STORAGE_KEY), session);
assert.equal(secureUtf8ByteLength("pond 🐟"), 9);
await assert.rejects(
  storage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      ...JSON.parse(session),
      user: { id: deviceId, is_anonymous: false },
    }),
  ),
  (error) => error.issue === "invalid_session",
);

resetSecureStorageFailure();
const nativeFailure = createSecureSessionStorage({
  async getItemAsync() {
    return null;
  },
  async setItemAsync() {
    throw new Error("Native SecureStore payload size too large");
  },
  async deleteItemAsync() {},
});
await assert.rejects(
  nativeFailure.setItem(SESSION_STORAGE_KEY, session),
  (error) =>
    error.issue === "too_large" &&
    error.serializedBytes === secureUtf8ByteLength(session) &&
    !error.message.includes("opaque-session-token"),
);
assert.equal(getSecureStorageFailure()?.issue, "too_large");
resetSecureStorageFailure();

const readFailure = createSecureSessionStorage({
  async getItemAsync() {
    throw new Error("native keychain temporarily unavailable");
  },
  async setItemAsync() {},
  async deleteItemAsync() {},
});
await assert.rejects(
  readFailure.getItem(SESSION_STORAGE_KEY),
  (error) =>
    error.issue === "unavailable" &&
    error.serializedBytes === null &&
    !error.message.includes("opaque-session-token"),
);
resetSecureStorageFailure();

process.stdout.write(
  "Device access boundary and selection race checks passed.\n",
);
