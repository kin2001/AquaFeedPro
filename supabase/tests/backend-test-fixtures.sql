\set ON_ERROR_STOP on
-- Disposable-only baseline for suites that expect pre-provisioned simulator profiles.
-- No real credentials, Auth accounts, access rows, feed events or external calls.
begin;
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
commit;
