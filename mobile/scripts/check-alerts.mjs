import assert from "node:assert/strict";

import { alertLine, detectAlerts } from "../src/lib/alerts.ts";

const limits = { doLow: 4, doHigh: 9, feedLow: 20 };
const reading = (doMgL, feedPercent) => ({ doMgL, feedPercent });

// Limit not set: that kind is false and never raised, even from an active state.
assert.deepEqual(
  detectAlerts(
    reading(1, 1),
    { doLow: null, doHigh: null, feedLow: null },
    { do_low: true, do_high: true, feed_low: true },
  ),
  { state: { do_low: false, do_high: false, feed_low: false }, raised: [] },
);

// Value outside, previously inactive: raised.
assert.deepEqual(detectAlerts(reading(3.8, 18), limits, {}), {
  state: { do_low: true, do_high: false, feed_low: true },
  raised: ["do_low", "feed_low"],
});
assert.deepEqual(detectAlerts(reading(9.5, 50), limits, {}).raised, [
  "do_high",
]);

// Value outside, already active: stays active, not raised again.
assert.deepEqual(
  detectAlerts(reading(3.8, 18), limits, { do_low: true, feed_low: true }),
  { state: { do_low: true, do_high: false, feed_low: true }, raised: [] },
);

// Value null (unknown, stale, invalid): keeps an active alert active and raises nothing.
assert.deepEqual(
  detectAlerts(reading(null, null), limits, { do_low: true, feed_low: true }),
  { state: { do_low: true, do_high: false, feed_low: true }, raised: [] },
);
// Value null never raises from an inactive state either.
assert.deepEqual(detectAlerts(reading(null, null), limits, {}), {
  state: { do_low: false, do_high: false, feed_low: false },
  raised: [],
});

// Value back inside: cleared, so the next crossing raises again.
const cleared = detectAlerts(reading(6, 60), limits, {
  do_low: true,
  feed_low: true,
});
assert.deepEqual(cleared, {
  state: { do_low: false, do_high: false, feed_low: false },
  raised: [],
});
assert.deepEqual(detectAlerts(reading(3, 10), limits, cleared.state).raised, [
  "do_low",
  "feed_low",
]);

// Equal to the limit is inside, for every kind.
assert.deepEqual(detectAlerts(reading(4, 20), limits, {}).raised, []);
assert.deepEqual(detectAlerts(reading(9, 20), limits, {}).raised, []);

const entry = (kind, value, limit, simulated) => ({
  id: "1",
  deviceId: "d",
  deviceName: "Device 1",
  kind,
  value,
  limit,
  simulated,
  at: "2026-10-14T00:00:00Z",
  read: false,
});
assert.equal(
  alertLine(entry("do_low", 3.8, 4, false)),
  "3.8 mg/L · limit 4 · Device 1",
);
assert.equal(
  alertLine(entry("feed_low", 18, 20, true)),
  "18% · alert below 20% · Device 1 · Simulator",
);

process.stdout.write("Alert rule checks passed.\n");
