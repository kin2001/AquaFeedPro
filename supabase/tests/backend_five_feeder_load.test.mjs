import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runFiveFeederLoad } from "./backend_five_feeder_load.mjs";

test("the five-feeder workload rejects missing, remote and override targets before opening psql", async () => {
  for (const databaseUrl of [
    undefined,
    "postgresql://owner@example.invalid/aquafeed_backend_test",
    "postgresql://postgres@127.0.0.1/other",
    "postgresql://postgres@127.0.0.1/aquafeed_backend_test?host=example.invalid",
  ]) {
    await assert.rejects(
      runFiveFeederLoad({ databaseUrl, psqlPath: "not-an-executable" }),
      /explicit isolated loopback URL/,
    );
  }
});

test("the workload CLI takes only an explicit URL environment variable name", () => {
  const entry = fileURLToPath(
    new URL("./backend_five_feeder_load.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [entry, "--database-url-env", "unsafe-literal"],
    {
      encoding: "utf8",
      timeout: 3000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--database-url-env VARIABLE/);
  assert.doesNotMatch(result.stderr, /unsafe-literal/);
});
