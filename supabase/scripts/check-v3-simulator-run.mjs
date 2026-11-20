// Offline only. The Python simulator sends into an in-memory recorder, and
// the actual Edge handler receives those bytes with a substituted RPC client.
// The RPC outcomes are fixtures. Database acceptance needs seeded device and
// schedule state, SQL rollback checks, and an observer for the private hints.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const cases = new Map([
  ["valid", { status: 200, interval: 30 }],
  [
    "config-invalid",
    {
      status: 503,
      interval: 60,
      sqlstate: "P8C02",
      message: "The device configuration could not be safely acknowledged.",
    },
  ],
  [
    "bad-scheduled",
    {
      status: 503,
      interval: 30,
      sqlstate: "P8D01",
      source: "scheduled",
      reason: "\ud800",
      message: "Scheduled feeding history could not be safely recorded.",
    },
  ],
  [
    "bad-manual",
    {
      status: 503,
      interval: 30,
      sqlstate: "P8D02",
      source: "manual",
      reason: "\u0000",
      message: "Device sync could not be safely recorded.",
    },
  ],
  [
    "unicode-fish",
    {
      status: 200,
      interval: 30,
      source: "scheduled",
      reason: "🐟 e\u0301",
    },
  ],
]);

const python = String.raw`
import datetime as dt
import json
import sys
import uuid
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from art31_simulator import DeviceApi, Simulator, format_time, metric_sync_payload

DEVICE = "22222222-2222-4222-8222-222222222222"

class Capture:
    def request(self, method, path, body, headers):
        self.sent = dict(method=method, path=path, body=body.decode("ascii"), headers=headers)

    def getresponse(self):
        return self

    def read(self, size=-1):
        return b"{}"

    status = 200

def scheduled_or_manual_event(source, reason, instant):
    sequence = str(uuid.uuid4())
    scheduled = source == "scheduled"
    return {
        "sequence_id": sequence, "event_sequence": 1,
        "event_type": "accepted", "outcome_status": "accepted", "source": source,
        "device_at": format_time(instant), "time_quality": "rtc",
        "command_id": None if scheduled else sequence,
        "schedule_id": str(uuid.uuid4()) if scheduled else None,
        "configuration_revision": 1 if scheduled else None,
        "occurrence_local_date": instant.date().isoformat() if scheduled else None,
        "requested_dose": {"mode": "grams", "amount_g": 12},
        "estimated_dispensed_g": None, "measured_dispensed_g": None,
        "measurement_quality": "unavailable", "reason_code": reason,
        "maintenance_resolution": None, "lockout_cleared": False,
        "nozzle_number": 1, "step_index": 1,
    }

def capture(mode, directory):
    instant = dt.datetime.now(dt.timezone.utc)
    with closing(Simulator(Path(directory) / (mode + ".sqlite3"), DEVICE)) as engine:
        configuration = {
            "revision": 1, "based_on_revision": 0, "timezone": "UTC",
            "monitoring_limits": {"do_low_mg_l": 3, "do_high_mg_l": 10},
            "low_feed_threshold_pct": 25, "schedules": [],
            "oxygen_report_interval_seconds": 30,
        }
        assert engine.apply_configuration(configuration)["last_attempt_status"] == "applied"
        interval = 60 if mode == "config-invalid" else engine.applied_reporting_interval()
        body = metric_sync_payload(engine.sync_payload(sample_time=instant), interval)
    if mode == "bad-scheduled":
        body["events"] = [scheduled_or_manual_event("scheduled", "\ud800", instant)]
    elif mode == "bad-manual":
        body["events"] = [scheduled_or_manual_event("manual", "\x00", instant)]
    elif mode == "unicode-fish":
        body["events"] = [scheduled_or_manual_event("scheduled", "\U0001f41f e\u0301", instant)]

    api = DeviceApi("http://127.0.0.1", "offline-publishable", "A" * 43)
    api.sync_connection = recorder = Capture()
    api._post(False, body)
    return recorder.sent

with (
    TemporaryDirectory(prefix="aquafeed-v3-matrix-") as directory,
    patch("http.client.HTTPConnection", side_effect=AssertionError("offline matrix forbids HTTP")),
    patch("http.client.HTTPSConnection", side_effect=AssertionError("offline matrix forbids HTTPS")),
):
    print(json.dumps({mode: capture(mode, directory) for mode in sys.argv[1:]}))
`;

const captured = JSON.parse(
  execFileSync("python", ["-B", "-c", python, ...cases.keys()], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    encoding: "utf8",
  }),
);
const device = "22222222-2222-4222-8222-222222222222";
const verifier = createHash("sha256").update("A".repeat(43)).digest("hex");
const profile = {
  capabilities_revision: 5,
  capabilities: { independent_telemetry_v1: true, feed_capacity_g: 20000 },
};
const identityKeys = [
  "source",
  "sequence_id",
  "event_sequence",
  "schedule_id",
  "configuration_revision",
  "occurrence_local_date",
  "nozzle_number",
  "step_index",
];
const serverTime = "2026-11-20T00:00:00Z";
let rpcCalls;
let offeredResult;
let handler;
const fetch = globalThis.fetch;

try {
  globalThis.fetch = async () => assert.fail("offline matrix forbids fetch");
  globalThis.__v3MatrixClient = {
    from(table) {
      assert.equal(table, "devices");
      return {
        select(columns) {
          assert.equal(columns, "capabilities,capabilities_revision");
          return {
            eq(column, value) {
              assert.equal(column, "device_id");
              assert.equal(value, device);
              return {
                async single() {
                  return { data: profile, error: null };
                },
              };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "art38_authenticate_device")
        return { data: device, error: null };
      if (name === "backend_sync_device") return offeredResult;
      assert.fail("unexpected RPC: " + name);
    },
  };
  globalThis.Deno = {
    env: { get: () => "offline-placeholder" },
    serve(value) {
      handler = value;
    },
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith("npm:@supabase/supabase-js@")) {
        return { url: "offline:v3-matrix-client", shortCircuit: true };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url === "offline:v3-matrix-client") {
        return {
          format: "module",
          shortCircuit: true,
          source:
            "export const createClient = () => globalThis.__v3MatrixClient;",
        };
      }
      return next(url, context);
    },
  });
  try {
    await import("../functions/device-api/index.ts");
  } finally {
    hooks.deregister();
  }
  assert.equal(typeof handler, "function");

  const boots = new Set();
  const requests = new Set();
  for (const [mode, expect] of cases) {
    const sent = captured[mode];
    const body = JSON.parse(sent.body);
    assert.equal(sent.method, "POST");
    assert.equal(sent.path, "/functions/v1/device-api/v2/sync");
    assert.equal(sent.headers["X-Protocol-Major"], "2");
    assert.equal(sent.headers["X-Request-Id"], body.request_id);
    assert.equal(boots.has(body.boot_id), false);
    assert.equal(requests.has(body.request_id), false);
    boots.add(body.boot_id);
    requests.add(body.request_id);
    assert.equal(
      body.configuration.oxygen_report_interval_seconds,
      expect.interval,
    );

    const metricAcks = ["do", "feed"].map((metric) => {
      const live = body.metric_telemetry.live[metric];
      assert.equal(live.metric, metric);
      assert.equal(live.boot_id, body.boot_id);
      assert.equal(live.sequence, body.live_sequence);
      return { metric, boot_id: body.boot_id, sequence: body.live_sequence };
    });
    assert.deepEqual(body.metric_telemetry.backlog, []);
    const eventAcks = body.events.map(({ sequence_id, event_sequence }) => ({
      sequence_id,
      event_sequence,
    }));

    rpcCalls = [];
    offeredResult = expect.sqlstate
      ? { data: null, error: { code: expect.sqlstate } }
      : {
          error: null,
          data: {
            status: "ok",
            server_time: serverTime,
            command: null,
            acknowledged_metrics: metricAcks,
            acknowledged_samples: [],
            acknowledged_events: eventAcks,
            desired_configuration: null,
            next_sync_after_ms: 30_000,
          },
        };
    const response = await handler(
      new Request("https://offline.invalid" + sent.path, sent),
    );
    const result = await response.json();
    assert.equal(
      response.status,
      expect.status,
      mode + ": " + JSON.stringify(result),
    );
    assert.deepEqual(
      rpcCalls.map(({ name }) => name),
      ["art38_authenticate_device", "backend_sync_device"],
    );
    assert.deepEqual(rpcCalls[0].args, { p_verifier_hex: verifier });
    const { p_device_id, p_device_verifier_hex, p_sync } = rpcCalls[1].args;
    assert.equal(p_device_id, device);
    assert.equal(p_device_verifier_hex, verifier);
    assert.equal(p_sync.request_id, body.request_id);
    assert.equal(
      p_sync.configuration.oxygen_report_interval_seconds,
      expect.interval,
    );
    assert.deepEqual(p_sync.metric_telemetry, body.metric_telemetry);
    assert.equal(Object.hasOwn(p_sync, "events"), false);
    assert.equal(body.events.length, expect.source ? 1 : 0);
    const [event] = body.events;
    assert.deepEqual(
      p_sync.event_keys,
      event
        ? [Object.fromEntries(identityKeys.map((key) => [key, event[key]]))]
        : [],
    );
    for (const source of ["scheduled", "manual"]) {
      const batch = p_sync[source + "_events_json"];
      if (source !== expect.source) {
        assert.equal(batch, "[]");
      } else {
        assert.equal(event.source, source);
        assert.equal(event.reason_code, expect.reason);
        // The outer transport retains a string. The inner batch retains exact code units.
        assert.equal(JSON.parse(JSON.stringify({ batch })).batch, batch);
        assert.deepEqual(JSON.parse(batch), [event]);
      }
    }

    if (expect.sqlstate) {
      assert.deepEqual(result, {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: expect.message,
          request_id: body.request_id,
          retryable: true,
        },
      });
    } else {
      assert.equal(result.protocol_major, 2);
      assert.equal(result.request_id, body.request_id);
      assert.equal(Date.parse(result.server_time), Date.parse(serverTime));
      assert.deepEqual(result.acknowledged_events, eventAcks);
      assert.deepEqual(result.acknowledged_metrics, metricAcks);
      assert.deepEqual(result.acknowledged_samples, []);
    }
    console.log(
      "PASS " + mode + " (offline simulator HTTP bytes through Edge, fake RPC)",
    );
  }
} finally {
  globalThis.fetch = fetch;
  delete globalThis.__v3MatrixClient;
  delete globalThis.Deno;
}
