import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  baselineSqlFiles,
  runSqlSuites,
} from "../scripts/check-backend-baseline.mjs";

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
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      if (args.includes("broken.sql")) {
        child.stderr.write(
          "psql:broken.sql:27: ERROR:  P0001: do-not-log SQL values\n",
        );
        child.stderr.end(
          "CONTEXT:  PL/pgSQL function inline_code_block line 11 at RAISE\nSELECT 'do-not-log'; postgresql://test:do-not-log@127.0.0.1\n",
        );
      }
      child.emit("close", args.includes("broken.sql") ? 3 : 0);
    });
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
        assert.match(error.message, /SQLSTATE P0001, line 27/);
        assert.match(error.message, /inline block line 11/);
        assert.doesNotMatch(
          error.message,
          /do-not-log|postgresql:|SELECT|CONTEXT/,
        );
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
    assert.deepEqual(options.stdio, ["ignore", "ignore", "pipe"]);
    assert.ok(args.includes("VERBOSITY=verbose"));
    assert.equal(options.env.LC_ALL, "C");
    assert.ok(!args.some((arg) => arg.includes("do-not-log")));
  }
});

test("migration profiles precede ART33/ART97, guarded cleanup precedes fresh latest-schema suites", async () => {
  const files = (await baselineSqlFiles()).map((file) => path.basename(file));
  const art33 = files.indexOf(
    "20261009120000_art33_independent_nozzle_schedules.sql",
  );
  const art97 = files.indexOf(
    "20261015060257_art97_inventory_profile_durability.sql",
  );
  const migrationFiles = (
    await readdir(new URL("../migrations/", import.meta.url))
  )
    .filter((file) => /^\d{14}_.+\.sql$/.test(file))
    .sort();
  const lastMigration = files.indexOf(migrationFiles.at(-1));
  const cleanup = files.indexOf("backend-test-migration-fixtures-cleanup.sql");
  assert.equal(files[art33 - 1], "backend-test-fixtures.sql");
  assert.ok(art33 < art97 && art97 < lastMigration && lastMigration < cleanup);
  assert.equal(files[cleanup + 1], "art7_two_installation_access.sql");
  assert.equal(files[cleanup + 2], "art38_device_access.sql");
  assert.equal(files[cleanup + 3], "backend-test-fixtures.sql");
  assert.deepEqual(
    files.filter((file) => /^\d{14}_.+\.sql$/.test(file)),
    migrationFiles,
    "every current immutable migration runs exactly once in lexical order",
  );
  assert.equal(files.filter((file) => /^(art|rt01_)/.test(file)).length, 10);
  assert.equal(
    files.at(-3),
    "backend_metric_observations.sql",
    "T04 retains all unchanged legacy suites before it",
  );
  assert.equal(
    files.at(-2),
    "backend_history_time.sql",
    "T05 follows T04 prerequisites",
  );
  assert.equal(
    files.at(-1),
    "backend_query_access.sql",
    "T06 preserves predecessor access suites",
  );
});

test("final baseline applies 24/01200 exactly once and never replays the historical policy experiment", async () => {
  const files = (await baselineSqlFiles()).map((f) => path.basename(f));
  const migrations = files.filter((f) => /^\d{14}_/.test(f));
  assert.equal(migrations.length, 24);
  assert.equal(migrations.at(-1), "20261114001200_backend_query_indexes.sql");
  assert.equal(files.at(-1), "backend_query_access.sql");
  assert.ok(!files.includes("backend_query_plans.sql"));
});

test("both historical experiment CI steps require the explicit 01200 absence and exact task ref", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const steps = workflow
    .split(/\n      - name: /)
    .filter((s) =>
      /T06 policy A-B-A control|Retain validated T06 policy control/.test(s),
    );
  assert.equal(steps.length, 2);
  for (const step of steps) {
    const expression = step.match(/\n        if: (.+)/)?.[1];
    assert.ok(
      expression?.includes(
        "supabase/migrations/20261114001200_backend_query_indexes.sql",
      ),
    );
    const evaluate = (ref, present, success = true) =>
      Function(
        "github",
        "hashFiles",
        "success",
        `return (${expression})`,
      )(
        { ref },
        (file) => {
          assert.equal(
            file,
            "supabase/migrations/20261114001200_backend_query_indexes.sql",
          );
          return present ? "synthetic-hash" : "";
        },
        () => success,
      );
    assert.equal(evaluate("refs/heads/feat/backend-t06-query", false), true);
    assert.equal(evaluate("refs/heads/feat/backend-t06-query", true), false);
    assert.equal(evaluate("refs/heads/main", false), false);
    if (step.startsWith("Retain "))
      assert.equal(
        evaluate("refs/heads/feat/backend-t06-query", false, false),
        false,
      );
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
