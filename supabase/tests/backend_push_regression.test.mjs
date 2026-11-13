import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  validateRollbackSuite,
  requireOldRed,
  runPushRegression,
  suiteClient,
} from "./backend_push_regression.mjs";

const marker = "T09_OLD_BODIES_VERIFIED";
const error =
  "ERROR:  P0001: T09 uncertain/terminal send was automatically reclaimed: lost-ticket-write\n";

test("the real rollback suite is accepted, transaction/psql escape is rejected before execution", async () => {
  const suite = await readFile(
    new URL("./art96_push_delivery.sql", import.meta.url),
    "utf8",
  );
  assert.equal(validateRollbackSuite(suite), suite);
  for (const unsafe of [
    suite.replace("rollback;", "commit;"),
    suite.replace("rollback;", "end transaction;"),
    suite + "\n\\connect shared\n",
    suite + "\n\\q\n",
    suite.replace("\\set ON_ERROR_STOP on", "\\set ON_ERROR_STOP off"),
    suite + "\nselect 1;\n",
    suite.replace("begin;", "begin; commit; begin;"),
    suite.replace("begin;", "begin; abort; begin;"),
  ])
    assert.throws(() => validateRollbackSuite(unsafe), /rollback-only/);
});

test("OLD requires applied-body marker AND the exact lost-ticket P0001 assertion, not any nonzero exit", () => {
  assert.doesNotThrow(() =>
    requireOldRed({ code: 3, stdout: marker + "\n", stderr: error }),
  );
  for (const result of [
    { code: 0, stdout: marker + "\n", stderr: error },
    { code: 3, stdout: "", stderr: error },
    { code: null, stdout: marker + "\n", stderr: error },
    {
      code: 3,
      stdout: marker + "\n",
      stderr: "ERROR:  42601: syntax failure\n",
    },
    {
      code: 3,
      stdout: marker + "\n",
      stderr: error.replace("lost-ticket-write", "ambiguous"),
    },
    {
      code: 3,
      stdout: marker + "\n",
      stderr: error + "ERROR:  P0001: setup failure\n",
    },
    { code: 3, stdout: marker + "\n", stderr: error.replace("P0001", "23503") },
    { code: 3, stdout: marker + "\n", stderr: error.replace("ERROR", "FATAL") },
    {
      code: 3,
      stdout: marker + "\n",
      stderr: error + "ERROR: unclassified client failure\n",
    },
  ])
    assert.throws(() => requireOldRed(result), /expected OLD assertion/);
});

test("control transport is bounded, keeps credentials out of arguments, and never exposes raw stderr", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const children = [];
  t.mock.method(childProcess, "spawn", (_executable, args, options) => {
    assert.ok(args.includes("ON_ERROR_STOP=1"));
    assert.ok(args.includes("VERBOSITY=verbose"));
    assert.equal(
      args.some((arg) => arg.includes("private-password")),
      false,
    );
    assert.equal(options.env.PGAPPNAME, "aquafeed-t09-push-control");
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      queueMicrotask(() => child.emit("close", null));
      return true;
    };
    children.push(child);
    return child;
  });
  const pending = suiteClient(
    { PGPASSWORD: "private-password" },
    "fake-psql",
    "safe synthetic input",
  );
  const deadlineFailure = assert.rejects(pending, (error) => {
    assert.equal(error.message, "Isolated push control client failed.");
    return true;
  });
  t.mock.timers.tick(30_000);
  await deadlineFailure;
  const oversized = suiteClient({}, "fake-psql", "safe synthetic input");
  const boundedFailure = assert.rejects(
    oversized,
    /Isolated push control client failed/,
  );
  children[1].stderr.write("private-payload".repeat(3000));
  await boundedFailure;
});

test("missing/cloud/override targets are rejected before opening any client", async (t) => {
  let calls = 0;
  t.mock.method(childProcess, "spawn", () => {
    calls++;
    throw new Error("must not run");
  });
  for (const databaseUrl of [
    undefined,
    "",
    "postgresql://shared.invalid/aquafeed_backend_test",
    "postgresql://127.0.0.1/postgres",
    "postgresql://127.0.0.1/aquafeed_backend_test?host=shared.invalid",
  ]) {
    await assert.rejects(runPushRegression({ databaseUrl }), /isolated/);
  }
  assert.equal(calls, 0);
});
