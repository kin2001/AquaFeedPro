import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs, { readdir } from "node:fs/promises";
import { test } from "node:test";
import { checkSharedBackendMetadata } from "../scripts/check-shared-backend-metadata.mjs";

const projectRef = "giilhohmrytpgyeyysir";
const checks = {
  roles_present: true,
  client_roles_do_not_bypass_rls: true,
  private_schema_protected: true,
  private_credentials_protected: true,
  service_rpcs_not_client_executable: true,
  public_tables_rls_enabled: true,
  durable_unique_indexes_valid: true,
  revision_measurement_columns_present: true,
  service_cannot_delete_journal: true,
  private_not_published: true,
};
const migrations = (await readdir(new URL("../migrations/", import.meta.url)))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort()
  .map((file) => ({ version: file.slice(0, 14), name: file.slice(15, -4) }));
function metadata(overrides = {}) {
  return {
    kind: "aquafeed_shared_metadata_v1",
    database: "postgres",
    server_version: "17.11",
    transaction_read_only: "on",
    statement_timeout: "10s",
    lock_timeout: "1s",
    checks,
    migrations,
    ...overrides,
  };
}
function respond(t, value) {
  t.mock.method(
    childProcess,
    "execFile",
    (_file, _args, _options, callback) => {
      queueMicrotask(() =>
        callback(
          null,
          JSON.stringify({
            boundary: "synthetic-boundary",
            rows: [{ backend_shared_metadata: value }],
            warning: "do-not-log-secret",
          }),
          "ignored CLI status",
        ),
      );
    },
  );
}

test("rejects missing/non-allowlisted targets before any network process", async (t) => {
  t.mock.method(childProcess, "execFile", () => {
    throw new Error("must not execute");
  });
  for (const ref of [undefined, "", "other-project", `${projectRef} --debug`]) {
    await assert.rejects(
      checkSharedBackendMetadata({ projectRef: ref }),
      /explicit allowlisted project/,
    );
  }
});

test("uses only reviewed static file and Management API flags, without dumping CLI output", async (t) => {
  const logs = [];
  t.mock.method(console, "log", (...parts) => logs.push(parts.join(" ")));
  t.mock.method(childProcess, "execFile", (file, args, options, callback) => {
    assert.match(file, /cli-windows-x64\/bin\/supabase\.exe$/);
    assert.deepEqual(args.slice(0, 5), [
      "db",
      "query",
      "--linked",
      "--project-ref",
      projectRef,
    ]);
    assert.equal(args[5], "--file");
    assert.match(
      args[6].replaceAll("\\", "/"),
      /\/supabase\/tests\/backend-shared-metadata\.sql$/,
    );
    assert.deepEqual(args.slice(7), [
      "--output",
      "json",
      "--log-level",
      "error",
    ]);
    assert.equal(options.timeout, 30_000);
    queueMicrotask(() =>
      callback(
        null,
        JSON.stringify({
          boundary: "synthetic-boundary",
          rows: [{ backend_shared_metadata: metadata() }],
          warning: "do-not-log-secret",
        }),
        "do-not-log-secret",
      ),
    );
  });
  const result = await checkSharedBackendMetadata({ projectRef });
  assert.equal(result.catalog_status, "PASS");
  assert.equal(result.migration_status, "MATCH");
  assert.equal(result.full_sql_status, "UNVERIFIED");
  assert.doesNotMatch(logs.join("\n"), /do-not-log-secret/);
});

test("reports historical IDs and absent migration separately from catalog PASS", async (t) => {
  const remote = migrations
    .filter((row) => row.version !== "20261103120000")
    .map((row) => ({
      ...row,
      version:
        { 20261002194139: "20261002204906", 20261002205502: "20261002210131" }[
          row.version
        ] || row.version,
    }));
  respond(t, metadata({ migrations: remote }));
  const result = await checkSharedBackendMetadata({ projectRef });
  assert.equal(result.catalog_status, "PASS");
  assert.equal(result.migration_status, "DRIFT");
  assert.deepEqual(
    result.migration_drift.id_differences.map(
      ({ local_version, remote_version }) => [local_version, remote_version],
    ),
    [
      ["20261002194139", "20261002204906"],
      ["20261002205502", "20261002210131"],
    ],
  );
  assert.deepEqual(
    result.migration_drift.local_only.map(({ version }) => version),
    ["20261103120000"],
  );
  assert.equal(result.remote_migration_count, 18);
  assert.equal(result.full_sql_status, "UNVERIFIED");
});

test("CLI/query errors propagate without stderr/credential content", async (t) => {
  t.mock.method(
    childProcess,
    "execFile",
    (_file, _args, _options, callback) => {
      queueMicrotask(() =>
        callback(
          new Error("do-not-log-secret"),
          "do-not-log-secret",
          "do-not-log-secret",
        ),
      );
    },
  );
  await assert.rejects(checkSharedBackendMetadata({ projectRef }), (error) => {
    assert.match(error.message, /Shared metadata CLI query failed/);
    assert.doesNotMatch(error.message, /do-not-log-secret/);
    return true;
  });
});

test("missing/malformed envelopes and missing safety flags fail closed", async (t) => {
  for (const output of [
    "not-json",
    "[]",
    JSON.stringify([{ backend_shared_metadata: metadata() }]),
    JSON.stringify({ rows: [] }),
    JSON.stringify({
      rows: [{ backend_shared_metadata: metadata({ checks: {} }) }],
    }),
  ]) {
    t.mock.method(
      childProcess,
      "execFile",
      (_file, _args, _options, callback) => {
        queueMicrotask(() => callback(null, output, "do-not-log-secret"));
      },
    );
    await assert.rejects(
      checkSharedBackendMetadata({ projectRef }),
      /Invalid shared metadata response/,
    );
  }
});

test("non-true catalog safety flags are rejected", async (t) => {
  for (const value of [false, null, 1, "true"]) {
    respond(
      t,
      metadata({
        checks: { ...checks, service_rpcs_not_client_executable: value },
      }),
    );
    await assert.rejects(
      checkSharedBackendMetadata({ projectRef }),
      /Shared catalog checks failed/,
    );
  }
});

test("incorrect identity, read-write transactions and incorrect/missing timeouts are rejected", async (t) => {
  for (const overrides of [
    { database: "another-database" },
    { server_version: "18.0" },
    { transaction_read_only: "off" },
    { statement_timeout: "0" },
    { lock_timeout: "0" },
    { lock_timeout: undefined },
  ]) {
    respond(t, metadata(overrides));
    await assert.rejects(
      checkSharedBackendMetadata({ projectRef }),
      /Invalid shared metadata response/,
    );
  }
});

test("changed unreviewed SQL is rejected before any CLI process", async (t) => {
  t.mock.method(fs, "readFile", async () =>
    Buffer.from("select unreviewed_query();"),
  );
  t.mock.method(childProcess, "execFile", () => {
    throw new Error("must not execute");
  });
  await assert.rejects(
    checkSharedBackendMetadata({ projectRef }),
    /SQL differs from the reviewed checksum/,
  );
});
