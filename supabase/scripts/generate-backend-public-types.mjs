// CI-only public-schema generation. Never login/link or inspect the shared project.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

export function postgresMetaImage(events) {
  const images = new Set(events.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    .filter((event) => event.Type === "container" && event.Action === "create")
    .map((event) => event.Actor?.Attributes?.image)
    .filter((image) => typeof image === "string" && /(?:^|\/)postgres-meta(?::|@)/.test(image)));
  if (images.size !== 1) throw new Error("Exactly one actual postgres-meta container image must be observed.");
  return [...images][0];
}

const GENERATION_STAGES = new Set([
  "docker-preflight", "schema-provenance", "cli-download", "cli-checksum", "cli-extract",
  "cli-version", "cli-generate", "docker-events", "image-inspect", "artifact-diff", "git-head",
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
      ["local_stack_required", /no such container[^\r\n]*supabase_db|supabase (?:is )?not running/i],
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
    ];
    errorClass = classes.find(([, pattern]) => pattern.test(stderr))?.[0] ?? errorClass;
  }
  return `Public type generation failed stage=${stage} exit=${exit} class=${errorClass}.`;
}

function command(stage, executable, args, options = {}, allowed = [0]) {
  if (!GENERATION_STAGES.has(stage)) throw new Error("Unknown public type generation diagnostic stage.");
  if (stage === "cli-version" || stage === "cli-generate") console.log(`Public type generation stage=${stage} status=start`);
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024, ...options });
  if (result.error || !allowed.includes(result.status)) throw new Error(generationCommandFailure(stage, result));
  return result.stdout;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== "--verify")) throw new Error("Usage: generate-backend-public-types.mjs [--verify]");
  const target = generationTarget(process.env);
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const work = await mkdtemp(path.join(process.env.RUNNER_TEMP, "t04-cli-"));
  // Explicit --db-url from an empty cwd. No repo link/config or inherited cloud/debug credentials.
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "XDG_RUNTIME_DIR"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  const options = { cwd: work, env };
  const dockerVersion = command("docker-preflight", "docker", ["info", "--format", "{{.ServerVersion}}"], options).trim();
  const sqlEnv = { ...env, ...Object.fromEntries(Object.entries(isolatedConnection(target.href)).filter(([key]) => key.startsWith("PG"))), LC_ALL: "C" };
  const facts = JSON.parse(command("schema-provenance", "psql", ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", `SELECT json_build_object(
    'fresh',current_database()='aquafeed_backend_test' AND EXISTS(SELECT 1 FROM backend_test.provenance WHERE singleton AND migration_fixtures_created AND migration_fixtures_cleaned AND database_oid=(SELECT oid FROM pg_database WHERE datname=current_database())),
    'installed',to_regprocedure('public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb)') IS NOT NULL,
    'postgres_version',current_setting('server_version'));`], { ...options, env: sqlEnv }));
  if (facts.fresh !== true || facts.installed !== true) throw new Error("Fresh provenance-bound migrated CI schema is required.");
  command("cli-download", "curl", ["--fail", "--location", "--silent", "--show-error", "--output", "cli.tar.gz", CLI_URL], options);
  command("cli-checksum", "sha256sum", ["--check", "-"], { ...options, input: `${CLI_SHA256}  cli.tar.gz\n` });
  command("cli-extract", "tar", ["-xzf", "cli.tar.gz", "supabase"], options);
  const cli = path.join(work, "supabase");
  const version = command("cli-version", cli, ["--version"], options).trim();
  if (version !== CLI_VERSION) throw new Error("Public type generation failed stage=cli-version exit=0 class=pinned_version_mismatch.");
  console.log(`Public type generation stage=cli-version status=ok version=${CLI_VERSION}`);
  const started = Math.floor(Date.now() / 1000);
  const generated = publicTypesOnly(command("cli-generate", cli, ["gen", "types", "typescript", "--db-url", target.href, "--schema", "public"], options));
  console.log("Public type generation stage=cli-generate status=ok");
  const ended = Math.ceil(Date.now() / 1000);
  const events = command("docker-events", "docker", ["events", "--since", String(started), "--until", String(ended), "--filter", "type=container", "--filter", "event=create", "--format", "{{json .}}"], options);
  const image = postgresMetaImage(events);
  const inspected = JSON.parse(command("image-inspect", "docker", ["image", "inspect", image, "--format", "{{json .}}"], options));
  if (!/^sha256:[0-9a-f]{64}$/.test(inspected.Id) || !Array.isArray(inspected.RepoDigests) || !inspected.RepoDigests.some((digest) => /@sha256:[0-9a-f]{64}$/.test(digest)))
    throw new Error("Actual postgres-meta image digest provenance is missing.");
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
    docker_version: dockerVersion,
    postgres_meta: { image, image_id: inspected.Id, repo_digests: inspected.RepoDigests },
    generated_sha256: sha(generated), committed_sha256: sha(committed),
    exact_match: committed === generated, verification_required: args[0] === "--verify", migrations,
  };
  await writeFile(path.join(output, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
  console.log(`Public-only types: CLI ${version}, postgres-meta ${image}, ${inspected.RepoDigests.join(",")}, SHA256 ${provenance.generated_sha256}; committed comparison ${provenance.exact_match ? "MATCH" : "DIFF (initial artifact is not integrated)"}.`);
  if (args[0] === "--verify" && !provenance.exact_match) throw new Error("Generated public types differ from the reviewed committed artifact.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
