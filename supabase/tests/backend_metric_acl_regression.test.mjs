import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { migrationBody, withoutServiceReset, requireAclOldRed, installMetricWithAclControl } from "./backend_metric_acl_regression.mjs";

const source = readFileSync(new URL("../migrations/20261114001000_backend_metric_observations.sql", import.meta.url), "utf8");
test("ACL control removes exactly the anchored outer transaction, preserving effective migration body/timeouts", () => {
  const body = migrationBody(source);
  assert.equal(body, source.replace(/^begin;\r?$/m, "").replace(/^commit;\r?$/m, ""));
  assert.ok(body.includes("set local lock_timeout = '5s';"));
  assert.ok(body.includes("set local statement_timeout = '30s';"));
  for (const invalid of [source + "\ncommit;", source.replace("begin;", "BEGIN;"), source.replace("commit;", "commit; -- changed"), source.replace("begin;", "begin;\nbegin;"), source + "\nselect 1;", "select 1;\n" + source, source.replace("begin;", "begin;\nROLLBACK;"), "\\set ON_ERROR_STOP off\n" + source]) assert.throws(() => migrationBody(invalid));
});
test("OLD ACL control removes only the one new service reset, never any other revoke or grant", () => {
  const body = migrationBody(source);
  const old = withoutServiceReset(body);
  assert.equal(old.replace("revoke all on public.%I from public,anon,authenticated'", "revoke all on public.%I from public,anon,authenticated,service_role'"), body);
  assert.throws(() => withoutServiceReset(old));
  assert.throws(() => withoutServiceReset(body + body));
});
test("ACL install/control rejects missing/cloud/query-override connections before any client or ALTER", async () => {
  for (const databaseUrl of [undefined, "postgresql://cloud.invalid/aquafeed_backend_test", "postgresql://127.0.0.1/postgres", "postgresql://127.0.0.1/aquafeed_backend_test?host=cloud.invalid"]) {
    await assert.rejects(installMetricWithAclControl({ databaseUrl, psqlPath: "must-not-run" }), /isolated/);
  }
});

test("OLD ACL evidence must be exact effective-destructive-privilege P0001, not arbitrary migration errors", () => {
  const expected = { code: 3, stdout: "\n", stderr: "ERROR:  P0001: T04_SERVICE_DESTRUCTIVE_DEFAULT_ACL\n" };
  requireAclOldRed(expected);
  for (const patch of [{ code: 0 }, { stdout: "unexpected" }, { stderr: "ERROR:  42P01: missing table\n" }, { stderr: "ERROR:  P0001: migration failed\n" }, { stderr: expected.stderr.repeat(2) }]) assert.throws(() => requireAclOldRed({ ...expected, ...patch }));
});
