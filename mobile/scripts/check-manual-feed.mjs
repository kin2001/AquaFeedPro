import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const installationId = "11111111-1111-4111-8111-111111111111";
const otherInstallationId = "22222222-2222-4222-8222-222222222222";
const concurrentInstallationId = "55555555-5555-4555-8555-555555555555";
const deviceId = "33333333-3333-4333-8333-333333333333";
const sequenceId = "44444444-4444-4444-8444-444444444444";
const uuids = Array.from(
  { length: 128 },
  (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const secure = new Map();
const calls = [];
let currentStatus = "running";
let currentSafetyLockout = false;
let currentLockoutResolution = null;
let losePostResponse = true;
let nextPostError = null;
let lookupMissing = 0;
let lookupError = null;
let malformedPostResponse = false;
let delayedSecureRead = null;
let recoveryPostCount = 0;

const targets = [
  { nozzle_number: 1, dose: { mode: "grams", amount_g: 25 } },
  { nozzle_number: 2, dose: { mode: "grams", amount_g: 40 } },
];
const secureKey = (installation, device) =>
  `manual-feed.${installation}.${device.toLowerCase()}`;

function commandFor(requestId, idempotencyKey) {
  const statuses =
    currentStatus === "partial"
      ? ["completed", "unknown"]
      : currentStatus === "unknown"
        ? ["unknown", "not_started"]
        : ["completed", "running"];
  return {
    command_id: sequenceId,
    sequence_id: sequenceId,
    device_id: deviceId,
    request_id: requestId,
    idempotency_key: idempotencyKey,
    status: currentStatus,
    status_sequence: currentStatus === "partial" ? 4 : 3,
    created_at: "2026-10-08T00:00:00Z",
    start_before: "2026-10-08T00:01:00Z",
    targets,
    nozzle_results: targets.map((target, index) => ({
      nozzle_number: target.nozzle_number,
      status: statuses[index],
      requested_dose: target.dose,
      estimated_dispensed_g: null,
      measured_dispensed_g:
        index === 0 && statuses[index] === "completed" ? 24.5 : null,
      measurement_quality:
        index === 0 && statuses[index] === "completed"
          ? "valid"
          : "unavailable",
    })),
    safety_lockout: currentSafetyLockout,
    lockout_resolution: currentLockoutResolution,
  };
}

async function requestAppApi(installation, path, method, body) {
  calls.push({ installation, path, method, body });
  if (method === "POST") {
    const key = secureKey(installation, deviceId);
    const saved = JSON.parse(secure.get(key));
    assert.equal(
      saved.request_id,
      body.request_id,
      "the key is durable before POST begins",
    );
    assert.equal(saved.idempotency_key, body.idempotency_key);
    if (path.endsWith("/feed-recovery/no-admission")) {
      recoveryPostCount += 1;
      assert.equal(body.request_id, saved.request_id);
      assert.equal(body.idempotency_key, saved.idempotency_key);
      assert.equal(JSON.stringify(body.targets), JSON.stringify(saved.targets));
      return {
        request_id: body.request_id,
        resolution: "created",
        command: {
          ...commandFor(body.request_id, body.idempotency_key),
          status: "rejected",
        },
      };
    }
    if (nextPostError) {
      const error = nextPostError;
      nextPostError = null;
      throw Object.assign(new Error(`${error.code} admission refusal`), error);
    }
    if (losePostResponse) {
      losePostResponse = false;
      throw new Error("response lost after submit");
    }
    if (malformedPostResponse) {
      malformedPostResponse = false;
      return { request_id: body.request_id, command: {} };
    }
    return {
      request_id: body.request_id,
      command: commandFor(body.request_id, body.idempotency_key),
    };
  }
  if (path.includes("/commands/by-key?")) {
    if (lookupError) {
      const error = lookupError;
      lookupError = null;
      if (error instanceof Error) throw error;
      throw Object.assign(new Error(error.code), error);
    }
    if (lookupMissing > 0) {
      lookupMissing -= 1;
      throw Object.assign(new Error("command not found"), {
        code: "RESOURCE_NOT_FOUND",
        status: 404,
      });
    }
    const key = new URLSearchParams(path.split("?")[1]).get("key");
    const pending = JSON.parse(secure.get(secureKey(installation, deviceId)));
    assert.equal(
      key,
      pending.idempotency_key,
      "reconciliation uses the original key",
    );
    return {
      request_id: body?.request_id ?? uuids.shift(),
      command: commandFor(pending.request_id, key),
    };
  }
  if (
    path.endsWith(
      "/history?from=2026-10-01&to=2026-10-08&source=manual&status=unknown",
    )
  ) {
    return {
      request_id: uuids.shift(),
      from_date: "2026-10-01",
      to_date: "2026-10-08",
      timezone: "Asia/Manila",
      timezone_known: true,
      totals: { total: 1, completed: 0, needs_attention: 1, in_progress: 0 },
      records: [
        {
          ...commandFor(uuids.shift(), uuids.shift()),
          source: "manual",
          reason_code: null,
          started_at: "2026-10-08T00:00:05Z",
          completed_at: null,
        },
      ],
      next_cursor: null,
    };
  }
  if (path.endsWith(`/history/${sequenceId}`)) {
    return {
      request_id: uuids.shift(),
      timezone: "Asia/Manila",
      timezone_known: true,
      record: {
        ...commandFor(uuids.shift(), uuids.shift()),
        source: "manual",
        reason_code: null,
        started_at: "2026-10-08T00:00:05Z",
        completed_at: null,
      },
    };
  }
  throw new Error(`Unexpected API call: ${method} ${path}`);
}

const source = await readFile(
  new URL("../src/lib/manual-feed.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(code, {
  module,
  exports: module.exports,
  require(name) {
    if (name === "expo-secure-store")
      return {
        getItemAsync: async (key) => {
          assert.match(
            key,
            /^[\w.-]+$/,
            "SecureStore key uses supported characters",
          );
          const saved = secure.get(key) ?? null;
          if (delayedSecureRead?.key === key) {
            delayedSecureRead.reads += 1;
            if (delayedSecureRead.reads === delayedSecureRead.at) {
              delayedSecureRead.entered();
              await delayedSecureRead.gate;
            }
          }
          return saved;
        },
        setItemAsync: async (key, value) => {
          assert.match(
            key,
            /^[\w.-]+$/,
            "SecureStore key uses supported characters",
          );
          secure.set(key, value);
        },
        deleteItemAsync: async (key) => {
          assert.match(
            key,
            /^[\w.-]+$/,
            "SecureStore key uses supported characters",
          );
          secure.delete(key);
        },
      };
    if (name === "./device-access") return { requestAppApi };
    throw new Error(`Unexpected import ${name}`);
  },
  URLSearchParams,
  crypto: { randomUUID: () => uuids.shift() },
});

const api = module.exports;
const measuredSnapshot = (
  remaining,
  freshness = "fresh",
  quality = "valid",
) => ({
  latest_sample: {
    feed_remaining_g: remaining,
    feed_freshness: freshness,
    feed_quality: quality,
  },
});
const combinedTwentyFiveKg = [
  { nozzle_number: 1, dose: { mode: "grams", amount_g: 10000 } },
  { nozzle_number: 2, dose: { mode: "grams", amount_g: 15000 } },
];
const combinedTwentyKg = [
  { nozzle_number: 1, dose: { mode: "grams", amount_g: 10000 } },
  { nozzle_number: 2, dose: { mode: "grams", amount_g: 10000 } },
];
assert.equal(
  api.manualInventoryIssue(measuredSnapshot(20000), combinedTwentyKg),
  null,
  "a combined request equal to measured stock is admissible",
);
assert.match(
  api.manualInventoryIssue(measuredSnapshot(20000), combinedTwentyFiveKg),
  /exceed.*remaining stock/,
);
assert.equal(
  api.manualInventoryIssue(measuredSnapshot(20000), [
    { nozzle_number: 1, dose: { mode: "grams", amount_g: 19995 } },
    {
      nozzle_number: 2,
      dose: { mode: "fixed_portion", fixed_portion_id: "small" },
    },
  ]),
  null,
);
assert.match(
  api.manualInventoryIssue(measuredSnapshot(20000), [
    { nozzle_number: 1, dose: { mode: "grams", amount_g: 20000 } },
    {
      nozzle_number: 2,
      dose: { mode: "fixed_portion", fixed_portion_id: "small" },
    },
  ]),
  /positive remainder/,
);
assert.match(
  api.manualInventoryIssue(measuredSnapshot(20000, "stale"), targets),
  /fresh, valid measured/,
);
assert.match(
  api.manualInventoryIssue(
    measuredSnapshot(20000, "fresh", "unknown"),
    targets,
  ),
  /fresh, valid measured/,
);
const fixedPortionTarget = [
  {
    nozzle_number: 1,
    dose: { mode: "fixed_portion", fixed_portion_id: "small" },
  },
];
assert.equal(
  api.manualInventoryIssue(measuredSnapshot(20000), fixedPortionTarget),
  null,
  "a supported fixed portion stays compatible when fresh positive stock is observed",
);
assert.match(
  api.manualInventoryIssue(measuredSnapshot(0), fixedPortionTarget),
  /positive remainder/,
);
assert.match(
  api.manualInventoryNotice(fixedPortionTarget),
  /mass cannot be verified/,
);
const command = await api.submitManualFeed(
  installationId,
  deviceId,
  1,
  targets,
);
assert.equal(command.status, "running");
assert.deepEqual(
  calls.map(({ method }) => method),
  ["POST", "GET"],
);
const saved = JSON.parse(secure.get(secureKey(installationId, deviceId)));
assert.equal(
  calls[1].path.includes(encodeURIComponent(saved.idempotency_key)),
  true,
);
await assert.rejects(
  api.submitManualFeed(installationId, deviceId, 1, [targets[0]]),
  /saved doses cannot be changed/,
);
assert.equal(calls.filter(({ method }) => method === "POST").length, 1);
assert.equal(
  await api.loadPendingManualFeed(otherInstallationId, deviceId),
  null,
);

const beforeConcurrentPosts = calls.filter(
  ({ method }) => method === "POST",
).length;
const concurrent = await Promise.all([
  api.submitManualFeed(concurrentInstallationId, deviceId, 1, targets),
  api.submitManualFeed(concurrentInstallationId, deviceId, 1, targets),
]);
assert.equal(concurrent[0].idempotency_key, concurrent[1].idempotency_key);
assert.equal(
  calls.filter(({ method }) => method === "POST").length,
  beforeConcurrentPosts + 1,
  "concurrent identical taps share one persisted idempotency key and POST",
);
assert.ok(secure.has(secureKey(concurrentInstallationId, deviceId)));

const cleanupInstallationId = "abababab-abab-4bab-8bab-000000000001";
const oldPending = {
  request_id: "abababab-abab-4bab-8bab-000000000002",
  idempotency_key: "abababab-abab-4bab-8bab-000000000003",
  device_id: deviceId,
  capabilities_revision: 1,
  targets,
};
const cleanupKey = secureKey(cleanupInstallationId, deviceId);
secure.set(cleanupKey, JSON.stringify(oldPending));
let unblockCleanupRead;
let signalCleanupRead;
const cleanupReadGate = new Promise((resolve) => {
  unblockCleanupRead = resolve;
});
const cleanupReadReached = new Promise((resolve) => {
  signalCleanupRead = resolve;
});
delayedSecureRead = {
  key: cleanupKey,
  at: 2,
  reads: 0,
  entered: signalCleanupRead,
  gate: cleanupReadGate,
};
currentStatus = "completed";
const cleanupA = api.reconcileManualFeed(
  cleanupInstallationId,
  deviceId,
  oldPending.idempotency_key,
);
await cleanupReadReached;
const cleanupB = api.reconcileManualFeed(
  cleanupInstallationId,
  deviceId,
  oldPending.idempotency_key,
);
await new Promise((resolve) => setImmediate(resolve));
currentStatus = "running";
const submissionAfterCleanup = api.submitManualFeed(
  cleanupInstallationId,
  deviceId,
  1,
  targets,
);
await new Promise((resolve) => setImmediate(resolve));
unblockCleanupRead();
const [cleanedByA, cleanedByB, acceptedAfterCleanup] = await Promise.all([
  cleanupA,
  cleanupB,
  submissionAfterCleanup,
]);
delayedSecureRead = null;
assert.equal(cleanedByA.idempotency_key, oldPending.idempotency_key);
assert.equal(cleanedByB.idempotency_key, oldPending.idempotency_key);
assert.notEqual(
  acceptedAfterCleanup.idempotency_key,
  oldPending.idempotency_key,
);
assert.equal(
  JSON.parse(secure.get(cleanupKey)).idempotency_key,
  acceptedAfterCleanup.idempotency_key,
  "a delayed terminal cleanup cannot delete a newly confirmed feed key",
);
currentStatus = "running";

currentStatus = "partial";
currentSafetyLockout = true;
const uncertain = await api.reconcileManualFeed(
  installationId,
  deviceId,
  saved.idempotency_key,
);
assert.equal(uncertain.status, "partial");
assert.equal(uncertain.nozzle_results[1].measured_dispensed_g, null);
assert.ok(
  await api.loadPendingManualFeed(installationId, deviceId),
  "unknown second leg stays saved under lockout",
);

currentStatus = "unknown";
currentSafetyLockout = false;
currentLockoutResolution = {
  resolution_at: "2026-10-08T00:02:00Z",
  resolution_reason: "physical inspection completed",
  source: "device_maintenance",
};
const maintenanceResolved = await api.reconcileManualFeed(
  installationId,
  deviceId,
  saved.idempotency_key,
);
assert.equal(maintenanceResolved.status, "unknown");
assert.equal(
  await api.loadPendingManualFeed(installationId, deviceId),
  null,
  "verified maintenance clears the retry lock while preserving the unknown result",
);
currentStatus = "running";
currentLockoutResolution = null;
const beforeMaintenanceRetry = calls.filter(
  ({ method }) => method === "POST",
).length;
const retriedAfterMaintenance = await api.submitManualFeed(
  installationId,
  deviceId,
  1,
  targets,
);
assert.notEqual(retriedAfterMaintenance.idempotency_key, saved.idempotency_key);
assert.equal(
  calls.filter(({ method }) => method === "POST").length,
  beforeMaintenanceRetry + 1,
  "a newly confirmed feed gets a new key only after explicit maintenance resolution",
);

const refusalInstallationId = "66666666-6666-4666-8666-666666666666";
nextPostError = { code: "DEVICE_OFFLINE", status: 409 };
await assert.rejects(
  api.submitManualFeed(refusalInstallationId, deviceId, 1, targets),
  (error) => error.code === "DEVICE_OFFLINE",
);
assert.equal(
  await api.loadPendingManualFeed(refusalInstallationId, deviceId),
  null,
  "a typed definitive pre-admission refusal clears its owned pending key",
);
const beforeOfflineRetry = calls.filter(
  ({ method }) => method === "POST",
).length;
await api.submitManualFeed(refusalInstallationId, deviceId, 1, targets);
assert.equal(
  calls.filter(({ method }) => method === "POST").length,
  beforeOfflineRetry + 1,
  "a definitive refusal allows a later explicit feed instead of retrying a missing key",
);

for (const [code, installation] of [
  ["INVENTORY_UNAVAILABLE", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"],
  ["INSUFFICIENT_INVENTORY", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"],
]) {
  nextPostError = { code, status: 409 };
  await assert.rejects(
    api.submitManualFeed(installation, deviceId, 4, targets),
    (error) => error.code === code,
  );
  assert.equal(
    await api.loadPendingManualFeed(installation, deviceId),
    null,
    `${code} is a definitive no-admission refusal`,
  );
}

const unavailableInstallationId = "88888888-8888-4888-8888-888888888888";
nextPostError = { code: "SERVICE_UNAVAILABLE", status: 503 };
lookupMissing = 1;
await assert.rejects(
  api.submitManualFeed(unavailableInstallationId, deviceId, 1, targets),
  /original feed key is saved/,
);
assert.ok(
  await api.loadPendingManualFeed(unavailableInstallationId, deviceId),
  "a 5xx and ambiguous key lookup never clear the saved request",
);
const unavailablePending = await api.loadPendingManualFeed(
  unavailableInstallationId,
  deviceId,
);
assert.ok(unavailablePending);
const postsBeforeMissingStatus = calls.filter(
  ({ method }) => method === "POST",
).length;
lookupMissing = 1;
await assert.rejects(
  api.reconcileManualFeed(unavailableInstallationId, deviceId),
  /No status was found for this saved feed\./,
);
assert.equal(
  (await api.loadPendingManualFeed(unavailableInstallationId, deviceId))
    ?.idempotency_key,
  unavailablePending.idempotency_key,
  "a missing saved status preserves the original pending identity",
);
assert.equal(
  calls.filter(({ method }) => method === "POST").length,
  postsBeforeMissingStatus,
  "checking a missing status never starts another feed",
);

lookupError = { code: "ACCESS_DENIED", status: 403 };
await assert.rejects(
  api.reconcileManualFeed(unavailableInstallationId, deviceId),
  (error) => error.code === "ACCESS_DENIED" && error.status === 403,
);
const networkError = new Error("network unavailable");
lookupError = networkError;
await assert.rejects(
  api.reconcileManualFeed(unavailableInstallationId, deviceId),
  (error) => error === networkError,
);
assert.equal(
  (await api.loadPendingManualFeed(unavailableInstallationId, deviceId))
    ?.idempotency_key,
  unavailablePending.idempotency_key,
  "access and network failures preserve the saved feed identity",
);
assert.equal(
  calls.filter(({ method }) => method === "POST").length,
  postsBeforeMissingStatus,
  "status lookup failures never start another feed",
);

const recoveryInstallationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
losePostResponse = true;
lookupMissing = 1;
await assert.rejects(
  api.submitManualFeed(recoveryInstallationId, deviceId, 4, targets),
  /original feed key is saved/,
);
const savedForRecovery = await api.loadPendingManualFeed(
  recoveryInstallationId,
  deviceId,
);
assert.ok(
  savedForRecovery,
  "a missing GET result keeps the saved request ambiguous",
);
assert.equal(recoveryPostCount, 0);
const callsBeforeRecovery = calls.length;
currentStatus = "rejected";
const resolved = await api.resolveSavedManualFeedNoAdmission(
  recoveryInstallationId,
  deviceId,
  () => true,
);
assert.equal(resolved.noAdmissionRecorded, true);
assert.equal(resolved.command.status, "rejected");
assert.equal(recoveryPostCount, 1);
assert.equal(calls.length, callsBeforeRecovery + 1);
assert.equal(
  calls.at(-1).path,
  `/devices/${deviceId}/feed-recovery/no-admission`,
  "explicit recovery uses a separate no-actuation endpoint",
);
assert.equal(calls.at(-1).method, "POST");
assert.equal(calls.at(-1).body.request_id, savedForRecovery.request_id);
assert.equal(
  calls.at(-1).body.idempotency_key,
  savedForRecovery.idempotency_key,
);
assert.equal(
  await api.loadPendingManualFeed(recoveryInstallationId, deviceId),
  null,
  "the terminal no-admission fence clears only the matching saved request",
);
currentStatus = "running";

const mismatchedRefusalInstallationId = "99999999-9999-4999-8999-999999999999";
nextPostError = { code: "DEVICE_OFFLINE", status: 503 };
lookupMissing = 1;
await assert.rejects(
  api.submitManualFeed(mismatchedRefusalInstallationId, deviceId, 1, targets),
  /original feed key is saved/,
);
assert.ok(
  await api.loadPendingManualFeed(mismatchedRefusalInstallationId, deviceId),
  "a refusal code paired with the wrong HTTP status cannot clear the saved request",
);

const malformedInstallationId = "abababab-abab-4bab-8bab-abababababab";
malformedPostResponse = true;
lookupMissing = 2;
await assert.rejects(
  api.submitManualFeed(malformedInstallationId, deviceId, 1, targets),
  /original feed key is saved/,
);
assert.ok(
  await api.loadPendingManualFeed(malformedInstallationId, deviceId),
  "a malformed success body and failed status lookup preserve the saved request",
);

const sessionChangedInstallationId = "77777777-7777-4777-8777-777777777777";
nextPostError = { code: "DEVICE_BUSY", status: 409 };
await assert.rejects(
  api.submitManualFeed(
    sessionChangedInstallationId,
    deviceId,
    1,
    targets,
    () => false,
  ),
  (error) => error.code === "DEVICE_BUSY",
);
assert.ok(
  await api.loadPendingManualFeed(sessionChangedInstallationId, deviceId),
  "session or selected-device changes preserve the original pending identity",
);

const postCountBeforeHistory = calls.filter(
  ({ method }) => method === "POST",
).length;
const page = await api.readHistoryPage(installationId, deviceId, {
  from: "2026-10-01",
  to: "2026-10-08",
  source: "manual",
  status: "unknown",
  cursor: null,
});
assert.equal(page.records[0].nozzle_results[1].measured_dispensed_g, null);
assert.match(
  calls.at(-1).path,
  /from=2026-10-01&to=2026-10-08&source=manual&status=unknown/,
);
await api.readHistoryDetail(installationId, deviceId, sequenceId);
assert.equal(
  calls.at(-1).method,
  "GET",
  "history details are a read-only deep-link destination",
);
assert.equal(
  calls.filter(({ method }) => method === "POST").length,
  postCountBeforeHistory,
  "history reads never create feed commands",
);

const detailScreen = await readFile(
  new URL("../src/app/history/[runId].tsx", import.meta.url),
  "utf8",
);
assert.match(detailScreen, /readHistoryDetail/);
assert.doesNotMatch(detailScreen, /submitManualFeed/);
const confirmScreen = await readFile(
  new URL("../src/app/feed/confirm.tsx", import.meta.url),
  "utf8",
);
assert.match(
  confirmScreen,
  /const lockout = command\?\.safety_lockout === true/,
);
assert.doesNotMatch(confirmScreen, /command\?\.status === "unknown"/);
assert.match(confirmScreen, /resolveSavedManualFeedNoAdmission/);
assert.match(confirmScreen, /pendingReceipt/);
assert.match(confirmScreen, /This saved feed has no confirmed result/);
assert.match(
  confirmScreen,
  /The saved feed was safely closed without starting a feed/,
);
assert.match(
  confirmScreen,
  /A feed record already exists for this saved request/,
);
assert.match(confirmScreen, /manualInventoryIssue/);
assert.match(confirmScreen, /manualInventoryNotice/);
// Exercise the real route with deterministic local services; no network or feeder.
let uiHooks;
const uiReact = {
  useState: (value) => uiHooks.state(value),
  useRef: (value) => uiHooks.state(() => ({ current: value }))[0],
  useEffect: (effect, deps) => uiHooks.effect(effect, deps),
  useLayoutEffect: (effect, deps) => uiHooks.effect(effect, deps),
  useCallback: (fn, deps) => uiHooks.memo(() => fn, deps),
  useMemo: (fn, deps) => uiHooks.memo(fn, deps),
};
function uiHarness(render) {
  const slots = [];
  let index;
  let effects;
  const changed = (previous, deps) =>
    !previous || !deps || deps.some((v, i) => v !== previous.deps[i]);
  const instance = {
    state(initial) {
      const at = index++;
      if (!(at in slots))
        slots[at] = typeof initial === "function" ? initial() : initial;
      return [
        slots[at],
        (value) => {
          slots[at] = typeof value === "function" ? value(slots[at]) : value;
        },
      ];
    },
    memo(fn, deps) {
      const at = index++;
      if (changed(slots[at], deps)) slots[at] = { value: fn(), deps };
      return slots[at].value;
    },
    effect(fn, deps) {
      const at = index++;
      if (changed(slots[at], deps))
        effects.push(() => {
          slots[at]?.cleanup?.();
          slots[at] = { deps, cleanup: fn() };
        });
    },
    render() {
      index = 0;
      effects = [];
      uiHooks = instance;
      const view = render();
      effects.forEach((fn) => fn());
      return view;
    },
  };
  return instance;
}
function uiNodes(node, type) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => uiNodes(child, type));
  return [
    ...(node.type === type ? [node] : []),
    ...uiNodes(node.props?.children, type),
    ...uiNodes(node.props?.footer, type),
    ...uiNodes(node.props?.actions, type),
  ];
}
const uiKit = Object.fromEntries(
  [
    "BentoCard",
    "Button",
    "Chip",
    "KeyValue",
    "ListRow",
    "Notice",
    "SectionHeader",
    "Segmented",
    "Sheet",
    "StatusLabel",
    "TextField",
    "SwitchRow",
  ].map((name) => [name, name]),
);
const uiCapability = {
  enabled: true,
  doseModes: ["grams"],
  minDoseG: 5,
  maxDoseG: 50,
  doseStepG: 5,
  fixedPortionIds: [],
};
const uiDevice = {
  deviceId,
  alias: "Fixture feeder",
  model: "Fixture",
  contactFreshness: "fresh",
  capabilitiesRevision: 1,
  capabilities: {
    nozzles: { 1: uiCapability, 2: uiCapability },
    schedulerWakeGraceMs: 1000,
  },
};
let uiAccess = {
  installationId,
  scopeRevision: 1,
  selectedDeviceId: deviceId,
  selectedDevice: uiDevice,
  devices: [uiDevice],
  refreshDevices: async () => {},
};
let finishRecovery;
let failRecovery;
let savedUiFeed = null;
let uiSubmissions = [];
const uiCommand = {
  status: "completed",
  safety_lockout: false,
  nozzle_results: [
    {
      nozzle_number: 1,
      status: "completed",
      requested_dose: { mode: "grams", amount_g: 5 },
      measurement_quality: "valid",
      measured_dispensed_g: 4.8,
      estimated_dispensed_g: 4.9,
    },
  ],
};
const uiServices = {
  loadPendingManualFeed: () =>
    new Promise((resolve, reject) => {
      finishRecovery = () => resolve(savedUiFeed);
      failRecovery = reject;
    }),
  reconcileManualFeed: async () => uiCommand,
  manualInventoryNotice: () => null,
  manualInventoryIssue: () => null,
  submitManualFeed: async (...args) => {
    uiSubmissions.push(args);
    return uiCommand;
  },
};
const uiExports = {};
vm.runInNewContext(
  ts.transpile(confirmScreen, {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  }),
  {
    exports: uiExports,
    require: (name) =>
      ({
        react: uiReact,
        "react/jsx-runtime": {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        },
        "react-native": {
          StyleSheet: { create: (styles) => styles },
          Text: "Text",
          View: "View",
        },
        "expo-router": {
          router: {},
          useFocusEffect: (fn) => uiReact.useEffect(fn, [fn]),
        },
        "@/components/app-shell": {
          ...uiKit,
          statusIcons: { completed: "check" },
        },
        "@/components/feed-status": { statusKind: (status) => status },
        "@/constants/theme": { Colors: { light: {} }, Typography: {} },
        "@/lib/device-access": { useDeviceAccess: () => uiAccess },
        "@/lib/device-changes": { subscribeDeviceChanges: () => () => {} },
        "@/lib/manual-feed": uiServices,
        "@/lib/monitoring": { readMonitoringSnapshot: async () => ({}) },
      })[name] ?? {},
  },
);
const uiFlush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const feedUi = uiHarness(() => uiExports.default());
let feedView = feedUi.render();
const confirmButton = (view) =>
  uiNodes(view, "Button").find(
    (node) => node.props.children === "Confirm feed",
  );
assert.equal(
  confirmButton(feedView)?.props.disabled ?? true,
  true,
  "confirmation stays blocked until saved-feed recovery has loaded",
);
await uiFlush();
finishRecovery();
await uiFlush();
feedView = feedUi.render();
assert.equal(confirmButton(feedView).props.disabled, false);
const submitFromSameFrame = confirmButton(feedView).props.onPress;
submitFromSameFrame();
submitFromSameFrame();
await uiFlush();
finishRecovery();
await uiFlush();
feedView = feedUi.render();
assert.equal(
  uiSubmissions.length,
  1,
  "same-frame repeated confirmation sends only once",
);
submitFromSameFrame();
await uiFlush();
assert.equal(
  uiSubmissions.length,
  1,
  "a stale confirmation callback cannot send again after a terminal result",
);
assert.equal(uiSubmissions[0][1], deviceId);
assert.equal(uiSubmissions[0][3][0].dose.amount_g, 5);
assert.equal(
  confirmButton(feedView),
  undefined,
  "a result never invites another feed in the same confirmation sheet",
);
assert.equal(
  uiNodes(feedView, "Segmented").length,
  0,
  "results do not mix saved doses with an editable new request",
);
assert.equal(
  uiNodes(feedView, "ListRow")[0].props.lines.length,
  3,
  "requested, measured and estimated results have separate readable lines",
);

const offlineUi = uiHarness(() => uiExports.default());
uiDevice.contactFreshness = "stale";
offlineUi.render();
await uiFlush();
finishRecovery();
await uiFlush();
assert.equal(
  confirmButton(offlineUi.render()).props.disabled,
  true,
  "offline contact never enables a feed",
);
uiDevice.contactFreshness = "fresh";
const failedRecoveryUi = uiHarness(() => uiExports.default());
failedRecoveryUi.render();
await uiFlush();
failRecovery(new Error("fixture storage read failed"));
await uiFlush();
let failedRecoveryView = failedRecoveryUi.render();
assert.equal(
  confirmButton(failedRecoveryView).props.disabled,
  true,
  "failed saved-request lookup cannot authorize a new feed",
);
const retryRecovery = uiNodes(failedRecoveryView, "Button").find(
  (node) => node.props.children === "Check saved feed",
);
assert.ok(
  retryRecovery,
  "a failed saved-request lookup offers a read-only recovery action",
);
retryRecovery.props.onPress();
await uiFlush();
finishRecovery();
await uiFlush();
assert.equal(confirmButton(failedRecoveryUi.render()).props.disabled, false);
savedUiFeed = {
  idempotency_key: "fixture-saved",
  targets: [{ nozzle_number: 2, dose: { mode: "grams", amount_g: 35 } }],
};
const restoredUi = uiHarness(() => uiExports.default());
restoredUi.render();
await uiFlush();
finishRecovery();
await uiFlush();
finishRecovery();
await uiFlush();
assert.equal(
  confirmButton(restoredUi.render()),
  undefined,
  "reopening reads the saved command rather than inviting another feed",
);
assert.equal(
  uiSubmissions.length,
  1,
  "recovery and reconnect reads do not submit",
);
savedUiFeed = null;
const bothUi = uiHarness(() => uiExports.default());
bothUi.render();
await uiFlush();
finishRecovery();
await uiFlush();
let bothView = bothUi.render();
uiNodes(bothView, "Segmented")[0].props.onChange("both");
bothView = bothUi.render();
const bothSummary = uiNodes(bothView, "KeyValue").filter((node) =>
  node.props.label?.startsWith("Nozzle"),
);
assert.deepEqual(
  bothSummary.map((node) => node.props.label),
  ["Nozzle 1", "Nozzle 2"],
);
assert.equal(
  bothSummary.length,
  2,
  "Both confirmation shows each nozzle separately in execution order",
);
uiAccess = {
  ...uiAccess,
  selectedDeviceId: "changed-fixture-device",
  scopeRevision: 2,
};
bothView = bothUi.render();
assert.equal(
  confirmButton(bothView).props.disabled,
  true,
  "selection changes cannot retarget confirmation",
);
uiAccess = { ...uiAccess, selectedDeviceId: deviceId, scopeRevision: 1 };

const editorSource = await readFile(
  new URL("../src/components/schedule-editor.tsx", import.meta.url),
  "utf8",
);
const editorExports = {};
const scheduleEditorTheme = {
  Colors: { light: {} },
  Spacing: {},
  Typography: {},
};
assert.ok(
  scheduleEditorTheme.Colors?.light,
  "manual_feed_mock_supports_schedule_editor_theme",
);
let editorWrites = [];
let rejectEditorSave;
const editorConfiguration = {
  current_state: { desired_revision: 1, last_attempt_status: "applied" },
  applied_snapshot: {
    revision: 1,
    timezone: "Asia/Manila",
    schedules: [],
    monitoring_limits: {},
    low_feed_threshold_pct: null,
  },
};
uiDevice.capabilities.localScheduleExecution = true;
uiDevice.capabilities.maxSchedules = 8;
vm.runInNewContext(
  ts.transpile(editorSource, {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  }),
  {
    exports: editorExports,
    require: (name) =>
      ({
        react: uiReact,
        "react/jsx-runtime": {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        },
        "react-native": {
          StyleSheet: { create: (styles) => styles },
          Text: "Text",
          View: "View",
        },
        "expo-router": { router: {} },
        "@/components/app-shell": uiKit,
        "@/components/feed-status": {
          displayTime: (time) => time,
          zoneOffsetLabel: () => "UTC+8",
        },
        "@/constants/theme": scheduleEditorTheme,
        "@/lib/device-access": { useDeviceAccess: () => uiAccess },
        "@/lib/device-access-state": {
          sameDeviceRequestScope: (a, b) =>
            JSON.stringify(a) === JSON.stringify(b),
        },
        "@/lib/schedules": {
          readConfiguration: async () => editorConfiguration,
          loadPendingWrite: async () => null,
          newScheduleId: () => "fixture-schedule",
          validateSchedule: () => null,
          isConfirmedScheduleRejection: () => true,
          saveConfiguration: (...args) => {
            editorWrites.push(args);
            return new Promise((_resolve, reject) => {
              rejectEditorSave = reject;
            });
          },
        },
      })[name] ?? {},
  },
);
const editorUi = uiHarness(() => editorExports.ScheduleEditor({}));
editorUi.render();
await uiFlush();
editorUi.render();
let editorView = editorUi.render();
uiNodes(editorView, "TextField")[0].props.onChangeText("25");
editorView = editorUi.render();
const saveFromSameFrame = uiNodes(editorView, "Button").find(
  (node) => node.props.children === "Add schedule",
).props.onPress;
saveFromSameFrame();
saveFromSameFrame();
assert.equal(
  editorWrites.length,
  1,
  "same-frame schedule saves submit once before rendering busy state",
);
rejectEditorSave(new Error("Fixture rejection"));
await uiFlush();
editorView = editorUi.render();
assert.equal(
  uiNodes(editorView, "TextField")[0].props.value,
  "25",
  "failed schedule saves preserve the entered dose",
);
assert.equal(editorWrites[0][3].schedules[0].targets[0].dose.amount_g, 25);
assert.ok(
  uiNodes(editorView, "KeyValue").some(
    (node) =>
      node.props.label === "Feeder" && node.props.value === "Fixture feeder",
  ),
  "schedule form identifies its target feeder",
);

uiDevice.capabilities.nozzles["1"] = {
  ...uiCapability,
  doseModes: ["fixed_portion"],
  fixedPortionIds: ["fixture-portion"],
};
const fixedEditorUi = uiHarness(() => editorExports.ScheduleEditor({}));
fixedEditorUi.render();
await uiFlush();
fixedEditorUi.render();
const fixedEditorView = fixedEditorUi.render();
assert.equal(
  uiNodes(fixedEditorView, "TextField").length,
  0,
  "fixed-only schedules never offer unsupported gram input",
);
assert.equal(
  uiNodes(fixedEditorView, "Chip").find(
    (node) => node.props.label === "fixture-portion",
  ).props.selected,
  true,
);
uiDevice.capabilities.nozzles["1"] = uiCapability;

const scheduleUiSource = await readFile(
  new URL("../src/app/(tabs)/schedule.tsx", import.meta.url),
  "utf8",
);
const scheduleUiExports = {};
let toggleWrites = [];
let releaseToggle;
const scheduleUiConfiguration = {
  ...editorConfiguration,
  applied_snapshot: {
    ...editorConfiguration.applied_snapshot,
    schedules: [
      {
        schedule_id: "fixture-schedule",
        local_time: "08:00",
        weekdays: [1, 3],
        enabled: true,
        targets: [{ nozzle_number: 1, dose: { mode: "grams", amount_g: 25 } }],
      },
    ],
  },
};
vm.runInNewContext(
  ts.transpile(scheduleUiSource, {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  }),
  {
    exports: scheduleUiExports,
    require: (name) =>
      ({
        react: uiReact,
        "react/jsx-runtime": {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        },
        "react-native": {
          StyleSheet: { create: (styles) => styles },
          Text: "Text",
          View: "View",
        },
        "expo-router": {
          router: {},
          useFocusEffect: (fn) => uiReact.useEffect(fn, [fn]),
        },
        "@/components/app-shell": {
          ...uiKit,
          AppPage: "AppPage",
          Toggle: "Toggle",
          IconButton: "IconButton",
        },
        "@/components/feed-status": { displayTime: (time) => time },
        "@/constants/theme": { Colors: { light: {} }, Typography: {} },
        "@/lib/device-access": { useDeviceAccess: () => uiAccess },
        "@/lib/device-access-state": {
          sameDeviceRequestScope: (a, b) =>
            JSON.stringify(a) === JSON.stringify(b),
        },
        "@/lib/device-changes": { subscribeDeviceChanges: () => () => {} },
        "@/lib/error-text": { errorText: (error) => error.message },
        "@/lib/schedules": {
          readConfiguration: async () => scheduleUiConfiguration,
          readNextOccurrence: async () => ({ occurrence: null }),
          loadPendingWrite: async () => null,
          saveConfiguration: (...args) => {
            toggleWrites.push(args);
            return new Promise((resolve) => {
              releaseToggle = resolve;
            });
          },
        },
      })[name] ?? {},
  },
);
const scheduleUi = uiHarness(() => scheduleUiExports.default());
scheduleUi.render();
await uiFlush();
let scheduleUiView = scheduleUi.render();
const toggleFromSameFrame = uiNodes(scheduleUiView, "Toggle")[0].props
  .onValueChange;
const menuButton = uiNodes(scheduleUiView, "IconButton")[0];
menuButton.props.onPress();
assert.equal(
  toggleWrites.length,
  0,
  "opening schedule menu never toggles or saves",
);
toggleFromSameFrame();
toggleFromSameFrame();
assert.equal(
  toggleWrites.length,
  1,
  "same-frame schedule toggles send one requested revision",
);
assert.equal(toggleWrites[0][3].schedules[0].enabled, false);
assert.equal(
  uiNodes(scheduleUi.render(), "Toggle")[0].props.value,
  true,
  "pending toggle preserves actual applied enabled state",
);
releaseToggle();
await uiFlush();

console.log(
  "Manual feed recovery, concurrent submission, maintenance and refusal handling, device/session isolation, null measurement, history filters, read-only details and Task 04 confirmation/editor/schedule UI regressions passed.",
);
