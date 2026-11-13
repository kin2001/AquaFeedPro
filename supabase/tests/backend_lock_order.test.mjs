import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { PsqlSession, runLockOrder } from "./backend_lock_order.mjs";

function client(t) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.kill = () => {
    queueMicrotask(() => child.emit("close", null));
    return true;
  };
  child.stdin.on("finish", () => child.emit("close", 0));
  t.mock.method(childProcess, "spawn", () => child);
  return { child, session: new PsqlSession({}) };
}

test("persistent client waits for its complete marker and preserves SQLSTATE, not raw stderr", async (t) => {
  const { child, session } = client(t);
  try {
    const result = session.query("SELECT 1;", { allowError: true });
    child.stdout.write("1\n__t02_1__ 40");
    child.stdout.write("P01\r\n");
    assert.deepEqual(await result, { state: "40P01", rows: ["1"] });
    const next = session.ok("SELECT true;");
    child.stdout.write("true\n__t02_2__ 00000\n");
    assert.deepEqual(await next, [true]);
  } finally {
    await session.close();
  }
});

test("unexpected client exit fails pending work and never turns a missing marker into success", async (t) => {
  const { child, session } = client(t);
  const pending = session.query("SELECT 1;");
  child.emit("close", 3);
  await assert.rejects(pending, /closed unexpectedly/);
  await session.close();
});

test("parallel commands on one persistent connection are rejected", async (t) => {
  const { child, session } = client(t);
  try {
    const first = session.query("SELECT 1;");
    await assert.rejects(session.query("SELECT 2;"), /not ready/);
    child.stdout.write("1\n__t02_1__ 00000\n");
    await first;
  } finally {
    await session.close();
  }
});

test("unbounded or malformed output fails closed without disclosing output", async (t) => {
  const { child, session } = client(t);
  const pending = session.query("SELECT 1;");
  child.stdout.write("do-not-disclose".repeat(10_000));
  await assert.rejects(pending, (error) => {
    assert.match(error.message, /exceeded limit/);
    assert.doesNotMatch(error.message, /do-not-disclose/);
    return true;
  });
  await session.close();
});

test("missing client fails before any fixture or function mutation", async () => {
  await assert.rejects(
    runLockOrder({
      databaseUrl:
        "postgresql://postgres:isolated-ci-only@127.0.0.1:54322/aquafeed_backend_test",
      psqlPath: "missing-psql-t02",
    }),
    /Unable to start isolated psql/,
  );
});

test("shutdown is bounded when a client fails to acknowledge exit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { child, session } = client(t);
  child.kill = () => true;
  child.stdin.removeAllListeners("finish");
  const closing = session.close();
  const rejected = assert.rejects(closing, /shutdown deadline/);
  t.mock.timers.tick(2_000);
  await rejected;
});

test("lock harness rejects missing/cloud/override targets before opening any client", async (t) => {
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
    await assert.rejects(runLockOrder({ databaseUrl }), /isolated/);
  }
  assert.equal(calls, 0);
});
