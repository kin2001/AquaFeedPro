import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import * as generation from "../scripts/generate-backend-public-types.mjs";
const { publicTypesOnly, generationTarget } = generation;
const generated = `export type Database = {
  public: {
    Tables: {
      device_metric_observations: { Row: { device_id: string } }
      device_metric_current: { Row: { device_id: string } }
      device_resource_versions: { Row: { device_id: string } }
    }
    Functions: { backend_sync_metrics: { Args: { p_device_verifier_hex: string } } }
  }
}
`;
test("generated public artifact permits public RPC verifier params but never credential records/nonpublic schemas", () => {
  assert.equal(publicTypesOnly(generated), generated);
  for (const value of [generated.replace("  public:", "  private:"), generated.replace("  public:", "  auth:"), generated.replace("    Tables: {", "    Tables: {\n      device_credentials: { Row: { credential_verifier: string } }"), generated.replace("backend_sync_metrics", "not_metrics"), generated + "\n  auth: { Users: {} }", generated + '\n  "private": { Tables: {} }', "not TypeScript"]) assert.throws(() => publicTypesOnly(value));
});
test("generation is CI Linux only and exactly the fresh disposable service URL, never cloud/overrides", () => {
  const env = { GITHUB_ACTIONS: "true", RUNNER_TEMP: "/runner/temp", LOCAL_TEST_DATABASE_URL: "postgresql://postgres:isolated-ci-only@127.0.0.1:54322/aquafeed_backend_test" };
  assert.equal(generationTarget(env, "linux").port, "54322");
  for (const patch of [{ GITHUB_ACTIONS: "false" }, { RUNNER_TEMP: "" }, { LOCAL_TEST_DATABASE_URL: env.LOCAL_TEST_DATABASE_URL + "?host=cloud" }, { LOCAL_TEST_DATABASE_URL: env.LOCAL_TEST_DATABASE_URL.replace("127.0.0.1", "cloud.invalid") }, { LOCAL_TEST_DATABASE_URL: env.LOCAL_TEST_DATABASE_URL.replace("isolated-ci-only", "secret") }]) assert.throws(() => generationTarget({ ...env, ...patch }, "linux"));
  assert.throws(() => generationTarget(env, "win32"));
});
test("generation failures identify a fixed stage/class/exit without leaking stderr, arguments, environment or generated output", () => {
  assert.equal(typeof generation.generationCommandFailure, "function", "bounded generation diagnostics are implemented");
  const secret = "do-not-log-private-token";
  const cases = [
    ["cli-version", { status: 1, stderr: secret }, "command_exit", 1],
    ["cli-generate", { status: 1, stderr: `database \"${secret}\" does not exist (SQLSTATE 3D000)` }, "database_missing", 1, "3D000"],
    ["cli-generate", { status: 1, stderr: `password authentication failed for ${secret}` }, "database_auth", 1],
    ["cli-generate", { status: 1, stderr: `failed to inspect container health: No such container: supabase_db_${secret}` }, "local_stack_required", 1],
    ["cli-generate", { status: 1, stderr: `failed to connect ${secret}: server refused TLS connection` }, "ssl_refused", 1],
    ["cli-generate", { status: 1, stderr: `x509: certificate signed by unknown authority ${secret}` }, "ssl_certificate", 1],
    ["cli-generate", { status: 1, stderr: `invalid sslmode in ${secret}` }, "connection_parse", 1],
    ["cli-generate", { status: 1, stderr: `connect: connection refused ${secret}` }, "connection_refused", 1],
    ["cli-generate", { status: 1, stderr: `manifest unknown ${secret}` }, "image_unavailable", 1],
    ["cli-generate", { status: 1, stderr: `lookup ${secret}: no such host` }, "network_dns", 1],
    ["cli-generate", { status: 1, stderr: `context deadline exceeded ${secret}` }, "network_timeout", 1],
    ["cli-generate", { status: 1, stderr: `Cannot connect to the Docker daemon ${secret}` }, "docker_unavailable", 1],
    ["cli-version", { status: null, error: { code: "ENOENT", message: secret } }, "executable_missing", "none"],
    ["cli-version", { status: null, error: { code: "EACCES", message: secret } }, "execution_denied", "none"],
    ["cli-generate", { status: null, error: { code: "ETIMEDOUT", message: secret } }, "process_timeout", "none"],
    ["cli-generate", { status: null, error: { code: "ENOBUFS", message: secret } }, "output_limit", "none"],
    ["cli-generate", { status: 1, stderr: `No such image: ${secret}` }, "image_missing", 1],
  ];
  for (const [stage, result, errorClass, exit, sqlstate] of cases) {
    const message = generation.generationCommandFailure(stage, { ...result, stdout: `generated ${secret}`, args: [secret], env: { TOKEN: secret } });
    assert.equal(message, `Public type generation failed stage=${stage} exit=${exit} class=${errorClass}${sqlstate ? ` sqlstate=${sqlstate}` : ""}.`);
    assert.ok(message.length < 180 && !message.includes(secret) && !/[\r\n\x00-\x1f]/.test(message));
  }
  assert.throws(() => generation.generationCommandFailure(`cli-generate\n${secret}`, { status: 1 }), (error) => !error.message.includes(secret));
  const unknown = generation.generationCommandFailure("cli-generate", { status: secret, stderr: secret, error: { code: secret, message: secret } });
  assert.equal(unknown, "Public type generation failed stage=cli-generate exit=none class=process_start_failed.");
});

test("known pinned upstream fingerprints and allowlisted SQLSTATE distinguish native failures without raw detail", () => {
  for (const [stderr, expected] of [
    ['Could not find the `supabase-go` binary.', 'sidecar_missing'],
    ['supabase-go binary not found', 'sidecar_missing'],
    ['supabase start is not running.', 'local_stack_required'],
    ['Missing required field in config: project_id', 'config_project_id'],
    ['Missing required field in config: db.port', 'config_db_port'],
    ['failed to connect to postgres: controlled driver failure', 'native_database_connection'],
    ['failed to generate typescript types: controlled metadata failure', 'native_typegen_failure'],
  ]) assert.match(generation.generationCommandFailure('cli-generate', { status: 1, stderr }), new RegExp(`class=${expected}\\.`));
  assert.match(generation.generationCommandFailure('cli-generate', { status: 1, stderr: 'failed to generate typescript types: column missing (SQLSTATE 42703)' }), /class=native_typegen_failure sqlstate=42703\./);
  assert.doesNotMatch(generation.generationCommandFailure('cli-generate', { status: 1, stderr: 'SQLSTATE TOKEN' }), /TOKEN/);
});

test("native generator provenance hashes both archive binaries and distinguishes source-declared metadata from observations", () => {
  assert.equal(typeof generation.nativeGeneratorProvenance, "function");
  const frontend = Buffer.from("test frontend");
  const sidecar = Buffer.from("test sidecar");
  const result = generation.nativeGeneratorProvenance("2.120.0", frontend, sidecar);
  assert.equal(result.frontend_sha256, createHash("sha256").update(frontend).digest("hex"));
  assert.equal(result.sidecar_sha256, createHash("sha256").update(sidecar).digest("hex"));
  assert.equal(result.frontend_version_observed, "2.120.0");
  assert.equal(result.sidecar_invoked, false);
  assert.deepEqual(result.typegen_library, { version: "0.2.2", evidence: "pinned_source_package_json_not_runtime_inspection" });
  assert.equal(result.mode, "source_traced_native_in_process");
  assert.equal(Object.hasOwn(result, "image"), false);
  assert.throws(() => generation.nativeGeneratorProvenance("other", frontend, sidecar));
  assert.throws(() => generation.nativeGeneratorProvenance("2.120.0", frontend, Buffer.alloc(0)));
});

test("failure detail is stderr-only, bounded, and redacts controlled credentials before truncation", () => {
  assert.equal(typeof generation.generationFailureDetail, "function");
  const secret = "privateValue123456789";
  const cases = [
    `password=isolated-ci-only`, `isolated%2Dci%2Donly`, `%69solated-ci-only`,
    String.raw`isolated-\u0063i-only`,
    `postgresql://postgres:isolated-ci-only@127.0.0.1:54322/aquafeed_backend_test`,
    `https://user:${secret}@host.invalid/path?token=${secret}`, `file:///private/${secret}`,
    `postgresql:\\/\\/postgres:isolated-ci-only@host.invalid/db`,
    `user:${secret}@host.invalid`, `Bearer ${secret}`, `bEaReR\n${secret}`, `Bearer: ${secret}`,
    `\"token\": \"${secret}\"`, `access_token='${secret}'`, `--password ${secret}`,
    `refresh_token=${secret}`, `api-key: ${secret}`, `credential: ${secret}`, `secret ${secret}`,
    `SUPABASE_ACCESS_TOKEN=${secret}`, `DB_PASSWORD='${secret}'`, `SUPABASE_SECRET_KEY=${secret}`,
    `\\\"token\\\": \\\"${secret}\\\"`,
    `token=\"first\\\"${secret}\"`,
    `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signatureSecret`,
    `sb_secret_${secret}`, `sbp_${secret}`, `github_pat_${secret}`, `ExponentPushToken[${secret}]`,
    `eyJhbGciOiJIUzI1NiJ9..encryptedBody.ivSecret.signatureSecret`,
    `\u001b]8;;https://host.invalid/${secret}\u0007link\u001b]8;;\u0007`,
    `\u001b[31mBearer ${secret}\u001b[0m`, `Bear\u200ber ${secret}`,
    `Authorization: Bearer ${secret}\\nnext line`,
  ];
  for (const stderr of cases) {
    const detail = generation.generationFailureDetail("cli-generate", { status: 1, stderr: `failed to generate typescript types: ${stderr}`, stdout: "STDOUT_MUST_NOT_APPEAR", args: [secret], env: { TOKEN: secret } });
    assert.ok(typeof detail === "string" && Buffer.byteLength(detail) <= 2048, stderr);
    assert.ok(!detail.includes(secret) && !detail.includes("isolated-ci-only") && !detail.includes("isolated%2Dci%2Donly") && !detail.includes("signatureSecret"), stderr);
    assert.doesNotMatch(detail, /:\/\/|STDOUT_MUST_NOT_APPEAR|[\p{Cc}\p{Cf}]/u, stderr);
  }
  const long = generation.generationFailureDetail("cli-generate", { status: 1, stderr: `${"界".repeat(680)} token=${secret}\n${"x".repeat(3000)}` });
  assert.ok(Buffer.byteLength(long) <= 2048 && !long.includes(secret));
  assert.ok(!long.includes("\ufffd"), "truncate on a valid UTF-8 boundary");
  const summaryLength = generation.generationCommandFailure("cli-generate", { status: 1 }).length + 1;
  const boundary = generation.generationFailureDetail("cli-generate", { status: 1, stderr: `${"x".repeat(2030 - summaryLength)} Bearer SECRETSTART_${secret}` });
  assert.ok(Buffer.byteLength(boundary) <= 2048 && !boundary.includes("SECRETSTART"), "no partial credential at the byte cutoff");
  assert.equal(generation.generationFailureDetail("cli-generate", { status: 1, stderr: "sb_secret_" }), "Generation failure detail suppressed.");
  assert.equal(generation.generationFailureDetail("cli-version", { status: 1, stderr: secret }), null);
  assert.equal(generation.generationFailureDetail("cli-generate", { status: 0, stderr: secret }), null);
  const useful = generation.generationFailureDetail("cli-generate", { status: 1, stderr: 'failed to generate typescript types: column catalog_test does not exist (SQLSTATE 42703)', get stdout() { throw new Error('stdout must not be read'); } });
  assert.match(useful, /column catalog_test does not exist/);
  assert.match(useful, /sqlstate=42703/);
  const broken = { status: 1, get stderr() { throw new Error(secret); } };
  assert.equal(generation.generationFailureDetail("cli-generate", broken), "Generation failure detail suppressed.");
});

test("only failed cli-generate writes the exact bounded sanitized artifact; IO failure has no raw fallback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'aquafeed-typegen-detail-'));
  try {
    assert.equal(generation.recordGenerationFailure('cli-version', { status: 1, stderr: 'not recorded' }, root), false);
    assert.equal(generation.recordGenerationFailure('cli-generate', { status: 0, stderr: 'not recorded' }, root), false);
    assert.deepEqual(await readdir(root), []);
    assert.equal(generation.recordGenerationFailure('cli-generate', { status: 1, stderr: 'failed to generate typescript types: password=isolated-ci-only', stdout: 'STDOUT_SENTINEL' }, root), true);
    const file = path.join(root, 't04-public-types', 'generation-failure.txt');
    const detail = await readFile(file, 'utf8');
    assert.ok(Buffer.byteLength(detail) <= 2048);
    assert.doesNotMatch(detail, /isolated-ci-only|STDOUT_SENTINEL/);
    assert.deepEqual(await readdir(path.dirname(file)), ['generation-failure.txt']);
    assert.equal(generation.recordGenerationFailure('cli-generate', { status: 1, get stderr() { throw new Error('private'); } }, root), true);
    assert.equal(await readFile(file, 'utf8'), 'Generation failure detail suppressed.');
    const notDirectory = path.join(root, 'not-a-directory');
    await writeFile(notDirectory, 'fixture');
    assert.equal(generation.recordGenerationFailure('cli-generate', { status: 1, stderr: 'private' }, notDirectory), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
