import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID, webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const requireContracts = createRequire(
  new URL("../../contracts/package.json", import.meta.url),
);
const Ajv = requireContracts("ajv/dist/2020.js").default;
const addFormats = requireContracts("ajv-formats").default;
const schema = JSON.parse(
  await readFile(
    new URL("../../contracts/schemas/v2.schema.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv({ strict: false });
addFormats(ajv);
ajv.addSchema(schema, "v2");
const validateManualFeed = ajv.getSchema("v2#/$defs/ManualFeedRequest");

const deviceId = "11111111-1111-4111-8111-111111111111";
const installationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestIds = [
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "77777777-7777-4777-8777-777777777777",
];
const key = "66666666-6666-4666-8666-666666666666";
const feedCalls = [];
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
const record = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const shared = {
  admin: {
    async rpc(_name, args) {
      feedCalls.push(JSON.parse(JSON.stringify(args)));
      const command = {
        command_id: key,
        sequence_id: key,
        device_id: args.p_device_id,
        request_id: args.p_request_id,
        idempotency_key: args.p_idempotency_key,
        targets: args.p_targets,
        status: "queued",
        created_at: "2026-10-09T00:00:00Z",
        start_before: "2026-10-09T00:01:00Z",
      };
      return { data: { status: "created", command }, error: null };
    },
  },
  apiError: (_requestId, status, code) =>
    Response.json({ error: { code } }, { status }),
  installationId: async () => installationId,
  isUuid: uuid,
  json: (value, status = 200) => Response.json(value, { status }),
  normalizeUtcTimestamp: (value) =>
    typeof value === "string" && Number.isFinite(Date.parse(value))
      ? value
      : null,
  protocolMajor: (value) => value?.protocol_major === 2,
  readJson: async (request) => ({
    value: await request.json(),
    response: null,
  }),
  record,
  requestIdFrom: (value) =>
    uuid(value?.request_id) ? value.request_id : randomUUID(),
  takeRateLimit: async () => true,
};

function load(source, name, suffix = "") {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  let handler;
  const context = {
    module,
    exports: module.exports,
    require: () => shared,
    Deno: { serve: (value) => (handler = value) },
    crypto: { randomUUID, subtle: webcrypto.subtle },
    Request,
    Response,
    URL,
    URLSearchParams,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    atob,
    btoa,
  };
  vm.runInNewContext(`${compiled}\n${suffix}`, context, { filename: name });
  return { handler, context };
}

const base = {
  protocol_major: 2,
  request_id: requestIds[0],
  device_id: deviceId,
  idempotency_key: key,
  capabilities_revision: 1,
  targets: [
    { nozzle_number: 1, dose: { mode: "grams", amount_g: 50 } },
    {
      nozzle_number: 2,
      dose: { mode: "fixed_portion", fixed_portion_id: "portion_small" },
    },
  ],
};
const additive = {
  ...base,
  request_id: requestIds[1],
  tracking_hint: "ignored",
  targets: base.targets.map((target) => ({
    ...target,
    trace_id: "ignored",
    dose: { ...target.dose, label: "ignored" },
  })),
};
assert.equal(validateManualFeed(base), true);
assert.equal(validateManualFeed(additive), true);

const source = await readFile(
  new URL("../../supabase/functions/app-api/index.ts", import.meta.url),
  "utf8",
);
const { handler } = load(source, "app-api/index.ts");
const url = `https://fixture.invalid/functions/v1/app-api/v2/devices/${deviceId}/feed`;
const post = (body) =>
  handler(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
assert.equal((await post(base)).status, 202);
assert.equal((await post(additive)).status, 202);
assert.deepEqual(feedCalls[0].p_targets, feedCalls[1].p_targets);
assert.equal("trace_id" in feedCalls[1].p_targets[0], false);
assert.equal("label" in feedCalls[1].p_targets[1].dose, false);

const changedDose = {
  ...additive,
  request_id: requestIds[2],
  targets: [
    { ...additive.targets[0], dose: { mode: "grams", amount_g: 51 } },
    additive.targets[1],
  ],
};
assert.equal(validateManualFeed(changedDose), true);
assert.equal((await post(changedDose)).status, 202);
assert.notDeepEqual(feedCalls[0].p_targets, feedCalls[2].p_targets);
assert.equal(feedCalls[2].p_targets[0].dose.amount_g, 51);

const missingRequired = { ...base, request_id: requestIds[3] };
delete missingRequired.capabilities_revision;
assert.equal(validateManualFeed(missingRequired), false);
const callsBeforeInvalid = feedCalls.length;
const rejected = await post(missingRequired);
assert.equal(rejected.status, 422);
assert.equal(feedCalls.length, callsBeforeInvalid);

const deviceSource = await readFile(
  new URL("../../supabase/functions/device-api/index.ts", import.meta.url),
  "utf8",
);
const deviceModule = load(
  deviceSource,
  "device-api/index.ts",
  "globalThis.parser = { validDeviceSync, normalizedRunEvent };",
);
const event = {
  sequence_id: key,
  event_sequence: 1,
  event_type: "queued",
  outcome_status: "queued",
  source: "manual",
  device_at: "2026-10-09T00:00:00Z",
  time_quality: "synced",
  command_id: key,
  schedule_id: null,
  configuration_revision: null,
  occurrence_local_date: null,
  requested_dose: { mode: "grams", amount_g: 20, label: "ignored" },
  estimated_dispensed_g: null,
  measured_dispensed_g: null,
  measurement_quality: "unavailable",
  reason_code: null,
  maintenance_resolution: null,
  lockout_cleared: false,
  nozzle_number: 1,
  step_index: 1,
  tracking_hint: "ignored",
};
const sync = {
  protocol_major: 2,
  request_id: requestIds[0],
  boot_id: requestIds[1],
  live_sequence: 1,
  firmware_version: "test",
  capabilities_revision: 1,
  clock: { quality: "synced", uncertainty_ms: 0, tracking_hint: "ignored" },
  actuator: {
    state: "idle",
    active_sequence_id: null,
    fault_code: null,
    tracking_hint: "ignored",
  },
  configuration: {
    applied_revision: null,
    last_attempt_revision: null,
    last_attempt_status: null,
    error_code: null,
    tracking_hint: "ignored",
  },
  latest_sample: null,
  backlog_samples: [],
  events: [event],
  tracking_hint: "ignored",
};
assert.equal(deviceModule.context.parser.validDeviceSync(sync), true);
const normalized = deviceModule.context.parser.normalizedRunEvent(event);
assert.equal("tracking_hint" in normalized, false);
assert.equal("label" in normalized.requested_dose, false);
assert.equal(
  deviceModule.context.parser.validDeviceSync({
    ...sync,
    events: [{ ...event, event_sequence: 0 }],
  }),
  false,
);

console.log(
  "Published-schema, app/device additive-field normalization, replay identity and malformed-field checks passed.",
);
