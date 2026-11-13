import childProcess from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function isolatedConnection(databaseUrl) {
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
    await new Promise((resolve, reject) => {
      let stderr = "";
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
        stderr += chunk
          .toString()
          .slice(0, Math.max(0, 16_384 - stderr.length));
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
          const detail = diagnostic
            ? ` SQLSTATE ${diagnostic[2]}, line ${Number(diagnostic[1])}.`
            : "";
          reject(
            new Error(
              `SQL suite failed: ${path.basename(suite)} (exit ${code ?? "signal"}).${detail}`,
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
  await runSqlSuites({
    databaseUrl: process.env[args[1]],
    psqlPath: process.env.PSQL_PATH || "psql",
    suites: await baselineSqlFiles(),
  });
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
