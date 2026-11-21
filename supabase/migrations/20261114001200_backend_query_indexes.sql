-- Backend T06: policy-only scalar auth.uid convention; ZERO indexes added or dropped.
-- Depends on ART95 alert RLS and the unchanged T04/T05 schema. Old clients remain compatible.
-- No rows, feeding identities/evidence, functions, grants, constraints or query shapes change.
-- CI43618084596/c8b4ecc verified A/B/A access semantics; NO demonstrated latency speedup.
-- Verify: backend_query_access.sql plus all 24 migrations / 13 suites and strict public types.
-- Recovery: docs/operations/backend-migrations.md; rollback uncommitted DDL, otherwise a reviewed
-- forward policy correction only. No data restore/down migration or shared deployment authorized.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public;
lock table public.alert_events in access exclusive mode;

do $$
declare
  expected text := E'(EXISTS ( SELECT 1\n   FROM device_access a\n  WHERE ((a.device_id = alert_events.device_id) AND (a.installation_id = auth.uid()) AND (a.status = ''active''::text))))';
  policy_before jsonb;
  relation_before jsonb;
  columns_before jsonb;
begin
  if (select count(*) from pg_policy where polrelid='public.alert_events'::regclass) <> 1 then
    raise exception 'T06 alert policy count mismatch';
  end if;
  select to_jsonb(p)-'polqual' into strict policy_before from pg_policy p
    where polrelid='public.alert_events'::regclass and polname='alert_events_active_member_select'
      and polcmd='r' and polpermissive and polwithcheck is null
      and polroles=array[(select oid from pg_roles where rolname='authenticated')]
      and pg_get_expr(polqual,polrelid)=expected;
  select to_jsonb(c) into strict relation_before from pg_class c
    where oid='public.alert_events'::regclass and relrowsecurity and not relforcerowsecurity;
  select jsonb_agg(to_jsonb(a) order by attnum) into columns_before from pg_attribute a
    where attrelid='public.alert_events'::regclass;
  if (select count(*)<>2 or bool_or(rolsuper or rolbypassrls)
        from pg_roles where rolname in ('anon','authenticated')) then
    raise exception 'T06 client role mismatch';
  end if;
  if exists(select 1 from pg_roles r join pg_class c on c.relowner=r.oid
      where c.oid='public.alert_events'::regclass and r.rolname in ('anon','authenticated'))
    or not has_table_privilege('authenticated','public.alert_events','SELECT')
    or has_table_privilege('authenticated','public.alert_events','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    or has_table_privilege('anon','public.alert_events','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    or has_any_column_privilege('anon','public.alert_events','SELECT,INSERT,UPDATE,REFERENCES')
    or has_any_column_privilege('authenticated','public.alert_events','INSERT,UPDATE,REFERENCES')
    or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
      where c.oid='public.alert_events'::regclass and (x.grantee=0 or (x.grantee=(select oid from pg_roles where rolname='authenticated') and x.is_grantable)))
    or exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) x
      where a.attrelid='public.alert_events'::regclass and (x.grantee=0 or x.grantee=(select oid from pg_roles where rolname='anon')
        or (x.grantee=(select oid from pg_roles where rolname='authenticated') and (x.privilege_type<>'SELECT' or x.is_grantable)))) then
    raise exception 'T06 alert privilege mismatch';
  end if;

  alter policy alert_events_active_member_select on public.alert_events using (exists (
    select 1 from public.device_access a where a.device_id=alert_events.device_id
      and a.installation_id=(select auth.uid()) and a.status='active'));

  expected:=replace(expected,'a.installation_id = auth.uid()','a.installation_id = ( SELECT auth.uid() AS uid)');
  if not exists(select 1 from pg_policy p where polrelid='public.alert_events'::regclass
      and polname='alert_events_active_member_select' and to_jsonb(p)-'polqual'=policy_before
      and pg_get_expr(polqual,polrelid)=expected)
    or (select to_jsonb(c) from pg_class c where oid='public.alert_events'::regclass) is distinct from relation_before
    or (select jsonb_agg(to_jsonb(a) order by attnum) from pg_attribute a where attrelid='public.alert_events'::regclass) is distinct from columns_before then
    raise exception 'T06 policy-only preservation mismatch';
  end if;
end $$;
commit;
