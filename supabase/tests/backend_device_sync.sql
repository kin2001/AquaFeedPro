\set ON_ERROR_STOP on
-- B2-1 FIRST TEST CANDIDATE: parent-owned disposable RED, NOT native/hardware evidence.
-- Catches N11's not_found exit discarding real reconciliation changes before finalization.
-- Baseline 1802 / unchanged 01200-01400 is expected to fail at the fixed VERSION marker.
-- This is one pilot, NOT coverage of all 26 exits, producers, ACLs or aggregate behavior.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';
set local idle_in_transaction_session_timeout = '15s';
set local timezone = 'UTC';
set constraints all deferred;

do $$
begin
  if current_database() <> 'aquafeed_backend_test' or current_user <> 'postgres' then
    raise exception 'T08_B2_DISPOSABLE_TARGET_REQUIRED';
  end if;
  if not exists (
    select 1 from backend_test.provenance where singleton
      and migration_fixtures_created and migration_fixtures_cleaned
      and database_oid=(select oid from pg_catalog.pg_database where datname=current_database())
  ) then
    raise exception 'T08_B2_FRESH_PROVENANCE_REQUIRED';
  end if;
end $$;

do $$
declare
  d constant uuid := 'a808b201-0000-4000-8000-000000000001';
  installation constant uuid := 'a808b201-0000-4000-8000-000000000011';
  outsider constant uuid := 'a808b201-0000-4000-8000-000000000012';
  boot constant uuid := 'a808b201-0000-4000-8000-000000000021';
  request_id constant uuid := 'a808b201-0000-4000-8000-000000000031';
  command_key constant uuid := 'a808b201-0000-4000-8000-000000000041';
  missing_lookup constant uuid := 'a808b201-0000-4000-8000-000000000099';
  targets constant jsonb := '[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":25}},{"nozzle_number":2,"dose":{"mode":"grams","amount_g":40}}]';
  v_sequence_id uuid;
  result jsonb;
  before_versions jsonb;
  expected_versions jsonb;
  after_versions jsonb;
  before_message_ids uuid[];
  before_messages bigint;
  after_messages bigint;
  m realtime.messages%rowtype;
  changed integer;
  v_topic text := 'device:'||d::text||':updates';
begin
  -- Refuse collisions, never rotate credentials, clear evidence or reuse a fixture's state.
  if exists(select 1 from public.devices x where x.device_id=d)
    or exists(select 1 from auth.users u where u.id in (installation,outsider)) then
    raise exception 'T08_B2_FIXTURE_COLLISION';
  end if;
  insert into auth.users(id,is_anonymous) values(installation,true);
  -- Same isolated profile-clone pattern as backend_lock_order.mjs, not provisioning/rotation.
  insert into public.devices(device_id,model,firmware_version,protocol_major,is_simulated,capabilities_revision,capabilities)
    select d,'T08 B2 disposable producer pilot',x.firmware_version,x.protocol_major,true,x.capabilities_revision,x.capabilities
    from public.devices x where x.device_id='22222222-2222-4222-8222-222222222222'
      and x.is_simulated and x.protocol_major=2 and x.capabilities_revision=5
      and x.capabilities->>'feed_capacity_g'='20000';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'T08_B2_PROFILE_FIXTURE_MISSING'; end if;
  -- Entirely synthetic verifier owned by this disposable rollback fixture; no existing credential read.
  insert into private.device_credentials(device_id,credential_verifier) values(d,decode(repeat('a',64),'hex'));
  insert into public.device_access(device_id,installation_id,status) values(d,installation,'active');
  insert into public.device_state(device_id) values(d);
  result := public.art27_sync_telemetry(d,repeat('a',64),boot,1,
    jsonb_build_object('sequence',1,'measured_at',clock_timestamp(),'time_quality','rtc',
      'do_mg_l',5.8,'do_quality','valid','feed_remaining_g',20000,'feed_percent',100,
      'feed_quality','valid','calibration_revision',1),'[]'::jsonb);
  if (result->>'status'='ok') is distinct from true then
    raise exception 'T08_B2_TELEMETRY_SETUP_FAILED';
  end if;
  result := public.art31_create_manual_feed(d,installation,request_id,command_key,targets,5);
  if (result->>'status'='created' and result#>>'{command,status}'='queued') is distinct from true then
    raise exception 'T08_B2_ADMISSION_SETUP_FAILED';
  end if;
  v_sequence_id := (result#>>'{command,sequence_id}')::uuid;
  if v_sequence_id is null then raise exception 'T08_B2_ADMISSION_SETUP_FAILED'; end if;
  if not exists(select 1 from public.feed_sequences s where s.device_id=d and s.sequence_id=v_sequence_id
      and s.source='manual' and s.status='queued' and s.status_sequence=1 and s.unresolved and s.delivered_at is null)
    or not exists(select 1 from public.feed_steps f where f.device_id=d and f.sequence_id=v_sequence_id
      and f.step_index=1 and f.nozzle_number=1 and f.status='queued')
    or not exists(select 1 from public.feed_steps f where f.device_id=d and f.sequence_id=v_sequence_id
      and f.step_index=2 and f.nozzle_number=2 and f.status='queued')
    or exists(select 1 from public.alert_events a where a.device_id=d) then
    raise exception 'T08_B2_QUEUED_FIXTURE_INVALID';
  end if;

  -- Synthetic elapsed-time setup, copied from the accepted T02 timeout fixture.
  -- No manual-sync/command-delivery call, accepted/running event, physical feeding or sleep.
  update public.feed_sequences s set delivered_at=clock_timestamp()-interval '2 minutes',
    start_before=clock_timestamp()-interval '1 minute' where s.device_id=d and s.sequence_id=v_sequence_id;
  update public.feed_steps f set start_before=clock_timestamp()-interval '1 minute'
    where f.device_id=d and f.sequence_id=v_sequence_id and f.step_index=1;
  -- Seed only a valid baseline V row; never call finalizer or emulate the expected bump here.
  insert into public.device_resource_versions(device_id) values(d) on conflict(device_id) do nothing;
  select v.revisions into strict before_versions from public.device_resource_versions v where v.device_id=d;
  expected_versions := jsonb_set(jsonb_set(before_versions,'{feeding}',
    to_jsonb((before_versions->>'feeding')::numeric+1)),'{alerts}',to_jsonb((before_versions->>'alerts')::numeric+1));
  select coalesce(array_agg(x.id order by x.id),array[]::uuid[]),count(*) into before_message_ids,before_messages
    from realtime.messages x where x.topic=v_topic;

  -- Authorization denial must precede reconciliation even when another command is overdue.
  result := public.art31_read_manual_command(d,outsider,missing_lookup);
  if result is distinct from '{"status":"not_active"}'::jsonb
    or not exists(select 1 from public.feed_sequences s where s.device_id=d and s.sequence_id=v_sequence_id
      and s.status='queued' and s.status_sequence=1)
    or (select revisions from public.device_resource_versions where device_id=d) is distinct from before_versions
    or exists(select 1 from public.alert_events a where a.device_id=d)
    or (select count(*) from realtime.messages x where x.topic=v_topic) <> before_messages then
    raise exception 'T08_B2_PREAUTH_RECONCILED';
  end if;

  -- Real existing public RPC, deliberately omit p_by_key to exercise its false default.
  result := public.art31_read_manual_command(d,installation,missing_lookup);
  if result is distinct from '{"status":"not_found"}'::jsonb then
    raise exception 'T08_B2_NOT_FOUND_DTO_CHANGED';
  end if;
  -- These business controls must pass BEFORE the expected baseline version failure.
  if not exists(select 1 from public.feed_sequences s where s.device_id=d and s.sequence_id=v_sequence_id
      and s.status='unknown' and s.status_sequence=2 and s.unresolved and s.safety_lockout)
    or not exists(select 1 from public.device_state s where s.device_id=d
      and s.safety_lockout and s.lockout_sequence_id=v_sequence_id)
    or (select count(*) from public.feed_sequences s where s.device_id=d) <> 1 then
    raise exception 'T08_B2_RECONCILIATION_NOT_OBSERVED';
  end if;
  if (select count(*) from public.feed_steps f where f.device_id=d and f.sequence_id=v_sequence_id) <> 2
    or not exists(select 1 from public.feed_steps f where f.device_id=d and f.sequence_id=v_sequence_id
      and f.step_index=1 and f.nozzle_number=1 and f.status='unknown' and f.requested_dose=targets->0->'dose')
    or not exists(select 1 from public.feed_steps f where f.device_id=d and f.sequence_id=v_sequence_id
      and f.step_index=2 and f.nozzle_number=2 and f.status='not_started' and f.requested_dose=targets->1->'dose'
      and f.started_at is null and f.baseline_ready_at is null and f.start_before is null)
    or exists(select 1 from public.feed_steps f where f.device_id=d and
      (f.measured_dispensed_g is not null or f.estimated_dispensed_g is not null or f.measurement_quality<>'unavailable'))
    or exists(select 1 from public.device_events e where e.device_id=d) then
    raise exception 'T08_B2_UNCERTAIN_OUTCOME_REWRITTEN';
  end if;
  if (select count(*) from public.device_execution_reservations r where r.device_id=d) <> 1
    or not exists(select 1 from public.device_execution_reservations r where r.device_id=d
      and r.sequence_id=v_sequence_id and r.phase='active' and r.released_at is null)
    or not exists(select 1 from public.device_state s join public.device_telemetry t
      on t.device_id=s.device_id and t.boot_id=s.latest_telemetry_boot_id and t.sample_sequence=s.latest_telemetry_sequence
      where s.device_id=d and t.feed_remaining_g=20000 and t.feed_percent=100 and t.feed_quality='valid') then
    raise exception 'T08_B2_RESERVATION_OR_STOCK_CHANGED';
  end if;
  if (select count(*) from public.alert_events a where a.device_id=d) <> 1
    or not exists(select 1 from public.alert_events a where a.device_id=d
      and a.sequence_id=v_sequence_id and a.alert_kind='feeding_unknown') then
    raise exception 'T08_B2_RECONCILIATION_ALERT_MISSING';
  end if;

  select revisions into strict after_versions from public.device_resource_versions where device_id=d;
  if after_versions is distinct from expected_versions then
    -- Expected behavioral RED on unchanged 1802: real facts/alert changed but V did not.
    raise exception using errcode='P0001',message='T08_B2_NOT_FOUND_RECONCILE_VERSION_MISSING';
  end if;
  -- Disposable substituted-send evidence only; native inner failure may legitimately store no message.
  select count(*) into after_messages from realtime.messages x where x.topic=v_topic;
  if after_messages <> before_messages+1 then raise exception 'T08_B2_HINT_COUNT_MISMATCH'; end if;
  select x.* into strict m from realtime.messages x where x.topic=v_topic and not (x.id=any(before_message_ids));
  if (m.extension='broadcast' and m.event='resource_update' and m.private is true
    and m.payload->>'id'=m.id::text and m.payload->>'device_id'=d::text
    and m.payload->'resources'='["feeding","alerts"]'::jsonb
    and m.payload->'revisions'=jsonb_build_object('feeding',expected_versions->'feeding','alerts',expected_versions->'alerts')
    and m.payload-array['id','device_id','resources','revisions']='{}'::jsonb) is distinct from true then
    raise exception 'T08_B2_HINT_SHAPE_MISMATCH';
  end if;
  -- A second lookup must not repeat uncertainty reconciliation, bump V or republish.
  result := public.art31_read_manual_command(d,installation,missing_lookup);
  if result is distinct from '{"status":"not_found"}'::jsonb
    or (select revisions from public.device_resource_versions where device_id=d) is distinct from after_versions
    or (select count(*) from realtime.messages x where x.topic=v_topic) <> after_messages
    or (select count(*) from public.alert_events a where a.device_id=d) <> 1
    or not exists(select 1 from public.feed_sequences s where s.device_id=d and s.sequence_id=v_sequence_id
      and s.status='unknown' and s.status_sequence=2 and s.unresolved and s.safety_lockout) then
    raise exception 'T08_B2_NOT_FOUND_REPLAY_CHANGED';
  end if;
end $$;
rollback;
\echo T08_B2_PRODUCER_PILOT_OK

-- NEXT TEST-ONLY SLICE: the entire accepted pilot above remains byte-exact.
-- Missing finalization on any legitimate post-reconcile refusal/read must fail at its own oracle.
-- Parent can select one independently with -v t08_b2_case=n9_existing (default all).
-- shortcut: device_busy needs a second independently valid reservation/sequence fixture;
-- add that case only after its supported construction is reviewed, not by fabricating an unsafe row.
\if :{?t08_b2_case}
\else
\set t08_b2_case all
\endif
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';
set local idle_in_transaction_session_timeout = '15s';
set local timezone = 'UTC';
set constraints all deferred;
create temporary table t08_b2_exit_selection(case_name text not null) on commit drop;
insert into t08_b2_exit_selection values (:'t08_b2_case');

do $$
declare
  c record;
  v_selected text;
  v_ran integer := 0;
  v_suffix text;
  d uuid;
  installation uuid;
  boot uuid;
  request_id uuid;
  command_key uuid;
  next_request uuid;
  next_key uuid;
  missing_lookup uuid;
  targets constant jsonb := '[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":25}},{"nozzle_number":2,"dose":{"mode":"grams","amount_g":40}}]';
  v_call_targets jsonb;
  v_call_revision integer;
  v_old uuid;
  v_command_id uuid;
  v_result jsonb;
  v_expected_result jsonb;
  v_expected_command jsonb;
  v_expected_record jsonb;
  v_nozzle_results jsonb;
  v_sequence public.feed_sequences%rowtype;
  v_before_versions jsonb;
  v_expected_versions jsonb;
  v_after_versions jsonb;
  v_before_ids uuid[];
  v_before_messages bigint;
  v_before_sample jsonb;
  v_before_contact timestamptz;
  v_call_started timestamptz;
  v_call_finished timestamptz;
  v_stopped_at timestamptz;
  v_topic text;
  v_owner text;
  v_revisions_subset jsonb;
  v_day date := current_date;
  v_message realtime.messages%rowtype;
  v_changed integer;
begin
  if current_database()<>'aquafeed_backend_test' or current_user<>'postgres'
    or not exists(select 1 from backend_test.provenance where singleton
      and migration_fixtures_created and migration_fixtures_cleaned
      and database_oid=(select oid from pg_catalog.pg_database where datname=current_database())) then
    raise exception 'T08_B2_EXIT_DISPOSABLE_PROVENANCE_REQUIRED';
  end if;
  select case_name into strict v_selected from pg_temp.t08_b2_exit_selection;
  -- Literal owners are independent expectations, not flags read from the implementation.
  for c in select * from (values
    (1,'n11_found','found',true,array['feeding','alerts']::text[],'T08_B2_N11_FOUND'),
    (2,'n7_ok_null','ok',true,array['feeding','contact','alerts']::text[],'T08_B2_N7_OK_NULL'),
    (3,'n9_conflict','idempotency_conflict',true,array['feeding','alerts']::text[],'T08_B2_N9_CONFLICT'),
    (4,'n9_existing','existing',true,array['feeding','alerts']::text[],'T08_B2_N9_EXISTING'),
    (5,'n9_capability','capability_mismatch',true,array['feeding','alerts']::text[],'T08_B2_N9_CAPABILITY'),
    (6,'n9_wake_unsupported','dose_unsupported',true,array['feeding','alerts']::text[],'T08_B2_N9_WAKE_UNSUPPORTED'),
    (7,'n9_unavailable','unavailable',false,array['feeding']::text[],'T08_B2_N9_UNAVAILABLE'),
    (8,'n9_safety_lockout','safety_lockout',true,array['feeding','alerts']::text[],'T08_B2_N9_SAFETY_LOCKOUT'),
    (9,'n9_offline','device_offline',false,array['feeding']::text[],'T08_B2_N9_OFFLINE'),
    (10,'n9_disabled','dose_unsupported',false,array['feeding']::text[],'T08_B2_N9_DISABLED'),
    (11,'n9_amount_unsupported','dose_unsupported',false,array['feeding']::text[],'T08_B2_N9_AMOUNT_UNSUPPORTED'),
    (12,'n9_range','dose_out_of_range',false,array['feeding']::text[],'T08_B2_N9_RANGE'),
    (13,'n9_mode_unsupported','dose_unsupported',false,array['feeding']::text[],'T08_B2_N9_MODE_UNSUPPORTED'),
    (14,'n9_inventory','inventory_unavailable',false,array['feeding']::text[],'T08_B2_N9_INVENTORY'),
    (15,'n9_insufficient','insufficient_inventory',false,array['feeding']::text[],'T08_B2_N9_INSUFFICIENT'),
    (16,'n9_created','created',false,array['feeding']::text[],'T08_B2_N9_CREATED'),
    (17,'n10_conflict','idempotency_conflict',true,array['feeding','alerts']::text[],'T08_B2_N10_CONFLICT'),
    (18,'n10_existing','existing',true,array['feeding','alerts']::text[],'T08_B2_N10_EXISTING'),
    (19,'n10_created','created',true,array['feeding','alerts']::text[],'T08_B2_N10_CREATED'),
    (20,'n12_invalid_filter','invalid',true,array['feeding','alerts']::text[],'T08_B2_N12_INVALID_FILTER'),
    (21,'n12_invalid_dates','invalid',true,array['feeding','alerts']::text[],'T08_B2_N12_INVALID_DATES'),
    (22,'n12_ok','ok',true,array['feeding','alerts']::text[],'T08_B2_N12_OK'),
    (23,'n13_not_found','not_found',true,array['feeding','alerts']::text[],'T08_B2_N13_NOT_FOUND'),
    (24,'n13_ok','ok',true,array['feeding','alerts']::text[],'T08_B2_N13_OK')
  ) cases(ordinal,case_name,want_status,delivered,owners,marker)
    where v_selected='all' or cases.case_name=v_selected order by ordinal
  loop
    v_ran := v_ran+1;
    v_suffix := lpad(c.ordinal::text,12,'0');
    d := ('a808b202-0000-4000-8000-'||v_suffix)::uuid;
    installation := ('a808b202-0000-4000-8011-'||v_suffix)::uuid;
    boot := ('a808b202-0000-4000-8021-'||v_suffix)::uuid;
    request_id := ('a808b202-0000-4000-8031-'||v_suffix)::uuid;
    command_key := ('a808b202-0000-4000-8041-'||v_suffix)::uuid;
    next_request := ('a808b202-0000-4000-8051-'||v_suffix)::uuid;
    next_key := ('a808b202-0000-4000-8061-'||v_suffix)::uuid;
    missing_lookup := ('a808b202-0000-4000-8099-'||v_suffix)::uuid;
    v_topic := 'device:'||d::text||':updates';
    if exists(select 1 from public.devices x where x.device_id=d)
      or exists(select 1 from auth.users u where u.id=installation) then
      raise exception using message=c.marker||'_FIXTURE_COLLISION';
    end if;
    insert into auth.users(id,is_anonymous) values(installation,true);
    insert into public.devices(device_id,model,firmware_version,protocol_major,is_simulated,capabilities_revision,capabilities)
      select d,'T08 B2 disposable exit oracle',x.firmware_version,x.protocol_major,true,x.capabilities_revision,x.capabilities
      from public.devices x where x.device_id='22222222-2222-4222-8222-222222222222'
        and x.is_simulated and x.protocol_major=2 and x.capabilities_revision=5
        and x.capabilities->>'feed_capacity_g'='20000';
    get diagnostics v_changed = row_count;
    if v_changed<>1 then raise exception using message=c.marker||'_PROFILE_MISSING'; end if;
    insert into private.device_credentials(device_id,credential_verifier) values(d,decode(repeat('a',64),'hex'));
    insert into public.device_access(device_id,installation_id,status) values(d,installation,'active');
    insert into public.device_state(device_id) values(d);
    v_result := public.art27_sync_telemetry(d,repeat('a',64),boot,1,
      jsonb_build_object('sequence',1,'measured_at',clock_timestamp(),'time_quality','rtc',
        'do_mg_l',5.8,'do_quality','valid','feed_remaining_g',20000,'feed_percent',100,
        'feed_quality','valid','calibration_revision',1),'[]'::jsonb);
    if (v_result->>'status'='ok') is distinct from true then
      raise exception using message=c.marker||'_TELEMETRY_SETUP';
    end if;
    v_result := public.art31_create_manual_feed(d,installation,request_id,command_key,targets,5);
    if (v_result->>'status'='created' and v_result#>>'{command,status}'='queued') is distinct from true then
      raise exception using message=c.marker||'_ADMISSION_SETUP';
    end if;
    v_old := (v_result#>>'{command,sequence_id}')::uuid;
    if v_old is null or v_old=missing_lookup
      or not exists(select 1 from public.feed_sequences s where s.device_id=d and s.sequence_id=v_old
        and s.status='queued' and s.status_sequence=1 and s.unresolved and not s.safety_lockout and s.delivered_at is null)
      or (select count(*) from public.feed_sequences s where s.device_id=d)<>1
      or (select count(*) from public.feed_steps f where f.device_id=d and f.status='queued')<>2
      or not exists(select 1 from public.device_execution_reservations r where r.device_id=d
        and r.sequence_id=v_old and r.phase='active' and r.released_at is null)
      or exists(select 1 from public.alert_events a where a.device_id=d) then
      raise exception using message=c.marker||'_QUEUED_FIXTURE';
    end if;
    -- True elapsed-time transition: unknown retains lockout; undelivered expiry releases admission.
    -- Never clear an unknown outcome/lockout merely to reach a later admission refusal.
    update public.feed_sequences s set start_before=clock_timestamp()-interval '1 minute',
      delivered_at=case when c.delivered then clock_timestamp()-interval '2 minutes' else null end
      where s.device_id=d and s.sequence_id=v_old;
    update public.feed_steps f set start_before=clock_timestamp()-interval '1 minute'
      where f.device_id=d and f.sequence_id=v_old and f.step_index=1;
    v_call_targets := targets;
    v_call_revision := 5;
    if c.case_name='n9_conflict' then
      v_call_targets := jsonb_set(targets,'{0,dose,amount_g}','26'::jsonb);
    elsif c.case_name='n9_capability' then v_call_revision := 4;
    elsif c.case_name='n9_wake_unsupported' then
      update public.devices set capabilities_revision=6,capabilities=capabilities-'scheduler_wake_grace_ms' where device_id=d;
      v_call_revision := 6;
    elsif c.case_name='n9_unavailable' then
      -- Only this newly owned rollback fixture loses S; expiry needs no unknown/lockout repair.
      delete from public.device_state where device_id=d;
    elsif c.case_name='n9_offline' then
      update public.device_state set contact_freshness='stale',
        last_authenticated_contact_at=clock_timestamp()-interval '2 minutes' where device_id=d;
    elsif c.case_name='n9_disabled' then
      update public.devices set capabilities_revision=6,
        capabilities=jsonb_set(capabilities,'{nozzles,1,enabled}','false'::jsonb) where device_id=d;
      v_call_revision := 6;
    elsif c.case_name='n9_amount_unsupported' then
      v_call_targets := jsonb_set(targets,'{0,dose,amount_g}','0'::jsonb);
    elsif c.case_name='n9_range' then
      v_call_targets := jsonb_set(targets,'{0,dose,amount_g}','20001'::jsonb);
    elsif c.case_name='n9_mode_unsupported' then
      v_call_targets := jsonb_set(targets,'{0,dose}','{"mode":"unsupported"}'::jsonb);
    elsif c.case_name='n9_inventory' then
      update public.devices set capabilities_revision=6,
        capabilities=jsonb_set(capabilities,'{feed_remaining_monitoring}','false'::jsonb) where device_id=d;
      v_call_revision := 6;
    elsif c.case_name='n9_insufficient' then
      if not exists(select 1 from public.devices x where x.device_id=d
        and x.capabilities#>>'{nozzles,1,max_dose_g}'='20000' and x.capabilities#>>'{nozzles,2,max_dose_g}'='20000'
        and x.capabilities#>>'{nozzles,1,min_dose_g}'='5' and x.capabilities#>>'{nozzles,2,min_dose_g}'='5'
        and x.capabilities#>>'{nozzles,1,dose_step_g}'='1' and x.capabilities#>>'{nozzles,2,dose_step_g}'='1') then
        raise exception using message=c.marker||'_STOCK_PROFILE_SETUP';
      end if;
      v_call_targets := jsonb_set(jsonb_set(targets,'{0,dose,amount_g}','15000'::jsonb),'{1,dose,amount_g}','10000'::jsonb);
    end if;
    insert into public.device_resource_versions(device_id) values(d) on conflict(device_id) do nothing;
    select revisions into strict v_before_versions from public.device_resource_versions where device_id=d;
    v_expected_versions := v_before_versions;
    v_revisions_subset := '{}'::jsonb;
    foreach v_owner in array c.owners loop
      v_expected_versions := jsonb_set(v_expected_versions,array[v_owner],to_jsonb((v_before_versions->>v_owner)::numeric+1));
      v_revisions_subset := v_revisions_subset||jsonb_build_object(v_owner,v_expected_versions->v_owner);
    end loop;
    select coalesce(array_agg(x.id order by x.id),array[]::uuid[]),count(*) into v_before_ids,v_before_messages
      from realtime.messages x where x.topic=v_topic;
    select to_jsonb(t) into strict v_before_sample from public.device_telemetry t
      where t.device_id=d and t.boot_id=boot and t.sample_sequence=1;
    select s.last_authenticated_contact_at into v_before_contact from public.device_state s where s.device_id=d;
    v_call_started := clock_timestamp();
    if c.case_name='n11_found' then
      -- Lookup by key complements the accepted omitted-default not_found pilot.
      v_result := public.art31_read_manual_command(d,installation,command_key,true);
    elsif c.case_name='n7_ok_null' then
      v_result := public.art31_sync_manual_feed(d,repeat('a',64),5,'[]'::jsonb,'unknown',null,'rtc',0);
    elsif c.case_name like 'n9_%' then
      v_result := public.art31_create_manual_feed(d,installation,next_request,
        case when c.case_name in ('n9_conflict','n9_existing') then command_key else next_key end,v_call_targets,v_call_revision);
    elsif c.case_name like 'n10_%' then
      v_result := public.art31_resolve_manual_feed_no_admission(d,installation,
        case when c.case_name='n10_existing' then request_id else next_request end,
        case when c.case_name in ('n10_conflict','n10_existing') then command_key else next_key end,targets,5);
    elsif c.case_name='n12_invalid_filter' then
      v_result := public.art31_history_page(d,installation,v_day,v_day,'invalid-source','all');
    elsif c.case_name='n12_invalid_dates' then
      v_result := public.art31_history_page(d,installation,v_day+1,v_day,'all','all');
    elsif c.case_name='n12_ok' then
      v_result := public.art31_history_page(d,installation,v_day,v_day,'all','all');
    elsif c.case_name like 'n13_%' then
      v_result := public.art31_history_detail(d,installation,case when c.case_name='n13_ok' then v_old else missing_lookup end);
    else raise exception 'T08_B2_EXIT_UNHANDLED_CASE';
    end if;
    v_call_finished := clock_timestamp();
    if (v_result->>'status'=c.want_status) is distinct from true then
      raise exception using message=c.marker||'_LEGACY_STATUS_CHANGED';
    end if;
    -- Actual business and safety facts precede every version oracle; no inert fixture qualifies.
    if not exists(select 1 from public.feed_sequences s where s.device_id=d and s.sequence_id=v_old
        and s.status=(case when c.delivered then 'unknown' else 'expired' end) and s.status_sequence=2
        and s.unresolved=c.delivered and s.safety_lockout=c.delivered and s.lockout_resolved_at is null)
      or not exists(select 1 from public.feed_steps f where f.device_id=d and f.sequence_id=v_old
        and f.step_index=1 and f.nozzle_number=1 and f.requested_dose=targets->0->'dose'
        and f.status=(case when c.delivered then 'unknown' else 'expired' end) and f.started_at is null)
      or not exists(select 1 from public.feed_steps f where f.device_id=d and f.sequence_id=v_old
        and f.step_index=2 and f.nozzle_number=2 and f.requested_dose=targets->1->'dose'
        and f.status='not_started' and f.started_at is null and f.baseline_ready_at is null and f.start_before is null)
      or not exists(select 1 from public.device_execution_reservations r where r.device_id=d and r.sequence_id=v_old
        and r.phase=(case when c.delivered then 'active' else 'released' end) and (r.released_at is null)=c.delivered)
      or exists(select 1 from public.feed_steps f where f.device_id=d and
        (f.measured_dispensed_g is not null or f.estimated_dispensed_g is not null or f.measurement_quality<>'unavailable'))
      or exists(select 1 from public.device_events e where e.device_id=d)
      or (select to_jsonb(t) from public.device_telemetry t where t.device_id=d and t.boot_id=boot and t.sample_sequence=1)
        is distinct from v_before_sample then
      raise exception using message=c.marker||'_RECONCILIATION_NOT_OBSERVED';
    end if;
    if c.delivered and not exists(select 1 from public.device_state s where s.device_id=d
        and s.safety_lockout and s.lockout_sequence_id=v_old)
      or (select count(*) from public.alert_events a where a.device_id=d)<>(case when c.delivered then 1 else 0 end)
      or (c.delivered and not exists(select 1 from public.alert_events a where a.device_id=d
        and a.sequence_id=v_old and a.alert_kind='feeding_unknown')) then
      raise exception using message=c.marker||'_LOCKOUT_OR_ALERT_CHANGED';
    end if;
    if c.case_name='n7_ok_null' then
      if not exists(select 1 from public.device_state s where s.device_id=d and s.contact_freshness='fresh'
        and s.last_authenticated_contact_at>v_before_contact) then
        raise exception using message=c.marker||'_CONTACT_NOT_OBSERVED';
      end if;
    elsif (select s.last_authenticated_contact_at from public.device_state s where s.device_id=d) is distinct from v_before_contact then
      raise exception using message=c.marker||'_UNEXPECTED_CONTACT_CHANGE';
    end if;
    if (c.case_name='n9_unavailable' and exists(select 1 from public.device_state s where s.device_id=d))
      or (not c.delivered and c.case_name<>'n9_unavailable' and not exists(select 1 from public.device_state s
        where s.device_id=d and not s.safety_lockout and s.lockout_sequence_id is null)) then
      raise exception using message=c.marker||'_AVAILABILITY_OR_LOCKOUT_CHANGED';
    end if;
    if (select count(*) from public.feed_sequences s where s.device_id=d)<>(case when c.want_status='created' then 2 else 1 end)
      or (select count(*) from public.feed_steps f where f.device_id=d)<>(case when c.want_status='created' then 4 else 2 end)
      or (select count(*) from public.device_execution_reservations r where r.device_id=d)<>
        (case when c.case_name='n9_created' then 2 else 1 end) then
      raise exception using message=c.marker||'_EXTRA_OR_MISSING_COMMAND';
    end if;
    -- Independently spelled legacy constructors: no call to the serializer under test for expectations.
    if c.want_status in ('created','existing') or c.case_name='n11_found' then
      v_command_id := case when c.want_status='created' then (v_result#>>'{command,sequence_id}')::uuid else v_old end;
      select * into strict v_sequence from public.feed_sequences s where s.device_id=d and s.sequence_id=v_command_id;
      if c.want_status='created' and (v_command_id=v_old or v_sequence.request_id<>next_request
          or v_sequence.idempotency_key<>next_key or v_sequence.status_sequence<>1
          or v_sequence.capabilities_revision<>5 or v_sequence.target_count<>2
          or v_sequence.status<>(case when c.case_name='n9_created' then 'queued' else 'rejected' end)
          or v_sequence.unresolved<>(c.case_name='n9_created') or v_sequence.safety_lockout
          or v_sequence.delivered_at is not null) then
        raise exception using message=c.marker||'_NEW_COMMAND_SEMANTICS_CHANGED';
      end if;
      if c.case_name='n10_created' and exists(select 1 from public.device_execution_reservations r
        where r.device_id=d and r.sequence_id=v_command_id) then
        raise exception using message=c.marker||'_FENCE_RESERVED_EXECUTION';
      end if;
      v_nozzle_results := jsonb_build_array(
        jsonb_build_object('nozzle_number',1,'status',case when c.want_status='created' then v_sequence.status else 'unknown' end,
          'requested_dose',targets->0->'dose','estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable'),
        jsonb_build_object('nozzle_number',2,'status',case when c.want_status='created' then v_sequence.status else 'not_started' end,
          'requested_dose',targets->1->'dose','estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable'));
      v_expected_command := jsonb_build_object('command_id',v_command_id,'sequence_id',v_command_id,'device_id',d,
        'request_id',case when c.want_status='created' then next_request else request_id end,
        'idempotency_key',case when c.want_status='created' then next_key else command_key end,
        'status',case when c.want_status='created' then v_sequence.status else 'unknown' end,
        'status_sequence',case when c.want_status='created' then 1 else 2 end,'created_at',v_sequence.created_at,
        'start_before',v_sequence.start_before,'targets',targets,'nozzle_results',v_nozzle_results,
        'safety_lockout',c.want_status<>'created','lockout_resolution',null);
      v_expected_result := jsonb_build_object('status',c.want_status,'command',v_expected_command);
    elsif c.case_name in ('n12_ok','n13_ok') then
      select * into strict v_sequence from public.feed_sequences s where s.device_id=d and s.sequence_id=v_old;
      select max(f.stopped_at) into v_stopped_at from public.feed_steps f where f.device_id=d and f.sequence_id=v_old;
      v_nozzle_results := jsonb_build_array(
        jsonb_build_object('nozzle_number',1,'status','unknown','requested_dose',targets->0->'dose',
          'estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable'),
        jsonb_build_object('nozzle_number',2,'status','not_started','requested_dose',targets->1->'dose',
          'estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable'));
      v_expected_record := jsonb_build_object('sequence_id',v_old,'command_id',v_old,'device_id',d,'source','manual',
        'request_id',request_id,'idempotency_key',command_key,'status','unknown','status_sequence',2,
        'created_at',v_sequence.created_at,'start_before',v_sequence.start_before,'started_at',null,
        'completed_at',v_stopped_at,'reason_code',null,'targets',targets,'nozzle_results',v_nozzle_results,
        'safety_lockout',true,'lockout_resolution',null);
      if c.case_name='n13_ok' then
        v_expected_result := jsonb_build_object('status','ok','timezone','UTC','timezone_known',false,'record',v_expected_record);
      else
        v_expected_result := jsonb_build_object('status','ok','from_date',v_day,'to_date',v_day,
          'timezone','UTC','timezone_known',false,'total',1,'completed_total',0,'needs_attention_total',1,'in_progress_total',0,
          'records',jsonb_build_array(v_expected_record),'has_more',false,
          'next',jsonb_build_object('created_at',v_sequence.created_at,'sequence_id',v_old));
      end if;
    elsif c.case_name='n7_ok_null' then
      if jsonb_typeof(v_result->'server_time') is distinct from 'string'
        or not pg_input_is_valid(v_result->>'server_time','timestamp with time zone') then
        raise exception using message=c.marker||'_SERVER_TIME_CHANGED';
      end if;
      if (v_result->>'server_time')::timestamptz not between v_call_started and v_call_finished then
        raise exception using message=c.marker||'_SERVER_TIME_CHANGED';
      end if;
      v_expected_result := jsonb_build_object('status','ok','server_time',v_result->'server_time',
        'acknowledged_events','[]'::jsonb,'command',null,'next_sync_after_ms',1000);
    else v_expected_result := jsonb_build_object('status',c.want_status);
    end if;
    if v_result is distinct from v_expected_result then
      raise exception using message=c.marker||'_LEGACY_DTO_CHANGED';
    end if;
    -- A temporarily inconsistent fixture must fail integrity, not masquerade as a version RED.
    set constraints all immediate;
    set constraints all deferred;
    select revisions into strict v_after_versions from public.device_resource_versions where device_id=d;
    if v_after_versions is distinct from v_expected_versions then
      raise exception using errcode='P0001',message=c.marker||'_VERSION_MISSING';
    end if;
    -- Substituted disposable send only. This is not a promise of native stored-message delivery.
    if (select count(*) from realtime.messages x where x.topic=v_topic)<>v_before_messages+1 then
      raise exception using message=c.marker||'_HINT_COUNT_CHANGED';
    end if;
    select x.* into strict v_message from realtime.messages x where x.topic=v_topic and not (x.id=any(v_before_ids));
    if (v_message.extension='broadcast' and v_message.event='resource_update' and v_message.private is true
      and v_message.payload->>'id'=v_message.id::text and v_message.payload->>'device_id'=d::text
      and v_message.payload->'resources'=to_jsonb(c.owners) and v_message.payload->'revisions'=v_revisions_subset
      and v_message.payload-array['id','device_id','resources','revisions']='{}'::jsonb) is distinct from true then
      raise exception using message=c.marker||'_HINT_SHAPE_CHANGED';
    end if;
  end loop;
  if v_ran=0 then raise exception 'T08_B2_EXIT_SELECTOR_INVALID'; end if;
end $$;
rollback;
\echo T08_B2_RECONCILIATION_EXIT_ORACLES_OK

-- TEST-ONLY: preserve both accepted reconciliation transactions above byte-for-byte.
-- Parent selects a standalone case with -v t08_b2_producer=n2_replay (default all).
-- Old N1 already advances V: its missing publication must fail HINT, not VERSION.
-- N3 is owner-only/nonpublishing: test its private flags, not a public version bump.
\if :{?t08_b2_producer}
\else
\set t08_b2_producer all
\endif
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';
set local idle_in_transaction_session_timeout = '15s';
set local timezone = 'UTC';
set constraints all deferred;
create temporary table t08_b2_producer_selection(case_name text not null) on commit drop;
insert into t08_b2_producer_selection values (:'t08_b2_producer');

do $$
declare
  c record;
  selected text;
  ran integer := 0;
  suffix text;
  d uuid;
  installation uuid;
  other_installation uuid;
  boot uuid;
  v_request_id uuid;
  v_schedule_id uuid;
  v_sequence_id uuid;
  marker text;
  v_topic text;
  r jsonb;
  setup_result jsonb;
  want jsonb;
  snapshot jsonb;
  current_state jsonb;
  report jsonb;
  metric_do jsonb;
  metric_feed jsonb;
  envelope jsonb;
  legacy_sample jsonb;
  event jsonb;
  events jsonb;
  want_ack jsonb;
  before_versions jsonb;
  expected_versions jsonb;
  after_versions jsonb;
  subset jsonb;
  owner_name text;
  before_ids uuid[];
  before_messages bigint;
  before_contact timestamptz;
  before_device jsonb;
  before_state jsonb;
  before_audits bigint;
  before_sequences bigint;
  before_events bigint;
  started timestamptz;
  finished timestamptz;
  changed integer;
  target_revision bigint;
  due constant timestamptz := '2026-11-16 12:00:00+00';
  message realtime.messages%rowtype;
begin
  if current_database()<>'aquafeed_backend_test' or current_user<>'postgres'
    or not exists(select 1 from backend_test.provenance where singleton
      and migration_fixtures_created and migration_fixtures_cleaned
      and database_oid=(select oid from pg_catalog.pg_database where datname=current_database())) then
    raise exception 'T08_B2_STANDALONE_DISPOSABLE_PROVENANCE_REQUIRED';
  end if;
  select case_name into strict selected from pg_temp.t08_b2_producer_selection;
  -- Literal expectations: no production flag/serializer/finalizer builds the oracle.
  for c in select * from (values
    (1,'n1_live',1,'live','ok',array['do','feed','history','contact']::text[],null::jsonb),
    (2,'n1_replay',1,'replay','ok',array[]::text[],null::jsonb),
    (3,'n1_backlog',1,'backlog','ok',array['history']::text[],null::jsonb),
    (4,'n1_alert',1,'alert','ok',array['do','feed','history','contact','alerts']::text[],null::jsonb),
    (5,'n2_live',2,'live','ok',array['do','feed','history','contact']::text[],null::jsonb),
    (6,'n2_replay',2,'replay','ok',array['contact']::text[],null::jsonb),
    (7,'n2_independent',2,'independent','ok',array['history','contact']::text[],null::jsonb),
    (8,'n2_alert',2,'alert','ok',array['do','feed','history','contact','alerts']::text[],null::jsonb),
    (9,'n3_apply',3,'apply','ok',array[]::text[],'["configuration"]'::jsonb),
    (10,'n3_replay',3,'replay','ok',array[]::text[],'[]'::jsonb),
    (11,'n3_rejected',3,'rejected','ok',array[]::text[],'["configuration"]'::jsonb),
    (12,'n3_pending',3,'pending','ok',array[]::text[],'[]'::jsonb),
    (13,'n3_tombstone',3,'tombstone','ok',array[]::text[],'["configuration"]'::jsonb),
    (14,'n4_apply',4,'apply','ok',array['configuration']::text[],null::jsonb),
    (15,'n4_replay',4,'replay','ok',array[]::text[],null::jsonb),
    (16,'n4_rejected',4,'rejected','ok',array['configuration']::text[],null::jsonb),
    (17,'n4_pending',4,'pending','ok',array[]::text[],null::jsonb),
    (18,'n5_apply',5,'apply','ok',array['configuration']::text[],null::jsonb),
    (19,'n5_replay',5,'replay','ok',array[]::text[],null::jsonb),
    (20,'n5_rejected',5,'rejected','ok',array['configuration']::text[],null::jsonb),
    (21,'n5_pending',5,'pending','ok',array[]::text[],null::jsonb),
    (22,'n5_invalid_interval',5,'invalid_interval','invalid',array[]::text[],null::jsonb),
    (23,'n6_accepted',6,'accepted','ok',array['feeding']::text[],null::jsonb),
    (24,'n6_replay',6,'replay','ok',array[]::text[],null::jsonb),
    (25,'n6_empty',6,'empty','ok',array[]::text[],null::jsonb),
    (26,'n6_invalid_rollback',6,'invalid_rollback','invalid',array[]::text[],null::jsonb),
    (27,'n6_failed',6,'failed','ok',array['feeding','alerts']::text[],null::jsonb),
    (28,'n14_accepted',14,'accepted','ok',array['configuration']::text[],null::jsonb),
    (29,'n14_rejected',14,'rejected','rejected',array['configuration']::text[],null::jsonb),
    (30,'n14_replay',14,'replay','ok',array[]::text[],null::jsonb),
    (31,'n14_rejected_replay',14,'rejected_replay','rejected',array[]::text[],null::jsonb),
    (32,'n14_conflict',14,'conflict','conflict',array[]::text[],null::jsonb),
    (33,'n15_updated',15,'updated','updated',array['configuration']::text[],null::jsonb),
    (34,'n15_same_labels',15,'same_labels','updated',array['configuration']::text[],null::jsonb),
    (35,'n15_conflict',15,'conflict','conflict',array[]::text[],null::jsonb),
    (36,'n16_revoked',16,'revoked','revoked',array['contact']::text[],null::jsonb),
    (37,'n16_repeat',16,'repeat','not_active',array[]::text[],null::jsonb)
  ) cases(ordinal,case_name,root,mode,want_status,owners,private_flags)
    where selected='all' or cases.case_name=selected order by ordinal
  loop
    ran := ran+1;
    suffix := lpad(c.ordinal::text,12,'0');
    d := ('a808b203-0000-4000-8000-'||suffix)::uuid;
    installation := ('a808b203-0000-4000-8011-'||suffix)::uuid;
    other_installation := ('a808b203-0000-4000-8012-'||suffix)::uuid;
    boot := ('a808b203-0000-4000-8021-'||suffix)::uuid;
    v_request_id := ('a808b203-0000-4000-8031-'||suffix)::uuid;
    v_schedule_id := ('a808b203-0000-4000-8041-'||suffix)::uuid;
    v_sequence_id := ('a808b203-0000-4000-8051-'||suffix)::uuid;
    marker := 'T08_B2_'||upper(c.case_name);
    v_topic := 'device:'||d::text||':updates';
    if exists(select 1 from public.devices x where x.device_id=d)
      or exists(select 1 from auth.users u where u.id in (installation,other_installation)) then
      raise exception using message=marker||'_FIXTURE_COLLISION';
    end if;
    insert into auth.users(id,is_anonymous) values(installation,true),(other_installation,true);
    insert into public.devices(device_id,model,firmware_version,protocol_major,is_simulated,capabilities_revision,capabilities)
      select d,'T08 B2 disposable standalone oracle',x.firmware_version,x.protocol_major,true,x.capabilities_revision,
        x.capabilities||jsonb_build_object('independent_telemetry_v1',c.root in (1,5) or c.mode='independent')
      from public.devices x where x.device_id='22222222-2222-4222-8222-222222222222'
        and x.is_simulated and x.protocol_major=2 and x.capabilities_revision=5
        and x.capabilities->>'feed_capacity_g'='20000';
    get diagnostics changed = row_count;
    if changed<>1 then raise exception using message=marker||'_PROFILE_MISSING'; end if;
    insert into private.device_credentials(device_id,credential_verifier) values(d,decode(repeat('a',64),'hex'));
    insert into public.device_state(device_id) values(d);
    insert into public.device_access(device_id,installation_id,status)
      values(d,installation,'active'),(d,other_installation,'active');
    snapshot := jsonb_build_object('timezone','UTC',
      'monitoring_limits','{"do_low_mg_l":4,"do_high_mg_l":8}'::jsonb,'low_feed_threshold_pct',20,
      'schedules',jsonb_build_array(jsonb_build_object('schedule_id',v_schedule_id,'local_time','12:00',
        'weekdays','[1,2,3,4,5,6,7]'::jsonb,'enabled',true,
        'targets','[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":12}},{"nozzle_number":2,"dose":{"mode":"grams","amount_g":19}}]'::jsonb)));
    if c.root=5 then snapshot := snapshot||'{"oxygen_report_interval_seconds":30}'::jsonb; end if;
    if c.root=14 and c.mode in ('rejected','rejected_replay') then
      snapshot := jsonb_set(snapshot,'{timezone}','"NOT/A_TIMEZONE"'::jsonb);
    end if;
    target_revision := 1;
    if c.root in (3,4,5,6) or c.mode='alert'
      or (c.root=14 and c.mode in ('replay','rejected_replay','conflict')) then
      setup_result := public.art33_write_configuration(d,installation,v_request_id,0,snapshot);
      if (setup_result->>'status'=(case when c.mode='rejected_replay' then 'rejected' else 'ok' end)) is distinct from true
        or not exists(select 1 from public.device_config_revisions x where x.device_id=d and x.revision=1
          and x.requested_snapshot=snapshot) then
        raise exception using message=marker||'_CONFIGURATION_SETUP';
      end if;
    end if;
    if c.root=6 or c.mode='alert' or (c.root in (3,4,5) and c.mode in ('replay','tombstone')) then
      if c.root=5 then
        setup_result := public.backend_device_configuration_report(d,repeat('a',64),
          '{"applied_revision":1,"last_attempt_revision":1,"last_attempt_status":"applied","error_code":null,"oxygen_report_interval_seconds":30}');
      else
        setup_result := public.art33_device_configuration_report(d,repeat('a',64),1,1,'applied',null);
      end if;
      if (setup_result='{"status":"ok","desired_configuration":null}'::jsonb) is distinct from true
        or not exists(select 1 from public.devices x where x.device_id=d and x.applied_revision=1)
        or (select count(*) from public.device_config_schedules x where x.device_id=d)<>2
        or (select count(*) from public.device_config_schedule_slots x where x.device_id=d)<>14 then
        raise exception using message=marker||'_APPLIED_SETUP';
      end if;
    end if;
    if c.mode='tombstone' then
      snapshot := jsonb_set(snapshot,'{schedules}','[]'::jsonb);
      setup_result := public.art33_write_configuration(d,installation,gen_random_uuid(),1,snapshot);
      if (setup_result->>'status'='ok' and setup_result#>>'{receipt,revision}'='2') is distinct from true then
        raise exception using message=marker||'_SECOND_REVISION_SETUP';
      end if;
      target_revision := 2;
    end if;
    metric_do := jsonb_build_object('metric','do','boot_id',boot,'sequence',10,
      'measured_at',to_char(clock_timestamp()-interval '1 second','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'captured_at',null,'time_quality','synced','quality','valid',
      'do_mg_l',(case when c.mode='alert' then 2 else 5.8 end),
      'feed_remaining_g',null,'feed_percent',null,'calibration_revision',null);
    metric_feed := metric_do||'{"metric":"feed","do_mg_l":null,"feed_remaining_g":18000,"feed_percent":90,"calibration_revision":1}'::jsonb;
    envelope := jsonb_build_object('live',jsonb_build_object('do',metric_do,'feed',metric_feed),'backlog','[]'::jsonb);
    legacy_sample := jsonb_build_object('sequence',10,'measured_at',metric_do->'measured_at','time_quality','synced',
      'do_mg_l',metric_do->'do_mg_l','do_quality','valid','feed_remaining_g',18000,'feed_percent',90,
      'feed_quality','valid','calibration_revision',1);
    if c.root=1 and c.mode in ('replay','backlog') then
      setup_result := public.backend_sync_metrics(d,repeat('a',64),boot,10,
        (case when c.mode='replay' then envelope else '{"live":{"do":null,"feed":null},"backlog":[]}'::jsonb end));
      if (setup_result->>'status'='ok') is distinct from true then raise exception using message=marker||'_METRIC_SETUP'; end if;
      if c.mode='backlog' then
        metric_do := jsonb_set(metric_do,'{sequence}','9'::jsonb);
        envelope := jsonb_build_object('live','{"do":null,"feed":null}'::jsonb,'backlog',jsonb_build_array(metric_do));
      end if;
    elsif c.root=2 and c.mode='replay' then
      setup_result := public.art27_sync_telemetry(d,repeat('a',64),boot,10,legacy_sample,'[]'::jsonb);
      if (setup_result->>'status'='ok') is distinct from true then raise exception using message=marker||'_LEGACY_SETUP'; end if;
    end if;
    event := jsonb_build_object('sequence_id',v_sequence_id,'event_sequence',1,'event_type','accepted','outcome_status','accepted',
      'source','scheduled','device_at','2026-11-16T12:00:00Z','time_quality','synced','command_id',null,
      'schedule_id',v_schedule_id,'configuration_revision',1,'occurrence_local_date','2026-11-16',
      'requested_dose','{"mode":"grams","amount_g":12}'::jsonb,
      'estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable',
      'reason_code',null,'maintenance_resolution',null,'lockout_cleared',false,'nozzle_number',1,'step_index',1);
    events := jsonb_build_array(event);
    if c.root=6 and c.mode='replay' then
      setup_result := public.art33_record_scheduled_events(d,repeat('a',64),events,'synced',0,'idle',null);
      if (setup_result->>'status'='ok') is distinct from true then raise exception using message=marker||'_SCHEDULED_SETUP'; end if;
    elsif c.root=6 and c.mode='empty' then events := '[]'::jsonb;
    elsif c.root=6 and c.mode in ('failed','invalid_rollback') then
      -- The positive failed case proves this same prefix creates journal/measurement/alert
      -- facts. A later bad target must roll ALL of them back through the existing catch.
      events := events||jsonb_build_array(
        event||'{"event_sequence":2,"event_type":"running","outcome_status":"running","device_at":"2026-11-16T12:00:01Z"}'::jsonb,
        event||'{"event_sequence":3,"event_type":"failed","outcome_status":"failed","device_at":"2026-11-16T12:00:02Z","measurement_quality":"valid","measured_dispensed_g":11.76,"reason_code":"SIMULATOR_MEASURED_FAILURE"}'::jsonb);
      if c.mode='invalid_rollback' then
        events := events||jsonb_build_array(event||'{"event_sequence":4,"requested_dose":{"mode":"grams","amount_g":13}}'::jsonb);
      end if;
    end if;
    if c.root=15 then
      update public.devices set metadata_conflict=true where device_id=d;
      if c.mode in ('same_labels','conflict') then
        setup_result := public.art102_update_device_metadata(d,installation,' T08 label ',' Pond 3 ',1);
        if (setup_result->>'status'='updated' and setup_result->>'metadata_revision'='2') is distinct from true then
          raise exception using message=marker||'_METADATA_SETUP';
        end if;
      end if;
    elsif c.root=16 and c.mode='repeat' then
      setup_result := public.art38_revoke_device_access(d,installation);
      if (setup_result->>'status'='revoked') is distinct from true then raise exception using message=marker||'_REVOKE_SETUP'; end if;
    end if;
    insert into public.device_resource_versions(device_id) values(d) on conflict(device_id) do nothing;
    select revisions into strict before_versions from public.device_resource_versions where device_id=d;
    expected_versions := before_versions;
    subset := '{}'::jsonb;
    foreach owner_name in array c.owners loop
      expected_versions := jsonb_set(expected_versions,array[owner_name],to_jsonb((before_versions->>owner_name)::numeric+1));
      subset := subset||jsonb_build_object(owner_name,expected_versions->owner_name);
    end loop;
    select coalesce(array_agg(x.id order by x.id),array[]::uuid[]),count(*) into before_ids,before_messages
      from realtime.messages x where x.topic=v_topic;
    select to_jsonb(x) into strict before_device from public.devices x where x.device_id=d;
    select to_jsonb(x),x.last_authenticated_contact_at into strict before_state,before_contact from public.device_state x where x.device_id=d;
    select count(*) into before_audits from private.security_audit_events x where x.device_id=d;
    select count(*) into before_sequences from public.feed_sequences x where x.device_id=d;
    select count(*) into before_events from public.device_events x where x.device_id=d;
    -- Denial must not renew contact, apply a report, journal events or publish.
    if c.root=3 and (has_function_privilege('service_role','private.backend_configuration_report(uuid,text,bigint,bigint,text,text)','EXECUTE')
      or has_function_privilege('anon','private.backend_configuration_report(uuid,text,bigint,bigint,text,text)','EXECUTE')
      or has_function_privilege('authenticated','private.backend_configuration_report(uuid,text,bigint,bigint,text,text)','EXECUTE')) then
      raise exception using message=marker||'_PRIVATE_CORE_EXPOSED';
    end if;
    if c.root=1 then r := public.backend_sync_metrics(d,repeat('f',64),boot,10,envelope);
    elsif c.root=2 then r := public.art27_sync_telemetry(d,repeat('f',64),boot,10,legacy_sample,'[]'::jsonb);
    elsif c.root=3 then r := private.backend_configuration_report(d,repeat('f',64),1,1,'applied',null);
    elsif c.root=4 then r := public.art33_device_configuration_report(d,repeat('f',64),1,1,'applied',null);
    elsif c.root=5 then r := public.backend_device_configuration_report(d,repeat('f',64),'{}'::jsonb);
    elsif c.root=6 then r := public.art33_record_scheduled_events(d,repeat('f',64),events,'synced',0,'idle',null);
    elsif c.root=14 then r := public.art33_write_configuration(d,('a808b203-0000-4000-8013-'||suffix)::uuid,gen_random_uuid(),0,snapshot);
    elsif c.root=15 then r := public.art102_update_device_metadata(d,('a808b203-0000-4000-8013-'||suffix)::uuid,'Denied',null,1);
    elsif c.root=16 then r := public.art38_revoke_device_access(d,('a808b203-0000-4000-8013-'||suffix)::uuid);
    end if;
    if (case when c.root=3 then r-'_changed_resources' else r end) is distinct from
        jsonb_build_object('status',(case when c.root<14 then 'auth_required' else 'not_active' end))
      or (c.root=3 and r ? '_changed_resources' and r->'_changed_resources'<>'[]'::jsonb)
      or (select to_jsonb(x) from public.devices x where x.device_id=d) is distinct from before_device
      or (select to_jsonb(x) from public.device_state x where x.device_id=d) is distinct from before_state
      or (select count(*) from public.feed_sequences x where x.device_id=d)<>before_sequences
      or (select count(*) from public.device_events x where x.device_id=d)<>before_events
      or (select count(*) from private.security_audit_events x where x.device_id=d)<>before_audits
      or (select revisions from public.device_resource_versions where device_id=d) is distinct from before_versions
      or (select count(*) from realtime.messages x where x.topic=v_topic)<>before_messages then
      raise exception using message=marker||'_PREAUTH_CHANGED';
    end if;
    started := clock_timestamp();
    if c.root=1 then r := public.backend_sync_metrics(d,repeat('a',64),boot,10,envelope);
    elsif c.root=2 then r := public.art27_sync_telemetry(d,repeat('a',64),boot,10,legacy_sample,'[]'::jsonb);
    elsif c.root in (3,4) then
      if c.root=3 then
        r := private.backend_configuration_report(d,repeat('a',64),
          (case when c.mode='rejected' or c.mode='pending' then null else target_revision end),target_revision,
          (case when c.mode='rejected' then 'rejected' when c.mode='pending' then 'pending' else 'applied' end),
          (case when c.mode='rejected' then 'CLOCK_UNTRUSTED' else null end));
      else
        r := public.art33_device_configuration_report(d,repeat('a',64),
          (case when c.mode='rejected' or c.mode='pending' then null else target_revision end),target_revision,
          (case when c.mode='rejected' then 'rejected' when c.mode='pending' then 'pending' else 'applied' end),
          (case when c.mode='rejected' then 'CLOCK_UNTRUSTED' else null end));
      end if;
    elsif c.root=5 then
      report := jsonb_build_object('applied_revision',(case when c.mode in ('rejected','pending') then null else 1 end),
        'last_attempt_revision',1,'last_attempt_status',(case when c.mode='rejected' then 'rejected' when c.mode='pending' then 'pending' else 'applied' end),
        'error_code',(case when c.mode='rejected' then 'CLOCK_UNTRUSTED' else null end),
        'oxygen_report_interval_seconds',(case when c.mode in ('rejected','pending') then null when c.mode='invalid_interval' then 60 else 30 end));
      r := public.backend_device_configuration_report(d,repeat('a',64),report);
    elsif c.root=6 then r := public.art33_record_scheduled_events(d,repeat('a',64),events,'synced',0,'idle',null);
    elsif c.root=14 then
      r := public.art33_write_configuration(d,installation,
        (case when c.mode='conflict' then gen_random_uuid() else v_request_id end),0,snapshot);
    elsif c.root=15 then
      -- Real INVOKER service path; no postgres-only finalizer privilege can hide a regression.
      set local role service_role;
      r := public.art102_update_device_metadata(d,installation,' T08 label ',' Pond 3 ',
        (case when c.mode='same_labels' then 2 else 1 end));
      reset role;
    elsif c.root=16 then
      set local role service_role;
      r := public.art38_revoke_device_access(d,installation);
      reset role;
    else raise exception 'T08_B2_STANDALONE_UNHANDLED_CASE';
    end if;
    finished := clock_timestamp();
    if (r->>'status'=c.want_status) is distinct from true then raise exception using message=marker||'_LEGACY_STATUS_CHANGED'; end if;
    want := jsonb_build_object('status',c.want_status);
    if c.root in (1,2) then
      if jsonb_typeof(r->'server_time') is distinct from 'string'
        or not pg_input_is_valid(r->>'server_time','timestamp with time zone') then
        raise exception using message=marker||'_SERVER_TIME_CHANGED';
      end if;
      if (r->>'server_time')::timestamptz not between started and finished then raise exception using message=marker||'_SERVER_TIME_CHANGED'; end if;
      if c.root=1 then
        want_ack := (case when c.mode='backlog' then jsonb_build_array(jsonb_build_object('metric','do','boot_id',boot,'sequence',9))
          else jsonb_build_array(jsonb_build_object('metric','do','boot_id',boot,'sequence',10),jsonb_build_object('metric','feed','boot_id',boot,'sequence',10)) end);
        want := want||jsonb_build_object('server_time',r->'server_time','acknowledged_metrics',want_ack,'revisions',expected_versions);
        if (select count(*) from public.device_metric_observations x where x.device_id=d)<>(case when c.mode='backlog' then 1 else 2 end)
          or (select count(*) from public.device_metric_current x where x.device_id=d)<>(case when c.mode='backlog' then 0 else 2 end)
          or not exists(select 1 from public.device_metric_observations x where x.device_id=d and x.metric='do'
            and x.input_observation=metric_do and x.do_mg_l=(case when c.mode='alert' then 2 else 5.8 end))
          or exists(select 1 from public.device_telemetry x where x.device_id=d) then
          raise exception using message=marker||'_METRIC_FACTS_NOT_OBSERVED';
        end if;
        if c.mode<>'backlog' and (not exists(select 1 from public.device_metric_current x where x.device_id=d
            and x.metric='feed' and x.boot_id=boot and x.sample_sequence=10 and x.live_sequence=10)
          or not exists(select 1 from public.device_metric_current x where x.device_id=d
            and x.metric='do' and x.boot_id=boot and x.sample_sequence=10 and x.live_sequence=10)
          or not exists(select 1 from public.device_metric_observations x where x.device_id=d
            and x.metric='feed' and x.input_observation=metric_feed and x.quality='valid'
            and x.feed_remaining_g=18000 and x.feed_percent=90 and x.calibration_revision=1)) then
          raise exception using message=marker||'_METRIC_POINTER_OR_STOCK_CHANGED';
        end if;
      else
        want := want||jsonb_build_object('server_time',r->'server_time','acknowledged_samples',jsonb_build_array(jsonb_build_object('boot_id',boot,'sequence',10)));
        if (select count(*) from public.device_telemetry x where x.device_id=d)<>1
          or not exists(select 1 from public.device_telemetry x where x.device_id=d and x.boot_id=boot and x.sample_sequence=10
            and x.do_mg_l=(case when c.mode='alert' then 2 else 5.8 end) and x.feed_remaining_g=18000 and x.feed_percent=90)
          or not exists(select 1 from public.device_state x where x.device_id=d and x.latest_telemetry_boot_id=boot
            and x.latest_telemetry_sequence=10 and x.live_sequence=10)
          or exists(select 1 from public.device_metric_observations x where x.device_id=d)
          or exists(select 1 from public.device_metric_current x where x.device_id=d) then
          raise exception using message=marker||'_LEGACY_FACTS_NOT_OBSERVED';
        end if;
      end if;
      if 'contact'=any(c.owners) then
        if not exists(select 1 from public.device_state x where x.device_id=d and x.contact_freshness='fresh'
          and x.last_authenticated_contact_at is distinct from before_contact) then raise exception using message=marker||'_CONTACT_NOT_OBSERVED'; end if;
      elsif (select last_authenticated_contact_at from public.device_state where device_id=d) is distinct from before_contact then
        raise exception using message=marker||'_REPLAY_RENEWED_CONTACT';
      end if;
      if (select count(*) from public.alert_events x where x.device_id=d)<>(case when c.mode='alert' then 1 else 0 end)
        or (c.mode='alert' and not exists(select 1 from public.alert_events x where x.device_id=d and x.alert_kind='do_low')) then
        raise exception using message=marker||'_ALERT_FACTS_CHANGED';
      end if;
    elsif c.root in (3,4,5) then
      if c.mode='invalid_interval' then
        if (select to_jsonb(x) from public.devices x where x.device_id=d) is distinct from before_device
          or not exists(select 1 from public.device_config_revisions x where x.device_id=d and x.revision=1 and x.state='requested') then
          raise exception using message=marker||'_INVALID_ACK_APPLIED';
        end if;
      else
        want := want||jsonb_build_object('desired_configuration',
          (case when c.mode='pending' then snapshot||jsonb_build_object('revision',1,'based_on_revision',0) else null end));
        if not exists(select 1 from public.devices x where x.device_id=d and x.desired_revision=target_revision
          and x.applied_revision is not distinct from (case when c.mode in ('rejected','pending') then null else target_revision end)
          and x.last_attempt_revision=target_revision
          and x.last_attempt_status=(case when c.mode='rejected' then 'rejected' when c.mode='pending' then 'pending' else 'applied' end)
          and x.configuration_error_code is not distinct from (case when c.mode='rejected' then 'CLOCK_UNTRUSTED' else null end))
          or not exists(select 1 from public.device_config_revisions x where x.device_id=d and x.revision=target_revision
            and x.state=(case when c.mode='rejected' then 'rejected' when c.mode='pending' then 'requested' else 'applied' end)
            and x.requested_snapshot=snapshot and (x.applied_at is not null)=(c.mode not in ('rejected','pending')))
          or (select count(*) from public.device_schedule_tombstones x where x.device_id=d)<>(case when c.mode='tombstone' then 1 else 0 end) then
          raise exception using message=marker||'_CONFIGURATION_FACTS_NOT_OBSERVED';
        end if;
        if c.mode='tombstone' and not exists(select 1 from public.device_schedule_tombstones x
          where x.device_id=d and x.schedule_id=v_schedule_id) then
          raise exception using message=marker||'_REMOVED_SCHEDULE_NOT_RETIRED';
        end if;
        if c.mode in ('replay','pending') and (select to_jsonb(x) from public.devices x where x.device_id=d) is distinct from before_device then
          raise exception using message=marker||'_SEMANTIC_REPLAY_CHANGED';
        end if;
      end if;
    elsif c.root=6 then
      if c.mode<>'invalid_rollback' then
        want := want||jsonb_build_object('acknowledged_events',(case when c.mode='empty' then '[]'::jsonb
          when c.mode='failed' then jsonb_build_array(
            jsonb_build_object('sequence_id',v_sequence_id,'event_sequence',1),
            jsonb_build_object('sequence_id',v_sequence_id,'event_sequence',2),
            jsonb_build_object('sequence_id',v_sequence_id,'event_sequence',3))
          else jsonb_build_array(jsonb_build_object('sequence_id',v_sequence_id,'event_sequence',1)) end));
      end if;
      if c.mode='failed' then
        if (select count(*) from public.feed_sequences x where x.device_id=d)<>1
          or not exists(select 1 from public.feed_sequences x where x.device_id=d and x.sequence_id=v_sequence_id
            and x.source='scheduled' and x.status='failed' and x.status_sequence=3 and not x.unresolved and not x.safety_lockout)
          or (select count(*) from public.feed_steps x where x.device_id=d)<>2
          or not exists(select 1 from public.feed_steps x where x.device_id=d and x.step_index=1 and x.nozzle_number=1
            and x.status='failed' and x.measurement_quality='valid' and x.measured_dispensed_g=11.76
            and x.estimated_dispensed_g is null and x.started_at=due+interval '1 second' and x.stopped_at=due+interval '2 seconds')
          or not exists(select 1 from public.feed_steps x where x.device_id=d and x.step_index=2 and x.nozzle_number=2
            and x.status='not_started' and x.measurement_quality='unavailable' and x.measured_dispensed_g is null
            and x.estimated_dispensed_g is null and x.started_at is null and x.baseline_ready_at is null and x.start_before is null)
          or (select jsonb_agg(x.payload order by x.event_sequence) from public.device_events x where x.device_id=d) is distinct from events
          or (select count(*) from public.scheduled_occurrences x where x.device_id=d)<>1
          or not exists(select 1 from public.scheduled_occurrences x where x.device_id=d and x.sequence_id=v_sequence_id and x.outcome='failed')
          or (select count(*) from public.device_execution_reservations x where x.device_id=d)<>1
          or not exists(select 1 from public.device_execution_reservations x where x.device_id=d and x.sequence_id=v_sequence_id
            and x.phase='released' and x.released_at is not null)
          or (select count(*) from public.alert_events x where x.device_id=d)<>1
          or not exists(select 1 from public.alert_events x where x.device_id=d and x.sequence_id=v_sequence_id and x.alert_kind='feeding_failed') then
          raise exception using message=marker||'_FAILED_MEASUREMENT_AND_ALERT_NOT_OBSERVED';
        end if;
      elsif c.mode in ('accepted','replay') then
        if not exists(select 1 from public.feed_sequences x where x.device_id=d and x.sequence_id=v_sequence_id
            and x.source='scheduled' and x.status='accepted' and x.status_sequence=1 and x.unresolved and not x.safety_lockout
            and x.target_count=2 and x.due_at=due and x.start_before=due+interval '30 seconds')
          or (select count(*) from public.feed_steps x where x.device_id=d)<>2
          or not exists(select 1 from public.feed_steps x where x.device_id=d and x.step_index=1 and x.nozzle_number=1 and x.status='accepted'
            and x.requested_dose='{"mode":"grams","amount_g":12}'::jsonb)
          or not exists(select 1 from public.feed_steps x where x.device_id=d and x.step_index=2 and x.nozzle_number=2 and x.status='queued'
            and x.started_at is null and x.baseline_ready_at is null and x.start_before is null)
          or (select count(*) from public.device_events x where x.device_id=d)<>1
          or not exists(select 1 from public.device_events x where x.device_id=d and x.payload=event)
          or (select count(*) from public.scheduled_occurrences x where x.device_id=d)<>1
          or not exists(select 1 from public.scheduled_occurrences x where x.device_id=d and x.sequence_id=v_sequence_id and x.outcome='admitted')
          or (select count(*) from public.device_execution_reservations x where x.device_id=d)<>1
          or not exists(select 1 from public.device_execution_reservations x where x.device_id=d and x.sequence_id=v_sequence_id
            and x.phase='active' and x.released_at is null)
          or exists(select 1 from public.feed_steps x where x.device_id=d and (x.started_at is not null
            or x.measured_dispensed_g is not null or x.estimated_dispensed_g is not null or x.measurement_quality<>'unavailable')) then
          raise exception using message=marker||'_SCHEDULED_FACTS_NOT_OBSERVED';
        end if;
      elsif exists(select 1 from public.feed_sequences x where x.device_id=d)
        or exists(select 1 from public.feed_sequence_targets x where x.device_id=d)
        or exists(select 1 from public.feed_steps x where x.device_id=d)
        or exists(select 1 from public.device_events x where x.device_id=d)
        or exists(select 1 from public.scheduled_occurrences x where x.device_id=d)
        or exists(select 1 from public.device_execution_reservations x where x.device_id=d) then
        raise exception using message=marker||'_CAUGHT_BATCH_LEAKED_FACTS';
      end if;
    elsif c.root=14 then
      current_state := jsonb_build_object('desired_revision',(case when c.mode in ('rejected','rejected_replay') then null else 1 end),
        'applied_revision',null,'last_attempt_revision',1,'last_attempt_status',(case when c.mode in ('rejected','rejected_replay') then 'rejected' else 'pending' end),
        'error_code',(case when c.mode in ('rejected','rejected_replay') then 'VALIDATION_FAILED' else null end));
      want := want||jsonb_build_object('current_state',current_state);
      if c.mode<>'conflict' then
        want := want||jsonb_build_object('receipt',(case when c.mode in ('rejected','rejected_replay') then null
          else jsonb_build_object('revision',1,'based_on_revision',0,'snapshot',snapshot) end));
        if c.mode in ('rejected','rejected_replay','replay') then
          want := want||jsonb_build_object('error_code',(case when c.mode='replay' then null else 'VALIDATION_FAILED' end));
        end if;
      end if;
      if (select count(*) from public.device_config_revisions x where x.device_id=d)<>1
        or not exists(select 1 from public.device_config_revisions x where x.device_id=d and x.revision=1
          and x.request_id=v_request_id and x.based_on_revision=0 and x.requested_snapshot=snapshot
          and x.state=(case when c.mode in ('rejected','rejected_replay') then 'rejected' else 'requested' end))
        or (select count(*) from public.device_config_schedules x where x.device_id=d)<>
          (case when c.mode in ('rejected','rejected_replay') then 0 else 2 end)
        or (select count(*) from public.device_config_schedule_slots x where x.device_id=d)<>
          (case when c.mode in ('rejected','rejected_replay') then 0 else 14 end)
        or (select jsonb_build_object('desired_revision',x.desired_revision,'applied_revision',x.applied_revision,
          'last_attempt_revision',x.last_attempt_revision,'last_attempt_status',x.last_attempt_status,'error_code',x.configuration_error_code)
          from public.devices x where x.device_id=d) is distinct from current_state then
        raise exception using message=marker||'_WRITER_FACTS_NOT_OBSERVED';
      end if;
    elsif c.root=15 then
      if c.mode<>'conflict' then
        want := want||jsonb_build_object('device_id',d,'alias','T08 label','location','Pond 3',
          'metadata_revision',(case when c.mode='same_labels' then 3 else 2 end),'metadata_conflict',false);
      end if;
      if not exists(select 1 from public.devices x where x.device_id=d and x.alias='T08 label' and x.location='Pond 3'
          and not x.metadata_conflict and x.metadata_revision=(case when c.mode='same_labels' then 3 else 2 end))
        or (select count(*) from private.security_audit_events x where x.device_id=d and x.event_type='device_label_updated')<>
          before_audits+(case when c.mode='conflict' then 0 else 1 end) then
        raise exception using message=marker||'_METADATA_FACTS_NOT_OBSERVED';
      end if;
    elsif c.root=16 then
      if c.mode='revoked' then want := want||jsonb_build_object('revoked_at',transaction_timestamp()); end if;
      if not exists(select 1 from public.device_access x where x.device_id=d and x.installation_id=installation
          and x.status='revoked' and x.revoked_at=transaction_timestamp())
        or not exists(select 1 from public.device_access x where x.device_id=d and x.installation_id=other_installation and x.status='active')
        or (select count(*) from private.security_audit_events x where x.device_id=d and x.event_type='access_revoked')<>
          before_audits+(case when c.mode='repeat' then 0 else 1 end)
        or public.art33_read_configuration(d,installation,null) is distinct from '{"status":"not_active"}'::jsonb then
        raise exception using message=marker||'_REVOCATION_FACTS_NOT_OBSERVED';
      end if;
    end if;
    -- No hidden flags/revisions in legacy public DTOs; private N3 alone may carry its closed flag key.
    if (case when c.root=3 then r-'_changed_resources' else r end) is distinct from want then
      raise exception using message=marker||'_LEGACY_DTO_CHANGED';
    end if;
    if c.root not in (1,2) and (select to_jsonb(x) from public.device_state x where x.device_id=d) is distinct from before_state then
      raise exception using message=marker||'_UNEXPECTED_SENSOR_OR_CONTACT_WRITE';
    end if;
    if c.root<>6 and (exists(select 1 from public.feed_sequences x where x.device_id=d)
      or exists(select 1 from public.device_events x where x.device_id=d)
      or exists(select 1 from public.device_execution_reservations x where x.device_id=d)) then
      raise exception using message=marker||'_UNEXPECTED_FEEDING_WRITE';
    end if;
    if c.root not in (1,2) and not (c.root=6 and c.mode='failed')
      and exists(select 1 from public.alert_events x where x.device_id=d) then
      raise exception using message=marker||'_UNEXPECTED_ALERT';
    end if;
    if c.root not in (1,2) and (exists(select 1 from public.device_telemetry x where x.device_id=d)
      or exists(select 1 from public.device_metric_observations x where x.device_id=d)) then
      raise exception using message=marker||'_JOURNAL_IS_NOT_A_STOCK_SAMPLE';
    end if;
    set constraints all immediate;
    set constraints all deferred;
    select revisions into strict after_versions from public.device_resource_versions where device_id=d;
    if after_versions is distinct from expected_versions then
      raise exception using errcode='P0001',message=marker||'_VERSION_MISSING';
    end if;
    if c.root=3 and r->'_changed_resources' is distinct from c.private_flags then
      raise exception using errcode='P0001',message=marker||'_PRIVATE_FLAGS_MISSING';
    end if;
    -- Disposable substituted send: exactly one for a changed outer root, zero for core/no-op.
    -- This does not promise native stored-message or socket delivery.
    if (select count(*) from realtime.messages x where x.topic=v_topic)<>
      before_messages+(case when cardinality(c.owners)>0 then 1 else 0 end) then
      raise exception using errcode='P0001',message=marker||'_HINT_COUNT_MISSING';
    end if;
    if cardinality(c.owners)>0 then
      select x.* into strict message from realtime.messages x where x.topic=v_topic and not (x.id=any(before_ids));
      if (message.extension='broadcast' and message.event='resource_update' and message.private is true
        and message.payload->>'id'=message.id::text and message.payload->>'device_id'=d::text
        and message.payload->'resources'=to_jsonb(c.owners) and message.payload->'revisions'=subset
        and message.payload-array['id','device_id','resources','revisions']='{}'::jsonb) is distinct from true then
        raise exception using message=marker||'_HINT_SHAPE_CHANGED';
      end if;
    end if;
  end loop;
  if ran=0 then raise exception 'T08_B2_STANDALONE_SELECTOR_INVALID'; end if;
end $$;
rollback;
\echo T08_B2_STANDALONE_PRODUCER_ORACLES_OK

-- The aggregate must roll back mutations from each completed stage when a later
-- stage fails. Keep every positive and negative fixture in a test transaction.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';
set local timezone = 'UTC';

create function pg_temp.sync_facts(target uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'device', (select to_jsonb(d) from public.devices d where d.device_id=target),
    'state', (select to_jsonb(s) from public.device_state s where s.device_id=target),
    'configuration', (select jsonb_agg(to_jsonb(c) order by c.revision)
      from public.device_config_revisions c where c.device_id=target),
    'observations', (select jsonb_agg(to_jsonb(o) order by o.metric,o.boot_id,o.sample_sequence)
      from public.device_metric_observations o where o.device_id=target),
    'current', (select jsonb_agg(to_jsonb(c) order by c.metric)
      from public.device_metric_current c where c.device_id=target),
    'sequences', (select jsonb_agg(to_jsonb(q) order by q.sequence_id)
      from public.feed_sequences q where q.device_id=target),
    'steps', (select jsonb_agg(to_jsonb(f) order by f.sequence_id,f.step_index)
      from public.feed_steps f where f.device_id=target),
    'reservations', (select jsonb_agg(to_jsonb(r) order by r.sequence_id)
      from public.device_execution_reservations r where r.device_id=target),
    'events', (select jsonb_agg(to_jsonb(e) order by e.sequence_id,e.event_sequence)
      from public.device_events e where e.device_id=target),
    'alerts', (select jsonb_agg(to_jsonb(a) order by a.event_id)
      from public.alert_events a where a.device_id=target),
    'occurrences', (select jsonb_agg(to_jsonb(o) order by o.schedule_id,o.occurrence_local_date)
      from public.scheduled_occurrences o where o.device_id=target),
    'versions', (select revisions from public.device_resource_versions where device_id=target),
    'messages', (select jsonb_agg(to_jsonb(m) order by m.id)
      from realtime.messages m where m.topic='device:'||target::text||':updates')
  );
$$;

create function pg_temp.fail_aggregate_hint() returns trigger language plpgsql as $$
begin
  raise exception 'T08_TEST_AGGREGATE_INSERT_FAILURE';
end $$;

do $$
declare
  device constant uuid := 'a808b205-0000-4000-8000-000000000001';
  installation constant uuid := 'a808b205-0000-4000-8000-000000000002';
  boot constant uuid := 'a808b205-0000-4000-8000-000000000003';
  schedule constant uuid := 'a808b205-0000-4000-8000-000000000004';
  sequence constant uuid := 'a808b205-0000-4000-8000-000000000005';
  verifier constant text := repeat('b',64);
  update_topic constant text := 'device:'||device::text||':updates';
  sample jsonb;
  report constant jsonb := '{"applied_revision":1,"last_attempt_revision":1,"last_attempt_status":"applied","error_code":null,"oxygen_report_interval_seconds":30}';
  scheduled_event jsonb;
  event_key jsonb;
  payload jsonb;
  attempt record;
  baseline jsonb;
  result jsonb;
  accepted jsonb;
  batch jsonb;
  expected_metrics jsonb;
  bad_schedule constant text := $invalid$[{"reason_code":"\ud800"}]$invalid$;
  bad_manual constant text := $invalid$[{"reason_code":"\u0000"}]$invalid$;
begin
  -- A loopback client URL can reach PostgreSQL through Docker port forwarding.
  if current_database()<>'aquafeed_backend_test' or current_user<>'postgres'
    or not exists(select 1 from backend_test.provenance
      where singleton and migration_fixtures_created and migration_fixtures_cleaned
      and database_oid=(select oid from pg_database where datname=current_database())) then
    raise exception 'T08_AGGREGATE_DISPOSABLE_PROVENANCE_REQUIRED';
  end if;
  if not has_function_privilege('service_role','public.backend_sync_device(uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.backend_sync_device(uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.backend_sync_device(uuid,text,jsonb)','EXECUTE') then
    raise exception 'T08_AGGREGATE_RPC_ACL';
  end if;
  insert into auth.users(id,is_anonymous) values(installation,true);
  insert into public.devices(device_id,model,firmware_version,protocol_major,is_simulated,capabilities_revision,capabilities)
    select device,'T08 disposable aggregate',d.firmware_version,d.protocol_major,true,d.capabilities_revision,
      d.capabilities||'{"independent_telemetry_v1":true}'::jsonb
    from public.devices d where d.device_id='22222222-2222-4222-8222-222222222222'
      and d.is_simulated and d.protocol_major=2 and d.capabilities_revision=5;
  if not found then raise exception 'T08_AGGREGATE_PROFILE_MISSING'; end if;
  insert into private.device_credentials(device_id,credential_verifier) values(device,decode(verifier,'hex'));
  insert into public.device_state(device_id) values(device);
  insert into public.device_access(device_id,installation_id,status) values(device,installation,'active');
  set local role service_role;
  result := public.art33_write_configuration(device,installation,gen_random_uuid(),0,jsonb_build_object(
    'timezone','UTC','monitoring_limits','{"do_low_mg_l":4,"do_high_mg_l":8}'::jsonb,
    'low_feed_threshold_pct',20,'oxygen_report_interval_seconds',30,
    'schedules',jsonb_build_array(jsonb_build_object('schedule_id',schedule,'local_time','12:00',
      'weekdays','[1,2,3,4,5,6,7]'::jsonb,'enabled',true,
      'targets','[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":12}}]'::jsonb))));
  reset role;
  if (result->>'status'='ok' and result#>>'{receipt,revision}'='1') is distinct from true then
    raise exception 'T08_AGGREGATE_CONFIGURATION_SETUP';
  end if;

  sample := jsonb_build_object('metric','do','boot_id',boot,'sequence',101,
    'measured_at',to_char(clock_timestamp()-interval '1 second','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'captured_at',null,'time_quality','synced','quality','valid','do_mg_l',5.8,
    'feed_remaining_g',null,'feed_percent',null,'calibration_revision',null);
  event_key := jsonb_build_object('source','scheduled','sequence_id',sequence,'event_sequence',1,
    'schedule_id',schedule,'configuration_revision',1,'occurrence_local_date','2026-11-16',
    'nozzle_number',1,'step_index',1);
  scheduled_event := event_key||'{"event_type":"accepted","outcome_status":"accepted",
    "device_at":"2026-11-16T12:00:00Z","time_quality":"synced","command_id":null,
    "requested_dose":{"mode":"grams","amount_g":12},"estimated_dispensed_g":null,
    "measured_dispensed_g":null,"measurement_quality":"unavailable","reason_code":null,
    "maintenance_resolution":null,"lockout_cleared":false}'::jsonb;
  payload := jsonb_build_object('protocol_major',2,'request_id',gen_random_uuid(),'boot_id',boot,
    'live_sequence',101,'capabilities_revision',5,'clock','{"quality":"synced","uncertainty_ms":0}'::jsonb,
    'actuator','{"state":"idle","active_sequence_id":null}'::jsonb,'configuration',report,
    'latest_sample',null,'backlog_samples','[]'::jsonb,'event_keys',jsonb_build_array(event_key),
    'scheduled_events_json',jsonb_build_array(scheduled_event)::text,'manual_events_json','[]',
    'metric_telemetry',jsonb_build_object('live',jsonb_build_object('do',sample,'feed',null),'backlog','[]'::jsonb));
  baseline := pg_temp.sync_facts(device);
  for attempt in select * from (values
    ('P8C02', payload||jsonb_build_object(
      'configuration',report||'{"oxygen_report_interval_seconds":60}'::jsonb,'scheduled_events_json',bad_schedule)),
    ('P8D01', payload||jsonb_build_object('scheduled_events_json',bad_schedule)),
    ('P8D02', payload||jsonb_build_object('manual_events_json',bad_manual))
  ) cases(want_state,body) loop
    begin
      set local role service_role;
      perform public.backend_sync_device(device,verifier,attempt.body);
      raise exception 'T08_AGGREGATE_EXPECTED_FAILURE';
    exception when others then
      if sqlstate <> attempt.want_state then raise; end if;
    end;
    reset role;
    if pg_temp.sync_facts(device) is distinct from baseline then
      raise exception 'T08_AGGREGATE_PARTIAL_WRITE';
    end if;
  end loop;

  set local role service_role;
  result := public.backend_sync_device(device,verifier,payload);
  reset role;
  accepted := pg_temp.sync_facts(device);
  expected_metrics := jsonb_build_array(jsonb_build_object('metric','do','boot_id',boot,'sequence',101));
  if result->>'status' is distinct from 'ok'
    or result->'acknowledged_metrics' is distinct from expected_metrics
    or result->'acknowledged_events' is distinct from
      jsonb_build_array(jsonb_build_object('sequence_id',sequence,'event_sequence',1))
    or result->'revisions' is distinct from accepted->'versions'
    or accepted#>>'{device,applied_revision}' is distinct from '1'
    or jsonb_array_length(accepted->'observations') is distinct from 1
    or jsonb_array_length(accepted->'sequences') is distinct from 1
    or jsonb_array_length(accepted->'occurrences') is distinct from 1
    or jsonb_array_length(accepted->'messages') is distinct from jsonb_array_length(baseline->'messages')+1
    or not exists(select 1 from realtime.messages m
      where m.topic=update_topic and m.private and m.event='resource_update'
        and m.payload->'resources' @> '["configuration","do","feeding","history"]'::jsonb) then
    raise exception 'T08_AGGREGATE_POSITIVE_RETRY_FACTS';
  end if;

  set local role service_role;
  result := public.backend_sync_device(device,verifier,payload);
  reset role;
  if result->'acknowledged_metrics' is distinct from expected_metrics
    or result->'acknowledged_events' is distinct from
      jsonb_build_array(jsonb_build_object('sequence_id',sequence,'event_sequence',1))
    or result#>'{revisions,history}' is distinct from accepted#>'{versions,history}'
    or result#>'{revisions,feeding}' is distinct from accepted#>'{versions,feeding}'
    or (select count(*) from public.feed_sequences q where q.device_id=device)<>1 then
    raise exception 'T08_AGGREGATE_REPLAY_CHANGED_HISTORY_OR_FEEDING';
  end if;

  select jsonb_agg(sample||jsonb_build_object('sequence',n) order by n),
    jsonb_agg(jsonb_build_object('metric','do','boot_id',boot,'sequence',n) order by n)
    into batch,expected_metrics from generate_series(1,100) n;
  payload := payload||jsonb_build_object(
    'event_keys','[]'::jsonb,'scheduled_events_json','[]','metric_telemetry',
    jsonb_build_object('live','{"do":null,"feed":null}'::jsonb,'backlog',batch));
  baseline := pg_temp.sync_facts(device);
  set local role service_role;
  result := public.backend_sync_device(device,verifier,payload);
  reset role;
  if result->>'status' is distinct from 'ok' or jsonb_array_length(result->'acknowledged_metrics')<>100
    or not (result->'acknowledged_metrics' @> expected_metrics)
    or (select count(*) from public.device_metric_observations o where o.device_id=device)<>101
    or (select count(*) from realtime.messages m where m.topic=update_topic)<>jsonb_array_length(baseline->'messages')+1
    or (result#>>'{revisions,history}')::bigint is distinct from (baseline#>>'{versions,history}')::bigint+1
    or (select to_jsonb(c) from public.device_metric_current c where c.device_id=device)
      is distinct from baseline#>'{current,0}' then
    raise exception 'T08_AGGREGATE_BACKLOG_FACTS';
  end if;

  -- The fixture publisher catches this INSERT failure like the native inner
  -- sender. Verify the aggregate still returns the ACK and persisted revision.
  create trigger t08_fail_aggregate_hint before insert on realtime.messages
    for each row execute function pg_temp.fail_aggregate_hint();
  sample := sample||'{"sequence":102}'::jsonb;
  payload := payload||jsonb_build_object('live_sequence',102,'metric_telemetry',
    jsonb_build_object('live',jsonb_build_object('do',sample,'feed',null),'backlog','[]'::jsonb));
  baseline := pg_temp.sync_facts(device);
  set local role service_role;
  result := public.backend_sync_device(device,verifier,payload);
  reset role;
  if result->>'status' is distinct from 'ok'
    or result->'acknowledged_metrics' is distinct from jsonb_build_array(
      jsonb_build_object('metric','do','boot_id',boot,'sequence',102))
    or result->'revisions' is distinct from
      (select v.revisions from public.device_resource_versions v where v.device_id=device)
    or (result#>>'{revisions,history}')::bigint is distinct from (baseline#>>'{versions,history}')::bigint+1
    or not exists(select 1 from public.device_metric_observations o
      where o.device_id=device and o.metric='do' and o.sample_sequence=102)
    or (select count(*) from realtime.messages m where m.topic=update_topic)<>jsonb_array_length(baseline->'messages') then
    raise exception 'T08_AGGREGATE_PUBLISH_FAILURE_LOST_FACTS';
  end if;
  drop trigger t08_fail_aggregate_hint on realtime.messages;

  -- Replay the exact successful UTC wire payload under a non-UTC caller.
  perform set_config('TimeZone','Asia/Kuala_Lumpur',true);
  set local role service_role;
  result := public.backend_sync_device(device,verifier,payload);
  reset role;
  if result->>'status' is distinct from 'ok'
    or result->'acknowledged_metrics' is distinct from jsonb_build_array(
      jsonb_build_object('metric','do','boot_id',boot,'sequence',102))
    or private.backend_sync_utc(result->'server_time',true) is distinct from true
    or current_setting('TimeZone') is distinct from 'Asia/Kuala_Lumpur' then
    raise exception 'T08_AGGREGATE_NON_UTC_REPLAY_OR_CALLER_TIMEZONE_CHANGED';
  end if;
end $$;
set constraints all immediate;
rollback;
\echo T08_AGGREGATE_ROLLBACK_RETRY_REPLAY_AND_BACKLOG_OK
