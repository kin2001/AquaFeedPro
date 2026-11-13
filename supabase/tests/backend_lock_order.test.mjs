import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  PsqlSession,
  runLockOrder,
  lockOrderDiagnostic,
} from "./backend_lock_order.mjs";

function client(t) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
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

test("query terminates pg_get_functiondef output before requesting its SQLSTATE", async (t) => {
  const { child, session } = client(t);
  let submitted = "";
  child.stdin.on("data", (chunk) => {
    submitted += chunk.toString();
  });
  const definition =
    "CREATE OR REPLACE FUNCTION public.example() RETURNS void LANGUAGE plpgsql AS $function$\nBEGIN NULL; END;\n$function$\n";
  try {
    const pending = session.ok(definition);
    // pg_get_functiondef omits the outer semicolon; an echo alone reports the prior command.
    assert.equal(
      submitted,
      `\\set ON_ERROR_STOP on\n${definition}\n;\n\\echo __t02_1__ :SQLSTATE\n`,
    );
    child.stdout.write("__t02_1__ 00000\n");
    await pending;
    submitted = "";
    const deliberateError = session.query("SELECT 1;", { allowError: true });
    assert.equal(
      submitted,
      "\\set ON_ERROR_STOP off\nSELECT 1;\n\\echo __t02_2__ :SQLSTATE\n",
      "an extra empty SQL statement could overwrite the deliberate error SQLSTATE",
    );
    child.stdout.write("__t02_2__ 40P01\n");
    assert.equal((await deliberateError).state, "40P01");
  } finally {
    child.stdout.write("__t02_1__ 00000\n__t02_2__ 00000\n");
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

test("fatal SQL exit retains only the bounded SQLSTATE, not stderr content", async (t) => {
  const { child, session } = client(t);
  const pending = session.ok("SELECT 1;");
  child.stderr.write("ERROR:  426");
  child.stderr.write("01\nSECRET/UUID/SQL must not escape\n");
  assert.equal(session.lastState, "42601");
  child.stderr.write("ERROR:  55P03\n");
  child.emit("close", 3);
  await assert.rejects(pending, /closed unexpectedly/);
  assert.equal(session.lastState, "55P03");
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

test("failure diagnostics expose only allowlisted stages, SQLSTATE and bounded assertion facts", () => {
  const error = Object.assign(
    new Error("do-not-disclose SQL/UUID/credential"),
    {
      code: "ERR_ASSERTION",
      actual: { sequences: 2, steps: [1, 2], token: "do-not-disclose" },
      expected: { sequences: 1, steps: [1, 2] },
    },
  );
  const diagnostic = lockOrderDiagnostic(error, {
    phase: "new",
    stage: "retry-facts",
    manualState: "00000",
    telemetryState: "40P01",
  });
  assert.match(diagnostic, /phase=new stage=retry-facts kind=assertion/);
  assert.match(diagnostic, /manual_sqlstate=00000 telemetry_sqlstate=40P01/);
  assert.match(diagnostic, /"sequences":2/);
  assert.doesNotMatch(diagnostic, /do-not-disclose|token|credential|SQL\/UUID/);
  const hostile = lockOrderDiagnostic(error, {
    phase: "do-not-disclose",
    stage: "do-not-disclose",
    manualState: "unsafe-state",
  });
  assert.match(hostile, /phase=unknown stage=unknown/);
  assert.doesNotMatch(hostile, /do-not-disclose|unsafe-state/);
});

test("missing client fails before any fixture or function mutation", async (t) => {
  const diagnostics = [];
  t.mock.method(console, "error", (message) => diagnostics.push(message));
  await assert.rejects(
    runLockOrder({
      databaseUrl:
        "postgresql://postgres:isolated-ci-only@127.0.0.1:54322/aquafeed_backend_test",
      psqlPath: "missing-psql-t02",
    }),
    /Unable to start isolated psql/,
  );
  assert.equal(diagnostics.length, 1);
  assert.match(
    diagnostics[0],
    /phase=initial stage=connect kind=client-or-sql/,
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
