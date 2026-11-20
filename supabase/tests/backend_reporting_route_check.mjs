// Real handlers; only authenticated network/RPC boundary substituted. No SQL/network.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
const device = "22222222-2222-4222-8222-222222222222",
  installation = "70707070-7070-4070-8070-707070707070",
  id = "70707070-7070-4070-8070-707070707071";
const values = {
  timezone: "Asia/Manila",
  monitoring_limits: { do_low_mg_l: null, do_high_mg_l: null },
  low_feed_threshold_pct: null,
  schedules: [],
  oxygen_report_interval_seconds: 30,
};
const state = {
  desired_revision: 1,
  applied_revision: null,
  last_attempt_revision: 1,
  last_attempt_status: "pending",
  error_code: null,
};
let app,
  sync,
  calls = [],
  status = "ok",
  broken = false,
  transformMetric = (value) => value;
const client = {
  auth: {
    async getUser() {
      return {
        data: { user: { id: installation, is_anonymous: true } },
        error: null,
      };
    },
  },
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              async single() {
                return {
                  data: {
                    capabilities_revision: 1,
                    capabilities: { independent_telemetry_v1: true },
                  },
                  error: null,
                };
              },
            };
          },
        };
      },
    };
  },
  async rpc(name, args) {
    calls.push({ name, args });
    if (name === "art38_take_rate_limit") return { data: true, error: null };
    if (name === "backend_metric_snapshot")
      return {
        data: transformMetric({
          status,
          request_id: args.p_request_id,
          device_id: device,
          server_time: "2026-11-13T01:00:00Z",
          contact: { last_seen_at: null, online: false },
          configuration: {
            request_id: args.p_request_id,
            receipt: null,
            request_status: null,
            request_error_code: null,
            current_state: state,
            desired_snapshot: { ...values, revision: 1, based_on_revision: 0 },
            applied_snapshot: null,
          },
          resources: {
            do: {
              latest: null,
              time_basis: "unknown",
              age_seconds: null,
              quality: broken ? "valid" : "unavailable",
            },
            feed: {
              latest: null,
              time_basis: "unknown",
              age_seconds: null,
              quality: "unavailable",
            },
          },
          revisions: {
            do: 0,
            feed: 0,
            history: 0,
            configuration: 0,
            feeding: 0,
            contact: 0,
            alerts: 0,
          },
        }),
        error: null,
      };
    if (name === "art33_read_configuration") {
      const legacyValues = { ...values };
      delete legacyValues.oxygen_report_interval_seconds;
      return {
        data: {
          status,
          receipt: null,
          request_status: null,
          request_error_code: null,
          current_state: state,
          desired_snapshot: {
            ...legacyValues,
            revision: 1,
            based_on_revision: 0,
          },
          applied_snapshot: null,
        },
        error: null,
      };
    }
    if (name === "art33_write_configuration")
      return {
        data:
          status === "ok"
            ? {
                status,
                receipt: {
                  revision: 1,
                  based_on_revision: 0,
                  snapshot: args.p_snapshot,
                },
                current_state: state,
              }
            : { status },
        error: null,
      };
    if (name === "art38_authenticate_device")
      return { data: device, error: null };
    if (name === "backend_sync_device") {
      const e = args.p_sync.metric_telemetry;
      return {
        data: {
          status: "ok",
          server_time: "2026-11-13T01:00:03Z",
          acknowledged_metrics: [
            ...Object.values(e.live).filter(Boolean),
            ...e.backlog,
          ].map(({ metric, boot_id, sequence }) => ({
            metric,
            boot_id,
            sequence,
          })),
          acknowledged_samples: [],
          acknowledged_events: [],
          desired_configuration: {
            ...values,
            revision: 1,
            based_on_revision: 0,
          },
          command: null,
          next_sync_after_ms: 30000,
        },
        error: null,
      };
    }
    assert.fail("unexpected RPC " + name);
  },
};
globalThis.__reportingClient = client;
globalThis.Deno = {
  env: { get: () => "offline-placeholder" },
  serve(fn) {
    app = fn;
  },
};
registerHooks({
  resolve(s, c, n) {
    if (s.startsWith("npm:@supabase/supabase-js@"))
      return { url: "offline:reporting-client", shortCircuit: true };
    return n(s, c);
  },
  load(u, c, n) {
    if (u === "offline:reporting-client")
      return {
        format: "module",
        shortCircuit: true,
        source: "export const createClient=()=>globalThis.__reportingClient;",
      };
    return n(u, c);
  },
});
await import("../functions/app-api/index.ts");
async function invoke(
  path,
  method = "GET",
  body,
  version = "2.8.0",
  expected = 200,
) {
  calls = [];
  const r = await app(
    new Request(
      `https://offline.invalid/app-api/v2/devices/${device}/${path}`,
      {
        method,
        headers: {
          authorization: "Bearer sanitized",
          "Content-Type": "application/json",
          "X-Protocol-Major": "2",
          "X-Request-Id": id,
          ...(version ? { "X-Contract-Version": version } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    ),
  );
  const value = await r.json();
  assert.equal(r.status, expected, JSON.stringify(value));
  return value;
}
await invoke("monitoring/metrics");
assert.equal(calls[0].name, "backend_metric_snapshot");
assert.equal(calls[0].args.p_installation_id, installation);
await invoke("monitoring/metrics", "GET", undefined, null, 422);
await invoke("monitoring/metrics", "GET", undefined, "2.9.0", 422);
await invoke("configuration", "GET", undefined, "2.9.0", 422);
assert.equal(
  calls.length,
  0,
  "unknown contract is refused before protected config RPC",
);
broken = true;
await invoke("monitoring/metrics", "GET", undefined, "2.8.0", 503);
broken = false;
transformMetric = (value) => ({
  ...value,
  contact: { last_seen_at: "2026-11-14T01:00:00Z", online: true },
});
await invoke("monitoring/metrics", "GET", undefined, "2.8.0", 503);
const metricFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/fixtures/examples/v2/metric-280-snapshot-valid.json",
      import.meta.url,
    ),
  ),
);
transformMetric = (value) => ({
  ...metricFixture,
  status: value.status,
  request_id: value.request_id,
  device_id: device,
});
await invoke("monitoring/metrics");
for (const mutate of [
  (value) => {
    value.resources.do.latest.received_at = "2026-11-14T01:00:00Z";
  },
  (value) => {
    value.resources.do.age_seconds = 0;
  },
  (value) => {
    value.configuration.desired_snapshot.unexpected = true;
  },
]) {
  transformMetric = (value) => {
    const next = {
      ...structuredClone(metricFixture),
      status: value.status,
      request_id: value.request_id,
      device_id: device,
    };
    mutate(next);
    return next;
  };
  await invoke("monitoring/metrics", "GET", undefined, "2.8.0", 503);
}
transformMetric = (value) => value;
const projected = await invoke("configuration");
assert.equal(
  projected.desired_snapshot.oxygen_report_interval_seconds,
  null,
  "new app projects absent stored key to nullable DTO",
);
const legacyRead = await invoke("configuration", "GET", undefined, null);
assert.equal(
  Object.hasOwn(legacyRead.desired_snapshot, "oxygen_report_interval_seconds"),
  false,
  "legacy DTO stays unchanged",
);
status = "not_active";
await invoke("monitoring/metrics", "GET", undefined, "2.8.0", 403);
status = "unsupported";
await invoke("monitoring/metrics", "GET", undefined, "2.8.0", 422);
status = "ok";
const write = {
  protocol_major: 2,
  request_id: id,
  based_on_revision: 0,
  snapshot: values,
};
for (const interval of [null, 15, 30, 60, 3600, 7200, 14400, 28800]) {
  await invoke(
    "configuration",
    "PUT",
    {
      ...write,
      snapshot: { ...values, oxygen_report_interval_seconds: interval },
    },
    "2.8.0",
    202,
  );
  assert.equal(
    calls.at(-1).args.p_snapshot.oxygen_report_interval_seconds,
    interval,
  );
}
for (const bad of [0, 14, 31, -1, "30", false])
  await invoke(
    "configuration",
    "PUT",
    { ...write, snapshot: { ...values, oxygen_report_interval_seconds: bad } },
    "2.8.0",
    422,
  );
await invoke("configuration", "PUT", write, null, 409);
status = "upgrade_required";
const old = { ...values };
delete old.oxygen_report_interval_seconds;
await invoke("configuration", "PUT", { ...write, snapshot: old }, null, 409);
status = "ok";
// Device report carries exact applied interval into the service-only negotiated RPC.
globalThis.Deno.serve = (fn) => {
  sync = fn;
};
await import("../functions/device-api/index.ts");
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../contracts/fixtures/examples/v2/metric-280-sync-valid.json",
      import.meta.url,
    ),
  ),
);
for (const interval of [null, 15, 30, 60, 3600, 7200, 14400, 28800]) {
  calls = [];
  const r = await sync(
    new Request("https://offline.invalid/device-api/v2/sync", {
      method: "POST",
      headers: {
        authorization: "Bearer sanitized",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...fixture,
        configuration: {
          ...fixture.configuration,
          oxygen_report_interval_seconds: interval,
        },
      }),
    }),
  );
  const reply = await r.json();
  assert.equal(r.status, 200, JSON.stringify(reply));
  assert.equal(
    calls.find((c) => c.name === "backend_sync_device").args.p_sync
      .configuration.oxygen_report_interval_seconds,
    interval,
  );
  assert.equal(reply.next_sync_after_ms, 30000);
}
console.log(
  "PASS reporting real-handler negotiation, config allowlist/upgrade fence, metric snapshot validation/access and exact report forwarding; offline only",
);
