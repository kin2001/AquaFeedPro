import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
const device = "11111111-1111-4111-8111-111111111111";
let reply,
  calls = [];
globalThis.__historyRead = async (...args) => {
  calls.push(args);
  return { ...reply, request_id: args[4]["X-Request-Id"] };
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "expo-secure-store")
      return { url: "offline:secure", shortCircuit: true };
    if (
      (context.parentURL?.endsWith("/monitoring.ts") ||
        context.parentURL?.endsWith("/manual-feed.ts")) &&
      specifier === "./device-access"
    )
      return { url: "offline:access", shortCircuit: true };
    if (
      context.parentURL?.endsWith("/monitoring.ts") &&
      specifier === "./monitoring-time"
    )
      return next("../src/lib/monitoring-time.ts", {
        ...context,
        parentURL: import.meta.url,
      });
    if (
      context.parentURL?.endsWith("/monitoring.ts") &&
      specifier === "./device-access-state"
    )
      return next("../src/lib/device-access-state.ts", {
        ...context,
        parentURL: import.meta.url,
      });
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "offline:secure")
      return {
        format: "module",
        source: "export const getItemAsync = async () => null;",
        shortCircuit: true,
      };
    if (url === "offline:access")
      return {
        format: "module",
        source:
          "export const requestAppApi = (...args) => globalThis.__historyRead(...args)",
        shortCircuit: true,
      };
    return next(url, context);
  },
});
const monitoring = await import("../src/lib/monitoring.ts");
assert.equal(
  typeof monitoring.readMetricHistory,
  "function",
  "runtime-validated metric history reader exists",
);
const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../contracts/fixtures/examples/v2/${name}.json`,
        import.meta.url,
      ),
    ),
  );
reply = fixture("metric-280-history-valid");
const page = await monitoring.readMetricHistory("installation", device, {
  date: "2026-11-13",
  metric: "all",
  time: "known",
});
assert.equal(page.observations.length, 2);
assert.equal(calls.at(-1)[4]["X-Contract-Version"], "2.8.0");
for (const name of [
  "metric-280-review-read-identity-invalid",
  "metric-280-review-read-time-mismatch-invalid",
  "metric-280-review-read-measured-null-invalid",
  "metric-280-review-read-captured-null-invalid",
]) {
  const value = fixture(name);
  assert.equal(monitoring.parseMetricReading(value), null, name);
}
for (const bad of [
  { ...reply, device_id: "22222222-2222-4222-8222-222222222222" },
  { ...reply, date: "2026-11-12" },
  { ...reply, observations: Array(51).fill(reply.observations[0]) },
  {
    ...reply,
    observations: [
      { ...reply.observations[0], observed_at: "2026-11-13T01:00:00+00:00" },
    ],
  },
  { ...reply, time: "unknown" },
]) {
  reply = bad;
  await assert.rejects(() =>
    monitoring.readMetricHistory("installation", device, {
      date: "2026-11-13",
      metric: "all",
      time: "known",
    }),
  );
}
reply = fixture("metric-280-graph-valid");
const graph = await monitoring.readDoGraph("installation", device, "1h");
assert.equal(
  calls.at(-1)[4]["X-Contract-Version"],
  "2.8.0",
  "actual Home reader negotiates new graph",
);
assert.equal(
  graph.samples[0].do_mg_l,
  5.8,
  "normalized new-only point reaches existing chart data",
);
assert.equal(
  graph.samples[0].source_identity,
  "metric:do:11111111-1111-4111-8111-111111111111:100",
);
assert.equal(graph.samples[0].time_basis, "measured");
reply = {
  ...reply,
  samples: [
    {
      ...reply.samples[0],
      observation: {
        ...reply.samples[0].observation,
        observation: {
          ...reply.samples[0].observation.observation,
          quality: "error",
          do_mg_l: null,
        },
      },
    },
  ],
};
assert.equal(
  (await monitoring.readDoGraph("installation", device, "1h")).samples[0]
    .gap_reason,
  "error",
);
const manual = await import("../src/lib/manual-feed.ts");
reply = fixture("metric-280-feed-history-valid");
await manual.readHistoryPage("installation", device, {
  source: "all",
  status: "all",
});
assert.equal(
  calls.at(-1)[4]["X-Contract-Version"],
  "2.8.0",
  "existing history reader negotiates chronology",
);
for (const patch of [
  { occurred_at: "2026-11-13T01:00:02Z", time_basis: "unknown" },
  { received_at: null },
  { occurred_at: null, time_basis: "measured" },
]) {
  reply = fixture("metric-280-feed-history-valid");
  reply.records = [{ ...reply.records[0], ...patch }];
  await assert.rejects(() =>
    manual.readHistoryPage("installation", device, {
      source: "all",
      status: "all",
    }),
  );
}
console.log(
  "PASS mobile history runtime/cross-binding and actual Home graph reader with new-only observations (offline API; not native evidence)",
);
