// Disposable-only adversarial default ACL control. A failed client rolls back DDL and defaults together.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isolatedConnection } from "../scripts/check-backend-baseline.mjs";
import { suiteClient } from "./backend_push_regression.mjs";

const RESET = "revoke all on public.%I from public,anon,authenticated,service_role'";
const MESSAGE = "T04_SERVICE_DESTRUCTIVE_DEFAULT_ACL";
export function migrationBody(source) {
  const opening = /^begin;\r?$/m.exec(source);
  if (!opening || source.slice(0, opening.index).replace(/--[^\r\n]*/g, "").trim() ||
      (source.match(/^begin;\r?$/gm) ?? []).length !== 1 ||
      (source.match(/^commit;\r?$/gm) ?? []).length !== 1 ||
      (source.match(/\b(?:begin|commit)\s*;/gi) ?? []).length !== 2 ||
      !/^commit;\s*$/.test(source.slice(source.lastIndexOf("commit;"))) ||
      /\b(?:rollback|abort|prepare\s+transaction|start\s+transaction|end\s+(?:transaction|work))\b/i.test(source) ||
      /^\s*\\/m.test(source)) throw new Error("T04 ACL control requires the exact single outer migration transaction.");
  return source.replace(/^begin;\r?$/m, "").replace(/^commit;\r?$/m, "");
}
export function withoutServiceReset(body) {
  if (body.split(RESET).length !== 2) throw new Error("T04 service ACL reset must occur exactly once.");
  return body.replace(RESET, "revoke all on public.%I from public,anon,authenticated'");
}
export function requireAclOldRed({ code, stdout, stderr }) {
  const errors = [...stderr.matchAll(/^(?:psql:[^\r\n]+:\d+:\s*)?(?:ERROR|FATAL):[^\r\n]*$/gm)];
  if (code !== 3 || stdout.trim() || errors.length !== 1 ||
      !new RegExp(`^(?:psql:[^\\r\\n]+:\\d+:\\s*)?ERROR:\\s+P0001:\\s*${MESSAGE}$`).test(errors[0]?.[0] ?? ""))
    throw new Error("T04 exact adversarial-default privilege OLD assertion was not observed.");
}

const guard = `DO $guard$ BEGIN
  IF current_database()<>'aquafeed_backend_test' OR NOT EXISTS (
    SELECT 1 FROM backend_test.provenance WHERE singleton AND migration_fixtures_created AND NOT migration_fixtures_cleaned
      AND database_oid=(SELECT oid FROM pg_database WHERE datname=current_database()))
    THEN RAISE EXCEPTION 'T04_DEFAULT_ACL_PROVENANCE_MISMATCH'; END IF;
END $guard$;`;
const acl = `SELECT jsonb_build_object(
  'database_oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
  'owner_oid',(SELECT oid::text FROM pg_roles WHERE rolname=current_user),
  'had_row',EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole=current_user::regrole AND defaclnamespace='public'::regnamespace AND defaclobjtype='r'),
  'entries',coalesce((SELECT jsonb_agg(jsonb_build_array(e.grantor::text,e.grantee::text,e.privilege_type,e.is_grantable)
    ORDER BY e.grantor,e.grantee,e.privilege_type,e.is_grantable)
    FROM pg_default_acl a CROSS JOIN LATERAL aclexplode(a.defaclacl) e
    WHERE a.defaclrole=current_user::regrole AND a.defaclnamespace='public'::regnamespace AND a.defaclobjtype='r'),'[]'::jsonb))`;
const catalog = `SELECT jsonb_build_object('acl',(${acl}),
  'objects',jsonb_build_array(
    to_regclass('public.device_metric_observations') IS NOT NULL,
    to_regclass('public.device_metric_current') IS NOT NULL,
    to_regclass('public.device_resource_versions') IS NOT NULL,
    to_regprocedure('private.backend_valid_metric_observation(jsonb)') IS NOT NULL,
    to_regprocedure('private.backend_metric_immutable()') IS NOT NULL,
    to_regprocedure('private.backend_metric_current_guard()') IS NOT NULL,
    to_regprocedure('private.backend_current_metric(uuid,text)') IS NOT NULL,
    to_regprocedure('private.backend_evaluate_metric_alerts(uuid,text)') IS NOT NULL,
    to_regprocedure('public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb)') IS NOT NULL),
  'alert_source_column',EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.alert_events'::regclass AND attname='observation_metric' AND NOT attisdropped),
  'alert_source_key',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.alert_events'::regclass AND conname='alert_events_source_identity'),
  'patched_bodies',(SELECT jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) FROM (VALUES
    ('public.art31_create_manual_feed(uuid,uuid,uuid,uuid,jsonb,integer)'),
    ('private.art95_evaluate_alert_crossings()')) signatures(signature)))`;
const q = (value) => `'${value.replaceAll("'", "''")}'`;
const assertPrivileges = `DO $privileges$ DECLARE t text; p text; BEGIN
  FOREACH t IN ARRAY ARRAY['device_metric_observations','device_metric_current','device_resource_versions'] LOOP
    FOREACH p IN ARRAY ARRAY['DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF has_table_privilege('service_role','public.'||t,p) THEN
        RAISE EXCEPTION '${MESSAGE}'; END IF;
    END LOOP;
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
      IF NOT has_table_privilege('service_role','public.'||t,p) THEN
        RAISE EXCEPTION 'T04_SERVICE_REQUIRED_PRIVILEGE_MISSING'; END IF;
    END LOOP;
  END LOOP;
END $privileges$;`;

export async function installMetricWithAclControl({ databaseUrl, psqlPath = "psql" }) {
  const env = isolatedConnection(databaseUrl);
  const body = migrationBody(await readFile(new URL("../migrations/20261114001000_backend_metric_observations.sql", import.meta.url), "utf8"));
  // Each invocation is a new bounded client, including final restoration proof.
  const facts = async () => {
    const result = await suiteClient(env, psqlPath, `BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; ${guard} ${catalog}; ROLLBACK;`);
    if (result.code !== 0) throw new Error("T04 read-only default-ACL restoration proof failed.");
    try { return JSON.parse(result.stdout.trim()); } catch { throw new Error("T04 catalog proof was malformed."); }
  };
  const before = await facts();
  assert.ok(before.objects.every((present) => present === false) && !before.alert_source_column && !before.alert_source_key, "T04 control requires uninstalled objects");
  const baseline = q(JSON.stringify(before.acl));
  const transaction = (migration, commit) => `BEGIN;
SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s';
${guard}
DO $baseline$ BEGIN IF (${acl}) IS DISTINCT FROM ${baseline}::jsonb THEN RAISE EXCEPTION 'T04_DEFAULT_ACL_BASELINE_CHANGED'; END IF; END $baseline$;
-- Save exact service grantor/grantee/privilege/grantability before adversarial defaults.
CREATE TEMP TABLE t04_service_acl_before ON COMMIT DROP AS
  SELECT e.* FROM pg_default_acl a CROSS JOIN LATERAL aclexplode(a.defaclacl) e
  WHERE a.defaclrole=current_user::regrole AND a.defaclnamespace='public'::regnamespace AND a.defaclobjtype='r' AND e.grantee='service_role'::regrole;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
${migration}
${assertPrivileges}
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM service_role;
DO $restore$ DECLARE entry record; BEGIN
  FOR entry IN SELECT * FROM t04_service_acl_before LOOP
    IF entry.grantor<>current_user::regrole OR entry.grantee<>'service_role'::regrole
      OR entry.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
      THEN RAISE EXCEPTION 'T04_UNEXPECTED_DEFAULT_ACL_ENTRY'; END IF;
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT %s ON TABLES TO service_role%s',
      entry.privilege_type,CASE WHEN entry.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  IF (${acl}) IS DISTINCT FROM ${baseline}::jsonb THEN RAISE EXCEPTION 'T04_DEFAULT_ACL_NOT_RESTORED'; END IF;
END $restore$;
${commit ? "COMMIT;" : "ROLLBACK;"}`;
  let primary;
  let installed = false;
  try {
    requireAclOldRed(await suiteClient(env, psqlPath, transaction(withoutServiceReset(body), false)));
    // OLD failed inside its transaction: verify defaults, absence, and patched predecessor bodies all rolled back.
    assert.deepEqual(await facts(), before, "T04 OLD rollback must restore exact catalog/default ACL entries and row absence");
    const forward = await suiteClient(env, psqlPath, transaction(body, true));
    if (forward.code !== 0) throw new Error("T04 forward migration/default-ACL control failed; transaction rolled back.");
    installed = true;
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      const after = await facts();
      assert.deepEqual(after.acl, before.acl, "T04 original default entries/grant options/row absence must be restored");
      if (!installed) assert.deepEqual(after, before, "T04 failed installation must leave catalog unchanged");
      else assert.ok(after.objects.every((present) => present === true) && after.alert_source_column && after.alert_source_key, "T04 forward objects must be installed");
    } catch (proof) {
      if (primary) throw new AggregateError([primary, proof], "T04 control failed and independent restoration proof also failed.");
      throw proof;
    }
  }
  console.log("PASS T04 effective adversarial default ACL OLD RED / forward GREEN; exact entries/grantability/absence restored (disposable only)");
}
