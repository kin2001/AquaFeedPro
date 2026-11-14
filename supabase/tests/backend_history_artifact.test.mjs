import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { publicTypeFacts } from "../scripts/generate-backend-public-types.mjs";

test("CI artifact guard rejects partial, wrong-hash/commit/config/migration/private artifacts while retaining strict drift failure", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const workflow = await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const block = workflow.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/);
  assert.ok(block, "actual inline artifact guard is executable");
  const source = block[1].replace(/^          /gm, "");
  const temporary = await mkdtemp(path.join(tmpdir(), "t05-artifact-guard-"));
  const output = path.join(temporary, "t04-public-types");
  await mkdir(output);
  const sha = value => createHash("sha256").update(value).digest("hex");
  const committed = await readFile(path.join(root, "supabase/database.types.ts"), "utf8");
  // Sanitized synthetic guard fixture only; never substituted for the generated production artifact.
  const required = ["backend_metric_history", "backend_metric_do_graph", "backend_history_page", "backend_history_detail"];
  const facts = publicTypeFacts(committed, required);
  const missing = required.filter(name => !facts.required[name]);
  const complete = missing.length ? committed.replace("Functions: {", `Functions: { ${missing.map(name => `${name}: { Args: {} }`).join(" ")}`) : committed;
  const types = complete + "\n// Synthetic guard-only comparison drift.\n";
  const files = (await readdir(path.join(root, "supabase/migrations"))).filter(file => /^\d{14}_.*\.sql$/.test(file)).sort();
  assert.equal(files.length, 24, "current artifact must include the policy-only final migration");
  assert.equal(files.at(-1), "20261114001200_backend_query_indexes.sql");
  const config = 'project_id = "aquafeed-t04-public-types-ci"\n\n[db]\nport = 54322\n';
  const provenance = { commit: "offline-test-head", verification_required: true, exact_match: false, generated_sha256: sha(types), committed_sha256: sha(committed), target: { host: "127.0.0.1", port: "54322", database: "aquafeed_backend_test", schema: "public", fresh_provenance: true }, cli: { version: "2.120.0", archive_sha256: "7074584113aa00495beeac661c41fb09f1ddd0a483cd7333894b0d080086dc6e" }, generator: { mode: "source_traced_native_in_process", frontend_version_observed: "2.120.0", sidecar_invoked: false, source_commit: "753520fa7202ed5f8b25883a4c0aa7e5e9ad1fc4", frontend_sha256: "a".repeat(64), sidecar_sha256: "b".repeat(64) }, ephemeral_config: { relative_path: "supabase/config.toml", relative_to: "cli_cwd", content: config, sha256: sha(config) }, migrations: await Promise.all(files.map(async file => ({ file, sha256: sha(await readFile(path.join(root, "supabase/migrations", file))) }))) };
  async function run(p = provenance, generated = types, omit = false) {
    await writeFile(path.join(output, "database.types.ts"), generated);
    await writeFile(path.join(output, "provenance.json"), JSON.stringify(p));
    if (omit) await rm(path.join(output, "committed.diff"), { force: true });
    else await writeFile(path.join(output, "committed.diff"), "sanitized public-only fixture diff");
    const result = spawnSync(process.execPath, ["--input-type=module"], { cwd: root, env: { ...process.env, RUNNER_TEMP: temporary, GITHUB_SHA: "offline-test-head" }, input: source, encoding: "utf8" });
    return result.status;
  }
  try {
    assert.equal(await run(), 0, "complete artifact retained despite strict comparison drift");
    assert.notEqual(await run(provenance, types, true), 0, "partial artifact rejected");
    const duplicate = types.replace("Functions: {", "Functions: { backend_metric_history: { Args: {} }");
    assert.notEqual(await run({ ...provenance, generated_sha256: sha(duplicate) }, duplicate), 0, "duplicate direct RPCs are rejected, never normalized away");
    for (const patch of [{ generated_sha256: "0".repeat(64) }, { commit: "wrong-head" }, { ephemeral_config: { ...provenance.ephemeral_config, content: "wrong" } }, { migrations: provenance.migrations.slice(1) }, { target: { ...provenance.target, fresh_provenance: false } }]) assert.notEqual(await run({ ...provenance, ...patch }), 0);
    assert.notEqual(await run({ ...provenance, migrations: provenance.migrations.slice(0, -1) }), 0, "historical 23/01100 provenance cannot qualify the final 24-migration schema");
    const wrongPolicyHash = provenance.migrations.map((m, i) => i === 23 ? { ...m, sha256: "0".repeat(64) } : m);
    assert.notEqual(await run({ ...provenance, migrations: wrongPolicyHash }), 0, "final policy migration hash must match exactly");
    const privateTypes = types.replace("Tables: {", "Tables: { device_credentials: { Row: { secret: string } }");
    assert.notEqual(await run({ ...provenance, generated_sha256: sha(privateTypes) }, privateTypes), 0);
    assert.match(workflow, /run: node supabase\/scripts\/generate-backend-public-types\.mjs --verify/);
    assert.doesNotMatch(workflow, /continue-on-error/);
    assert.match(workflow, /if: always\(\) && steps\.public_artifact_validated\.outcome == 'success'/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
