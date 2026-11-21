import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const moduleUrl = new URL("../src/lib/monitoring-time.ts", import.meta.url);
assert.ok(existsSync(moduleUrl), "Philippine time helpers must exist");
const { philippineDayBounds, formatPhilippineTime, feedChronology } =
  await import(moduleUrl);
assert.deepEqual(philippineDayBounds("2026-11-13"), {
  startUtc: "2026-11-12T16:00:00Z",
  endUtc: "2026-11-13T16:00:00Z",
});
assert.deepEqual(philippineDayBounds("2024-02-29"), {
  startUtc: "2024-02-28T16:00:00Z",
  endUtc: "2024-02-29T16:00:00Z",
});
for (const date of [
  "2026-02-29",
  "2026-04-31",
  "2026-00-01",
  "2026-13-01",
  "2026-1-01",
  "not-a-date",
])
  assert.throws(() => philippineDayBounds(date));
assert.equal(formatPhilippineTime("2026-11-13T06:00:00Z"), "2:00 PM");
assert.equal(formatPhilippineTime("2026-11-12T16:00:00Z"), "12:00 AM");
assert.throws(() => formatPhilippineTime("invalid"));
assert.throws(
  () => formatPhilippineTime("2026-11-13T06:00:00"),
  "an unzoned wall clock is not an instant",
);
assert.throws(
  () => formatPhilippineTime("2026-02-29T06:00:00Z"),
  "invalid calendar time must not normalize silently",
);
const receipt = "2026-11-13T06:07:00Z";
assert.deepEqual(
  feedChronology({
    occurred_at: "2026-11-13T06:00:00Z",
    time_basis: "measured",
    received_at: receipt,
    started_at: "2026-11-13T06:00:00Z",
  }),
  { instant: "2026-11-13T06:00:00Z", label: "Execution started" },
);
assert.equal(
  feedChronology({
    occurred_at: "2026-11-12T15:59:00Z",
    time_basis: "measured",
    received_at: receipt,
    started_at: null,
  }).label,
  "Completion reported",
);
assert.deepEqual(
  feedChronology({
    occurred_at: null,
    time_basis: "unknown",
    received_at: receipt,
  }),
  { instant: receipt, label: "Received · execution time unknown" },
);
if (!process.env.TIME_CHECK_CHILD)
  for (const TZ of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url)],
      { env: { ...process.env, TZ, TIME_CHECK_CHILD: "1" }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
console.log(
  "PASS Philippine bounds/calendar, midnight, phone-zone independence and labeled feed chronology",
);
