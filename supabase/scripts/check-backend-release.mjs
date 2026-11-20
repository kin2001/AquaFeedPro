import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const PROJECT_REF = "giilhohmrytpgyeyysir";
const SUPABASE_DIR = fileURLToPath(new URL("../", import.meta.url));
const MIGRATION_SQL =
  "select version, name from supabase_migrations.schema_migrations order by version";
const SOURCE_CLOSURES = {
  "app-api": [
    "app-api/index.ts",
    "_shared/device-access.ts",
    "_shared/history.ts",
    "_shared/telemetry.ts",
  ],
  "device-api": [
    "device-api/index.ts",
    "_shared/device-access.ts",
    "_shared/telemetry.ts",
  ],
  "push-sender": [
    "push-sender/index.ts",
    "_shared/device-access.ts",
    "_shared/push-sender.ts",
  ],
};
const SLUGS = Object.keys(SOURCE_CLOSURES);
const ALLOWED_OPTIONS = new Set([
  "--project-ref",
  "--supabase-cli",
  ...SLUGS.map((slug) => `--${slug}-version`),
]);
const VERSION = /^\d{14}$/;
const MIGRATION_NAME = /^[a-z0-9_]+$/;
const SOURCE_SIZE_LIMIT = 2 * 1024 * 1024;
const USAGE =
  "Usage: node supabase/scripts/check-backend-release.mjs --project-ref giilhohmrytpgyeyysir --app-api-version N --device-api-version N --push-sender-version N [--supabase-cli path]";

function assertProject(projectRef) {
  if (projectRef !== PROJECT_REF)
    throw new Error(
      "An explicit allowlisted Thesis dev project ref is required.",
    );
}

function validVersion(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function parseOptions(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index], argv[index + 1]];
    if (
      !ALLOWED_OPTIONS.has(key) ||
      values.has(key) ||
      !value ||
      value.startsWith("--")
    )
      throw new Error(USAGE);
    values.set(key, value);
  }
  const projectRef = values.get("--project-ref");
  assertProject(projectRef);
  const versions = Object.fromEntries(
    SLUGS.map((slug) => [slug, Number(values.get(`--${slug}-version`))]),
  );
  for (const slug of SLUGS) {
    if (
      !/^[1-9]\d*$/.test(values.get(`--${slug}-version`) ?? "") ||
      !validVersion(versions[slug])
    )
      throw new Error(USAGE);
  }
  return {
    projectRef,
    versions,
    cli: values.get("--supabase-cli") ?? "supabase",
  };
}

const execFileAsync = promisify(execFile);
async function runSupabase(file, args, cwd) {
  // Use a direct child. Never forward stderr or a child error from the CLI.
  const result = await execFileAsync(file, args, {
    cwd,
    timeout: 30_000,
    maxBuffer: 1_048_576,
    windowsHide: true,
    shell: false,
  });
  return result.stdout;
}

function statusOf(checks) {
  if (checks.includes("DRIFT")) return "DRIFT";
  if (checks.includes("UNVERIFIED")) return "UNVERIFIED";
  return "PASS";
}

async function readLocalMigrations(supabaseDir) {
  const entries = await fs.readdir(path.join(supabaseDir, "migrations"), {
    withFileTypes: true,
  });
  const migrations = entries.flatMap((entry) => {
    const match = /^(\d{14})_(.+)\.sql$/.exec(entry.name);
    if (!match) return [];
    if (!entry.isFile() || !MIGRATION_NAME.test(match[2]))
      throw new Error("Invalid local migration filename or file type.");
    return [{ version: match[1], name: match[2] }];
  });
  if (migrations.length === 0) throw new Error("Missing local migrations.");
  return migrations;
}

function validMigrationRows(rows) {
  return (
    Array.isArray(rows) &&
    rows.every(
      (row) =>
        typeof row?.version === "string" &&
        VERSION.test(row.version) &&
        typeof row.name === "string" &&
        MIGRATION_NAME.test(row.name),
    ) &&
    new Set(rows.map(({ version }) => version)).size === rows.length &&
    new Set(rows.map(({ name }) => name)).size === rows.length
  );
}

async function checkMigrations(supabaseDir, command) {
  try {
    const local = await readLocalMigrations(supabaseDir);
    const remote = JSON.parse(
      await command([
        "db",
        "query",
        "--linked",
        "--output-format",
        "json",
        "--log-level",
        "error",
        MIGRATION_SQL,
      ]),
    ).rows;
    if (!validMigrationRows(remote) || !validMigrationRows(local))
      throw new Error("Invalid migration evidence.");
    const localById = new Map(local.map((row) => [row.version, row.name]));
    const remoteById = new Map(remote.map((row) => [row.version, row.name]));
    const localByName = new Map(local.map((row) => [row.name, row.version]));
    const remoteByName = new Map(remote.map((row) => [row.name, row.version]));
    const idMismatches = [];
    const nameMismatches = [];
    const missingVersions = [];
    for (const [localVersion, name] of [...localById].sort()) {
      const remoteVersion = remoteByName.get(name);
      if (remoteVersion && remoteVersion !== localVersion)
        idMismatches.push({ localVersion, remoteVersion });
      if (remoteById.has(localVersion) && remoteById.get(localVersion) !== name)
        nameMismatches.push(localVersion);
      if (!remoteById.has(localVersion) && !remoteVersion)
        missingVersions.push(localVersion);
    }
    const unexpectedVersions = [...remoteById]
      .sort()
      .filter(
        ([version, name]) => !localById.has(version) && !localByName.has(name),
      )
      .map(([version]) => version);
    return {
      status: [
        idMismatches,
        nameMismatches,
        missingVersions,
        unexpectedVersions,
      ].some((rows) => rows.length > 0)
        ? "DRIFT"
        : "PASS",
      expectedCount: local.length,
      observedCount: remote.length,
      idMismatches,
      nameMismatches,
      missingVersions,
      unexpectedVersions,
    };
  } catch {
    return {
      status: "UNVERIFIED",
      reason: "Migration metadata unavailable or invalid.",
    };
  }
}

async function checkedInJwt(supabaseDir) {
  // Accept only the checked-in config shape. An ambiguous TOML value is not evidence.
  const config = await fs.readFile(
    path.join(supabaseDir, "config.toml"),
    "utf8",
  );
  const values = new Map();
  let currentSlug;
  let projectDeclared = false;
  for (const line of config.split(/\r?\n/).map((line) => line.trim())) {
    if (!line || line.startsWith("#")) continue;
    if (
      /^project_id\s*=\s*"giilhohmrytpgyeyysir"\s*(?:#.*)?$/.test(line) &&
      !projectDeclared &&
      !currentSlug
    ) {
      projectDeclared = true;
      continue;
    }
    const table = /^\[functions\.([a-z-]+)\]\s*(?:#.*)?$/.exec(line);
    if (
      table &&
      projectDeclared &&
      SLUGS.includes(table[1]) &&
      !values.has(table[1]) &&
      (!currentSlug || values.has(currentSlug))
    ) {
      currentSlug = table[1];
      continue;
    }
    const option = /^verify_jwt\s*=\s*(true|false)\s*(?:#.*)?$/.exec(line);
    if (option && currentSlug && !values.has(currentSlug)) {
      values.set(currentSlug, option[1] === "true");
      continue;
    }
    throw new Error("Unsupported checked-in function configuration.");
  }
  return values;
}

async function checkFunctionMetadata(supabaseDir, versions, command) {
  let rows;
  let jwt;
  try {
    rows = JSON.parse(
      await command([
        "functions",
        "list",
        "-o",
        "json",
        "--log-level",
        "error",
      ]),
    );
    if (
      !Array.isArray(rows) ||
      rows.some((row) => typeof row?.slug !== "string")
    )
      throw new Error("Invalid function metadata.");
  } catch {
    return new Map();
  }
  try {
    jwt = await checkedInJwt(supabaseDir);
  } catch {
    jwt = new Map();
  }
  const evidence = new Map();
  for (const slug of SLUGS) {
    const matches = rows.filter((row) => row.slug === slug);
    if (matches.length === 0) {
      evidence.set(slug, {
        deployment: "DRIFT",
        reason: "Expected function not listed.",
      });
    } else if (matches.length === 1) {
      const [row] = matches;
      evidence.set(slug, {
        deployment:
          typeof row.status !== "string"
            ? "UNVERIFIED"
            : row.status === "ACTIVE"
              ? "PASS"
              : "DRIFT",
        expectedVersion: versions[slug],
        ...(validVersion(row.version) ? { observedVersion: row.version } : {}),
        version: !validVersion(row.version)
          ? "UNVERIFIED"
          : row.version === versions[slug]
            ? "PASS"
            : "DRIFT",
        jwt:
          !jwt.has(slug) || typeof row.verify_jwt !== "boolean"
            ? "UNVERIFIED"
            : row.verify_jwt === jwt.get(slug)
              ? "PASS"
              : "DRIFT",
      });
    }
  }
  return evidence;
}

async function sourceFiles(root, relative = "") {
  const directory = await fs.lstat(path.join(root, relative));
  if (!directory.isDirectory()) throw new Error("Invalid source directory.");
  const entries = await fs.readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await sourceFiles(root, name)));
    else if (entry.isFile()) files.push(name);
    else throw new Error("Invalid source file type.");
  }
  return files;
}

async function digest(target) {
  const file = await fs.lstat(target);
  if (!file.isFile() || file.size > SOURCE_SIZE_LIMIT)
    throw new Error("Invalid source file.");
  return createHash("sha256")
    .update(await fs.readFile(target))
    .digest("hex");
}

async function makeCliDirectory(root, name) {
  const directory = path.join(root, name);
  await fs.mkdir(path.join(directory, "supabase"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "supabase", "config.toml"),
    'project_id = "aquafeed-release-check"\n',
  );
  return directory;
}

async function checkFunctionSource(
  supabaseDir,
  slug,
  projectRef,
  command,
  cwd,
) {
  try {
    const downloaded = JSON.parse(
      await command(
        [
          "functions",
          "download",
          slug,
          "--use-api",
          "--output-format",
          "json",
          "--log-level",
          "error",
        ],
        cwd,
      ),
    );
    if (
      downloaded.project_ref !== projectRef ||
      !Array.isArray(downloaded.function_slugs) ||
      downloaded.function_slugs.length !== 1 ||
      downloaded.function_slugs[0] !== slug
    )
      throw new Error("Invalid download evidence.");
    if (!(await fs.lstat(path.join(cwd, "supabase"))).isDirectory())
      throw new Error("Invalid download directory.");
    const root = path.join(cwd, "supabase", "functions");
    const files = await sourceFiles(root);
    const closure = SOURCE_CLOSURES[slug];
    const hashes = await Promise.all(
      closure.map((file) => digest(path.join(supabaseDir, "functions", file))),
    );
    const missingFiles = closure.filter((file) => !files.includes(file));
    const changedFiles = [];
    for (const [index, file] of closure.entries()) {
      if (
        files.includes(file) &&
        (await digest(path.join(root, file))) !== hashes[index]
      )
        changedFiles.push(file);
    }
    const extraFiles = files.filter((file) => !closure.includes(file)).length;
    return {
      source:
        missingFiles.length || changedFiles.length || extraFiles
          ? "DRIFT"
          : "PASS",
      missingFiles,
      changedFiles,
      extraFiles,
    };
  } catch {
    return {
      source: "UNVERIFIED",
      sourceReason: "Deployed source unavailable or invalid.",
    };
  }
}

export async function checkBackendRelease(
  { projectRef, versions, cli = "supabase" },
  { supabaseDir = SUPABASE_DIR, run = runSupabase } = {},
) {
  assertProject(projectRef);
  if (!SLUGS.every((slug) => validVersion(versions?.[slug])))
    throw new Error(USAGE);
  const parent = await fs.realpath(os.tmpdir());
  const scratch = await fs.mkdtemp(path.join(parent, "aquafeed-release-"));
  try {
    const metadataDir = await makeCliDirectory(scratch, "metadata");
    const command = (args, cwd = metadataDir) => {
      const flags = ["--project-ref", projectRef, "--workdir", cwd];
      // Keep the fixed SQL positional argument last for the db query parser.
      const argv =
        args[0] === "db"
          ? [...args.slice(0, -1), ...flags, args.at(-1)]
          : [...args, ...flags];
      return run(cli, argv, cwd);
    };
    const migrations = await checkMigrations(supabaseDir, command);
    const metadata = await checkFunctionMetadata(
      supabaseDir,
      versions,
      command,
    );
    const functions = {};
    for (const slug of SLUGS) {
      const entry = metadata.get(slug) ?? {
        deployment: "UNVERIFIED",
        reason: "Function metadata unavailable or invalid.",
      };
      const cwd = await makeCliDirectory(scratch, slug);
      const source = await checkFunctionSource(
        supabaseDir,
        slug,
        projectRef,
        command,
        cwd,
      );
      functions[slug] = {
        status: statusOf([
          entry.deployment,
          entry.version,
          entry.jwt,
          source.source,
        ]),
        ...entry,
        ...source,
      };
    }
    return {
      projectRef,
      status: statusOf([
        migrations.status,
        ...Object.values(functions).map((fn) => fn.status),
      ]),
      migrations,
      functions,
    };
  } finally {
    if (
      path.dirname(scratch) !== parent ||
      (await fs.realpath(scratch)) !== scratch
    )
      throw new Error(
        "Temporary release evidence cleanup could not be verified.",
      );
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  let summary;
  try {
    const options = parseOptions(process.argv.slice(2));
    try {
      summary = await checkBackendRelease(options);
    } catch {
      summary = {
        status: "UNVERIFIED",
        reason: "Release evidence could not be collected safely.",
      };
    }
  } catch (error) {
    summary = { status: "UNVERIFIED", reason: error.message };
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = { PASS: 0, DRIFT: 1, UNVERIFIED: 2 }[summary.status];
}
