-- Rollback-only D3 acceptance for an isolated development database after ART-31.
-- Run the complete file in a privileged Supabase SQL Editor session; it rolls back.
begin;
set constraints all deferred;

do $$
begin
  if has_function_privilege('anon', 'public.art31_create_manual_feed(uuid,uuid,uuid,uuid,jsonb,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.art31_create_manual_feed(uuid,uuid,uuid,uuid,jsonb,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.art31_sync_manual_feed(uuid,text,integer,jsonb,text,uuid,text,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.art31_sync_manual_feed(uuid,text,integer,jsonb,text,uuid,text,integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.art31_create_manual_feed(uuid,uuid,uuid,uuid,jsonb,integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.art31_sync_manual_feed(uuid,text,integer,jsonb,text,uuid,text,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.art31_read_manual_command(uuid,uuid,uuid,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.art31_read_manual_command(uuid,uuid,uuid,boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.art31_read_manual_command(uuid,uuid,uuid,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.art31_history_page(uuid,uuid,date,date,text,text,timestamptz,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.art31_history_page(uuid,uuid,date,date,text,text,timestamptz,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.art31_history_page(uuid,uuid,date,date,text,text,timestamptz,uuid)', 'EXECUTE') then
    raise exception 'a client role can execute an ART-31 service-only RPC';
  end if;
end $$;

do $$
begin
  if exists (select 1 from auth.users where id in (
      '41414141-4141-4414-8414-414141414141',
      '42424242-4242-4424-8424-424242424242'
    ) and email not in ('art31-installation@invalid.example', 'art31-other@invalid.example')) then
    raise exception 'ART-31 test installation UUID is already owned by a different auth user';
  end if;
end $$;
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,is_anonymous)
values
  ('00000000-0000-0000-0000-000000000000','41414141-4141-4414-8414-414141414141',
   'authenticated','authenticated','art31-installation@invalid.example','',pg_catalog.clock_timestamp(),
   '{"provider":"email","providers":["email"]}','{}',true),
  ('00000000-0000-0000-0000-000000000000','42424242-4242-4424-8424-424242424242',
   'authenticated','authenticated','art31-other@invalid.example','',pg_catalog.clock_timestamp(),
   '{"provider":"email","providers":["email"]}','{}',true)
on conflict (id) do nothing;

-- Keep fixture cleanup in the privileged SQL Editor role; service_role must not
-- receive DELETE privileges on the durable execution journal or reservations.
do $$
declare
  v_device constant uuid := '22222222-2222-4222-8222-222222222222';
  v_stale_device constant uuid := '33333333-3333-4333-8333-333333333333';
begin
  if exists (select 1 from public.devices where device_id in (v_device,v_stale_device) and not is_simulated) then
    raise exception 'an ART-31 simulator fixture ID belongs to a real device';
  end if;
  delete from public.device_execution_reservations where device_id in (v_device,v_stale_device);
  delete from public.device_events where device_id in (v_device,v_stale_device);
  delete from public.scheduled_occurrences where device_id in (v_device,v_stale_device);
  delete from public.feed_steps where device_id in (v_device,v_stale_device);
  delete from public.feed_sequence_targets where device_id in (v_device,v_stale_device);
  delete from public.device_access where device_id in (v_device,v_stale_device);
  update public.device_state set safety_lockout=false, lockout_sequence_id=null,
    contact_freshness='unknown', last_authenticated_contact_at=null,
    sample_freshness='unknown', last_sample_at=null, sample_quality='unavailable'
    where device_id in (v_device,v_stale_device);
  delete from public.feed_sequences where device_id in (v_device,v_stale_device);
  delete from public.device_config_schedule_slots where device_id in (v_device,v_stale_device);
  delete from public.device_config_schedules where device_id in (v_device,v_stale_device);
  update public.devices set desired_revision=null, applied_revision=null
    where device_id in (v_device,v_stale_device);
  delete from public.device_config_revisions where device_id in (v_device,v_stale_device);
end $$;

do $$
declare
  v_device constant uuid := '22222222-2222-4222-8222-222222222222';
  v_stale_device constant uuid := '33333333-3333-4333-8333-333333333333';
  v_installation constant uuid := '41414141-4141-4414-8414-414141414141';
  v_other_installation constant uuid := '42424242-4242-4424-8424-424242424242';
  v_credential constant text := repeat('a', 64);
  v_sequence uuid;
  v_flow_sequence uuid;
  v_restart_sequence uuid;
  v_time_sequence uuid;
  v_order_sequence uuid;
  v_baseline timestamptz;
  v_key constant uuid := '61616161-6161-4616-8616-616161616161';
  v_request constant uuid := '71717171-7171-4717-8717-717171717171';
  v_targets constant jsonb := '[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":25}},{"nozzle_number":2,"dose":{"mode":"grams","amount_g":40}}]'::jsonb;
  v_status jsonb;
  v_command jsonb;
  v_events jsonb;
  v_page jsonb;
  v_page2 jsonb;
  v_unknown jsonb;
  v_event jsonb;
  v_cursor jsonb;
  v_id uuid;
  v_from date;
  v_to date;
  v_index integer;
  v_overlap integer;
  v_conflict_rejected boolean := false;
  v_order_rejected boolean := false;
  v_regression_rejected boolean := false;
begin
  v_status := public.art38_provision_simulated_device(v_device, v_credential, true);
  if v_status->>'status' not in ('provisioned','already_provisioned') then raise exception 'manual-feed simulator fixture was not provisioned'; end if;
  insert into public.device_access(device_id, installation_id, status, revoked_at)
    values (v_device, v_installation, 'active', null)
    on conflict (device_id,installation_id) do update set status='active',revoked_at=null;
  update public.device_state set last_authenticated_contact_at=pg_catalog.clock_timestamp(),
    contact_freshness='fresh', updated_at=pg_catalog.clock_timestamp() where device_id=v_device;

  v_status := public.art38_provision_simulated_device(v_stale_device, repeat('b', 64), true);
  if v_status->>'status' not in ('provisioned','already_provisioned') then raise exception 'ordered Both event fixture was not provisioned'; end if;
  insert into public.device_access(device_id, installation_id, status, revoked_at)
    values (v_stale_device, v_installation, 'active', null)
    on conflict (device_id,installation_id) do update set status='active',revoked_at=null;
  update public.device_state set last_authenticated_contact_at=pg_catalog.clock_timestamp(),
    contact_freshness='fresh', updated_at=pg_catalog.clock_timestamp() where device_id=v_stale_device;

  v_status := public.art31_create_manual_feed(v_device, v_installation, v_request, v_key, v_targets, 1);
  if v_status->>'status' <> 'created' then raise exception 'Both request was not admitted'; end if;
  v_sequence := (v_status#>>'{command,sequence_id}')::uuid;
  if v_status#>>'{command,targets,0,nozzle_number}' <> '1'
     or v_status#>>'{command,targets,1,nozzle_number}' <> '2' then
    raise exception 'Both targets were not stored in nozzle order';
  end if;
  v_status := public.art31_create_manual_feed(v_device, v_installation, v_request, v_key, v_targets, 1);
  if v_status->>'status' <> 'existing' then raise exception 'same-key retry did not return its original command'; end if;
  v_status := public.art31_create_manual_feed(v_device, v_installation, v_request, v_key,
    '[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":26}},{"nozzle_number":2,"dose":{"mode":"grams","amount_g":40}}]'::jsonb, 1);
  if v_status->>'status' <> 'idempotency_conflict' then raise exception 'changed dose reused an idempotency key'; end if;
  v_status := public.art31_create_manual_feed(v_device, v_installation,
    '72727272-7272-4727-8727-727272727272', '62626262-6262-4626-8626-626262626262', v_targets, 1);
  if v_status->>'status' <> 'device_busy' then raise exception 'a second sequence interleaved with the reserved Both command'; end if;
  v_status := public.art31_read_manual_command(v_device, v_other_installation, v_sequence, false);
  if v_status->>'status' <> 'not_active' then raise exception 'another installation read a protected command'; end if;

  v_event := jsonb_build_array(jsonb_build_object(
    'sequence_id',v_sequence,'event_sequence',2,'event_type','accepted','outcome_status','accepted',
    'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','synced',
    'command_id',v_sequence,'schedule_id',null,'configuration_revision',null,
    'occurrence_local_date',null,'requested_dose','{"mode":"grams","amount_g":25}'::jsonb,
    'estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable',
    'reason_code',null,'maintenance_resolution',null,'lockout_cleared',false,
    'nozzle_number',1,'step_index',1));
  begin
    perform public.art31_sync_manual_feed(v_device, v_credential, 1, v_event, 'idle', null, 'synced', 0);
  exception when invalid_parameter_value then
    v_order_rejected := true;
  end;
  if not v_order_rejected then raise exception 'out-of-order device event sequence was accepted'; end if;

  -- Both is admitted, accepted for both nozzles, then run and settle in order under one reservation.
  v_status := public.art31_create_manual_feed(v_stale_device, v_installation,
    '75757575-7575-4757-8757-757575757575', '65656565-6565-4656-8656-656565656565', v_targets, 1);
  if v_status->>'status' <> 'created' then raise exception 'ordered Both sequence was not admitted'; end if;
  v_flow_sequence := (v_status#>>'{command,sequence_id}')::uuid;
  select jsonb_agg(jsonb_build_object(
      'sequence_id', v_flow_sequence,
      'event_sequence', e.event_sequence,
      'event_type', e.event_type,
      'outcome_status', e.event_type,
      'source', 'manual',
      'device_at', pg_catalog.clock_timestamp()::text,
      'time_quality', 'synced',
      'command_id', v_flow_sequence,
      'schedule_id', null,
      'configuration_revision', null,
      'occurrence_local_date', null,
      'requested_dose', e.dose,
      'estimated_dispensed_g', null,
      'measured_dispensed_g', e.measured,
      'measurement_quality', e.quality,
      'reason_code', null,
      'maintenance_resolution', null,
      'lockout_cleared', false,
      'nozzle_number', e.nozzle_number,
      'step_index', e.step_index
    ) order by e.event_sequence)
    into v_events
    from (values
      (1, 'accepted', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, null::numeric, 'unavailable'),
      (2, 'accepted', 2, 2, '{"mode":"grams","amount_g":40}'::jsonb, null::numeric, 'unavailable'),
      (3, 'running', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, null::numeric, 'unavailable'),
      (4, 'completed', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, 24.5::numeric, 'valid'),
      (5, 'running', 2, 2, '{"mode":"grams","amount_g":40}'::jsonb, null::numeric, 'unavailable'),
      (6, 'completed', 2, 2, '{"mode":"grams","amount_g":40}'::jsonb, 39::numeric, 'valid')
    ) as e(event_sequence, event_type, step_index, nozzle_number, dose, measured, quality);
  v_status := public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_events, 'idle', null, 'synced', 0);
  if v_status->>'status' <> 'ok' or jsonb_array_length(v_status->'acknowledged_events') <> 6
     or (select status from public.feed_sequences where device_id=v_stale_device and sequence_id=v_flow_sequence) <> 'completed'
     or (select count(*) from public.feed_steps where device_id=v_stale_device and sequence_id=v_flow_sequence and status='completed') <> 2
     or (select phase from public.device_execution_reservations where device_id=v_stale_device and sequence_id=v_flow_sequence) <> 'released' then
    raise exception 'ordered Both delivery did not complete and release its device reservation';
  end if;

  -- A failed first nozzle must stop a second nozzle that was accepted but never started.
  v_status := public.art31_create_manual_feed(v_stale_device, v_installation,
    '80808080-8080-4080-8080-808080808080', '81818181-8181-4181-8181-818181818181', v_targets, 1);
  if v_status->>'status' <> 'created' then raise exception 'failed-stop Both sequence was not admitted'; end if;
  v_flow_sequence := (v_status#>>'{command,sequence_id}')::uuid;
  select jsonb_agg(jsonb_build_object(
      'sequence_id', v_flow_sequence,
      'event_sequence', e.event_sequence,
      'event_type', e.event_type,
      'outcome_status', e.event_type,
      'source', 'manual',
      'device_at', pg_catalog.clock_timestamp()::text,
      'time_quality', e.time_quality,
      'command_id', v_flow_sequence,
      'schedule_id', null,
      'configuration_revision', null,
      'occurrence_local_date', null,
      'requested_dose', e.dose,
      'estimated_dispensed_g', null,
      'measured_dispensed_g', null,
      'measurement_quality', 'unavailable',
      'reason_code', e.reason_code,
      'maintenance_resolution', null,
      'lockout_cleared', false,
      'nozzle_number', e.nozzle_number,
      'step_index', e.step_index
    ) order by e.event_sequence)
    into v_events
    from (values
      (1, 'accepted', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, 'synced', null::text),
      (2, 'accepted', 2, 2, '{"mode":"grams","amount_g":40}'::jsonb, 'synced', null::text),
      (3, 'running', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, 'synced', null::text),
      (4, 'failed', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, 'synced', 'SIMULATOR_FAULT'),
      (5, 'not_started', 2, 2, '{"mode":"grams","amount_g":40}'::jsonb, 'synced', 'SIMULATOR_SEQUENCE_STOPPED')
    ) as e(event_sequence, event_type, step_index, nozzle_number, dose, time_quality, reason_code);
  v_status := public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_events, 'fault', null, 'synced', 0);
  if v_status->>'status' <> 'ok' or jsonb_array_length(v_status->'acknowledged_events') <> 5
     or (select count(*) from public.device_events where device_id=v_stale_device and sequence_id=v_flow_sequence) <> 5
     or (select status from public.feed_sequences where device_id=v_stale_device and sequence_id=v_flow_sequence) <> 'failed'
     or (select unresolved from public.feed_sequences where device_id=v_stale_device and sequence_id=v_flow_sequence)
     or (select safety_lockout from public.feed_sequences where device_id=v_stale_device and sequence_id=v_flow_sequence)
     or (select status from public.feed_steps where device_id=v_stale_device and sequence_id=v_flow_sequence and step_index=1) <> 'failed'
     or (select status from public.feed_steps where device_id=v_stale_device and sequence_id=v_flow_sequence and step_index=2) <> 'not_started'
     or exists (select 1 from public.feed_steps where device_id=v_stale_device and sequence_id=v_flow_sequence
       and (estimated_dispensed_g is not null or measured_dispensed_g is not null or measurement_quality <> 'unavailable'))
     or (select phase from public.device_execution_reservations where device_id=v_stale_device and sequence_id=v_flow_sequence) <> 'released'
     or (select safety_lockout or lockout_sequence_id is not null from public.device_state where device_id=v_stale_device) then
    raise exception 'failed nozzle 1 did not settle accepted nozzle 2 as not_started and release safely';
  end if;
  v_event := jsonb_build_array(v_events->4);
  v_status := public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_event, 'fault', null, 'synced', 0);
  if v_status->>'status' <> 'ok' or jsonb_array_length(v_status->'acknowledged_events') <> 1
     or (select count(*) from public.device_events where device_id=v_stale_device and sequence_id=v_flow_sequence) <> 5
     or (select status from public.feed_sequences where device_id=v_stale_device and sequence_id=v_flow_sequence) <> 'failed'
     or (select status from public.feed_steps where device_id=v_stale_device and sequence_id=v_flow_sequence and step_index=1) <> 'failed'
     or (select status from public.feed_steps where device_id=v_stale_device and sequence_id=v_flow_sequence and step_index=2) <> 'not_started'
     or (select phase from public.device_execution_reservations where device_id=v_stale_device and sequence_id=v_flow_sequence) <> 'released' then
    raise exception 'duplicate not_started replay rewrote failed-stop outcomes';
  end if;

  -- Simulate a delivered operation whose outbox response was lost. Read-side reconciliation
  -- must settle the durable command as unknown before its old journal is delivered.
  update public.feed_sequences set status='running', delivered_at=pg_catalog.clock_timestamp()-interval '30 minutes',
    start_before=pg_catalog.clock_timestamp()-interval '29 minutes', status_sequence=status_sequence+1
    where device_id=v_device and sequence_id=v_sequence;
  update public.feed_steps set status='running', started_at=pg_catalog.clock_timestamp()-interval '30 minutes'
    where device_id=v_device and sequence_id=v_sequence and step_index=1;
  v_status := public.art31_read_manual_command(v_device, v_installation, v_sequence, false);
  v_command := v_status->'command';
  if v_status->>'status' <> 'found' or v_command->>'status' <> 'unknown'
     or v_command->>'safety_lockout' <> 'true'
     or not exists (select 1 from public.device_execution_reservations where device_id=v_device and sequence_id=v_sequence and phase in ('active','settling')) then
    raise exception 'timed-out delivery did not retain an unknown result and device reservation';
  end if;
  if v_command#>>'{nozzle_results,0,status}' <> 'unknown'
     or v_command#>>'{nozzle_results,1,status}' <> 'not_started'
     or v_command#>'{nozzle_results,0,measured_dispensed_g}' is distinct from 'null'::jsonb then
    raise exception 'timeout outcomes or null measurements were not preserved';
  end if;

  select jsonb_agg(jsonb_build_object(
      'sequence_id', v_sequence,
      'event_sequence', e.event_sequence,
      'event_type', e.event_type,
      'outcome_status', e.event_type,
      'source', 'manual',
      'device_at', pg_catalog.clock_timestamp()::text,
      'time_quality', 'synced',
      'command_id', v_sequence,
      'schedule_id', null,
      'configuration_revision', null,
      'occurrence_local_date', null,
      'requested_dose', e.dose,
      'estimated_dispensed_g', null,
      'measured_dispensed_g', e.measured,
      'measurement_quality', e.quality,
      'reason_code', null,
      'maintenance_resolution', null,
      'lockout_cleared', false,
      'nozzle_number', e.nozzle_number,
      'step_index', e.step_index
    ) order by e.event_sequence)
    into v_events
    from (values
      (1, 'accepted', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, null::numeric, 'unavailable'),
      (2, 'running', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, null::numeric, 'unavailable'),
      (3, 'completed', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, 24.5::numeric, 'valid'),
      (4, 'accepted', 2, 2, '{"mode":"grams","amount_g":40}'::jsonb, null::numeric, 'unavailable'),
      (5, 'running', 2, 2, '{"mode":"grams","amount_g":40}'::jsonb, null::numeric, 'unavailable'),
      (6, 'completed', 2, 2, '{"mode":"grams","amount_g":40}'::jsonb, 39::numeric, 'valid')
    ) as e(event_sequence, event_type, step_index, nozzle_number, dose, measured, quality);

  v_status := public.art31_sync_manual_feed(v_device, v_credential, 1, v_events, 'idle', null, 'synced', 0);
  if v_status->>'status' <> 'ok' or jsonb_array_length(v_status->'acknowledged_events') <> 6 then
    raise exception 'late device outbox was not acknowledged after timeout reconciliation';
  end if;
  if (select status from public.feed_sequences where device_id=v_device and sequence_id=v_sequence) <> 'unknown'
     or not (select safety_lockout from public.feed_sequences where device_id=v_device and sequence_id=v_sequence)
     or not exists (select 1 from public.device_execution_reservations where device_id=v_device and sequence_id=v_sequence and phase in ('active','settling'))
     or (select status from public.feed_steps where device_id=v_device and sequence_id=v_sequence and step_index=1) <> 'unknown'
     or (select status from public.feed_steps where device_id=v_device and sequence_id=v_sequence and step_index=2) <> 'not_started' then
    raise exception 'late journal events rewrote the unknown outcome or released its reservation';
  end if;

  v_event := jsonb_build_array(v_events->0);
  v_status := public.art31_sync_manual_feed(v_device, v_credential, 1, v_event, 'idle', null, 'synced', 0);
  if v_status->>'status' <> 'ok' or jsonb_array_length(v_status->'acknowledged_events') <> 1 then
    raise exception 'identical repeated event was not safely acknowledged';
  end if;
  v_event := jsonb_set(v_event, '{0,reason_code}', '"tampered"'::jsonb);
  begin
    perform public.art31_sync_manual_feed(v_device, v_credential, 1, v_event, 'idle', null, 'synced', 0);
  exception when unique_violation then
    v_conflict_rejected := true;
  end;
  if not v_conflict_rejected then raise exception 'reused event identity with changed payload was accepted'; end if;

  update private.device_credentials set revoked_at=pg_catalog.clock_timestamp() where device_id=v_device;
  v_status := public.art31_sync_manual_feed(v_device, v_credential, 1, jsonb_build_array(v_events->0), 'idle', null, 'synced', 0);
  if v_status->>'status' <> 'auth_required'
     or (select count(*) from public.device_events where device_id=v_device and sequence_id=v_sequence) <> 6 then
    raise exception 'revoked verifier wrote a device event';
  end if;

  update public.device_state set contact_freshness='fresh',
    last_authenticated_contact_at=pg_catalog.clock_timestamp()-interval '2 minutes'
    where device_id=v_stale_device;
  v_status := public.art31_create_manual_feed(v_stale_device, v_installation,
    '73737373-7373-4737-8737-737373737373', '63636363-6363-4636-8636-636363636363',
    '[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":25}}]'::jsonb, 1);
  if v_status->>'status' <> 'device_offline' then raise exception 'stale authenticated contact admitted a feed'; end if;

  -- An ACKed accepted event followed by restart must safely settle as not_started;
  -- the server must allow accepted -> not_started without authorizing another actuation.
  update public.device_state set contact_freshness='fresh',
    last_authenticated_contact_at=pg_catalog.clock_timestamp(), updated_at=pg_catalog.clock_timestamp()
    where device_id=v_stale_device;
  v_status := public.art31_create_manual_feed(v_stale_device, v_installation,
    '74747474-7474-4747-8747-747474747474', '64646464-6464-4646-8646-646464646464',
    '[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":25}}]'::jsonb, 1);
  if v_status->>'status' <> 'created' then raise exception 'restart-before-actuation fixture was not admitted'; end if;
  v_restart_sequence := (v_status#>>'{command,sequence_id}')::uuid;
  v_event := jsonb_build_array(jsonb_build_object(
    'sequence_id',v_restart_sequence,'event_sequence',1,'event_type','accepted','outcome_status','accepted',
    'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','synced',
    'command_id',v_restart_sequence,'schedule_id',null,'configuration_revision',null,
    'occurrence_local_date',null,'requested_dose','{"mode":"grams","amount_g":25}'::jsonb,
    'estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable',
    'reason_code',null,'maintenance_resolution',null,'lockout_cleared',false,
    'nozzle_number',1,'step_index',1));
  v_status := public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_event, 'idle', null, 'synced', 0);
  if v_status->>'status' <> 'ok' or jsonb_array_length(v_status->'acknowledged_events') <> 1 then
    raise exception 'accepted event was not acknowledged before restart';
  end if;
  v_event := jsonb_build_array(jsonb_build_object(
    'sequence_id',v_restart_sequence,'event_sequence',2,'event_type','not_started','outcome_status','not_started',
    'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','uncertain',
    'command_id',v_restart_sequence,'schedule_id',null,'configuration_revision',null,
    'occurrence_local_date',null,'requested_dose','{"mode":"grams","amount_g":25}'::jsonb,
    'estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable',
    'reason_code','SIMULATOR_RESTART_BEFORE_ACTUATION','maintenance_resolution',null,
    'lockout_cleared',false,'nozzle_number',1,'step_index',1));
  v_status := public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_event, 'idle', null, 'uncertain', 200);
  if v_status->>'status' <> 'ok' or jsonb_array_length(v_status->'acknowledged_events') <> 1
     or (select status from public.feed_steps where device_id=v_stale_device and sequence_id=v_restart_sequence and step_index=1) <> 'not_started'
     or (select status from public.feed_sequences where device_id=v_stale_device and sequence_id=v_restart_sequence) <> 'expired'
     or (select phase from public.device_execution_reservations where device_id=v_stale_device and sequence_id=v_restart_sequence) <> 'released' then
    raise exception 'accepted-before-actuation restart was not safely settled';
  end if;

  v_status := public.art31_history_page(v_device, v_installation, null, null, 'all', 'all', null, null);
  if v_status->>'status' <> 'ok'
     or (v_status->>'to_date')::date - (v_status->>'from_date')::date <> 6
     or (v_status->>'timezone_known')::boolean then
    raise exception 'default history dates or unknown-timezone behavior changed';
  end if;

  v_from := (pg_catalog.clock_timestamp() at time zone 'UTC')::date - 6;
  v_to := (pg_catalog.clock_timestamp() at time zone 'UTC')::date;
  for v_index in 1..51 loop
    v_id := ('70000000-0000-4000-8000-' || lpad(to_hex(v_index), 12, '0'))::uuid;
    insert into public.feed_sequences(device_id,sequence_id,source,installation_id,idempotency_key,request_id,
      target_count,capabilities_revision,status,status_sequence,unresolved,safety_lockout,created_at)
      values (v_device,v_id,'manual',v_installation,
        ('71000000-0000-4000-8000-' || lpad(to_hex(v_index), 12, '0'))::uuid,
        ('72000000-0000-4000-8000-' || lpad(to_hex(v_index), 12, '0'))::uuid,
        1,1,'completed',2,false,false,pg_catalog.clock_timestamp()-interval '1 day'+v_index*interval '1 second');
    insert into public.feed_sequence_targets(device_id,sequence_id,step_index,nozzle_number,requested_dose,first_step_index,first_nozzle_number)
      values (v_device,v_id,1,1,'{"mode":"grams","amount_g":25}',1,1);
    insert into public.feed_steps(device_id,sequence_id,step_index,nozzle_number,requested_dose,status,
      measured_dispensed_g,measurement_quality,started_at,stopped_at)
      values (v_device,v_id,1,1,'{"mode":"grams","amount_g":25}','completed',24.5,'valid',
        pg_catalog.clock_timestamp()-interval '1 day'+v_index*interval '1 second',
        pg_catalog.clock_timestamp()-interval '1 day'+v_index*interval '1 second'+interval '1 second');
  end loop;

  v_page := public.art31_history_page(v_device, v_installation, v_from, v_to, 'manual', 'all', null, null);
  if v_page->>'status' <> 'ok' or (v_page->>'total')::integer <> 52
     or (v_page->>'completed_total')::integer <> 51 or (v_page->>'needs_attention_total')::integer <> 1
     or jsonb_array_length(v_page->'records') <> 50 or v_page->>'has_more' <> 'true' then
    raise exception 'history cursor page size or exact filtered totals changed';
  end if;
  v_cursor := v_page->'next';
  v_page2 := public.art31_history_page(v_device, v_installation, v_from, v_to, 'manual', 'all',
    (v_cursor->>'created_at')::timestamptz, (v_cursor->>'sequence_id')::uuid);
  if (v_page2->>'total')::integer <> 52 or jsonb_array_length(v_page2->'records') <> 2
     or v_page2->>'has_more' <> 'false' then raise exception 'cursor page lost rows or changed its filtered total'; end if;
  select count(*) into v_overlap from jsonb_array_elements(v_page2->'records') as p2(value)
    where exists (select 1 from jsonb_array_elements(v_page->'records') as p1(value)
      where p1.value->>'sequence_id'=p2.value->>'sequence_id');
  if v_overlap <> 0 then raise exception 'history cursor repeated a record across pages'; end if;

  v_unknown := public.art31_history_page(v_device, v_installation, v_from, v_to, 'manual', 'unknown', null, null);
  if (v_unknown->>'total')::integer <> 1 or jsonb_array_length(v_unknown->'records') <> 1
     or v_unknown#>'{records,0,nozzle_results,0,measured_dispensed_g}' is distinct from 'null'::jsonb then
    raise exception 'unknown status filter or null measurement history changed';
  end if;

  -- A queued event cannot regress a running leg. A subsequent uncertain-time completion
  -- inside a synced envelope cannot authorize nozzle 2 or fabricate a settling baseline.
  v_status := public.art31_create_manual_feed(v_stale_device, v_installation,
    '78787878-7878-4787-8787-787878787878', '68686868-6868-4686-8686-686868686868', v_targets, 1);
  if v_status->>'status' <> 'created' then raise exception 'event-quality fixture was not admitted'; end if;
  v_time_sequence := (v_status#>>'{command,sequence_id}')::uuid;
  v_event := jsonb_build_array(jsonb_build_object(
    'sequence_id',v_time_sequence,'event_sequence',1,'event_type','accepted','outcome_status','accepted',
    'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','synced',
    'command_id',v_time_sequence,'schedule_id',null,'configuration_revision',null,
    'occurrence_local_date',null,'requested_dose','{"mode":"grams","amount_g":25}'::jsonb,
    'estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable',
    'reason_code',null,'maintenance_resolution',null,'lockout_cleared',false,'nozzle_number',1,'step_index',1));
  perform public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_event, 'idle', null, 'synced', 0);
  v_event := jsonb_build_array(jsonb_build_object(
    'sequence_id',v_time_sequence,'event_sequence',2,'event_type','running','outcome_status','running',
    'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','synced',
    'command_id',v_time_sequence,'schedule_id',null,'configuration_revision',null,
    'occurrence_local_date',null,'requested_dose','{"mode":"grams","amount_g":25}'::jsonb,
    'estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable',
    'reason_code',null,'maintenance_resolution',null,'lockout_cleared',false,'nozzle_number',1,'step_index',1));
  perform public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_event, 'feeding', v_time_sequence, 'synced', 0);
  v_event := jsonb_build_array(jsonb_build_object(
    'sequence_id',v_time_sequence,'event_sequence',3,'event_type','queued','outcome_status','queued',
    'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','synced',
    'command_id',v_time_sequence,'schedule_id',null,'configuration_revision',null,
    'occurrence_local_date',null,'requested_dose','{"mode":"grams","amount_g":25}'::jsonb,
    'estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable',
    'reason_code',null,'maintenance_resolution',null,'lockout_cleared',false,'nozzle_number',1,'step_index',1));
  begin
    perform public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_event, 'feeding', v_time_sequence, 'synced', 0);
  exception when unique_violation then
    v_regression_rejected := true;
  end;
  if not v_regression_rejected
     or (select status from public.feed_steps where device_id=v_stale_device and sequence_id=v_time_sequence and step_index=1) <> 'running'
     or (select count(*) from public.device_events where device_id=v_stale_device and sequence_id=v_time_sequence) <> 2 then
    raise exception 'a queued event regressed the running nozzle outcome';
  end if;
  v_event := jsonb_build_array(jsonb_build_object(
    'sequence_id',v_time_sequence,'event_sequence',3,'event_type','completed','outcome_status','completed',
    'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','uncertain',
    'command_id',v_time_sequence,'schedule_id',null,'configuration_revision',null,
    'occurrence_local_date',null,'requested_dose','{"mode":"grams","amount_g":25}'::jsonb,
    'estimated_dispensed_g',null,'measured_dispensed_g',24.5,'measurement_quality','valid',
    'reason_code',null,'maintenance_resolution',null,'lockout_cleared',false,'nozzle_number',1,'step_index',1));
  v_status := public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_event, 'idle', null, 'synced', 0);
  if v_status->>'status' <> 'ok'
     or (select baseline_ready_at from public.feed_steps where device_id=v_stale_device and sequence_id=v_time_sequence and step_index=1) is not null
     or (select status from public.feed_steps where device_id=v_stale_device and sequence_id=v_time_sequence and step_index=2) <> 'not_started'
     or (select status from public.feed_sequences where device_id=v_stale_device and sequence_id=v_time_sequence) <> 'partial' then
    raise exception 'uncertain journal time in a synced envelope authorized nozzle 2';
  end if;

  -- Keep this uncertain-stop lockout scenario isolated so the chronology case can reuse the fixture.
  begin
    v_status := public.art31_create_manual_feed(v_stale_device, v_installation,
      '82828282-8282-4282-8282-828282828282', '83838383-8383-4383-8383-838383838383', v_targets, 1);
    if v_status->>'status' <> 'created' then raise exception 'uncertain-stop Both sequence was not admitted'; end if;
    v_flow_sequence := (v_status#>>'{command,sequence_id}')::uuid;
    select jsonb_agg(jsonb_build_object(
        'sequence_id', v_flow_sequence,
        'event_sequence', e.event_sequence,
        'event_type', e.event_type,
        'outcome_status', e.event_type,
        'source', 'manual',
        'device_at', pg_catalog.clock_timestamp()::text,
        'time_quality', 'uncertain',
        'command_id', v_flow_sequence,
        'schedule_id', null,
        'configuration_revision', null,
        'occurrence_local_date', null,
        'requested_dose', e.dose,
        'estimated_dispensed_g', null,
        'measured_dispensed_g', null,
        'measurement_quality', 'unavailable',
        'reason_code', e.reason_code,
        'maintenance_resolution', null,
        'lockout_cleared', false,
        'nozzle_number', e.nozzle_number,
        'step_index', e.step_index
      ) order by e.event_sequence)
      into v_events
      from (values
        (1, 'accepted', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, null::text),
        (2, 'accepted', 2, 2, '{"mode":"grams","amount_g":40}'::jsonb, null::text),
        (3, 'running', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, null::text),
        (4, 'unknown', 1, 1, '{"mode":"grams","amount_g":25}'::jsonb, 'SIMULATOR_STOP_UNCERTAIN'),
        (5, 'not_started', 2, 2, '{"mode":"grams","amount_g":40}'::jsonb, 'SIMULATOR_SEQUENCE_STOPPED')
      ) as e(event_sequence, event_type, step_index, nozzle_number, dose, reason_code);
    v_status := public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_events, 'unknown', null, 'uncertain', 200);
    if v_status->>'status' <> 'ok' or jsonb_array_length(v_status->'acknowledged_events') <> 5
       or (select count(*) from public.device_events where device_id=v_stale_device and sequence_id=v_flow_sequence) <> 5
       or (select status from public.feed_sequences where device_id=v_stale_device and sequence_id=v_flow_sequence) <> 'unknown'
       or not (select unresolved and safety_lockout from public.feed_sequences where device_id=v_stale_device and sequence_id=v_flow_sequence)
       or (select status from public.feed_steps where device_id=v_stale_device and sequence_id=v_flow_sequence and step_index=1) <> 'unknown'
       or (select status from public.feed_steps where device_id=v_stale_device and sequence_id=v_flow_sequence and step_index=2) <> 'not_started'
       or exists (select 1 from public.feed_steps where device_id=v_stale_device and sequence_id=v_flow_sequence
         and (estimated_dispensed_g is not null or measured_dispensed_g is not null or measurement_quality <> 'unavailable'))
       or not exists (select 1 from public.device_execution_reservations where device_id=v_stale_device
         and sequence_id=v_flow_sequence and phase in ('active', 'settling'))
       or not exists (select 1 from public.device_state where device_id=v_stale_device
         and safety_lockout and lockout_sequence_id=v_flow_sequence) then
      raise exception 'uncertain first-nozzle stop did not retain truthful unknown state and reservation';
    end if;
    v_page := public.art31_history_page(v_stale_device, v_installation, null, null, 'manual', 'unknown', null, null);
    if v_page->>'status' <> 'ok' or (v_page->>'total')::integer <> 1
       or jsonb_array_length(v_page->'records') <> 1
       or v_page#>>'{records,0,sequence_id}' <> v_flow_sequence::text
       or v_page#>>'{records,0,nozzle_results,0,status}' <> 'unknown'
       or v_page#>>'{records,0,nozzle_results,1,status}' <> 'not_started'
       or v_page#>'{records,0,nozzle_results,0,measured_dispensed_g}' is distinct from 'null'::jsonb
       or v_page#>'{records,0,nozzle_results,1,measured_dispensed_g}' is distinct from 'null'::jsonb then
      raise exception 'uncertain stop history did not preserve unknown and not_started outcomes';
    end if;
    raise exception 'rollback ART-31 uncertain stop fixture';
  exception when raise_exception then
    if sqlerrm <> 'rollback ART-31 uncertain stop fixture' then raise; end if;
  end;
  if exists (select 1 from public.feed_sequences where device_id=v_stale_device and sequence_id=v_flow_sequence) then
    raise exception 'uncertain-stop fixture escaped its rollback-only subtransaction';
  end if;

  -- Nozzle 2 must not start with a timestamp before the settled nozzle 1 baseline.
  v_status := public.art31_create_manual_feed(v_stale_device, v_installation,
    '79797979-7979-4797-8797-797979797979', '69696969-6969-4696-8696-696969696969', v_targets, 1);
  if v_status->>'status' <> 'created' then raise exception 'chronology fixture was not admitted'; end if;
  v_order_sequence := (v_status#>>'{command,sequence_id}')::uuid;
  v_events := jsonb_build_array(
    jsonb_build_object('sequence_id',v_order_sequence,'event_sequence',1,'event_type','accepted','outcome_status','accepted',
      'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','synced','command_id',v_order_sequence,
      'schedule_id',null,'configuration_revision',null,'occurrence_local_date',null,
      'requested_dose','{"mode":"grams","amount_g":25}'::jsonb,'estimated_dispensed_g',null,
      'measured_dispensed_g',null,'measurement_quality','unavailable','reason_code',null,
      'maintenance_resolution',null,'lockout_cleared',false,'nozzle_number',1,'step_index',1),
    jsonb_build_object('sequence_id',v_order_sequence,'event_sequence',2,'event_type','accepted','outcome_status','accepted',
      'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','synced','command_id',v_order_sequence,
      'schedule_id',null,'configuration_revision',null,'occurrence_local_date',null,
      'requested_dose','{"mode":"grams","amount_g":40}'::jsonb,'estimated_dispensed_g',null,
      'measured_dispensed_g',null,'measurement_quality','unavailable','reason_code',null,
      'maintenance_resolution',null,'lockout_cleared',false,'nozzle_number',2,'step_index',2),
    jsonb_build_object('sequence_id',v_order_sequence,'event_sequence',3,'event_type','running','outcome_status','running',
      'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','synced','command_id',v_order_sequence,
      'schedule_id',null,'configuration_revision',null,'occurrence_local_date',null,
      'requested_dose','{"mode":"grams","amount_g":25}'::jsonb,'estimated_dispensed_g',null,
      'measured_dispensed_g',null,'measurement_quality','unavailable','reason_code',null,
      'maintenance_resolution',null,'lockout_cleared',false,'nozzle_number',1,'step_index',1),
    jsonb_build_object('sequence_id',v_order_sequence,'event_sequence',4,'event_type','completed','outcome_status','completed',
      'source','manual','device_at',pg_catalog.clock_timestamp()::text,'time_quality','synced','command_id',v_order_sequence,
      'schedule_id',null,'configuration_revision',null,'occurrence_local_date',null,
      'requested_dose','{"mode":"grams","amount_g":25}'::jsonb,'estimated_dispensed_g',null,
      'measured_dispensed_g',24.5,'measurement_quality','valid','reason_code',null,
      'maintenance_resolution',null,'lockout_cleared',false,'nozzle_number',1,'step_index',1));
  v_status := public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_events, 'feeding', v_order_sequence, 'synced', 0);
  if v_status->>'status' <> 'ok' then raise exception 'nozzle 1 did not establish a settled baseline'; end if;
  select baseline_ready_at into v_baseline from public.feed_steps
    where device_id=v_stale_device and sequence_id=v_order_sequence and step_index=1;
  v_event := jsonb_build_array(jsonb_build_object(
    'sequence_id',v_order_sequence,'event_sequence',5,'event_type','running','outcome_status','running',
    'source','manual','device_at',(v_baseline-interval '1 second')::text,'time_quality','synced',
    'command_id',v_order_sequence,'schedule_id',null,'configuration_revision',null,
    'occurrence_local_date',null,'requested_dose','{"mode":"grams","amount_g":40}'::jsonb,
    'estimated_dispensed_g',null,'measured_dispensed_g',null,'measurement_quality','unavailable',
    'reason_code',null,'maintenance_resolution',null,'lockout_cleared',false,'nozzle_number',2,'step_index',2));
  v_status := public.art31_sync_manual_feed(v_stale_device, repeat('b', 64), 1, v_event, 'feeding', v_order_sequence, 'synced', 0);
  if v_status->>'status' <> 'ok'
     or (select status from public.feed_steps where device_id=v_stale_device and sequence_id=v_order_sequence and step_index=2) <> 'unknown'
     or not (select safety_lockout from public.feed_sequences where device_id=v_stale_device and sequence_id=v_order_sequence)
     or not exists (select 1 from public.device_execution_reservations where device_id=v_stale_device and sequence_id=v_order_sequence and phase in ('active','settling')) then
    raise exception 'nozzle 2 event before the settled baseline did not lock the sequence as unknown';
  end if;
end $$;
set local role service_role;
do $$
declare
  v_device constant uuid := '22222222-2222-4222-8222-222222222222';
  v_stale_device constant uuid := '33333333-3333-4333-8333-333333333333';
  v_installation constant uuid := '41414141-4141-4414-8414-414141414141';
  v_other_installation constant uuid := '42424242-4242-4424-8424-424242424242';
  v_status jsonb;
begin
  v_status := public.art31_history_page(v_device, v_installation, null, null, 'all', 'all', null, null);
  if v_status->>'status' <> 'ok' then raise exception 'service_role cannot execute the history read RPC'; end if;
  v_status := public.art31_read_manual_command(v_stale_device, v_installation,
    '68686868-6868-4686-8686-686868686868', true);
  if v_status->>'status' <> 'found' then raise exception 'service_role cannot read the original manual command by key'; end if;
  v_status := public.art31_read_manual_command(v_stale_device, v_other_installation,
    '68686868-6868-4686-8686-686868686868', true);
  if v_status->>'status' <> 'not_active' then raise exception 'the service RPC exposed a command to another installation'; end if;
end $$;
reset role;
set constraints all immediate;
rollback;
