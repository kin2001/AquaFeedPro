import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

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
import * as deviceAccessState from "../src/lib/device-access-state.ts";

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

const providerInstallationA = "11111111-1111-4111-8111-111111111111";
const providerInstallationB = "44444444-4444-4444-8444-444444444444";
const providerDeviceA = "55555555-5555-4555-8555-555555555555";
const providerDeviceB = "77777777-7777-4777-8777-777777777777";
const wireNozzle = {
  enabled: false,
  dose_modes: [],
  fixed_portion_ids: [],
  min_dose_g: null,
  max_dose_g: null,
  dose_step_g: null,
  measured_dispensed_g: false,
  max_actuation_ms: null,
  minimum_cooldown_ms: null,
};
const pairProfile = (id) => ({
  device_id: id,
  model: "AquaFeed Duo",
  firmware_version: "simulator-fixture",
  protocol_major: 2,
  is_simulated: true,
  capabilities_revision: 1,
  capabilities: {
    do_monitoring: false,
    feed_remaining_monitoring: false,
    local_schedule_execution: false,
    max_schedules: null,
    max_clock_uncertainty_ms: null,
    scheduler_wake_grace_ms: null,
    maximum_settling_ms: null,
    nozzles: { 1: wireNozzle, 2: wireNozzle },
  },
});
const localRecord = (deviceId, alias = null, location = null) => ({
  deviceId,
  alias,
  location,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const providerCode = ts.transpileModule(
  await readFile(
    new URL("../src/lib/device-access.tsx", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

function providerHarness(installationId, initialRecords = []) {
  const refs = [];
  const storage = new Map();
  const storageCalls = [];
  const requests = [];
  let accessRecords = initialRecords.map((item) => ({
    device_id: item.deviceId,
    alias: item.alias,
    location: item.location,
    granted_at: "2026-10-04T00:00:00Z",
  }));
  let storageGate;
  let fetchGate;
  let labelFailures = 0;
  const session = () => ({
    access_token: "unit-test-access-token",
    expires_at: Math.floor(Date.now() / 1000) + 60,
    user: { id: installationId, is_anonymous: true },
  });
  const secureSessionStorage = {
    getItem: async (key) => storage.get(key) ?? null,
    async setItem(key, value) {
      storageCalls.push({ key, value });
      const gate = storageGate;
      storageGate = null;
      if (gate) await gate;
      storage.set(key, value);
    },
    removeItem: async (key) => storage.delete(key),
  };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
    },
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        in: () => query,
        then: (resolve, reject) =>
          Promise.resolve({
            data: [],
            error: new Error("fixture refresh read unavailable"),
          }).then(resolve, reject),
      };
      return query;
    },
  };
  const http = (value, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  });
  const fetch = async (url, init) => {
    const path = url.slice(url.indexOf("/v2") + 3);
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path, method: init.method, body });
    if (fetchGate?.path === path) {
      const gate = fetchGate.promise;
      fetchGate = null;
      await gate;
    }
    if (path === "/pair") {
      const device = pairProfile(body.device_id);
      const access = {
        device_id: body.device_id,
        alias: "Original pond name",
        location: "North pond",
        granted_at: "2026-10-04T00:00:00Z",
      };
      accessRecords.push(access);
      return http({ request_id: body.request_id, device, access });
    }
    if (path.endsWith("/alias") && init.method === "PATCH") {
      if (labelFailures-- > 0) {
        labelFailures = 0;
        return http({ error: { code: "SERVICE_UNAVAILABLE" } }, 503);
      }
      const targetId = path.split("/")[2];
      const current = accessRecords.find((item) => item.device_id === targetId);
      assert.ok(current, "label update has active fixture access");
      const access = {
        ...current,
        alias: Object.hasOwn(body, "alias") ? body.alias : current.alias,
        location: Object.hasOwn(body, "location")
          ? body.location
          : current.location,
      };
      accessRecords = accessRecords.map((item) =>
        item.device_id === targetId ? access : item,
      );
      return http({ request_id: body.request_id, access });
    }
    throw new Error("Unexpected provider API request.");
  };
  const react = {
    createContext: () => ({ Provider: {} }),
    useCallback: (fn) => fn,
    useContext: () => null,
    useEffect() {},
    useMemo: (fn) => fn(),
    useRef: (current) => {
      const ref = { current };
      refs.push(ref);
      return ref;
    },
    useState: (value) => [value, () => {}],
  };
  const imported = {
    react,
    "react/jsx-runtime": {
      Fragment: Symbol("Fragment"),
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
    "react-native": {
      AppState: {
        currentState: "active",
        addEventListener: () => ({ remove() {} }),
      },
      Platform: { OS: "android" },
    },
    "expo-secure-store": { isAvailableAsync: async () => true },
    "./device-access-state": deviceAccessState,
    "./secure-session-storage": {
      getSecureStorageFailure: () => null,
      resetSecureStorageFailure() {},
      SecureSessionStorageError: class SecureSessionStorageError extends Error {},
    },
    "./supabase": {
      removeLegacySqliteSession() {},
      secureSessionStorage,
      supabase,
    },
  };
  const providerModule = { exports: {} };
  const context = vm.createContext({
    crypto: { randomUUID: () => "88888888-8888-4888-8888-888888888888" },
    fetch,
    module: providerModule,
    exports: providerModule.exports,
    process: {
      env: {
        EXPO_PUBLIC_SUPABASE_URL: "https://fixture.invalid",
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-fixture-key",
      },
    },
    require: (name) => {
      assert.ok(
        Object.hasOwn(imported, name),
        "provider dependency is stubbed",
      );
      return imported[name];
    },
  });
  new vm.Script(providerCode).runInContext(context);
  const tree = providerModule.exports.DeviceAccessProvider({ children: null });
  const scopeRef = refs.find(
    (ref) =>
      ref.current &&
      Object.hasOwn(ref.current, "installationId") &&
      Object.hasOwn(ref.current, "selectedDeviceId"),
  );
  const devicesRef = refs.find((ref) => Array.isArray(ref.current));
  assert.ok(scopeRef && devicesRef);
  scopeRef.current = { installationId, revision: 1, selectedDeviceId: null };
  devicesRef.current = [...initialRecords];
  return {
    value: tree.props.value,
    scopeRef,
    devicesRef,
    requests,
    storageCalls,
    gateFetch(path, promise) {
      fetchGate = { path, promise };
    },
    gateStorage(promise) {
      storageGate = promise;
    },
    failLabel() {
      labelFailures = 1;
    },
  };
}

const labels = providerHarness(providerInstallationA);
const paired = await labels.value.pairDevice({
  device_id: providerDeviceA,
  challenge_id: challengeId,
  pairing_secret: "test-only-pairing-secret",
});
assert.equal(paired.alias, "Original pond name");
assert.equal(paired.location, "North pond");
assert.equal(labels.scopeRef.current.selectedDeviceId, null);
assert.deepEqual(
  Array.from(labels.devicesRef.current, (item) => item.deviceId),
  [providerDeviceA],
);
labels.failLabel();
await assert.rejects(
  labels.value.updateDeviceLabels(
    providerDeviceA,
    "Renamed feeder",
    paired.location,
  ),
  (error) => error.code === "SERVICE_UNAVAILABLE",
);
assert.equal(labels.devicesRef.current[0].location, "North pond");
await labels.value.updateDeviceLabels(
  providerDeviceA,
  "Renamed feeder",
  paired.location,
);
assert.equal(labels.devicesRef.current[0].alias, "Renamed feeder");
assert.equal(labels.devicesRef.current[0].location, "North pond");
assert.equal(labels.requests.filter((item) => item.path === "/pair").length, 1);
assert.ok(
  labels.requests
    .filter((item) => item.path.endsWith("/alias"))
    .every((item) => item.body.location === "North pond"),
);

const grantRace = providerHarness(providerInstallationA);
const grantGate = deferred();
grantRace.gateFetch("/pair", grantGate.promise);
const pendingGrant = grantRace.value.pairDevice({
  device_id: providerDeviceA,
  challenge_id: challengeId,
  pairing_secret: "test-only-pairing-secret",
});
await new Promise((resolve) => setImmediate(resolve));
grantRace.scopeRef.current = {
  installationId: providerInstallationB,
  revision: 2,
  selectedDeviceId: null,
};
grantRace.devicesRef.current = [localRecord(providerDeviceB, "Other pond")];
grantGate.resolve();
await assert.rejects(
  pendingGrant,
  (error) => error.code === "PAIRING_UNCONFIRMED",
);
assert.deepEqual(
  Array.from(grantRace.devicesRef.current, (item) => item.deviceId),
  [providerDeviceB],
);

const labelRace = providerHarness(providerInstallationA, [
  localRecord(providerDeviceA, "Original", "North pond"),
]);
const labelGate = deferred();
labelRace.gateFetch(
  "/devices/" + providerDeviceA + "/alias",
  labelGate.promise,
);
const pendingLabels = labelRace.value.updateDeviceLabels(
  providerDeviceA,
  "Renamed",
  "North pond",
);
await new Promise((resolve) => setImmediate(resolve));
labelRace.scopeRef.current = {
  installationId: providerInstallationB,
  revision: 2,
  selectedDeviceId: null,
};
labelRace.devicesRef.current = [localRecord(providerDeviceB, "Other pond")];
labelGate.resolve();
await assert.rejects(
  pendingLabels,
  (error) => error.code === "SESSION_CHANGED",
);
assert.deepEqual(
  Array.from(labelRace.devicesRef.current, (item) => item.deviceId),
  [providerDeviceB],
);

const selectionRace = providerHarness(providerInstallationA, [
  localRecord(providerDeviceA, "Original"),
]);
const storageGate = deferred();
selectionRace.gateStorage(storageGate.promise);
const pendingSelection = selectionRace.value.selectDevice(providerDeviceA);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(selectionRace.storageCalls.length, 1);
selectionRace.scopeRef.current = {
  installationId: providerInstallationB,
  revision: 2,
  selectedDeviceId: null,
};
selectionRace.devicesRef.current = [localRecord(providerDeviceB, "Other pond")];
storageGate.resolve();
await assert.rejects(
  pendingSelection,
  (error) => error.code === "SESSION_CHANGED",
);
assert.equal(selectionRace.scopeRef.current.selectedDeviceId, null);
assert.deepEqual(
  Array.from(selectionRace.devicesRef.current, (item) => item.deviceId),
  [providerDeviceB],
);

process.stdout.write(
  "Device access API callbacks, boundary, and race checks passed.\n",
);
