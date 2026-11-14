import assert from "node:assert/strict";
import { test } from "node:test";
import * as generation from "../scripts/generate-backend-public-types.mjs";
const { publicTypesOnly, generationTarget, postgresMetaImage } = generation;
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
    ["cli-generate", { status: 1, stderr: `database \"${secret}\" does not exist (SQLSTATE 3D000)` }, "database_missing", 1],
    ["cli-generate", { status: 1, stderr: `password authentication failed for ${secret}` }, "database_auth", 1],
    ["cli-generate", { status: 1, stderr: `failed to inspect container health: No such container: supabase_db_${secret}` }, "local_stack_required", 1],
    ["cli-generate", { status: 1, stderr: `failed to connect ${secret}: server refused TLS connection` }, "ssl_refused", 1],
    ["cli-generate", { status: 1, stderr: `x509: certificate signed by unknown authority ${secret}` }, "ssl_certificate", 1],
    ["cli-generate", { status: 1, stderr: `invalid sslmode in ${secret}` }, "connection_parse", 1],
    ["cli-generate", { status: 1, stderr: `connect: connection refused ${secret}` }, "connection_refused", 1],
    ["cli-generate", { status: 1, stderr: `manifest unknown ${secret}` }, "image_unavailable", 1],
    ["cli-generate", { status: 1, stderr: `lookup ${secret}: no such host` }, "network_dns", 1],
    ["cli-generate", { status: 1, stderr: `context deadline exceeded ${secret}` }, "network_timeout", 1],
    ["docker-preflight", { status: 1, stderr: `Cannot connect to the Docker daemon ${secret}` }, "docker_unavailable", 1],
    ["cli-version", { status: null, error: { code: "ENOENT", message: secret } }, "executable_missing", "none"],
    ["cli-version", { status: null, error: { code: "EACCES", message: secret } }, "execution_denied", "none"],
    ["cli-generate", { status: null, error: { code: "ETIMEDOUT", message: secret } }, "process_timeout", "none"],
    ["cli-generate", { status: null, error: { code: "ENOBUFS", message: secret } }, "output_limit", "none"],
    ["image-inspect", { status: 1, stderr: `No such image: ${secret}` }, "image_missing", 1],
  ];
  for (const [stage, result, errorClass, exit] of cases) {
    const message = generation.generationCommandFailure(stage, { ...result, stdout: `generated ${secret}`, args: [secret], env: { TOKEN: secret } });
    assert.equal(message, `Public type generation failed stage=${stage} exit=${exit} class=${errorClass}.`);
    assert.ok(message.length < 180 && !message.includes(secret) && !/[\r\n\x00-\x1f]/.test(message));
  }
  assert.throws(() => generation.generationCommandFailure(`cli-generate\n${secret}`, { status: 1 }), (error) => !error.message.includes(secret));
  const unknown = generation.generationCommandFailure("cli-generate", { status: secret, stderr: secret, error: { code: secret, message: secret } });
  assert.equal(unknown, "Public type generation failed stage=cli-generate exit=none class=process_start_failed.");
});

test("image provenance comes from actual Docker create events, not an invented digest", () => {
  const events = JSON.stringify({ Type: "container", Action: "create", Actor: { Attributes: { image: "public.ecr.aws/supabase/postgres-meta:v0.example" } } });
  assert.equal(postgresMetaImage(events), "public.ecr.aws/supabase/postgres-meta:v0.example");
  assert.throws(() => postgresMetaImage(""));
  assert.throws(() => postgresMetaImage(events + "\n" + events.replace("v0.example", "v0.other")));
});
