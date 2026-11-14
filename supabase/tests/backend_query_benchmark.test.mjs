import assert from "node:assert/strict";
import { test } from "node:test";
import { baselineSqlFiles } from "../scripts/check-backend-baseline.mjs";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("T06 access assertions are registered after all predecessor suites", async () => {
  const files = (await baselineSqlFiles()).map((file) =>
    file.split(/[\\/]/).at(-1),
  );
  assert.deepEqual(files.slice(-3), [
    "backend_metric_observations.sql",
    "backend_history_time.sql",
    "backend_query_access.sql",
  ]);
  assert.ok(
    !files.includes("backend_query_plans.sql"),
    "plans need their separate bounded artifact runner",
  );
});

const runner = () => import("./backend_query_benchmark.mjs");
const ci = {
  GITHUB_ACTIONS: "true",
  GITHUB_REF: "refs/heads/feat/backend-t06-query",
  GITHUB_SHA: "a".repeat(40),
  T06_DISPOSABLE_ACK: "parent-reviewed-ci-only",
};
const url =
  "postgresql://test:must-not-log@127.0.0.1:54322/aquafeed_backend_test";

test("benchmark rejects unapproved execution and remote/override targets before psql", async () => {
  const { queryEnvironment } = await runner();
  for (const env of [
    {},
    { ...ci, GITHUB_ACTIONS: "false" },
    { ...ci, T06_DISPOSABLE_ACK: "" },
    { ...ci, GITHUB_REF: "refs/heads/main" },
    { ...ci, GITHUB_SHA: "bad" },
  ])
    assert.throws(
      () => queryEnvironment(url, env),
      /parent-reviewed disposable CI/,
    );
  for (const target of [
    undefined,
    "postgresql://remote.invalid/aquafeed_backend_test",
    `${url}?host=remote.invalid`,
    url.replace("54322", "5432"),
  ])
    assert.throws(() => queryEnvironment(target, ci), /isolated|54322/);
  assert.equal(
    queryEnvironment(url, ci).PGAPPNAME,
    "aquafeed-t06-query-benchmark",
  );
});

test("exact installed-body expectations derive from immutable source, not handwritten queries", async () => {
  const { benchmarkSource } = await runner();
  const source = await readFile(
    new URL(
      "../migrations/20261114001100_backend_history_time.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const result = benchmarkSource(source);
  assert.equal(result.length, 5);
  assert.equal(
    result[0].signature,
    "private.backend_history_observations(uuid)",
  );
  assert.ok(result.every((item) => /^[0-9a-f]{32}$/.test(item.body_md5)));
  assert.throws(
    () =>
      benchmarkSource(
        source.replace(
          "create function private.backend_history_observations",
          "create function private.wrong",
        ),
      ),
    /installed-body/,
  );
});

test("artifact validator rejects incomplete, oversized, non-plan and sensitive captures", async () => {
  const { validateRecords } = await runner();
  for (const records of [
    [],
    [{ kind: "rollback", clean: false }],
    [{ kind: "unknown" }],
    [{ kind: "settings", value: "credential_verifier = secret" }],
    [{ kind: "helper", plan: [{ Plan: { "Node Type": "Function Scan" } }] }],
  ])
    assert.throws(() => validateRecords(records), /artifact/);
  assert.throws(
    () =>
      validateRecords([
        { kind: "fixture", text: "x".repeat(16 * 1024 * 1024) },
      ]),
    /artifact/,
  );
});

// Sanitized transport fixtures only, never presented as real PostgreSQL plans/evidence.
function completeCapture() {
  const digest = "b".repeat(32);
  const plan = [
    {
      Plan: {
        "Node Type": "Seq Scan",
        "Relation Name": "device_metric_observations",
      },
      "Execution Time": 1,
    },
  ];
  const labels = [
    ...["known", "unknown"].flatMap((mode) =>
      ["all", "do", "feed"].flatMap((metric) =>
        ["first", "next"].map((page) => `${mode}-${metric}-${page}`),
      ),
    ),
    "graph-1h",
    "graph-6h",
    "graph-24h",
    "feed-7-first",
    "feed-7-next",
    "feed-180-first",
    "feed-180-next",
    "feed-completed-first",
    "feed-completed-next",
    "chron-start",
    "chron-complete",
    "chron-unknown",
  ];
  return [
    {
      kind: "settings",
      postgres: "PostgreSQL 17.6 transport fixture",
      settings: { enable_seqscan: "on" },
    },
    {
      kind: "fixture",
      synthetic: true,
      metric_rows: 139500,
      legacy_rows: 55800,
      normalized_rows: 251100,
      normalized_unknown: 5022,
      captured_rows: 1395,
      events: 8370,
      alerts: 2790,
      devices: [1, 2, 3, 4, 5],
    },
    {
      kind: "catalog",
      schedule_indexes: [{ name: "test-primary" }, { name: "test-unique" }],
      alert_policy: [{}],
      function_bodies: [{}, {}, {}, {}, {}],
    },
    ...[1, 2, 3, 4, 5].map((device) => ({
      kind: "helper",
      device: String(device),
      plan,
      query_md5: digest,
    })),
    ...labels.flatMap((label) => [
      ...[1, 2, 3].map((repetition) => ({
        kind: "query",
        label,
        repetition,
        plan,
        query_md5: digest,
        fingerprint: digest,
      })),
      { kind: "correctness", label, fingerprint: digest },
    ]),
    ...[1, 2, 3].flatMap((repetition) =>
      [5000, 2500].map((rows) => ({
        kind: "write",
        label: rows === 5000 ? "metric-insert-5000" : "legacy-insert-2500",
        repetition,
        rows,
        plan,
        query_md5: digest,
      })),
    ),
    { kind: "rollback", clean: true },
  ];
}

test("complete transport capture retains only fixed files; missing/drifting results fail closed", async (t) => {
  const { validateRecords, runQueryBenchmark } = await runner();
  const records = completeCapture();
  assert.equal(validateRecords(records).length, 111);
  for (const change of [
    (r) => r.splice(3, 1),
    (r) => {
      r.find((x) => x.kind === "fixture").metric_rows = 1;
    },
    (r) => {
      r.find((x) => x.kind === "settings").settings.enable_seqscan = "off";
    },
    (r) => {
      r.find((x) => x.kind === "catalog").schedule_indexes = null;
    },
    (r) => {
      r.find((x) => x.kind === "query").fingerprint = "c".repeat(32);
    },
    (r) => {
      r.find((x) => x.kind === "query").repetition = 0;
    },
    (r) => {
      r.find((x) => x.kind === "write").rows = 1;
    },
    (r) => {
      r.find((x) => x.kind === "helper").plan[0].Plan = {
        "Node Type": "Function Scan",
      };
    },
  ]) {
    const bad = structuredClone(records);
    change(bad);
    assert.throws(() => validateRecords(bad), /artifact/);
  }
  const directory = await mkdtemp(path.join(tmpdir(), "t06-capture-"));
  t.mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.end(
        records.map((record) => JSON.stringify(record)).join("\n"),
      );
      child.emit("close", 0);
    });
    return child;
  });
  try {
    await runQueryBenchmark({
      databaseUrl: url,
      environment: ci,
      outputDirectory: directory,
      input: "-- transport only, no SQL",
    });
    assert.deepEqual((await readdir(directory)).sort(), [
      "facts.json",
      "plans.json",
    ]);
    assert.equal(
      JSON.parse(await readFile(path.join(directory, "plans.json"), "utf8"))
        .length,
      83,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("oversized SQL output kills capture before publishing any files", async (t) => {
  const { runQueryBenchmark } = await runner();
  const directory = await mkdtemp(path.join(tmpdir(), "t06-overflow-"));
  let killed = false;
  t.mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed = true;
    };
    queueMicrotask(() => {
      child.stdout.end("x".repeat(16 * 1024 * 1024 + 1));
      child.emit("close", 0);
    });
    return child;
  });
  try {
    await assert.rejects(
      runQueryBenchmark({
        databaseUrl: url,
        environment: ci,
        outputDirectory: directory,
        input: "-- transport only",
      }),
      /output exceeded/,
    );
    assert.equal(killed, true);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("client deadline terminates a silent SQL process without artifacts", async (t) => {
  const { runQueryBenchmark } = await runner();
  const directory = await mkdtemp(path.join(tmpdir(), "t06-deadline-"));
  let killed = false;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      killed = true;
    };
    return child;
  });
  try {
    const pending = runQueryBenchmark({
      databaseUrl: url,
      environment: ci,
      outputDirectory: directory,
      input: "-- transport only",
    });
    t.mock.timers.tick(240_000);
    await assert.rejects(pending, /240s client deadline/);
    assert.equal(killed, true);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQL assertion diagnostics expose only a complete allowlisted stage and static label", async () => {
  const { benchmarkDiagnostic } = await runner();
  assert.equal(typeof benchmarkDiagnostic, "function");
  const marker =
    "ERROR:  P0001: T06_BENCHMARK: independent exact source chronology/receipt\nDETAIL:  T06_STAGE: warmup\n";
  const expected =
    "; stage warmup; assertion independent exact source chronology/receipt";
  assert.equal(benchmarkDiagnostic(marker), expected);
  assert.equal(benchmarkDiagnostic(marker.replaceAll("\n", "\r\n")), expected);
  assert.equal(
    benchmarkDiagnostic(
      `postgresql://must-not-log\n${marker}CONTEXT: secret SQL`,
    ),
    expected,
  );
  for (const unsafe of [
    "ERROR: P0001: must-not-log postgresql://secret SQL",
    marker.replace("warmup", "must-not-log"),
    marker.replace("warmup", "warmup postgresql://secret"),
    marker.replace("chronology/receipt", "chronology/receipt must-not-log"),
    marker.replace("P0001", "42501"),
    marker.replace("ERROR:", "CONTEXT:"),
    marker.replace("DETAIL:", "CONTEXT:"),
    marker.replace("T06_STAGE: warmup", "T06_STAGE: warmup\u001b[31m"),
    marker.split("\n")[0],
    "DETAIL: T06_STAGE: warmup\n",
    "",
  ])
    assert.equal(benchmarkDiagnostic(unsafe), "");
});

test("failed SQL client retains safe assertion diagnostics but publishes no partial artifacts", async (t) => {
  const { runQueryBenchmark } = await runner();
  const directory = await mkdtemp(path.join(tmpdir(), "t06-assertion-"));
  t.mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.end('{"kind":"settings"}\n');
      child.stderr.end(
        "ERROR: P0001: T06_BENCHMARK: independent exact source chronology/receipt\nDETAIL: T06_STAGE: warmup\nCONTEXT: must-not-log postgresql://secret SQL\n",
      );
      child.emit("close", 3);
    });
    return child;
  });
  try {
    await assert.rejects(
      runQueryBenchmark({
        databaseUrl: url,
        environment: ci,
        outputDirectory: directory,
        input: "-- transport only",
      }),
      (error) =>
        error.message ===
        "T06 benchmark SQL failed; SQLSTATE P0001; stage warmup; assertion independent exact source chronology/receipt. Raw detail suppressed.",
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed SQL client is bounded, redacted and cannot leave publishable artifacts", async (t) => {
  const { runQueryBenchmark } = await runner();
  const directory = await mkdtemp(path.join(tmpdir(), "t06-query-"));
  let calls = 0;
  t.mock.method(childProcess, "spawn", (_executable, args, options) => {
    calls++;
    assert.ok(args.includes("ON_ERROR_STOP=1"));
    assert.ok(!args.join(" ").includes("must-not-log"));
    assert.equal(options.env.PGAPPNAME, "aquafeed-t06-query-benchmark");
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stderr.end("ERROR: P0001: must-not-log postgresql://secret SQL");
      child.emit("close", 3);
    });
    return child;
  });
  try {
    await assert.rejects(
      runQueryBenchmark({
        databaseUrl: url,
        environment: ci,
        outputDirectory: directory,
        input: "-- test boundary only",
      }),
      (error) =>
        /SQLSTATE P0001/.test(error.message) &&
        !/must-not-log|postgresql:|secret SQL/.test(error.message),
    );
    assert.equal(calls, 1);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
