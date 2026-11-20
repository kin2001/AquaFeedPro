import childProcess from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const fixtureWarningBySuite = new Map([
  ["backend_resource_updates.sql", "T08_TEST_INSERT_FAILURE"],
  ["backend_device_sync.sql", "T08_TEST_AGGREGATE_INSERT_FAILURE"],
]);

export function isolatedConnection(databaseUrl) {
  let connection;
  try {
    connection = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(connection.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname) ||
      connection.pathname !== "/aquafeed_backend_test" ||
      connection.search ||
      connection.hash
    )
      throw new Error();
    const user = decodeURIComponent(connection.username) || "postgres";
    const password = decodeURIComponent(connection.password);
    if (user.includes("\0") || password.includes("\0")) throw new Error();
    // Do not inherit libpq service/host overrides, options, or credential files.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.toUpperCase().startsWith("PG"),
      ),
    );
    return {
      ...env,
      PGHOST: connection.hostname.replace(/^\[|\]$/g, ""),
      PGPORT: connection.port || "5432",
      PGDATABASE: "aquafeed_backend_test",
      PGUSER: user,
      PGPASSWORD: password,
      PGCONNECT_TIMEOUT: "10",
      PGAPPNAME: "aquafeed-backend-baseline",
      LC_ALL: "C",
      PGPASSFILE: process.platform === "win32" ? "NUL" : "/dev/null",
    };
  } catch {
    throw new Error(
      "An explicit isolated loopback URL for aquafeed_backend_test is required (no query overrides).",
    );
  }
}

export async function runSqlSuites({ databaseUrl, psqlPath = "psql", suites }) {
  const env = isolatedConnection(databaseUrl);
  for (const suite of suites) {
    const fixtureWarning = fixtureWarningBySuite.get(path.basename(suite));
    await new Promise((resolve, reject) => {
      let stderr = "";
      let stderrTruncated = false;
      const child = childProcess.spawn(
        psqlPath,
        [
          "-X",
          "--no-password",
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "VERBOSITY=verbose",
          "-f",
          suite,
        ],
        {
          env,
          // Never echo SQL/libpq messages; extract only a bounded SQLSTATE/line header.
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        },
      );
      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString();
        const remaining = Math.max(0, 16_384 - stderr.length);
        stderrTruncated ||= text.length > remaining;
        stderr += text.slice(0, remaining);
      });
      child.once("error", () =>
        reject(
          new Error(
            "Unable to start psql; install/provide a local PostgreSQL client.",
          ),
        ),
      );
      child.once("close", (code) => {
        if (code !== 0) {
          const diagnostic = stderr.match(
            /(?:^|\n)psql:[^\r\n]+:(\d+):\s+(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/,
          );
          const inline = stderr.match(
            /(?:^|\n)CONTEXT:\s+PL\/pgSQL function inline_code_block line (\d+) at [A-Z ]+(?:\r?\n|$)/,
          );
          const detail = diagnostic
            ? ` SQLSTATE ${diagnostic[2]}, line ${Number(diagnostic[1])}.${inline ? ` inline block line ${Number(inline[1])}.` : ""}`
            : "";
          reject(
            new Error(
              `SQL suite failed: ${path.basename(suite)} (exit ${code ?? "signal"}).${detail}`,
            ),
          );
        } else if (
          fixtureWarning &&
          (stderrTruncated ||
            [
              ...stderr.matchAll(
                /(?:^|\n)psql:[^\r\n]+:\d+:\s+WARNING:\s+(?:[0-9A-Z]{5}:\s+)?T08_FIXTURE_SEND: (T08_TEST_[A-Z_]+)(?=\r?\n|$)/g,
              ),
            ]
              .map((match) => match[1])
              .join(",") !== fixtureWarning ||
            /(?:^|\n)psql:[^\r\n]+:\d+:\s+WARNING:\s+(?:[0-9A-Z]{5}:\s+)?T08_BROADCAST_FAILED(?=\r?\n|$)/.test(
              stderr,
            ))
        ) {
          reject(
            new Error(
              "SQL suite controlled warning evidence failed; raw diagnostics suppressed.",
            ),
          );
        } else resolve();
      });
    });
    console.log(`PASS ${path.basename(suite)}`);
  }
}

export async function baselineSqlFiles() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const migrations = (await readdir(path.join(root, "migrations")))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
  const suites = [
    "tests/backend-test-bootstrap.sql",
    ...migrations.flatMap((file) => [
      // ART33 and ART97 upgrade profiles provisioned out-of-band in the historical baseline.
      ...(file === "20261009120000_art33_independent_nozzle_schedules.sql"
        ? ["tests/backend-test-fixtures.sql"]
        : []),
      `migrations/${file}`,
    ]),
    "tests/backend-test-migration-fixtures-cleanup.sql",
    "tests/art7_two_installation_access.sql",
    "tests/art38_device_access.sql",
    "tests/backend-test-fixtures.sql",
    "tests/art27_live_monitoring.sql",
    "tests/art27_monitoring_settings.sql",
    "tests/art31_manual_feed.sql",
    "tests/art33_schedules.sql",
    "tests/rt01_device_wait_and_realtime.sql",
    "tests/art95_server_alerts.sql",
    "tests/art96_push_delivery.sql",
    "tests/art102_shared_device_metadata.sql",
    "tests/backend_device_sync.sql",
    "tests/backend_resource_updates.sql",
    "tests/backend_metric_observations.sql",
    "tests/backend_history_time.sql",
    "tests/backend_query_access.sql",
    "tests/backend_reporting_configuration.sql",
  ].map((file) => path.join(root, file));
  return suites;
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 2 ||
    args[0] !== "--database-url-env" ||
    !/^[A-Z_][A-Z0-9_]*$/.test(args[1])
  ) {
    throw new Error(
      "Usage: node supabase/scripts/check-backend-baseline.mjs --database-url-env LOCAL_TEST_DATABASE_URL",
    );
  }
  const options = {
    databaseUrl: process.env[args[1]],
    psqlPath: process.env.PSQL_PATH || "psql",
  };
  const suites = await baselineSqlFiles();
  const { metricMigrationIndex, runMetricOldRed } =
    await import("../tests/backend_metric_regression.mjs");
  const metricIndex = metricMigrationIndex(suites);
  await runSqlSuites({ ...options, suites: suites.slice(0, metricIndex) });
  await runMetricOldRed(options);
  const { installMetricWithAclControl } =
    await import("../tests/backend_metric_acl_regression.mjs");
  // Apply the exact forward body once persistently; adversarial OLD is transactionally rolled back.
  await installMetricWithAclControl(options);
  await runSqlSuites({ ...options, suites: suites.slice(metricIndex + 1) });
  // Serial and disposable-only: temporarily installs OLD telemetry, then restores the forward body.
  const { runLockOrder } = await import("../tests/backend_lock_order.mjs");
  try {
    await runLockOrder(options);
  } catch {
    // Assertion messages can contain SQL results; do not forward them to CI logs.
    throw new Error(
      "Isolated lock-order regression failed; raw SQL/results suppressed.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
