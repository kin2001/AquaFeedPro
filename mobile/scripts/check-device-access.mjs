import assert from "node:assert/strict";

import {
  enqueueSelectionWrite,
  isPairingSecret,
  parsePairingQrPayload,
  sameDeviceRequestScope,
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

process.stdout.write(
  "Device access boundary and selection race checks passed.\n",
);
