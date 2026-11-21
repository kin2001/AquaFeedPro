// Disposable Phase B policy A/B/A only; no forward migration or product/index rewrite.
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isolatedConnection } from "../scripts/check-backend-baseline.mjs";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 256 * 1024;
const sqlPath = new URL("backend_query_plans.sql", import.meta.url);
const signatures = [
  "private.backend_history_observations(uuid)",
  "public.backend_metric_history(uuid,uuid,date,text,timestamptz,text,text)",
  "public.backend_metric_do_graph(uuid,uuid,uuid,text,integer)",
  "private.backend_feed_chronology(uuid,uuid)",
  "public.backend_history_page(uuid,uuid,date,date,text,text,timestamptz,uuid)",
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
  ...["7", "180", "completed"].flatMap((range) =>
    ["first", "next"].map((page) => `feed-${range}-${page}`),
  ),
  "chron-start",
  "chron-complete",
  "chron-unknown",
];
const q = (value) => `'${value.replaceAll("'", "''")}'`;
const hash = (value, algorithm = "sha256") =>
  createHash(algorithm).update(value).digest("hex");

export function queryEnvironment(databaseUrl, environment = process.env) {
  if (
    environment.GITHUB_ACTIONS !== "true" ||
    environment.GITHUB_REF !== "refs/heads/feat/backend-t06-query" ||
    !/^[0-9a-f]{40}$/.test(environment.GITHUB_SHA ?? "") ||
    environment.T06_DISPOSABLE_ACK !== "parent-reviewed-ci-only"
  )
    throw new Error(
      "T06 requires parent-reviewed disposable CI on the exact task branch.",
    );
  const env = isolatedConnection(databaseUrl);
  if (env.PGHOST !== "127.0.0.1" || env.PGPORT !== "54322")
    throw new Error("T06 requires isolated CI port 54322.");
  return { ...env, PGAPPNAME: "aquafeed-t06-query-benchmark" };
}

export function benchmarkSource(source) {
  return signatures.map((signature) => {
    const name = signature.split("(")[0].replaceAll(".", "\\.");
    const matches = [
      ...source
        .replaceAll("\r\n", "\n")
        .matchAll(
          new RegExp(
            `create function ${name}\\([\\s\\S]*?\\bas \\$\\$([\\s\\S]*?)\\$\\$;`,
            "g",
          ),
        ),
    ];
    if (matches.length !== 1)
      throw new Error("T06 installed-body source expectation is ambiguous.");
    return { signature, body_md5: hash(matches[0][1], "md5") };
  });
}

export function validateRecords(records) {
  const fail = () => {
    throw new Error(
      "T06 artifact is incomplete, unsafe or outside its bounds.",
    );
  };
  if (!Array.isArray(records) || records.length !== 132) fail();
  const text = JSON.stringify(records);
  if (
    Buffer.byteLength(text) > MAX_BYTES ||
    /credential_verifier|ExponentPushToken|postgres(?:ql)?:\/\//i.test(text)
  )
    fail();
  const kinds = new Set([
    "settings",
    "fixture",
    "catalog",
    "helper",
    "query",
    "correctness",
    "write",
    "policy-plan",
    "policy-control",
    "rollback",
  ]);
  if (
    records.some(
      (record) =>
        !record ||
        !kinds.has(record.kind) ||
        Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES,
    )
  )
    fail();
  const rejectClaimFields = (key, value) => {
    if (/jwt|claim|^sub$/i.test(key) && key !== "claims_match") fail();
    return value;
  };
  for (const record of records) {
    const { plan, ...facts } = record;
    // Validation copy ONLY: fixed SQL GUC-name literals in predicate fields.
    // No claim objects/fields/values, extended names or nonpolicy exception.
    const planText = JSON.stringify(plan ?? null, (key, value) => {
      rejectClaimFields(key, value);
      if (record.kind === "policy-plan" && typeof value === "string") {
        if (/\{\s*"/.test(value)) fail();
        if (
          [
            "Filter",
            "Index Cond",
            "Recheck Cond",
            "Hash Cond",
            "Join Filter",
            "One-Time Filter",
          ].includes(key)
        )
          return value
            .replaceAll("'request.jwt.claim.sub'", "")
            .replaceAll("'request.jwt.claims'", "");
      }
      return value;
    });
    if (
      /request\.jwt/i.test(JSON.stringify(facts, rejectClaimFields)) ||
      /request\.jwt/i.test(planText)
    )
      fail();
  }
  for (const kind of ["settings", "fixture", "catalog", "rollback"])
    if (records.filter((record) => record.kind === kind).length !== 1) fail();
  if (records.at(-1)?.kind !== "rollback" || records.at(-1)?.clean !== true)
    fail();
  const fixture = records.find((record) => record.kind === "fixture");
  const settings = records.find((record) => record.kind === "settings");
  const catalog = records.find((record) => record.kind === "catalog");
  for (const [key, expected] of Object.entries({
    metric_rows: 139500,
    legacy_rows: 55800,
    normalized_rows: 251100,
    normalized_unknown: 5022,
    captured_rows: 1395,
    events: 8370,
    alerts: 2790,
  }))
    if (fixture[key] !== expected) fail();
  if (
    fixture.synthetic !== true ||
    !Array.isArray(fixture.devices) ||
    fixture.devices.length !== 5 ||
    !/^PostgreSQL 17\./.test(settings.postgres ?? "") ||
    settings.settings?.enable_seqscan !== "on" ||
    !Array.isArray(catalog.schedule_indexes) ||
    catalog.schedule_indexes.length < 2 ||
    !Array.isArray(catalog.alert_policy) ||
    catalog.alert_policy.length !== 1 ||
    !Array.isArray(catalog.function_bodies) ||
    catalog.function_bodies.length !== 5
  )
    fail();
  const helpers = records.filter((record) => record.kind === "helper");
  if (
    helpers.length !== 5 ||
    new Set(helpers.map((record) => record.device)).size !== 5
  )
    fail();
  for (const record of records.filter((item) =>
    ["helper", "query", "write", "policy-plan"].includes(item.kind),
  )) {
    if (
      !Array.isArray(record.plan) ||
      record.plan.length !== 1 ||
      !record.plan[0]?.Plan ||
      typeof record.plan[0]["Execution Time"] !== "number" ||
      !/^[0-9a-f]{32}$/.test(record.query_md5 ?? "")
    )
      fail();
    if (
      record.kind === "helper" &&
      !/"Relation Name":"device_metric_observations"/.test(
        JSON.stringify(record.plan),
      )
    )
      fail();
  }
  for (const label of labels) {
    const measured = records.filter(
      (record) => record.kind === "query" && record.label === label,
    );
    const controls = records.filter(
      (record) => record.kind === "correctness" && record.label === label,
    );
    if (
      measured.length !== 3 ||
      measured
        .map((record) => record.repetition)
        .sort()
        .join() !== "1,2,3" ||
      controls.length !== 1 ||
      measured.some(
        (record) =>
          record.fingerprint !== measured[0].fingerprint ||
          record.query_md5 !== measured[0].query_md5,
      ) ||
      !/^[0-9a-f]{32}$/.test(measured[0]?.fingerprint ?? "") ||
      !/^[0-9a-f]{32}$/.test(controls[0]?.fingerprint ?? "")
    )
      fail();
  }
  if (
    records.filter((record) => record.kind === "query").length !==
      labels.length * 3 ||
    records.filter((record) => record.kind === "correctness").length !==
      labels.length ||
    records.filter((record) => record.kind === "write").length !== 6
  )
    fail();
  for (const label of ["metric-insert-5000", "legacy-insert-2500"]) {
    const writes = records.filter(
      (record) => record.kind === "write" && record.label === label,
    );
    if (
      writes.length !== 3 ||
      writes
        .map((record) => record.repetition)
        .sort()
        .join() !== "1,2,3" ||
      writes.some(
        (record) => record.rows !== (label.startsWith("metric") ? 5000 : 2500),
      )
    )
      fail();
  }
  const controls = records.filter((r) => r.kind === "policy-control");
  const policyPlans = records.filter((r) => r.kind === "policy-plan");
  const digest = (v) => /^[0-9a-f]{32}$/.test(v ?? "");
  const contextOK = (c, role, subject) =>
    c?.role === role &&
    c.subject === subject &&
    c.rls === true &&
    c.claims_match === true &&
    c.superuser === false &&
    c.bypassrls === false &&
    c.owner === false;
  const baseline = controls.find((r) => r.phase === "A");
  if (
    controls.map((r) => r.phase).join() !== "A,B,A2" ||
    policyPlans.length !== 18 ||
    !baseline
  )
    fail();
  for (const phase of ["A", "B", "A2"]) {
    const facts = controls.filter((r) => r.phase === phase);
    if (facts.length !== 1) fail();
    const fact = facts[0];
    if (
      fact.auth_rows !== 2 ||
      fact.memberships !== 2 ||
      fact.qual_matches !== true ||
      !["qual_md5", "catalog_md5", "unchanged_md5", "fixture_md5"].every((k) =>
        digest(fact[k]),
      ) ||
      fact.unchanged_md5 !== baseline.unchanged_md5 ||
      fact.fixture_md5 !== baseline.fixture_md5 ||
      (phase === "B"
        ? fact.qual_md5 === baseline.qual_md5 ||
          fact.catalog_md5 === baseline.catalog_md5
        : fact.qual_md5 !== baseline.qual_md5 ||
          fact.catalog_md5 !== baseline.catalog_md5) ||
      !Array.isArray(fact.cases) ||
      fact.cases.length !== 6
    )
      fail();
    for (const [label, rows, pageRows, subject] of [
      ["activeA", 1440, 50, "subjectA"],
      ["activeB", 720, 50, "subjectB"],
      ["unrelated", 0, 0, "subjectA"],
      ["revoked", 0, 0, "subjectA"],
      ["missing", 0, 0, "none"],
      ["anon", 0, 0, "none"],
    ]) {
      const cases = fact.cases.filter((c) => c.label === label);
      const before = baseline.cases?.find((c) => c.label === label);
      if (cases.length !== 1 || !before) fail();
      const c = cases[0];
      if (
        !contextOK(
          c.context,
          label === "anon" ? "anon" : "authenticated",
          subject,
        ) ||
        c.rows !== rows ||
        c.page_rows !== pageRows ||
        c.sqlstate !== (label === "anon" ? "42501" : "00000") ||
        !digest(c.full_fingerprint) ||
        !digest(c.page_fingerprint) ||
        c.full_fingerprint !== c.expected_full ||
        c.page_fingerprint !== c.expected_page ||
        c.full_fingerprint !== before.full_fingerprint ||
        c.page_fingerprint !== before.page_fingerprint
      )
        fail();
    }
    if (
      fact.cases.find((c) => c.label === "activeA").full_fingerprint ===
      fact.cases.find((c) => c.label === "activeB").full_fingerprint
    )
      fail();
    for (const label of ["alert-page", "alert-visible-count"]) {
      const plans = policyPlans.filter(
        (r) => r.phase === phase && r.label === label,
      );
      const first = policyPlans.find(
        (r) => r.phase === "A" && r.label === label,
      );
      if (
        plans.length !== 3 ||
        plans
          .map((r) => r.repetition)
          .sort()
          .join() !== "1,2,3" ||
        plans.some(
          (r) =>
            !contextOK(r.context, "authenticated", "subjectA") ||
            r.query_md5 !== first?.query_md5 ||
            !/"Relation Name":"alert_events"/.test(JSON.stringify(r.plan)),
        )
      )
        fail();
    }
  }
  return records;
}

export function benchmarkDiagnostic(stderr) {
  // Only reviewed SQL's fixed markers may escape the suppressed libpq detail.
  const assertion = stderr.match(
    /(?:^|\n)ERROR:[ \t]+P0001:[ \t]+T06_BENCHMARK:[ \t]+([^\r\n]+)\r?(?:\n|$)/,
  )?.[1];
  const stage = [
    "setup",
    "helpers",
    "prepare",
    "warmup",
    "measure",
    "write",
    "policy",
  ].find(
    (value) =>
      stderr.match(
        /(?:^|\n)DETAIL:[ \t]+T06_STAGE:[ \t]+([^\r\n]+)\r?(?:\n|$)/,
      )?.[1] === value,
  );
  const label = [
    "disposable provenance",
    "fresh device identities",
    "no registered tokens",
    "no deliveries",
    "unforced planner",
    "exact installed body/settings",
    "metric counts",
    "legacy counts",
    "feed counts",
    "journal counts",
    "real alert trigger counts",
    "zero deliveries",
    "no open feed identities",
    "SELECT extraction",
    "capture deadline",
    "per-capture bytes",
    "normalized/source-qualified counts",
    "raw chronology lacks declared output names",
    "warmup deadline",
    "non-null query result",
    "reading shape",
    "honest unknown time",
    "independent exact reading scope/C-order/cursor",
    "graph buckets",
    "independent graph count/last reading",
    "independent graph unknown count",
    "feed shape",
    "independent feed total",
    "independent feed chronology/cursor",
    "independent exact source chronology/receipt",
    "full-result fingerprint equality",
    "metric inserted rows",
    "legacy inserted rows",
    "write rollback",
    "policy fixture",
    "policy predecessor",
    "policy qualifier",
    "policy catalog restoration",
    "policy fixture restoration",
    "policy role/JWT/RLS",
    "policy result fingerprints",
    "policy phase",
  ].find((value) => value === assertion);
  return stage && label ? `; stage ${stage}; assertion ${label}` : "";
}

export async function runQueryBenchmark({
  databaseUrl,
  environment = process.env,
  outputDirectory,
  input,
  psqlPath = "psql",
}) {
  const env = queryEnvironment(databaseUrl, environment);
  const stdout = await new Promise((resolve, reject) => {
    let out = "",
      err = "",
      finished = false;
    const child = childProcess.spawn(
      psqlPath,
      [
        "-X",
        "--no-password",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
      ],
      { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const fail = (message) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      child.kill();
      reject(new Error(message));
    };
    const deadline = setTimeout(
      () => fail("T06 benchmark exceeded its 240s client deadline."),
      240_000,
    );
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
      if (Buffer.byteLength(out) > MAX_BYTES)
        fail("T06 artifact output exceeded its bound.");
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString().slice(0, Math.max(0, 16_384 - err.length));
    });
    child.on("error", () =>
      fail("T06 benchmark could not start its SQL client."),
    );
    child.stdin.on("error", () => fail("T06 benchmark SQL input failed."));
    child.on("close", (code) => {
      if (finished) return;
      if (code !== 0) {
        const state = err.match(/(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/);
        fail(
          `T06 benchmark SQL failed${state ? `; SQLSTATE ${state[1]}` : ""}${benchmarkDiagnostic(err)}. Raw detail suppressed.`,
        );
      } else {
        finished = true;
        clearTimeout(deadline);
        resolve(out);
      }
    });
    child.stdin.end(input);
  });
  let records;
  try {
    // Only these two test UUID literals are relabeled; no broad SQL/claim redactor.
    records = validateRecords(
      stdout
        .replaceAll("66000000-0000-4000-8000-000000000201", "subjectA")
        .replaceAll("66000000-0000-4000-8000-000000000202", "subjectB")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line)),
    );
  } catch {
    throw new Error(
      "T06 artifact validation failed; nothing publishable was written.",
    );
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "plans.json"),
    JSON.stringify(
      records.filter((r) =>
        ["helper", "query", "write", "policy-plan"].includes(r.kind),
      ),
    ) + "\n",
  );
  await writeFile(
    path.join(outputDirectory, "facts.json"),
    JSON.stringify(
      records.filter(
        (r) => !["helper", "query", "write", "policy-plan"].includes(r.kind),
      ),
    ) + "\n",
  );
  return records;
}

async function main() {
  queryEnvironment(process.env.LOCAL_TEST_DATABASE_URL);
  if (process.argv.length !== 2 || !process.env.RUNNER_TEMP)
    throw new Error("T06 accepts no SQL or target arguments.");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const commit = childProcess
    .execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    .trim();
  if (commit !== process.env.GITHUB_SHA)
    throw new Error("T06 checkout/CI commit mismatch.");
  const files = (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((file) => /^\d{14}_.*\.sql$/.test(file))
    .sort();
  if (
    files.length !== 23 ||
    files.at(-1) !== "20261114001100_backend_history_time.sql"
  )
    throw new Error("T06 experiment requires exact 23/01100 baseline.");
  const source = await readFile(
    new URL(
      "../migrations/20261114001100_backend_history_time.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const bodies = benchmarkSource(source);
  const sql = await readFile(sqlPath, "utf8");
  if (sql.split("__T06_BODIES__").length !== 2)
    throw new Error("T06 benchmark source marker mismatch.");
  const migrations = await Promise.all(
    files.map(async (file) => ({
      file,
      sha256: hash(
        await readFile(new URL(`../migrations/${file}`, import.meta.url)),
      ),
    })),
  );
  const instruments = await Promise.all(
    [
      "backend_query_plans.sql",
      "backend_query_benchmark.mjs",
      "backend_query_access.sql",
    ].map(async (file) => ({
      file,
      sha256: hash(await readFile(new URL(file, import.meta.url))),
    })),
  );
  const outputDirectory = path.join(
    process.env.RUNNER_TEMP,
    "t06-query-phase-b",
  );
  const records = await runQueryBenchmark({
    databaseUrl: process.env.LOCAL_TEST_DATABASE_URL,
    outputDirectory,
    input: sql.replace("__T06_BODIES__", q(JSON.stringify(bodies))),
  });
  const observedBodies = records.find(
    (record) => record.kind === "catalog",
  ).function_bodies;
  const bodyKeys = (items) =>
    items
      .map((item) => `${item.signature}=${item.body_md5}`)
      .sort()
      .join("\n");
  if (bodyKeys(observedBodies) !== bodyKeys(bodies))
    throw new Error("T06 artifact installed-body provenance mismatch.");
  const outputs = await Promise.all(
    ["plans.json", "facts.json"].map(async (file) => {
      const bytes = await readFile(path.join(outputDirectory, file));
      return { file, bytes: bytes.length, sha256: hash(bytes) };
    }),
  );
  const manifest = {
    commit,
    migrations,
    instruments,
    bodies,
    outputs,
    phase: "policy-A-B-A-control-only",
    subject_labels:
      "two fixed synthetic UUID literals only; subjectA/subjectB are not executable SQL",
    synthetic: true,
    max_bytes: MAX_BYTES,
    sql_deadline_seconds: 180,
  };
  const manifestText = JSON.stringify(manifest) + "\n";
  if (
    outputs.reduce(
      (total, file) => total + file.bytes,
      Buffer.byteLength(manifestText),
    ) > MAX_BYTES
  )
    throw new Error("T06 complete artifact exceeded its bound.");
  await writeFile(path.join(outputDirectory, "manifest.json"), manifestText);
  console.log(
    `T06 retained ${records.length} validated synthetic records; no index selection or production result claimed.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
