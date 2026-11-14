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
test("ACL control rejects every transaction command/alias before database execution, including case/comment variants", () => {
  const commands = [
    "BEGIN;", "BEGIN WORK;", "BEGIN TRANSACTION;", "BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;",
    "COMMIT;", "COMMIT WORK;", "COMMIT TRANSACTION;", "COMMIT WORK AND NO CHAIN;", "COMMIT AND CHAIN;",
    "ROLLBACK;", "ROLLBACK WORK;", "ROLLBACK TRANSACTION;", "ROLLBACK TO SAVEPOINT previous;",
    "ABORT;", "ABORT WORK;", "ABORT TRANSACTION;",
    "END;", "END WORK;", "END TRANSACTION;", "END AND CHAIN;",
    "START TRANSACTION;", "START TRANSACTION READ ONLY;", "PREPARE TRANSACTION 't04-control';",
    "COMMIT TRANSACTION; BEGIN TRANSACTION;",
    "/* before */ cOmMiT /* between */ wOrK /* after */;",
    "-- before\n CoMmIt\tTrAnSaCtIoN ;", "-- before\rCOMMIT TRANSACTION;", "-- before\r\nCOMMIT WORK;",
    "COMMIT-- between\n WORK;", "BEGIN/* between */TRANSACTION;", "END/* between */TRANSACTION;",
    "START/* between */TRANSACTION;", "PREPARE/* between */TRANSACTION 't04-control';",
    "/* outer /* nested */ comment */ COMMIT WORK;",
    "SELECT 1;/* before */COMMIT TRANSACTION;",
  ];
  for (const command of commands) {
    const changed = source.replace("set local lock_timeout = '5s';", `${command}\nset local lock_timeout = '5s';`);
    assert.throws(() => migrationBody(changed), undefined, `reject ${command}`);
  }
});

test("ACL boundary guard keeps literals, identifiers, dollar bodies and nested comments opaque without changing bytes", () => {
  for (const fragment of [
    "SELECT 'COMMIT; BEGIN WORK; ROLLBACK TRANSACTION;';",
    "SELECT 'COMMIT WORK; '' BEGIN TRANSACTION;';",
    'SELECT "COMMIT WORK; END TRANSACTION";',
    "DO $t04$ BEGIN PERFORM 'COMMIT WORK;'; END; $t04$;",
    "/* COMMIT WORK; /* BEGIN TRANSACTION; */ END; */ SELECT 1;",
  ]) {
    const changed = source.replace("set local lock_timeout = '5s';", `${fragment}\nset local lock_timeout = '5s';`);
    assert.equal(migrationBody(changed), changed.replace(/^begin;\r?$/m, "").replace(/^commit;\r?$/m, ""));
  }
});

test("ACL boundary guard fails closed on ambiguous quoting and inline psql commands", () => {
  for (const fragment of ["SELECT 'unclosed;", 'SELECT "unclosed;', "DO $unclosed$ BEGIN NULL; END;", "/* unclosed", "SELECT E'\\\\';", "SELECT $unsupported;", "SELECT 1 \\gexec"]) {
    const changed = source.replace(/^commit;\r?$/m, `${fragment}\ncommit;`);
    assert.throws(() => migrationBody(changed), undefined, fragment);
  }
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
