import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { historyUtc } from "../functions/_shared/history.ts";
assert.equal(historyUtc("2026-11-13T06:00:00.123456+08:00"), "2026-11-12T22:00:00.123456Z");
assert.equal(historyUtc("2026-11-13 06:00:00+00"), "2026-11-13T06:00:00Z");
assert.equal(historyUtc("2026-02-29T00:00:00Z"), null);
const device = "22222222-2222-4222-8222-222222222222";
const installation = "65656565-6565-4565-8565-656565656565";
const requestId = "65656565-6565-4565-8565-656565656566";
const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/examples/v2/metric-280-history-valid.json", import.meta.url)));
let handler, calls = [], revoked = false, broken = false, rpcFailure = false;
const client = {
  auth: { async getUser() { return { data: { user: { id: installation, is_anonymous: true } }, error: null }; } },
  async rpc(name, args) {
    calls.push({ name, args });
    if (rpcFailure) return { data: null, error: { code: "XX000" } };
    if (revoked) return { data: { status: "not_active" }, error: null };
    if (name === "backend_metric_history") return { data: { ...fixture, request_id: undefined, status: "ok", device_id: device, date: args.p_date, metric: args.p_metric, time: args.p_time_mode, observations: broken ? [{ ...fixture.observations[0], stable_identity: "metric:feed:bad:1" }] : args.p_time_mode === "unknown" ? [] : fixture.observations, next: args.p_time_mode === "unknown" ? null : { time: "2026-11-13T06:00:00+00:00", identity: fixture.observations[0].stable_identity } }, error: null };
    if (name === "backend_metric_do_graph") {
      const graph = JSON.parse(readFileSync(new URL("../../contracts/fixtures/examples/v2/metric-280-graph-valid.json", import.meta.url)));
      return { data: { ...graph, status: "ok", request_id: requestId, device_id: device }, error: null };
    }
    if (name === "art27_do_graph") return { data: { status: "not_found" }, error: null };
    if (name === "backend_history_detail" || name === "art31_history_detail") return { data: { status: "not_found" }, error: null };
    assert.fail(`unexpected RPC ${name}`);
  },
};
globalThis.__historyClient = client;
globalThis.Deno = { env: { get: () => "offline-placeholder" }, serve(value) { handler = value; } };
registerHooks({ resolve(specifier, context, next) { if (specifier.startsWith("npm:@supabase/supabase-js@")) return { url: "offline:history-client", shortCircuit: true }; return next(specifier, context); }, load(url, context, next) { if (url === "offline:history-client") return { format: "module", shortCircuit: true, source: "export const createClient = () => globalThis.__historyClient;" }; return next(url, context); } });
await import("../functions/app-api/index.ts");
async function invoke(path, expected = 200, negotiated = true) {
  calls = [];
  const response = await handler(new Request(`https://offline.invalid/app-api/v2/devices/${device}/${path}`, { headers: { authorization: "Bearer sanitized", "X-Protocol-Major": "2", "X-Request-Id": requestId, ...(negotiated ? { "X-Contract-Version": "2.8.0" } : {}) } }));
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}
const page = await invoke("monitoring/readings?date=2026-11-13&metric=all");
assert.equal(page.request_id, requestId);
assert.ok(page.next_cursor);
assert.equal(calls[0].args.p_installation_id, installation);
await invoke(`monitoring/readings?date=2026-11-13&metric=all&cursor=${page.next_cursor}`);
for (const query of ["date=2026-02-29", "date=2026-11-13&date=2026-11-12", "time=unknown&date=2026-11-13", "date=2026-11-13&metric=bad", "date=2026-11-13&extra=1", "date=2026-11-13&cursor=bad", `date=2026-11-12&cursor=${page.next_cursor}`, `date=2026-11-13&metric=do&cursor=${page.next_cursor}`, `time=unknown&cursor=${page.next_cursor}`]) await invoke(`monitoring/readings?${query}`, 400);
await invoke("monitoring/readings?date=2026-11-13", 422, false);
assert.equal((await invoke("monitoring/readings?time=unknown")).date, null);
const otherResponse = await handler(new Request(`https://offline.invalid/app-api/v2/devices/33333333-3333-4333-8333-333333333333/monitoring/readings?date=2026-11-13&metric=all&cursor=${page.next_cursor}`, { headers: { authorization: "Bearer sanitized", "X-Protocol-Major": "2", "X-Request-Id": requestId, "X-Contract-Version": "2.8.0" } }));
assert.equal(otherResponse.status, 400, "cursor cannot cross device");
await invoke("monitoring/do?window=1h");
assert.equal(calls[0].name, "backend_metric_do_graph");
await invoke("monitoring/do?window=1h", 404, false);
assert.equal(calls[0].name, "art27_do_graph");
await invoke(`history/${requestId}`, 404);
assert.equal(calls[0].name, "backend_history_detail");
await invoke(`history/${requestId}`, 404, false);
assert.equal(calls[0].name, "art31_history_detail");
broken = true;
await invoke("monitoring/readings?date=2026-11-13", 503);
broken = false;
rpcFailure = true;
await invoke("monitoring/do?window=1h", 503);
assert.equal(calls.length, 1, "no transient fallback hiding new readings");
rpcFailure = false;
revoked = true;
for (const path of ["monitoring/readings?date=2026-11-13", "monitoring/readings?time=unknown", "monitoring/do", `history/${requestId}`]) await invoke(path, 403);
console.log("PASS actual history handler negotiation, validation, cursor binding, revocation mapping, graph path and no transient fallback (offline client; not SQL evidence)");
