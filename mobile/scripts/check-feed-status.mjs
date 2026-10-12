import assert from "node:assert/strict";

import {
  clockParts,
  relativeDayLabel,
  statusKind,
  statusText,
} from "../src/components/feed-status.ts";

assert.equal(statusText("running"), "In progress");
assert.equal(statusText("something_new"), "something_new");

assert.equal(statusKind("partial"), "warning");
assert.equal(statusKind("expired"), "failed");
assert.equal(statusKind("something_new"), "unknown");

const now = new Date("2026-10-12T10:00:00Z");
const day = (iso) => relativeDayLabel(new Date(iso), "Asia/Manila", now);
assert.equal(day("2026-10-12T04:00:00Z"), "Today");
// Midnight in Manila belongs to the new day; one minute earlier does not.
assert.equal(day("2026-10-11T16:00:00Z"), "Today");
assert.equal(day("2026-10-11T15:59:00Z"), "Yesterday");
assert.equal(day("2026-10-12T16:00:00Z"), "Tomorrow");

const { time } = clockParts(now, "Asia/Manila");
assert.ok(time.includes("6") && time.includes("00"), time);

process.stdout.write("Feed status label and day/clock checks passed.\n");
