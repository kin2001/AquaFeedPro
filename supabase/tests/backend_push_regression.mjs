import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isolatedConnection } from "../scripts/check-backend-baseline.mjs";
import { PsqlSession } from "./backend_lock_order.mjs";

const OLD_MARKER = "T09_OLD_BODIES_VERIFIED";
const GREEN_MARKER = "T09_FORWARD_SUITE_COMPLETED";
const RED_MESSAGE =
  "T09 uncertain/terminal send was automatically reclaimed: lost-ticket-write";
const CHILD_APP = "aquafeed-t09-push-control";
const q = (value) => `'${value.replaceAll("'", "''")}'`;
const signatures = [
  "public.art96_claim_push_deliveries(integer,integer)",
  "public.art96_record_push_send(uuid,uuid,bigint,text,text,text)",
];
const provenance = `DO $guard$ BEGIN
  IF current_database()<>'aquafeed_backend_test'
    OR NOT EXISTS (SELECT 1 FROM backend_test.provenance p JOIN pg_database d ON d.oid=p.database_oid
      WHERE p.singleton AND d.datname=current_database()
        AND p.migration_fixtures_created AND p.migration_fixtures_cleaned)
  THEN RAISE EXCEPTION 'fresh disposable baseline required'; END IF;
END $guard$;`;

// Accept only this suite's single DO block between BEGIN/ROLLBACK, never arbitrary psql input.
export function validateRollbackSuite(source) {
  const meta = source.split(/\r?\n/).filter((line) => /^\s*\\/.test(line));
  const sql = source.replace(/^\\set ON_ERROR_STOP on\r?\n/, "");
  const outside = sql.replace(
    /--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)[\s\S]*?\1/g,
    (token) => (token.startsWith("--") || token.startsWith("/*") ? " " : "?"),
  );
  if (
    meta.length !== 1 ||
    meta[0] !== "\\set ON_ERROR_STOP on" ||
    /\b(?:commit|abort|end\s+(?:transaction|work)|(?:start|prepare)\s+transaction)\b/i.test(
      sql,
    ) ||
    !/^\s*begin\s*;\s*set\s+constraints\s+all\s+deferred\s*;\s*do\s+\?\s*;\s*rollback\s*;\s*$/i.test(
      outside,
    )
  ) {
    throw new Error("The ART96 control must remain rollback-only.");
  }
  return source;
}

export function requireOldRed({ code, stdout, stderr }) {
  const errors = [
    ...stderr.matchAll(
      /^(?:psql:[^\r\n]+:\d+:\s*)?(?:ERROR|FATAL):[^\r\n]*$/gm,
    ),
  ];
  const expected = errors[0]?.[0].match(
    /^(?:psql:[^\r\n]+:\d+:\s*)?ERROR:\s+P0001:\s*([^\r\n]*)$/,
  );
  if (
    code !== 3 ||
    stdout.trim() !== OLD_MARKER ||
    errors.length !== 1 ||
    expected?.[1] !== RED_MESSAGE
  ) {
    throw new Error("The expected OLD assertion was not observed.");
  }
}

async function oldDefinitions() {
  const files = [
    "20261016140000_art102_shared_device_metadata.sql",
    "20261014125042_art96_android_push.sql",
  ];
  return Promise.all(
    files.map(async (file, index) => {
      const name = signatures[index].split("(")[0];
      const source = (
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        )
      ).replaceAll("\r\n", "\n");
      const matches = [
        ...source.matchAll(
          new RegExp(
            `create(?: or replace)? function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`,
            "g",
          ),
        ),
      ];
      assert.equal(matches.length, 1);
      // Only CREATE's replacement qualifier changes. The immutable effective OLD body is untouched.
      const sql = matches[0][0].replace(
        /^create function /,
        "create or replace function ",
      );
      const bodyMatch = sql.match(/\bas \$\$([\s\S]*)\$\$;$/i);
      assert.ok(bodyMatch?.[1]);
      assert.equal(sql.slice(0, bodyMatch.index).includes(";"), false);
      return { sql, body: bodyMatch[1], signature: signatures[index] };
    }),
  );
}

// Dedicated short-lived client: ON_ERROR_STOP exits roll back OLD DDL and all fixture writes together.
export async function suiteClient(env, psqlPath, input) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      psqlPath,
      [
        "-X",
        "--no-password",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
      ],
      {
        env: { ...env, PGAPPNAME: CHILD_APP },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stdout = "",
      stderr = "";
    const fail = () => {
      child.kill();
      reject(new Error("Isolated push control client failed."));
    };
    const deadline = setTimeout(fail, 30_000);
    for (const [stream, append] of [
      [
        child.stdout,
        (text) => {
          stdout += text;
        },
      ],
      [
        child.stderr,
        (text) => {
          stderr += text;
        },
      ],
    ])
      stream.on("data", (chunk) => {
        append(chunk.toString());
        if (stdout.length + stderr.length > 32_768) fail();
      });
    child.once("error", () => {
      clearTimeout(deadline);
      fail();
    });
    child.stdin.on("error", fail);
    child.once("close", (code) => {
      clearTimeout(deadline);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function definitions(session) {
  return session.ok(`SELECT jsonb_build_object(
    'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl,
    'security_definer',p.prosecdef,'config',p.proconfig)
    FROM pg_proc p JOIN (VALUES ${signatures.map((signature, i) => `(${i},${q(signature)}::regprocedure)`).join(",")}) f(n,oid)
      ON p.oid=f.oid ORDER BY f.n;`);
}

async function fixtures(session) {
  // Hash only test-owned database facts; no row, token, or credential values leave the private channel.
  const tables = [
    "auth.users",
    "public.devices",
    "public.device_access",
    "public.device_state",
    "public.device_config_revisions",
    "public.device_telemetry",
    "public.alert_events",
    "private.installation_push_tokens",
    "private.alert_push_deliveries",
    "private.alert_push_sender_state",
    "private.security_audit_events",
    "private.device_alert_state",
  ];
  return session.ok(
    `SELECT jsonb_object_agg(name,digest) FROM (${tables
      .map(
        (table) =>
          `SELECT ${q(table)} name,md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) digest FROM ${table} t`,
      )
      .join(" UNION ALL ")}) facts;`,
  );
}

export async function runPushRegression({
  databaseUrl,
  psqlPath = "psql",
} = {}) {
  const env = isolatedConnection(databaseUrl); // Reject cloud/tunnel URL overrides before any client.
  const suite = validateRollbackSuite(
    await readFile(
      new URL("./art96_push_delivery.sql", import.meta.url),
      "utf8",
    ),
  );
  const old = await oldDefinitions();
  const session = new PsqlSession(
    { ...env, PGAPPNAME: "aquafeed-t09-push-observer" },
    psqlPath,
  );
  let stage = "guard";
  try {
    await session.ok(
      "SET statement_timeout='8s'; SET lock_timeout='6s'; SET idle_in_transaction_session_timeout='15s';",
    );
    await session.ok(provenance);
    const savedDefinitions = await definitions(session);
    assert.equal(savedDefinitions.length, 2);
    const savedFixtures = await fixtures(session);
    const prefix = `BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='6s';
      SET LOCAL idle_in_transaction_session_timeout='15s'; SET LOCAL standard_conforming_strings=on;
      ${provenance}\n`;
    const verifyRollback = async () => {
      assert.deepEqual(await definitions(session), savedDefinitions);
      assert.deepEqual(await fixtures(session), savedFixtures);
      const [closed] = await session.ok(`SELECT to_jsonb(NOT EXISTS(
        SELECT 1 FROM pg_stat_activity WHERE application_name=${q(CHILD_APP)}));`);
      assert.equal(closed, true);
    };
    stage = "old";
    try {
      const applied = old
        .map(
          ({ signature, body }) =>
            `(SELECT replace(prosrc,E'\\r\\n',E'\\n') FROM pg_proc WHERE oid=${q(signature)}::regprocedure) IS NOT DISTINCT FROM ${q(body)}`,
        )
        .join(" AND ");
      const result = await suiteClient(
        env,
        psqlPath,
        `${prefix}${old.map(({ sql }) => sql).join("\n")}
        DO $verify$ BEGIN IF NOT (${applied}) THEN RAISE EXCEPTION 'OLD bodies not applied'; END IF; END $verify$;
        SELECT '${OLD_MARKER}';\n${suite}`,
      );
      requireOldRed(result);
      console.log(
        "RED observed backend_push_regression: verified OLD bodies, exact lost-ticket P0001 assertion",
      );
    } finally {
      // OLD was never committed. Even an unexpected error/disconnect must restore definitions and fixtures.
      try {
        await verifyRollback();
      } catch {
        stage = "old-rollback";
        throw new Error("OLD rollback verification failed.");
      }
    }
    stage = "green";
    try {
      const result = await suiteClient(
        env,
        psqlPath,
        `${prefix}${suite}\nSELECT '${GREEN_MARKER}';`,
      );
      assert.equal(result.code, 0);
      assert.equal(result.stdout.trim(), GREEN_MARKER);
      assert.doesNotMatch(result.stderr, /(?:ERROR|FATAL):/);
    } finally {
      try {
        await verifyRollback();
      } catch {
        stage = "green-rollback";
        throw new Error("Forward rollback verification failed.");
      }
    }
  } catch {
    throw new Error(
      `Push regression failed at stage=${stage}; raw SQL/results suppressed.`,
    );
  } finally {
    await session.close();
  }
  console.log(
    "PASS backend_push_regression: OLD RED / forward GREEN, definitions/ACLs/fixtures unchanged, no tagged sessions",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (
    args.length !== 2 ||
    args[0] !== "--database-url-env" ||
    !/^[A-Z_][A-Z0-9_]*$/.test(args[1])
  ) {
    console.error(
      "Usage: node supabase/tests/backend_push_regression.mjs --database-url-env LOCAL_TEST_DATABASE_URL",
    );
    process.exitCode = 1;
  } else
    runPushRegression({
      databaseUrl: process.env[args[1]],
      psqlPath: process.env.PSQL_PATH || "psql",
    }).catch(() => {
      console.error(
        "FAIL backend_push_regression: disposable control failed; raw SQL/results suppressed.",
      );
      process.exitCode = 1;
    });
}
