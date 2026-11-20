import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkBackendRelease,
  parseOptions,
} from "../scripts/check-backend-release.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = "giilhohmrytpgyeyysir";
const args = [
  "--project-ref",
  project,
  "--app-api-version",
  "11",
  "--device-api-version",
  "8",
  "--push-sender-version",
  "2",
];
const filesBySlug = {
  "app-api": [
    "app-api/index.ts",
    "_shared/device-access.ts",
    "_shared/history.ts",
    "_shared/telemetry.ts",
  ],
  "device-api": [
    "device-api/index.ts",
    "_shared/device-access.ts",
    "_shared/telemetry.ts",
  ],
  "push-sender": [
    "push-sender/index.ts",
    "_shared/device-access.ts",
    "_shared/push-sender.ts",
  ],
};
const deployed = [
  { slug: "app-api", version: 11, status: "ACTIVE", verify_jwt: true },
  { slug: "device-api", version: 8, status: "ACTIVE", verify_jwt: false },
  { slug: "push-sender", version: 2, status: "ACTIVE", verify_jwt: false },
];
const oldLocalVersion = "20261002194139";
const oldRemoteVersion = "20261002204906";
const pendingVersion = "20261114001500";
const unknownRemoteName = "sensitive_identifier_never_report";

async function fixture(t) {
  const local = await mkdtemp(
    path.join(os.tmpdir(), "aquafeed-release-fixture-"),
  );
  t.after(() => rm(local, { recursive: true, force: true }));
  await mkdir(path.join(local, "migrations"));
  await writeFile(
    path.join(local, "config.toml"),
    await readFile(path.join(root, "config.toml")),
  );
  const migrations = [
    { version: oldLocalVersion, name: "foundation" },
    { version: "20261103120000", name: "scheduled_missed_feeding_alerts" },
    { version: pendingVersion, name: "backend_device_sync" },
  ];
  for (const { version, name } of migrations)
    await writeFile(
      path.join(local, "migrations", `${version}_${name}.sql`),
      "-- fixture",
    );
  for (const file of new Set(Object.values(filesBySlug).flat())) {
    const target = path.join(local, "functions", file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `// Local fixture: ${file}\n`);
  }
  return { local, migrations };
}

function transport({
  local,
  migrations,
  functions = deployed,
  changedFile,
  metadataFailure,
  extraFile,
  unavailableSource,
  wrongDownloadProject,
}) {
  const calls = [];
  const scratch = [];
  const run = async (file, argv, cwd) => {
    calls.push({ file, argv, cwd });
    assert.equal(argv[argv.indexOf("--project-ref") + 1], project);
    assert.equal(argv.includes("--linked"), argv[0] === "db");
    if (argv[0] === "db" && argv[1] === "query") {
      assert.match(
        argv.join(" "),
        /select version, name from supabase_migrations\.schema_migrations order by version/i,
      );
      if (metadataFailure)
        throw new Error("permission denied: password=do_not_print");
      return JSON.stringify({ rows: migrations });
    }
    if (argv[0] === "functions" && argv[1] === "list") {
      return JSON.stringify(functions);
    }
    if (argv[0] === "functions" && argv[1] === "download") {
      assert.equal(argv.includes("--use-api"), true);
      assert.equal(argv[argv.indexOf("--workdir") + 1], cwd);
      scratch.push(cwd);
      if (argv[2] === unavailableSource)
        throw new Error("private provider diagnostic");
      for (const name of [
        ...filesBySlug[argv[2]],
        ...(extraFile ? [extraFile] : []),
      ]) {
        const destination = path.join(cwd, "supabase", "functions", name);
        await mkdir(path.dirname(destination), { recursive: true });
        const data =
          name === changedFile || name === extraFile
            ? "sensitive deployed code never reported"
            : await readFile(path.join(local, "functions", name));
        await writeFile(destination, data);
      }
      return JSON.stringify({
        function_slugs: [argv[2]],
        project_ref: wrongDownloadProject
          ? "unexpected_private_project"
          : project,
      });
    }
    assert.fail("Unexpected command");
  };
  return { calls, run, scratch };
}

test("a matching candidate checks each function in a distinct disposable directory", async (t) => {
  const values = await fixture(t);
  const { calls, run, scratch } = transport(values);
  const report = await checkBackendRelease(parseOptions(args), {
    supabaseDir: values.local,
    run,
  });
  assert.equal(report.status, "PASS");
  assert.deepEqual(
    calls.map(({ argv }) => argv.slice(0, 2).join(" ")),
    [
      "db query",
      "functions list",
      "functions download",
      "functions download",
      "functions download",
    ],
  );
  assert.equal(new Set(scratch).size, 3);
  for (const directory of scratch) {
    await assert.rejects(
      readFile(path.join(directory, "supabase", "config.toml")),
      { code: "ENOENT" },
    );
  }
});

test("equal migration names on different IDs and absent pending versions are drift", async (t) => {
  const values = await fixture(t);
  const { run } = transport({
    ...values,
    migrations: [
      { version: oldRemoteVersion, name: "foundation" },
      values.migrations[1],
      { version: "20261199000000", name: unknownRemoteName },
    ],
  });
  const report = await checkBackendRelease(parseOptions(args), {
    supabaseDir: values.local,
    run,
  });
  assert.equal(report.status, "DRIFT");
  const migration = report.migrations;
  assert.deepEqual(migration.idMismatches, [
    { localVersion: oldLocalVersion, remoteVersion: oldRemoteVersion },
  ]);
  assert.deepEqual(migration.missingVersions, [pendingVersion]);
  assert.deepEqual(migration.unexpectedVersions, ["20261199000000"]);
  assert.doesNotMatch(JSON.stringify(report), /sensitive_identifier/);
});

test("an empty remote catalog is drift, while missing migration rows are unverified", async (t) => {
  const values = await fixture(t);
  const empty = transport({ ...values, migrations: [] });
  const report = await checkBackendRelease(parseOptions(args), {
    supabaseDir: values.local,
    run: empty.run,
  });
  assert.equal(report.status, "DRIFT");
  assert.deepEqual(
    report.migrations.missingVersions,
    values.migrations.map(({ version }) => version),
  );

  const invalid = transport({ ...values, migrations: undefined });
  const missing = await checkBackendRelease(parseOptions(args), {
    supabaseDir: values.local,
    run: invalid.run,
  });
  assert.equal(missing.status, "UNVERIFIED");
});

test("matching IDs with different names and a wrong deployed version are drift", async (t) => {
  const values = await fixture(t);
  const { run } = transport({
    ...values,
    migrations: [
      { version: oldLocalVersion, name: unknownRemoteName },
      ...values.migrations.slice(1),
    ],
    functions: [{ ...deployed[0], version: 10 }, ...deployed.slice(1)],
  });
  const report = await checkBackendRelease(parseOptions(args), {
    supabaseDir: values.local,
    run,
  });
  assert.equal(report.status, "DRIFT");
  assert.deepEqual(report.migrations.nameMismatches, [oldLocalVersion]);
  assert.equal(report.functions["app-api"].version, "DRIFT");
  assert.doesNotMatch(JSON.stringify(report), /sensitive_identifier/);
});

test("shared source bytes and unexpected bundle files are reported without source content", async (t) => {
  const values = await fixture(t);
  const { run } = transport({
    ...values,
    changedFile: "_shared/telemetry.ts",
    extraFile: "_shared/secret_file.ts",
  });
  const report = await checkBackendRelease(parseOptions(args), {
    supabaseDir: values.local,
    run,
  });
  assert.equal(report.status, "DRIFT");
  assert.deepEqual(report.functions["device-api"].changedFiles, [
    "_shared/telemetry.ts",
  ]);
  assert.equal(report.functions["device-api"].extraFiles, 1);
  assert.doesNotMatch(
    JSON.stringify(report),
    /secret_file|sensitive deployed code/,
  );
});

test("an unauthorized project is rejected without running commands", async () => {
  const run = () => assert.fail("Should not execute CLI");
  assert.throws(
    () =>
      parseOptions(
        args.map((value) =>
          value === project ? "aaaaaaaaaaaaaaaaaaaa" : value,
        ),
      ),
    /allowlisted/,
  );
  await assert.rejects(
    checkBackendRelease(
      { ...parseOptions(args), projectRef: "aaaaaaaaaaaaaaaaaaaa" },
      { run },
    ),
    /allowlisted/,
  );
});

test("permission failure leaves blocked evidence unverified without echoing diagnostics", async (t) => {
  const values = await fixture(t);
  const { run } = transport({ ...values, metadataFailure: true });
  const report = await checkBackendRelease(parseOptions(args), {
    supabaseDir: values.local,
    run,
  });
  assert.equal(report.status, "UNVERIFIED");
  assert.equal(report.migrations.status, "UNVERIFIED");
  assert.equal(report.functions["app-api"].source, "PASS");
  assert.doesNotMatch(JSON.stringify(report), /password|do_not_print/);
});

test("a known deployment mismatch stays visible when a different source is unavailable", async (t) => {
  const values = await fixture(t);
  const { run } = transport({
    ...values,
    functions: [{ ...deployed[0], verify_jwt: false }, ...deployed.slice(1)],
    unavailableSource: "device-api",
  });
  const report = await checkBackendRelease(parseOptions(args), {
    supabaseDir: values.local,
    run,
  });
  assert.equal(report.status, "DRIFT");
  assert.equal(report.functions["app-api"].jwt, "DRIFT");
  assert.equal(report.functions["device-api"].source, "UNVERIFIED");
  assert.doesNotMatch(JSON.stringify(report), /private provider diagnostic/);
});

test("a download with the wrong project identity is unverified even with matching source", async (t) => {
  const values = await fixture(t);
  const { run } = transport({ ...values, wrongDownloadProject: true });
  const report = await checkBackendRelease(parseOptions(args), {
    supabaseDir: values.local,
    run,
  });
  assert.equal(report.status, "UNVERIFIED");
  assert.equal(report.functions["app-api"].source, "UNVERIFIED");
  assert.doesNotMatch(JSON.stringify(report), /unexpected_private_project/);
});

test("an ambiguous local JWT policy cannot produce a pass", async (t) => {
  const values = await fixture(t);
  const configPath = path.join(values.local, "config.toml");
  const config = await readFile(configPath, "utf8");
  await writeFile(configPath, `nonsense = """\n${config}\n"""\n`);
  const { run } = transport(values);
  const report = await checkBackendRelease(parseOptions(args), {
    supabaseDir: values.local,
    run,
  });
  assert.equal(report.status, "UNVERIFIED");
  assert.equal(report.functions["app-api"].jwt, "UNVERIFIED");
});
