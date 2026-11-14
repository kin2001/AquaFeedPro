// CI-only public-schema generation. Never login/link or inspect the shared project.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isolatedConnection } from "./check-backend-baseline.mjs";

const CLI_VERSION = "2.120.0";
const CLI_URL = "https://github.com/supabase/cli/releases/download/v2.120.0/supabase_2.120.0_linux_amd64.tar.gz";
const CLI_SHA256 = "7074584113aa00495beeac661c41fb09f1ddd0a483cd7333894b0d080086dc6e";
const sha = (text) => createHash("sha256").update(text).digest("hex");

export function generationTarget(env, platform = process.platform) {
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || !env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP))
    throw new Error("Public type acquisition is allowed only on the disposable Linux CI runner.");
  isolatedConnection(env.LOCAL_TEST_DATABASE_URL);
  const url = new URL(env.LOCAL_TEST_DATABASE_URL);
  if (url.hostname !== "127.0.0.1" || url.port !== "54322" || url.username !== "postgres" || url.password !== "isolated-ci-only")
    throw new Error("Only the declared disposable CI service is allowed.");
  return url;
}

export function publicTypesOnly(source) {
  const schemas = [...source.matchAll(/^ {2}(?:"([^"]+)"|([A-Za-z_][A-Za-z_0-9]*)):\s*\{/gm)].map((match) => match[1] ?? match[2]);
  if (!source.includes("export type Database = {") || !schemas.includes("public") ||
    schemas.some((schema) => !["public", "__InternalSupabase"].includes(schema)) ||
    /\b(?:device_credentials|installation_push_tokens|alert_push_deliveries|pairing_challenges|security_audit_events|device_alert_state|installation_alert_event_state|installation_alert_bulk_state|api_rate_windows|alert_push_sender_state):\s*\{\s*Row:\s*\{/.test(source) ||
    !["device_metric_observations:", "device_metric_current:", "device_resource_versions:", "backend_sync_metrics:"].every((key) => source.includes(key)))
    throw new Error("Generated artifact is not the expected public-only metric schema.");
  return source;
}

export function nativeGeneratorProvenance(version, frontend, sidecar) {
  if (version !== CLI_VERSION || !Buffer.isBuffer(frontend) || !frontend.length || !Buffer.isBuffer(sidecar) || !sidecar.length)
    throw new Error("Verified native CLI binary provenance is missing.");
  return {
    mode: "source_traced_native_in_process",
    frontend_version_observed: version,
    frontend_sha256: sha(frontend), sidecar_sha256: sha(sidecar), sidecar_invoked: false,
    source_ref: "v2.120.0", source_commit: "753520fa7202ed5f8b25883a4c0aa7e5e9ad1fc4",
    typegen_library: { version: "0.2.2", evidence: "pinned_source_package_json_not_runtime_inspection" },
  };
}

export async function seedTypegenConfig(work, runnerTemp) {
  if (typeof work !== "string" || typeof runnerTemp !== "string" || !path.isAbsolute(work) || !path.isAbsolute(runnerTemp))
    throw new Error("Ephemeral CLI config requires the fresh absolute runner work directory.");
  const relative = path.relative(await realpath(runnerTemp), await realpath(work));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("Ephemeral CLI config must remain inside runner temp.");
  // Keep config's supabase directory separate from the co-located supabase binary file.
  const workdir = path.join(work, "schema-project");
  await mkdir(workdir);
  await mkdir(path.join(workdir, "supabase"));
  const content = 'project_id = "aquafeed-t04-public-types-ci"\n\n[db]\nport = 54322\n';
  const file = path.join(workdir, "supabase", "config.toml");
  await writeFile(file, content, { flag: "wx" });
  const actual = await readFile(file);
  if (actual.toString("utf8") !== content) throw new Error("Ephemeral CLI config readback mismatch.");
  return { workdir, provenance: { relative_path: "supabase/config.toml", relative_to: "cli_cwd", content, sha256: sha(actual) } };
}

export function generationFailureDetail(stage, result) {
  if (stage !== "cli-generate") return null;
  try {
    if (!result.error && result.status === 0) return null;
    let text = typeof result.stderr === "string" ? result.stderr : "";
    text = text.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\p{Cf}|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/gu, "")
      .replace(/\\+\//g, "/").replace(/\\+(["'])/g, "$1").replace(/\\[nr]/g, "\n").replace(/\\t/g, " ");
    text = text.replace(/isolated(?:-|%2d)ci(?:-|%2d)only/gi, "[REDACTED]")
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[URL_REDACTED]")
      .replace(/\b[^\s:/@]+:[^\s@]+@[^\s"'<>]+/g, "[DSN_REDACTED]")
      // Coarsely redact credential-bearing tails; diagnostic prose is less important than credentials.
      .replace(/\bBearer(?:\s*:\s*|\s+)[^\r\n]*/gi, "Bearer [REDACTED]")
      .replace(/\b((?:(?:[a-z0-9_]*_)?(?:authorization|password|passwd|(?:access|refresh|id)[_-]?token|token|api[-_]?key|secret|credential)|[a-z0-9_]+_key)\b["']?\s*(?:[:=]|\s)\s*)[^\r\n]*/gi, "$1[REDACTED]")
      .replace(/\beyJ[a-z0-9_-]*(?:\.[a-z0-9_-]*){2,}|\b[a-z0-9_-]{8,}(?:\.[a-z0-9_-]{8,}){2,}\b/gi, "[JWT_REDACTED]")
      .replace(/\b(?:sb_(?:secret|publishable)_[a-z0-9_-]+|sbp_[a-z0-9]+|github_pat_[a-z0-9_]+|gh[pousr]_[a-z0-9]+|sk[-_][a-z0-9_-]+)\b|(?:ExponentPushToken|ExpoPushToken)\[[^\]]*\]/gi, "[TOKEN_REDACTED]")
      .replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
    if (/isolated(?:-|%2d)ci(?:-|%2d)only|[a-z][a-z0-9+.-]*:\/\/|\bBearer\s+(?!\[REDACTED\])\S|\b(?:sb_(?:secret|publishable)_|sbp_|github_pat_|gh[pousr]_|sk[-_]|eyJ[a-z0-9_-]*\.)|(?:ExponentPushToken|ExpoPushToken)\[/i.test(text) ||
        /\b(?:(?:[a-z0-9_]*_)?(?:authorization|password|passwd|(?:access|refresh|id)[_-]?token|token|api[-_]?key|secret|credential)|[a-z0-9_]+_key)\b["']?\s*[:=]\s*(?!\[REDACTED\])[^\s]/i.test(text))
      return "Generation failure detail suppressed.";
    const bytes = Buffer.from(`${generationCommandFailure(stage, result)} ${text || "No stderr detail was emitted."}`);
    let end = Math.min(bytes.length, 2048);
    while (end && (bytes[end] & 0xc0) === 0x80) end--;
    return bytes.subarray(0, end).toString("utf8");
  } catch { return "Generation failure detail suppressed."; }
}

export function recordGenerationFailure(stage, result, runnerTemp) {
  const detail = generationFailureDetail(stage, result);
  if (detail === null) return false;
  try {
    if (typeof runnerTemp !== "string" || !path.isAbsolute(runnerTemp)) return false;
    const output = path.join(runnerTemp, "t04-public-types");
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(output, "generation-failure.txt"), detail);
    return true;
  } catch { return false; } // Never mask the original failure or fall back to raw stderr.
}

const GENERATION_STAGES = new Set([
  "schema-provenance", "cli-download", "cli-checksum", "cli-extract",
  "cli-version", "cli-generate", "artifact-diff", "git-head",
]);

const TYPEGEN_SQLSTATES = new Set([
  "42601", "42703", "42P01", "42501", "42883", "42804", "42704", "0A000", "3D000", "3F000",
  "28P01", "28000", "08001", "08006", "57014", "53300", "XX000",
]);

export function generationCommandFailure(stage, result) {
  if (!GENERATION_STAGES.has(stage)) throw new Error("Unknown public type generation diagnostic stage.");
  const exit = Number.isInteger(result.status) && result.status >= 0 && result.status <= 255 ? result.status : "none";
  // Classify a bounded stderr window into fixed labels; never return the matched text or stdout.
  const stderr = typeof result.stderr === "string" ? result.stderr.slice(-65536) : "";
  let errorClass = "command_exit";
  if (result.error) {
    const code = result.error.code;
    errorClass = code === "ENOENT" ? "executable_missing" : code === "EACCES" ? "execution_denied" :
      code === "ETIMEDOUT" ? "process_timeout" : code === "ENOBUFS" ? "output_limit" : "process_start_failed";
  } else {
    const classes = [
      ["sidecar_missing", /Could not find the `supabase-go` binary\.|supabase-go binary not found/],
      ["local_stack_required", /supabase start is not running\.|no such container[^\r\n]*supabase_db|supabase (?:is )?not running/i],
      ["config_read_bad_resource", /failed to read file config:\s*BadResource:\s*FileSystem\.readFile/],
      ["config_project_id", /Missing required field in config: project_id/],
      ["config_db_port", /Missing required field in config: db\.port/],
      ["database_missing", /SQLSTATE 3D000|database[^\r\n]*does not exist/i],
      ["database_auth", /password authentication failed|no pg_hba\.conf entry|SQLSTATE 28P01/i],
      ["ssl_refused", /server refused TLS connection|server does not support SSL|SSL is not enabled on the server/i],
      ["ssl_certificate", /x509:|certificate verify|certificate signed by unknown authority|self.signed certificate/i],
      ["connection_parse", /invalid sslmode|failed to parse[^\r\n]*(?:URL|DSN)|invalid connection option/i],
      ["docker_unavailable", /cannot connect to the Docker daemon|Docker daemon is not running/i],
      ["image_unavailable", /manifest unknown|pull access denied|no matching manifest|repository does not exist/i],
      ["image_missing", /no such image/i],
      ["connection_refused", /connection refused|ECONNREFUSED/i],
      ["network_dns", /no such host|ENOTFOUND|name resolution/i],
      ["network_timeout", /context deadline exceeded|i\/o timeout|ETIMEDOUT/i],
      ["native_database_connection", /failed to connect to postgres:/],
      ["native_typegen_failure", /failed to generate typescript types:/],
    ];
    errorClass = classes.find(([, pattern]) => pattern.test(stderr))?.[0] ?? errorClass;
  }
  const sqlstate = /\bSQLSTATE[\s:(]+([0-9A-Z]{5})\b/.exec(stderr)?.[1];
  return `Public type generation failed stage=${stage} exit=${exit} class=${errorClass}${TYPEGEN_SQLSTATES.has(sqlstate) ? ` sqlstate=${sqlstate}` : ""}.`;
}

function command(stage, executable, args, options = {}, allowed = [0]) {
  if (!GENERATION_STAGES.has(stage)) throw new Error("Unknown public type generation diagnostic stage.");
  if (stage === "cli-version" || stage === "cli-generate") console.log(`Public type generation stage=${stage} status=start`);
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024, ...options });
  if (result.error || !allowed.includes(result.status)) {
    if (stage === "cli-generate" && !recordGenerationFailure(stage, result, process.env.RUNNER_TEMP))
      console.error("Public type generation sanitized failure detail unavailable.");
    throw new Error(generationCommandFailure(stage, result));
  }
  return result.stdout;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== "--verify")) throw new Error("Usage: generate-backend-public-types.mjs [--verify]");
  const target = generationTarget(process.env);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const work = await mkdtemp(path.join(process.env.RUNNER_TEMP, "t04-cli-"));
  // Explicit --db-url from an isolated CI project. No repo link/config or inherited cloud/debug credentials.
  const env = { ...Object.fromEntries(["PATH", "HOME", "TMPDIR", "XDG_RUNTIME_DIR"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])), SUPABASE_NO_UPDATE_NOTIFIER: "1" };
  const options = { cwd: work, env };
  const sqlEnv = { ...env, ...Object.fromEntries(Object.entries(isolatedConnection(target.href)).filter(([key]) => key.startsWith("PG"))), LC_ALL: "C" };
  const facts = JSON.parse(command("schema-provenance", "psql", ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", `SELECT json_build_object(
    'fresh',current_database()='aquafeed_backend_test' AND EXISTS(SELECT 1 FROM backend_test.provenance WHERE singleton AND migration_fixtures_created AND migration_fixtures_cleaned AND database_oid=(SELECT oid FROM pg_database WHERE datname=current_database())),
    'installed',to_regprocedure('public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb)') IS NOT NULL,
    'postgres_version',current_setting('server_version'));`], { ...options, env: sqlEnv }));
  if (facts.fresh !== true || facts.installed !== true) throw new Error("Fresh provenance-bound migrated CI schema is required.");
  const project = await seedTypegenConfig(work, process.env.RUNNER_TEMP);
  console.log(`Public type generation ephemeral_config=supabase/config.toml relative_to=cli_cwd sha256=${project.provenance.sha256}`);
  const cliOptions = { ...options, cwd: project.workdir };
  command("cli-download", "curl", ["--fail", "--location", "--silent", "--show-error", "--output", "cli.tar.gz", CLI_URL], options);
  command("cli-checksum", "sha256sum", ["--check", "-"], { ...options, input: `${CLI_SHA256}  cli.tar.gz\n` });
  command("cli-extract", "tar", ["-xzf", "cli.tar.gz", "supabase", "supabase-go"], options);
  const cli = path.join(work, "supabase");
  const version = command("cli-version", cli, ["--version"], cliOptions).trim();
  if (version !== CLI_VERSION) throw new Error("Public type generation failed stage=cli-version exit=0 class=pinned_version_mismatch.");
  console.log(`Public type generation stage=cli-version status=ok version=${CLI_VERSION}`);
  const nativeGenerator = nativeGeneratorProvenance(version, await readFile(cli), await readFile(path.join(work, "supabase-go")));
  const generated = publicTypesOnly(command("cli-generate", cli, ["gen", "types", "typescript", "--db-url", target.href, "--schema", "public"], cliOptions));
  console.log("Public type generation stage=cli-generate status=ok");

  const output = path.join(process.env.RUNNER_TEMP, "t04-public-types");
  await mkdir(output, { recursive: true });
  const generatedPath = path.join(output, "database.types.ts");
  await writeFile(generatedPath, generated);
  const committedPath = path.join(root, "supabase", "database.types.ts");
  const committed = await readFile(committedPath, "utf8");
  const comparison = command("artifact-diff", "diff", ["-u", "--label", "committed/supabase/database.types.ts", "--label", "generated/public/database.types.ts", committedPath, generatedPath], options, [0, 1]);
  await writeFile(path.join(output, "committed.diff"), comparison);
  const directory = path.join(root, "supabase", "migrations");
  const migrations = await Promise.all((await readdir(directory)).filter((file) => /^\d{14}_.*\.sql$/.test(file)).sort().map(async (file) => ({ file, sha256: sha(await readFile(path.join(directory, file))) })));
  const provenance = {
    commit: command("git-head", "git", ["-C", root, "rev-parse", "HEAD"], options).trim(),
    cli: { version, official_url: CLI_URL, archive_sha256: CLI_SHA256 },
    target: { host: target.hostname, port: target.port, database: "aquafeed_backend_test", schema: "public", fresh_provenance: true, postgres_version: facts.postgres_version },
    generator: { ...nativeGenerator, cli_cwd_relative_to_binary_directory: "schema-project" },
    ephemeral_config: project.provenance,
    generated_sha256: sha(generated), committed_sha256: sha(committed),
    exact_match: committed === generated, verification_required: args[0] === "--verify", migrations,
  };
  await writeFile(path.join(output, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
  console.log(`Public-only types: CLI ${version}, native generator (pinned source trace), SHA256 ${provenance.generated_sha256}; committed comparison ${provenance.exact_match ? "MATCH" : "DIFF (initial artifact is not integrated)"}.`);
  if (args[0] === "--verify" && !provenance.exact_match) throw new Error("Generated public types differ from the reviewed committed artifact.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
