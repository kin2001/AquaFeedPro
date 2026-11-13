import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_REF = "giilhohmrytpgyeyysir";
const CLI =
  "D:/DevCache/Shofiliate/npm-cache/_npx/0e23c24576954b26/node_modules/@supabase/cli-windows-x64/bin/supabase.exe";
const SQL_FILE = fileURLToPath(
  new URL("../tests/backend-shared-metadata.sql", import.meta.url),
);
// Parent reviewed/executed these exact static bytes; changed SQL requires another review.
const SQL_SHA256 =
  "9448ef842cbc581f59ea5d54e005af78f2a2b80a1ece20ed8311cba2ada537ca";
const CHECKS = [
  "roles_present",
  "client_roles_do_not_bypass_rls",
  "private_schema_protected",
  "private_credentials_protected",
  "service_rpcs_not_client_executable",
  "public_tables_rls_enabled",
  "durable_unique_indexes_valid",
  "revision_measurement_columns_present",
  "service_cannot_delete_journal",
  "private_not_published",
];

export async function summarizeSharedBackendMetadata(envelope) {
  const data = envelope?.rows?.[0]?.backend_shared_metadata;
  if (
    !Array.isArray(envelope?.rows) ||
    envelope.rows.length !== 1 ||
    data?.kind !== "aquafeed_shared_metadata_v1" ||
    data.database !== "postgres" ||
    typeof data.server_version !== "string" ||
    !/^17\.\d+(?:\.\d+)?$/.test(data.server_version) ||
    data.transaction_read_only !== "on" ||
    data.statement_timeout !== "10s" ||
    data.lock_timeout !== "1s" ||
    !data.checks ||
    Object.keys(data.checks).length !== CHECKS.length ||
    !CHECKS.every((name) => Object.hasOwn(data.checks, name)) ||
    !Array.isArray(data.migrations) ||
    !data.migrations.every(
      (row) =>
        typeof row?.version === "string" &&
        /^\d{14}$/.test(row.version) &&
        typeof row?.name === "string" &&
        /^[a-z0-9_]+$/.test(row.name),
    ) ||
    new Set(data.migrations.map((row) => row.version)).size !==
      data.migrations.length
  ) {
    throw new Error(
      "Invalid shared metadata response; no acceptance established.",
    );
  }
  const failed = CHECKS.filter((name) => data.checks[name] !== true);
  if (failed.length)
    throw new Error(`Shared catalog checks failed: ${failed.join(", ")}.`);

  const files = await fs.readdir(new URL("../migrations/", import.meta.url));
  const local = files
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((file) => ({ version: file.slice(0, 14), name: file.slice(15, -4) }));
  const remote = data.migrations;
  const idDifferences = local.flatMap((row) => {
    const match = remote.find(
      (other) => other.name === row.name && other.version !== row.version,
    );
    return match
      ? [
          {
            name: row.name,
            local_version: row.version,
            remote_version: match.version,
          },
        ]
      : [];
  });
  const drift = {
    id_differences: idDifferences,
    local_only: local.filter(
      (row) =>
        !remote.some(
          (other) => other.version === row.version || other.name === row.name,
        ),
    ),
    remote_only: remote.filter(
      (row) =>
        !local.some(
          (other) => other.version === row.version || other.name === row.name,
        ),
    ),
    name_differences: local.flatMap((row) => {
      const match = remote.find(
        (other) => other.version === row.version && other.name !== row.name,
      );
      return match
        ? [
            {
              version: row.version,
              local_name: row.name,
              remote_name: match.name,
            },
          ]
        : [];
    }),
  };
  return {
    project_ref: PROJECT_REF,
    database: data.database,
    server_version: data.server_version,
    catalog_status: "PASS",
    catalog_checks: data.checks,
    transaction_read_only: data.transaction_read_only,
    statement_timeout: data.statement_timeout,
    lock_timeout: data.lock_timeout,
    remote_migration_count: remote.length,
    migration_status: Object.values(drift).some((rows) => rows.length)
      ? "DRIFT"
      : "MATCH",
    migration_drift: drift,
    full_sql_status: "UNVERIFIED",
    recovery_status: "UNVERIFIED",
  };
}

export async function checkSharedBackendMetadata({ projectRef }) {
  if (projectRef !== PROJECT_REF)
    throw new Error("An explicit allowlisted project ref is required.");
  const sql = await fs.readFile(SQL_FILE);
  if (createHash("sha256").update(sql).digest("hex") !== SQL_SHA256) {
    throw new Error(
      "Static SQL differs from the reviewed checksum; obtain parent review before execution.",
    );
  }
  const stdout = await new Promise((resolve, reject) => {
    childProcess.execFile(
      CLI,
      [
        "db",
        "query",
        "--linked",
        "--project-ref",
        projectRef,
        "--file",
        SQL_FILE,
        "--output",
        "json",
        "--log-level",
        "error",
      ],
      { timeout: 30_000, maxBuffer: 1_048_576, windowsHide: true },
      (error, output) => {
        // Never forward CLI stderr/errors; they may contain connection/credential details.
        if (error)
          reject(
            new Error(
              "Shared metadata CLI query failed; no acceptance established.",
            ),
          );
        else resolve(output);
      },
    );
  });
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error(
      "Invalid shared metadata response; no acceptance established.",
    );
  }
  return summarizeSharedBackendMetadata(envelope);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const result =
    args.length === 2 && args[0] === "--project-ref"
      ? checkSharedBackendMetadata({ projectRef: args[1] })
      : Promise.reject(
          new Error(
            "Usage: node supabase/scripts/check-shared-backend-metadata.mjs --project-ref giilhohmrytpgyeyysir",
          ),
        );
  result
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      // Catalog PASS is not an overall PASS, and historical drift must remain visible.
      process.exitCode = summary.migration_status === "DRIFT" ? 2 : 0;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
