import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSqlSuites } from "../scripts/check-backend-baseline.mjs";

const databaseUrl =
  "postgresql://test:do-not-log@127.0.0.1:54322/aquafeed_backend_test";

test("rejects missing, remote and libpq-override connections before launching psql", async () => {
  for (const url of [
    undefined,
    "",
    "service=cloud",
    "postgresql://host.invalid/aquafeed_backend_test",
    "postgresql://127.0.0.1/postgres",
    `${databaseUrl}?host=host.invalid`,
    `${databaseUrl}#fragment`,
    databaseUrl.replace("do-not-log", "do-not-log%00"),
  ]) {
    await assert.rejects(
      runSqlSuites({ databaseUrl: url, psqlPath: "must-not-run", suites: [] }),
      /isolated/,
    );
  }
});

test("stops at first SQL exit, uses ON_ERROR_STOP and keeps credentials out of arguments/output", async (t) => {
  const calls = [];
  const logs = [];
  t.mock.method(console, "log", (...parts) => logs.push(parts.join(" ")));
  t.mock.method(console, "error", (...parts) => logs.push(parts.join(" ")));
  // Only tests child-process handling; this is NOT PostgreSQL assertion evidence.
  t.mock.method(childProcess, "spawn", (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    queueMicrotask(() =>
      child.emit("close", args.includes("broken.sql") ? 3 : 0),
    );
    return child;
  });
  const priorService = process.env.PGSERVICE;
  process.env.PGSERVICE = "must-not-inherit";
  try {
    await assert.rejects(
      runSqlSuites({
        databaseUrl,
        psqlPath: "psql-test-double",
        suites: ["good.sql", "broken.sql", "never.sql"],
      }),
      (error) => {
        assert.match(error.message, /SQL suite failed.*broken.sql.*3/);
        assert.doesNotMatch(error.message, /do-not-log|postgresql:/);
        return true;
      },
    );
  } finally {
    if (priorService === undefined) delete process.env.PGSERVICE;
    else process.env.PGSERVICE = priorService;
  }
  assert.equal(calls.length, 2);
  assert.doesNotMatch(logs.join("\n"), /do-not-log|postgresql:/);
  for (const { executable, args, options } of calls) {
    assert.equal(executable, "psql-test-double");
    assert.ok(args.includes("ON_ERROR_STOP=1"));
    assert.ok(args.includes("-X"));
    assert.ok(args.includes("--no-password"));
    assert.equal(options.env.PGHOST, "127.0.0.1");
    assert.equal(options.env.PGDATABASE, "aquafeed_backend_test");
    assert.equal(options.env.PGPASSWORD, "do-not-log");
    assert.equal(options.env.PGSERVICE, undefined);
    assert.equal(options.stdio, "ignore");
    assert.ok(!args.some((arg) => arg.includes("do-not-log")));
  }
});

test("missing psql produces a sanitized failure", async () => {
  await assert.rejects(
    runSqlSuites({
      databaseUrl,
      psqlPath: "missing-psql-t01",
      suites: ["good.sql"],
    }),
    /Unable to start psql/,
  );
});

test(
  "isolated PostgreSQL accepts a good assertion and rejects a deliberately broken assertion",
  {
    skip: !process.env.LOCAL_TEST_DATABASE_URL,
  },
  async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "aquafeed-sql-failure-"),
    );
    try {
      const good = path.join(directory, "good.sql");
      const broken = path.join(directory, "broken.sql");
      await writeFile(good, "do $$ begin assert 1 = 1; end $$;\n");
      await writeFile(
        broken,
        "do $$ begin raise exception 'deliberate isolated assertion failure'; end $$;\n",
      );
      const options = {
        databaseUrl: process.env.LOCAL_TEST_DATABASE_URL,
        psqlPath: process.env.PSQL_PATH || "psql",
      };
      await runSqlSuites({ ...options, suites: [good] });
      await assert.rejects(
        runSqlSuites({ ...options, suites: [broken] }),
        /SQL suite failed: broken.sql \(exit 3\)/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
