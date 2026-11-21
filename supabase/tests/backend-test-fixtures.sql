\set ON_ERROR_STOP on
-- Disposable-only canonical profiles: revision 1 before ART33, revision 5 after all migrations.
-- No real credentials, Auth accounts, access rows, feed events or external calls.
begin;
do $$
begin
  if current_database()<>'aquafeed_backend_test'
     or not exists(select 1 from backend_test.provenance
       where singleton and database_oid=(select oid from pg_database where datname=current_database())) then
    raise exception 'fixture setup requires disposable bootstrap provenance';
  end if;
end $$;
set local role service_role;
do $$
declare
  result jsonb;
begin
  result := public.art38_provision_simulated_device(
    '22222222-2222-4222-8222-222222222222', repeat('a',64), false);
  if result->>'status' <> 'provisioned' then
    raise exception 'isolated primary simulator fixture was not freshly provisioned';
  end if;
  result := public.art38_provision_simulated_device(
    '33333333-3333-4333-8333-333333333333', repeat('b',64), false);
  if result->>'status' <> 'provisioned' then
    raise exception 'isolated secondary simulator fixture was not freshly provisioned';
  end if;
end $$;
reset role;
-- Only the initial canonical revision-1 creation may authorize later guarded cleanup.
update backend_test.provenance set migration_fixtures_created=true
where not migration_fixtures_created and not migration_fixtures_cleaned
  and (select count(*) from public.devices where device_id in (
    '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333')
    and is_simulated and protocol_major=2 and capabilities_revision=1)=2;
commit;
