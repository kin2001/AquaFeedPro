\set ON_ERROR_STOP on
-- Run on the isolated, approved development database after ART-27 D5 is applied.
-- Fixed simulator fixtures 222/333 and all synthetic access/credential/data changes roll back.
begin;
set constraints all deferred;

do $$
begin
  if not has_function_privilege('service_role','public.art27_sync_telemetry(uuid,text,uuid,bigint,jsonb,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.art27_monitoring_snapshot(uuid,uuid,uuid)','EXECUTE')
    or not has_function_privilege('service_role','public.art27_do_graph(uuid,uuid,uuid,text,integer)','EXECUTE')
    or has_function_privilege('anon','public.art27_sync_telemetry(uuid,text,uuid,bigint,jsonb,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.art27_sync_telemetry(uuid,text,uuid,bigint,jsonb,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.art27_monitoring_snapshot(uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.art27_monitoring_snapshot(uuid,uuid,uuid)','EXECUTE')
    or has_function_privilege('anon','public.art27_do_graph(uuid,uuid,uuid,text,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.art27_do_graph(uuid,uuid,uuid,text,integer)','EXECUTE') then
    raise exception 'D5 RPCs must be service-only';
  end if;
  if has_table_privilege('service_role','public.device_telemetry','DELETE')
    or has_table_privilege('service_role','public.device_telemetry','TRUNCATE') then
    raise exception 'telemetry retention deletion must remain disabled';
  end if;
  if not exists(select 1 from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='device_telemetry')
    or not exists(select 1 from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='device_state')
    or not exists(select 1 from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='device_events')
    or not exists(select 1 from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='device_config_revisions')
    or exists(select 1 from pg_catalog.pg_publication_tables where schemaname='private') then
    raise exception 'Realtime must publish protected public state and exclude private credentials';
  end if;
end $$;

set local role service_role;
do $$
declare
  v_device constant uuid := '22222222-2222-4222-8222-222222222222';
  v_second_device constant uuid := '33333333-3333-4333-8333-333333333333';
  v_installation constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_second_installation constant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_boot constant uuid := '60000000-0000-4000-8000-000000000001';
  v_reboot constant uuid := '60000000-0000-4000-8000-000000000002';
  v_second_boot constant uuid := '60000000-0000-4000-8000-000000000003';
  v_request constant uuid := '70000000-0000-4000-8000-000000000001';
  v_credential constant text := repeat('a', 64);
  v_second_credential constant text := repeat('b', 64);
  v_wrong_credential constant text := repeat('f', 64);
  v_time timestamptz := pg_catalog.clock_timestamp();
  v_sample jsonb;
  v_latest jsonb;
  v_backlog jsonb;
  v_result jsonb;
  v_first_ack jsonb;
  v_snapshot_before jsonb;
  v_snapshot_after jsonb;
  v_graph jsonb;
  v_new_row jsonb;
  v_conflicting_row jsonb;
  v_bad_latest jsonb;
  v_rows_before bigint;
  v_contact_before timestamptz;
  i integer;
begin
  v_result := public.art38_provision_simulated_device(v_device, v_credential, true);
  if v_result->>'status' not in ('provisioned','already_provisioned') then
    raise exception 'first simulator fixture could not be prepared: %', v_result;
  end if;
  v_result := public.art38_provision_simulated_device(v_second_device, v_second_credential, true);
  if v_result->>'status' not in ('provisioned','already_provisioned') then
    raise exception 'second simulator fixture could not be prepared: %', v_result;
  end if;
  insert into public.device_access(device_id,installation_id,status,revoked_at)
  values
    (v_device,v_installation,'active',null),
    (v_second_device,v_second_installation,'active',null)
  on conflict (device_id,installation_id) do update
    set status='active',revoked_at=null;

  v_result := public.art27_sync_telemetry(v_device, v_wrong_credential, v_boot, 1,
    jsonb_build_object('sequence',1,'measured_at',v_time,'time_quality','rtc',
      'do_mg_l',5.8,'do_quality','valid','feed_remaining_g',500,'feed_percent',50,
      'feed_quality','valid','calibration_revision',2), '[]'::jsonb);
  if v_result->>'status' <> 'auth_required' then
    raise exception 'invalid machine credential reached telemetry writes';
  end if;

  v_sample := jsonb_build_object('sequence',1,'measured_at',v_time-interval '2 hours','time_quality','rtc',
    'do_mg_l',5.8,'do_quality','valid','feed_remaining_g',500,'feed_percent',50,
    'feed_quality','valid','calibration_revision',2);
  v_result := public.art27_sync_telemetry(v_device,v_credential,v_boot,1,v_sample,'[]'::jsonb);
  if v_result->>'status' <> 'ok' or jsonb_array_length(v_result->'acknowledged_samples') <> 1 then
    raise exception 'authenticated sample was not persisted and acknowledged';
  end if;
  v_first_ack := v_result->'acknowledged_samples';
  v_result := public.art27_sync_telemetry(v_device,v_credential,v_boot,1,v_sample,'[]'::jsonb);
  if v_result->>'status' <> 'ok' or v_result->'acknowledged_samples' <> v_first_ack
    or (select count(*) from public.device_telemetry where device_id=v_device) <> 1 then
    raise exception 'sample replay must return its persisted ACK without duplicating telemetry';
  end if;

  select public.art27_monitoring_snapshot(v_device,v_installation,v_request) into v_snapshot_before;
  if v_snapshot_before->>'status' <> 'ok'
    or v_snapshot_before#>>'{latest_sample,boot_id}' <> v_boot::text
    or v_snapshot_before#>>'{latest_sample,sequence}' <> '1'
    or (v_snapshot_before#>>'{latest_sample,sample_age_seconds}')::integer < 7200 then
    raise exception 'baseline snapshot did not preserve its stale sample identity and age';
  end if;
  perform pg_catalog.pg_sleep(1);
  v_result := public.art27_sync_telemetry(v_device,v_credential,v_boot,2,'null'::jsonb,'[]'::jsonb);
  select public.art27_monitoring_snapshot(v_device,v_installation,v_request) into v_snapshot_after;
  if v_result->>'status' <> 'ok'
    or v_snapshot_after#>>'{latest_sample,boot_id}' <> v_boot::text
    or v_snapshot_after#>>'{latest_sample,sequence}' <> '1'
    or v_snapshot_after#>>'{latest_sample,measured_at}' is distinct from v_snapshot_before#>>'{latest_sample,measured_at}'
    or (v_snapshot_after#>>'{latest_sample,sample_age_seconds}')::integer < (v_snapshot_before#>>'{latest_sample,sample_age_seconds}')::integer
    or (select live_sequence from public.device_state where device_id=v_device) <> 2
    or (v_snapshot_after#>>'{contact,freshness}') <> 'fresh' then
    raise exception 'sensorless heartbeat must advance live sequence and contact without changing sample identity or age';
  end if;

  select jsonb_agg(
    case
      when g=98 then jsonb_build_object('boot_id',v_reboot,'sequence',g,'measured_at',null,'time_quality','invalid',
        'do_mg_l',null,'do_quality','unavailable','feed_remaining_g',null,'feed_percent',null,
        'feed_quality','unavailable','calibration_revision',null)
      when g=99 then jsonb_build_object('boot_id',v_reboot,'sequence',g,'measured_at',v_time+interval '1 day','time_quality','rtc',
        'do_mg_l',6.1,'do_quality','valid','feed_remaining_g',null,'feed_percent',null,
        'feed_quality','unavailable','calibration_revision',null)
      when g=1 then jsonb_build_object('boot_id',v_reboot,'sequence',g,'measured_at',v_time-interval '10 minutes','time_quality','rtc',
        'do_mg_l',null,'do_quality','unavailable','feed_remaining_g',500,'feed_percent',50,
        'feed_quality','valid','calibration_revision',2)
      else jsonb_build_object('boot_id',v_reboot,'sequence',g,
        'measured_at',v_time-interval '10 minutes'-pg_catalog.make_interval(secs=>((g-1)*30)),
        'time_quality','rtc','do_mg_l',5.8,'do_quality','valid','feed_remaining_g',500,'feed_percent',50,
        'feed_quality','valid','calibration_revision',2)
    end order by g)
    into v_backlog
    from pg_catalog.generate_series(1,99) as series(g);
  v_latest := jsonb_build_object('sequence',100,'measured_at',v_time-interval '1 minute','time_quality','rtc',
    'do_mg_l',5.8,'do_quality','valid','feed_remaining_g',500,'feed_percent',50,
    'feed_quality','valid','calibration_revision',2);
  v_result := public.art27_sync_telemetry(v_device,v_credential,v_reboot,100,v_latest,v_backlog);
  if v_result->>'status' <> 'ok' or jsonb_array_length(v_result->'acknowledged_samples') <> 100
    or (select live_sequence from public.device_state where device_id=v_device) <> 100
    or (select latest_telemetry_boot_id from public.device_state where device_id=v_device) <> v_reboot
    or (select latest_telemetry_sequence from public.device_state where device_id=v_device) <> 100 then
    raise exception '100-sample reboot batch must persist, acknowledge and advance the live identity atomically';
  end if;
  v_first_ack := v_result->'acknowledged_samples';
  v_result := public.art27_sync_telemetry(v_device,v_credential,v_reboot,100,v_latest,v_backlog);
  if v_result->>'status' <> 'ok' or v_result->'acknowledged_samples' <> v_first_ack
    or (select count(*) from public.device_telemetry where device_id=v_device) <> 101 then
    raise exception 'replaying a persisted 100-sample batch must return ACKs without duplicate rows';
  end if;

  v_result := public.art27_sync_telemetry(v_second_device,v_second_credential,v_second_boot,1,
    jsonb_build_object('sequence',1,'measured_at',v_time-interval '5 minutes','time_quality','rtc',
      'do_mg_l',6.0,'do_quality','valid','feed_remaining_g',400,'feed_percent',40,
      'feed_quality','valid','calibration_revision',3), '[]'::jsonb);
  if v_result->>'status' <> 'ok' then raise exception 'second fixture telemetry setup failed'; end if;
  v_result := public.art27_sync_telemetry(v_second_device,v_second_credential,v_second_boot,2,
    jsonb_build_object('sequence',2,'measured_at',v_time+interval '1 day','time_quality','rtc',
      'do_mg_l',6.0,'do_quality','valid','feed_remaining_g',400,'feed_percent',40,
      'feed_quality','valid','calibration_revision',3), '[]'::jsonb);
  v_snapshot_after := public.art27_monitoring_snapshot(v_second_device,v_second_installation,v_request);
  if v_result->>'status' <> 'ok'
    or v_snapshot_after#>>'{latest_sample,sequence}' <> '2'
    or v_snapshot_after#>>'{latest_sample,sample_age_seconds}' is not null
    or v_snapshot_after#>>'{latest_sample,do_freshness}' <> 'unknown'
    or v_snapshot_after#>>'{latest_sample,feed_freshness}' <> 'unknown'
    or v_snapshot_after#>>'{latest_sample,do_mg_l}' is not null
    or v_snapshot_after#>>'{latest_sample,feed_remaining_g}' is not null then
    raise exception 'future device timestamps must not make sensor values or freshness appear trustworthy';
  end if;

  v_snapshot_after := public.art27_monitoring_snapshot(v_device,v_second_installation,v_request);
  if v_snapshot_after->>'status' <> 'not_active' then
    raise exception 'another installation must not read this device snapshot';
  end if;
  v_graph := public.art27_do_graph(v_device,v_installation,v_request,'1h',100);
  if v_graph->>'status' <> 'ok' or (v_graph->>'sample_count')::integer <> 98
    or (v_graph->>'valid_sample_count')::integer <> 97
    or (v_graph->>'invalid_time_sample_count')::integer <> 2
    or (v_graph->>'returned_count')::integer <> 100
    or jsonb_array_length(v_graph->'samples') <> 100
    or (v_graph->>'gap_count')::integer < 1
    or not exists(select 1 from jsonb_array_elements(v_graph->'samples') sample where sample->>'gap_reason'='unavailable') then
    raise exception '1h graph must filter untrusted times, count valid readings, cap points and retain gaps';
  end if;
  v_graph := public.art27_do_graph(v_device,v_installation,v_request,'6h',100);
  if v_graph->>'status' <> 'ok' or (v_graph->>'sample_count')::integer <> 99 then
    raise exception '6h graph must include the older sample excluded by the 1h filter';
  end if;
  if public.art27_do_graph(v_device,v_second_installation,v_request,'1h',100)->>'status' <> 'not_active' then
    raise exception 'another installation must not read this device graph';
  end if;

  select count(*) into v_rows_before from public.device_telemetry where device_id=v_device;
  select last_authenticated_contact_at into v_contact_before from public.device_state where device_id=v_device;
  select jsonb_build_object('boot_id',v_reboot,'sequence',150,'measured_at',v_time,'time_quality','rtc',
    'do_mg_l',5.9,'do_quality','valid','feed_remaining_g',500,'feed_percent',50,
    'feed_quality','valid','calibration_revision',2) into v_new_row;
  select jsonb_set(v_backlog->0,'{measured_at}',to_jsonb(((v_backlog->0->>'measured_at')::timestamptz-interval '1 second')))
    into v_conflicting_row;
  begin
    perform public.art27_sync_telemetry(v_device,v_credential,v_reboot,150,'null'::jsonb,
      jsonb_build_array(v_new_row,v_conflicting_row));
    raise exception 'immutable identity conflict unexpectedly succeeded';
  exception when unique_violation then null; end;
  if exists(select 1 from public.device_telemetry where device_id=v_device and boot_id=v_reboot and sample_sequence=150)
    or (select count(*) from public.device_telemetry where device_id=v_device) <> v_rows_before
    or (select live_sequence from public.device_state where device_id=v_device) <> 100
    or (select last_authenticated_contact_at from public.device_state where device_id=v_device) is distinct from v_contact_before then
    raise exception 'immutable conflict must roll back the full batch before contact or state changes';
  end if;

  v_new_row := jsonb_set(v_new_row,'{sequence}','151'::jsonb);
  v_bad_latest := jsonb_build_object('sequence',152,'measured_at',v_time,'time_quality','rtc',
    'do_mg_l',5.8,'do_quality','error','feed_remaining_g',500,'feed_percent',50,
    'feed_quality','valid','calibration_revision',2);
  begin
    perform public.art27_sync_telemetry(v_device,v_credential,v_reboot,152,v_bad_latest,jsonb_build_array(v_new_row));
    raise exception 'malformed batch unexpectedly succeeded';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from public.device_telemetry where device_id=v_device and boot_id=v_reboot and sample_sequence in (151,152))
    or (select count(*) from public.device_telemetry where device_id=v_device) <> v_rows_before
    or (select live_sequence from public.device_state where device_id=v_device) <> 100
    or (select last_authenticated_contact_at from public.device_state where device_id=v_device) is distinct from v_contact_before then
    raise exception 'malformed batch must roll back earlier valid rows and state changes';
  end if;

  select jsonb_agg(jsonb_build_object('boot_id',v_reboot,'sequence',g,'measured_at',v_time,
    'time_quality','rtc','do_mg_l',5.8,'do_quality','valid','feed_remaining_g',500,
    'feed_percent',50,'feed_quality','valid','calibration_revision',2) order by g)
    into v_backlog from pg_catalog.generate_series(200,299) as series(g);
  begin
    perform public.art27_sync_telemetry(v_device,v_credential,v_reboot,400,
      jsonb_build_object('sequence',400,'measured_at',v_time,'time_quality','rtc','do_mg_l',5.8,
        'do_quality','valid','feed_remaining_g',500,'feed_percent',50,'feed_quality','valid','calibration_revision',2),v_backlog);
    raise exception '101-row batch unexpectedly succeeded';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from public.device_telemetry where device_id=v_device and boot_id=v_reboot and sample_sequence between 200 and 400)
    or (select count(*) from public.device_telemetry where device_id=v_device) <> v_rows_before then
    raise exception '101-row request must be rejected before inserting any sample';
  end if;

  v_result := public.art27_sync_telemetry(v_device,v_credential,v_reboot,101,
    jsonb_build_object('sequence',101,'measured_at',null,'time_quality','invalid',
      'do_mg_l',null,'do_quality','unavailable','feed_remaining_g',null,'feed_percent',null,
      'feed_quality','unavailable','calibration_revision',null),'[]'::jsonb);
  v_snapshot_after := public.art27_monitoring_snapshot(v_device,v_installation,v_request);
  if v_result->>'status' <> 'ok'
    or v_snapshot_after#>>'{latest_sample,sequence}' <> '101'
    or v_snapshot_after#>>'{latest_sample,sample_age_seconds}' is not null
    or v_snapshot_after#>>'{latest_sample,do_freshness}' <> 'unknown'
    or v_snapshot_after#>>'{latest_sample,feed_freshness}' <> 'unknown'
    or v_snapshot_after#>>'{latest_sample,do_mg_l}' is not null
    or v_snapshot_after#>>'{latest_sample,feed_remaining_g}' is not null then
    raise exception 'invalid device time must stay unknown and never be rendered as zero or fresh';
  end if;

  if has_schema_privilege('anon','private','USAGE')
    or has_schema_privilege('authenticated','private','USAGE')
    or has_table_privilege('anon','private.device_credentials','SELECT')
    or has_table_privilege('authenticated','private.device_credentials','SELECT') then
    raise exception 'private machine credentials are exposed to client roles';
  end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
begin
  if not exists(select 1 from public.device_telemetry where device_id='22222222-2222-4222-8222-222222222222')
    or exists(select 1 from public.device_telemetry where device_id='33333333-3333-4333-8333-333333333333') then
    raise exception 'Realtime-visible telemetry must be filtered to the active installation';
  end if;
end $$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
do $$
begin
  if not exists(select 1 from public.device_telemetry where device_id='33333333-3333-4333-8333-333333333333')
    or exists(select 1 from public.device_telemetry where device_id='22222222-2222-4222-8222-222222222222') then
    raise exception 'Realtime-visible telemetry must not cross installation boundaries';
  end if;
end $$;

reset role;
set local role service_role;
do $$
declare
  v_device constant uuid := '22222222-2222-4222-8222-222222222222';
  v_installation constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_result jsonb;
begin
  v_result := public.art38_revoke_device_access(v_device,v_installation);
  if v_result->>'status' <> 'revoked'
    or public.art27_monitoring_snapshot(v_device,v_installation,'70000000-0000-4000-8000-000000000001')->>'status' <> 'not_active' then
    raise exception 'revoked app membership must block protected RPC reads';
  end if;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
begin
  if exists(select 1 from public.device_telemetry where device_id='22222222-2222-4222-8222-222222222222') then
    raise exception 'revoked app membership must remove telemetry from Realtime-visible reads';
  end if;
end $$;

reset role;
set local role service_role;
do $$
declare
  v_device constant uuid := '22222222-2222-4222-8222-222222222222';
  v_result jsonb;
begin
  update private.device_credentials set revoked_at=pg_catalog.clock_timestamp() where device_id=v_device;
  v_result := public.art27_sync_telemetry(v_device,repeat('a',64),'60000000-0000-4000-8000-000000000002',101,
    jsonb_build_object('sequence',101,'measured_at',pg_catalog.clock_timestamp(),'time_quality','rtc',
      'do_mg_l',5.8,'do_quality','valid','feed_remaining_g',500,'feed_percent',50,
      'feed_quality','valid','calibration_revision',2),'[]'::jsonb);
  if v_result->>'status' <> 'auth_required' then
    raise exception 'revoked machine credential must fail closed';
  end if;
end $$;
rollback;
