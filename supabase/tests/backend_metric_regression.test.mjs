import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { requireMetricOldRed, metricMigrationIndex } from "./backend_metric_regression.mjs";

test("T04 OLD gate accepts only exact missing-installation assertion, never generic SQL errors", () => {
  const expected = { code: 3, stdout: "", stderr: "ERROR:  P0001: T04_CURRENT_METRICS_NOT_INSTALLED\nCONTEXT: PL/pgSQL function inline_code_block line 1 at RAISE\n" };
  requireMetricOldRed(expected);
  for (const patch of [ { code: 0 }, { code: 1 }, { stdout: "unexpected" }, { stderr: "ERROR:  42P01: relation missing\n" }, { stderr: "ERROR:  P0001: unrelated business failure\n" }, { stderr: expected.stderr + "ERROR:  P0001: T04_CURRENT_METRICS_NOT_INSTALLED\n" } ]) assert.throws(() => requireMetricOldRed({ ...expected, ...patch }));
});
test("T04 guarded patches each match exactly one effective immutable predecessor fragment (source check, not SQL)", () => {
  const forward = readFileSync(new URL("../migrations/20261114001000_backend_metric_observations.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const patches = [...forward.matchAll(/select pg_temp\.backend_metric_patch\('([^']+)',\n\$o\$([\s\S]*?)\$o\$/g)];
  assert.equal(patches.length, 3);
  for (const [, signature, fragment] of patches) {
    const file = signature.startsWith("public.art31_") ? "20261015113815_art97_stock_policy_manual_recovery.sql" : "20261014081014_art95_server_alerts.sql";
    const predecessor = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
    assert.equal(predecessor.split(fragment).length - 1, 1, signature);
  }
});

test("T04 explicitly resets service table ACLs before minimal grants (source check, real adversarial defaults run only in CI)", () => {
  const migration = readFileSync(new URL("../migrations/20261114001000_backend_metric_observations.sql", import.meta.url), "utf8");
  assert.ok(migration.includes("revoke all on public.%I from public,anon,authenticated,service_role"));
});

test("T04 control can run only immediately before the reserved forward migration", () => {
  assert.equal(metricMigrationIndex(["bootstrap.sql", "20261114000900_backend_push_uncertain_no_resend.sql", "20261114001000_backend_metric_observations.sql", "backend_metric_observations.sql"]), 2);
  assert.throws(() => metricMigrationIndex(["bootstrap.sql"]));
  assert.throws(() => metricMigrationIndex(["20261114001000_backend_metric_observations.sql", "20261114001000_backend_metric_observations.sql"]));
});
