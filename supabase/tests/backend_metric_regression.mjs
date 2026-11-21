import childProcess from "node:child_process";
import path from "node:path";
import { isolatedConnection } from "../scripts/check-backend-baseline.mjs";

export function metricMigrationIndex(files) {
  const indices = files.flatMap((file, index) => path.basename(file) === "20261114001000_backend_metric_observations.sql" ? [index] : []);
  if (indices.length !== 1) throw new Error("Exactly one reserved T04 migration is required.");
  return indices[0];
}

// This proves missing installation ONLY, not old business behavior. Forward SQL tests prove behavior.
export function requireMetricOldRed({ code, stdout, stderr }) {
  const errors = [...stderr.matchAll(/^(?:psql:[^\r\n]+:\d+:\s*)?(?:ERROR|FATAL):[^\r\n]*$/gm)];
  if (code !== 3 || stdout.trim() !== "" || errors.length !== 1 ||
    !/^(?:psql:[^\r\n]+:\d+:\s*)?ERROR:\s+P0001:\s*T04_CURRENT_METRICS_NOT_INSTALLED$/.test(errors[0]?.[0] ?? ""))
    throw new Error("The exact T04 missing-installation OLD assertion was not observed.");
}

export async function runMetricOldRed({ databaseUrl, psqlPath = "psql" }) {
  const env = isolatedConnection(databaseUrl);
  const result = await new Promise((resolve, reject) => {
    const child = childProcess.spawn(psqlPath, ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"], {
      env: { ...env, PGAPPNAME: "aquafeed-t04-installation-control" }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    let stdout = "", stderr = "";
    const deadline = setTimeout(() => { child.kill(); reject(new Error("T04 isolated control timed out.")); }, 30000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString().slice(0, Math.max(0, 16384 - stdout.length)); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString().slice(0, Math.max(0, 16384 - stderr.length)); });
    child.once("error", () => { clearTimeout(deadline); reject(new Error("T04 could not start isolated psql.")); });
    child.once("close", (code) => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
    child.stdin.on("error", () => {});
    child.stdin.end(`BEGIN;
SET LOCAL statement_timeout='10s';
DO $gate$ BEGIN
  IF current_database()<>'aquafeed_backend_test' OR NOT EXISTS (
    SELECT 1 FROM backend_test.provenance WHERE singleton AND migration_fixtures_created
    AND NOT migration_fixtures_cleaned AND database_oid=(SELECT oid FROM pg_database WHERE datname=current_database()))
    THEN RAISE EXCEPTION 'T04_CONTROL_PROVENANCE_MISMATCH'; END IF;
  IF to_regclass('public.device_metric_observations') IS NULL
    AND to_regclass('public.device_metric_current') IS NULL
    AND to_regprocedure('public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb)') IS NULL
    THEN RAISE EXCEPTION 'T04_CURRENT_METRICS_NOT_INSTALLED'; END IF;
  RAISE EXCEPTION 'T04_CONTROL_UNEXPECTED_INSTALLATION';
END $gate$;
ROLLBACK;`);
  });
  requireMetricOldRed(result);
  console.log("PASS T04 exact missing-installation OLD RED (not old business-behavior proof)");
}
