import assert from "node:assert/strict";
import { test } from "node:test";
import { publicTypesOnly, generationTarget, postgresMetaImage } from "../scripts/generate-backend-public-types.mjs";
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
test("image provenance comes from actual Docker create events, not an invented digest", () => {
  const events = JSON.stringify({ Type: "container", Action: "create", Actor: { Attributes: { image: "public.ecr.aws/supabase/postgres-meta:v0.example" } } });
  assert.equal(postgresMetaImage(events), "public.ecr.aws/supabase/postgres-meta:v0.example");
  assert.throws(() => postgresMetaImage(""));
  assert.throws(() => postgresMetaImage(events + "\n" + events.replace("v0.example", "v0.other")));
});
