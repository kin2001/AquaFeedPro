\set ON_ERROR_STOP on
-- TEST ONLY: remove empty task-created migration profiles, never evidence or seed 111.
-- All checks, guard regressions, exact-row deletion and helper removal are one transaction.
begin;
create function backend_test.cleanup_migration_fixtures() returns void
language plpgsql as $$
declare
  ids constant uuid[] := array[
    '22222222-2222-4222-8222-222222222222'::uuid,
    '33333333-3333-4333-8333-333333333333'::uuid];
  -- Direct and indirect device children, including journals and private alert/push/access state.
  children constant text[] := array[
    'public.device_access','public.device_config_revisions','public.device_schedule_identities',
    'public.device_schedule_tombstones','public.device_config_schedules','public.device_config_schedule_slots',
    'public.device_telemetry','public.device_metric_observations','public.device_metric_current',
    'public.device_resource_versions','public.feed_sequences','public.feed_sequence_targets','public.feed_steps',
    'public.scheduled_occurrences','public.device_events','public.device_execution_reservations','public.alert_events',
    'private.pairing_challenges','private.security_audit_events','private.device_alert_state',
    'private.installation_alert_event_state','private.installation_alert_bulk_state','private.alert_push_deliveries'];
  relation text;
  has_evidence boolean;
  affected integer;
begin
  if current_database()<>'aquafeed_backend_test'
     or (select count(*) from backend_test.provenance where singleton
       and database_oid=(select oid from pg_database where datname=current_database())
       and migration_fixtures_created and not migration_fixtures_cleaned)<>1 then
    raise exception 'cleanup requires fresh-bootstrap provenance' using errcode='55000';
  end if;
  -- Refuse new device-bearing dependencies until explicitly reviewed and enumerated.
  if exists(select 1 from pg_attribute a join pg_class c on c.oid=a.attrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','private') and c.relkind in ('r','p')
        and a.attname='device_id' and not a.attisdropped
        and n.nspname||'.'||c.relname <> all(children || array[
          'public.devices','public.device_state','private.device_credentials']))
     or exists(select 1 from pg_constraint k join pg_class c on c.oid=k.conrelid
       join pg_namespace n on n.oid=c.relnamespace
       where k.contype='f' and k.confrelid=any(array[
         'public.devices'::regclass,'public.device_state'::regclass,'private.device_credentials'::regclass])
       and n.nspname||'.'||c.relname <> all(children || array[
         'public.devices','public.device_state','private.device_credentials'])) then
    raise exception 'cleanup found an unreviewed device dependency' using errcode='55000';
  end if;
  -- Block writes during checks/deletion; this runs serially on a disposable CI database only.
  lock table public.devices,public.device_state,private.device_credentials in share row exclusive mode;
  foreach relation in array children loop
    execute format('lock table %s in share mode',relation::regclass);
    execute format('select exists(select 1 from %s where device_id=any($1))',relation::regclass)
      into has_evidence using ids;
    if has_evidence then
      raise exception 'cleanup refuses business evidence in %',relation using errcode='55000';
    end if;
  end loop;
  -- Tokens/rate windows have no device FK; no installation/challenge was created by this setup.
  if exists(select 1 from private.installation_push_tokens)
     or exists(select 1 from private.api_rate_windows) then
    raise exception 'cleanup refuses unattributed token or rate evidence' using errcode='55000';
  end if;
  if (select count(*) from public.devices where device_id=any(ids)
      and is_simulated and protocol_major=2 and capabilities_revision=5
      and model='AquaFeed controlled simulator' and firmware_version='sim-2.0.0'
      and desired_revision is null and applied_revision is null and last_attempt_revision is null
      and last_attempt_status is null and configuration_error_code is null
      and alias is null and location is null and metadata_revision=1 and not metadata_conflict
      and capabilities->>'scheduled_both'='true' and capabilities->>'feed_capacity_g'='20000')<>2
     or (select count(*) from private.device_credentials where device_id=any(ids) and revoked_at is null
       and credential_verifier=decode(case when device_id=ids[1] then repeat('a',64) else repeat('b',64) end,'hex'))<>2
     or (select count(*) from public.device_state s where device_id=any(ids)
       and to_jsonb(s)-'device_id'-'updated_at'='{
         "last_authenticated_contact_at":null,"contact_freshness":"unknown",
         "last_sample_at":null,"sample_freshness":"unknown","sample_quality":"unavailable",
         "safety_lockout":false,"lockout_sequence_id":null,"live_sequence":-1,
         "latest_telemetry_boot_id":null,"latest_telemetry_sequence":null}'::jsonb)<>2 then
    raise exception 'cleanup requires the known empty synthetic profiles, verifiers and state' using errcode='55000';
  end if;
  delete from private.device_credentials where device_id=any(ids);
  get diagnostics affected=row_count;
  if affected<>2 then raise exception 'unexpected credential delete count'; end if;
  delete from public.device_state where device_id=any(ids);
  get diagnostics affected=row_count;
  if affected<>2 then raise exception 'unexpected state delete count'; end if;
  delete from public.devices where device_id=any(ids);
  get diagnostics affected=row_count;
  if affected<>2 then raise exception 'unexpected profile delete count'; end if;
  update backend_test.provenance set migration_fixtures_cleaned=true where singleton;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'unexpected provenance update count'; end if;
end $$;

-- Executable guards: each expected exception rolls back the injected mutation in its subtransaction.
do $$
begin
  begin
    update backend_test.provenance set migration_fixtures_created=false;
    perform backend_test.cleanup_migration_fixtures();
    raise exception 'cleanup incorrectly accepted missing provenance';
  exception when sqlstate '55000' then
    if sqlerrm<>'cleanup requires fresh-bootstrap provenance' then raise; end if;
  end;
  begin
    create table backend_test.unreviewed_reference(feeder_id uuid references public.devices(device_id));
    perform backend_test.cleanup_migration_fixtures();
    raise exception 'cleanup incorrectly accepted an unreviewed dependency';
  exception when sqlstate '55000' then
    if sqlerrm<>'cleanup found an unreviewed device dependency' then raise; end if;
  end;
  begin
    insert into public.device_telemetry(device_id,boot_id,sample_sequence,time_quality,do_quality,feed_quality)
      values('22222222-2222-4222-8222-222222222222','99999999-9999-4999-8999-999999999999',1,
        'uncertain','unavailable','unavailable');
    perform backend_test.cleanup_migration_fixtures();
    raise exception 'cleanup incorrectly accepted telemetry evidence';
  exception when sqlstate '55000' then
    if sqlerrm<>'cleanup refuses business evidence in public.device_telemetry' then raise; end if;
  end;
  begin
    update private.device_credentials set revoked_at=clock_timestamp()
      where device_id='22222222-2222-4222-8222-222222222222';
    perform backend_test.cleanup_migration_fixtures();
    raise exception 'cleanup incorrectly accepted an unexpected credential state';
  exception when sqlstate '55000' then
    if sqlerrm<>'cleanup requires the known empty synthetic profiles, verifiers and state' then raise; end if;
  end;
end $$;

do $$
declare
  seed_before jsonb;
  seed_after jsonb;
begin
  select jsonb_build_array(to_jsonb(d),to_jsonb(s)) into seed_before
    from public.devices d join public.device_state s using(device_id)
    where device_id='11111111-1111-4111-8111-111111111111';
  if seed_before is null then raise exception 'D1 seed must remain present'; end if;
  perform backend_test.cleanup_migration_fixtures();
  select jsonb_build_array(to_jsonb(d),to_jsonb(s)) into seed_after
    from public.devices d join public.device_state s using(device_id)
    where device_id='11111111-1111-4111-8111-111111111111';
  if seed_after is distinct from seed_before then raise exception 'cleanup altered D1 seed'; end if;
end $$;
drop function backend_test.cleanup_migration_fixtures();
commit;
