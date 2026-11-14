\set ON_ERROR_STOP on
-- Disposable rollback-only assertions. Never execute against shared Supabase.
begin;
set constraints all deferred;
set local timezone='UTC';

do $$ begin
  if current_database()<>'aquafeed_backend_test' or not exists (
    select 1 from backend_test.provenance where singleton and migration_fixtures_cleaned
      and database_oid=(select oid from pg_database where datname=current_database())) then
    raise exception 'T04 requires fresh disposable baseline';
  end if;
  if to_regprocedure('public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb)') is null then
    raise exception 'T04_CURRENT_METRICS_NOT_INSTALLED';
  end if;
end $$;

create function pg_temp.metric_sample(metric text, seq bigint, age_seconds integer default 0,
  value numeric default 5, quality text default 'valid', boot uuid default '64000000-0000-4000-8000-000000000001')
returns jsonb language sql as $$
  select jsonb_build_object('metric',metric,'boot_id',boot,'sequence',seq,
    'measured_at',to_char(clock_timestamp()-age_seconds*interval '1 second','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'captured_at',null,'time_quality','synced','quality',quality,
    'do_mg_l',case when metric='do' and quality='valid' then value end,
    'feed_remaining_g',case when metric='feed' and quality='valid' then value end,
    'feed_percent',case when metric='feed' and quality='valid' then value/200 end,
    'calibration_revision',case when metric='feed' and quality='valid' then 1 end)
$$;
create function pg_temp.metric_envelope(d jsonb default null,f jsonb default null,b jsonb default '[]')
returns jsonb language sql as $$ select jsonb_build_object('live',jsonb_build_object('do',d,'feed',f),'backlog',b) $$;
create function pg_temp.check_metric(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'T04: %',message; end if; end $$;

do $$
declare
  d constant uuid := '22222222-2222-4222-8222-222222222222';
  boot constant uuid := '64000000-0000-4000-8000-000000000001';
  boot2 constant uuid := '64000000-0000-4000-8000-000000000002';
  installation constant uuid := '64646464-6464-4464-8464-646464646464';
  verifier text;
  r jsonb; env jsonb; before_versions jsonb; saved jsonb; sample jsonb; bad jsonb;
  before_contact timestamptz;
  manual_key uuid := gen_random_uuid(); manual_request uuid := gen_random_uuid();
  before_rows bigint; before_alerts bigint;
  seq bigint := 100;
  item text;
  counter integer;
begin
  perform pg_temp.check_metric(not exists(select 1 from public.device_metric_observations where device_id=d), 'fresh metric fixture');
  perform public.art38_provision_simulated_device(d,repeat('a',64),true);
  select encode(credential_verifier,'hex') into strict verifier from private.device_credentials where device_id=d;
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,is_anonymous)
  values('00000000-0000-0000-0000-000000000000',installation,'authenticated','authenticated','t04@invalid.example','','{}','{}',true);
  insert into public.device_access(device_id,installation_id,status) values(d,installation,'active');
  -- Canonical configuration/ACK setup, never inferred from provisioning.
  r := public.art33_write_configuration(d,installation,gen_random_uuid(),0,'{"timezone":"Asia/Manila","monitoring_limits":{"do_low_mg_l":4,"do_high_mg_l":8},"low_feed_threshold_pct":20,"schedules":[]}');
  perform pg_temp.check_metric(r->>'status'='ok','configuration setup');
  r := public.art33_device_configuration_report(d,verifier,1,1,'applied',null);
  perform pg_temp.check_metric(r->>'status'='ok','configuration apply');
  r := public.art96_register_push_token(installation,'64000000-0000-4000-8000-000000000099','android','ExponentPushToken[synthetic_t04_token_A001]');
  perform pg_temp.check_metric(r->>'status'='ok','synthetic push registration');
  env := pg_temp.metric_envelope(pg_temp.metric_sample('do',seq),pg_temp.metric_sample('feed',seq,300,18000));
  begin
    perform public.backend_sync_metrics(d,verifier,boot,seq,env);
    raise exception 'T04 unsupported capability accepted';
  exception when sqlstate '22023' then null; end;
  update public.devices set capabilities=capabilities||'{"independent_telemetry_v1":true}' where device_id=d;
  r := public.backend_sync_metrics(d,repeat('0',64),boot,seq,env);
  perform pg_temp.check_metric(r->>'status'='auth_required','credential required');
  r := public.backend_sync_metrics(d,verifier,boot,seq,env);
  perform pg_temp.check_metric(r->>'status'='ok' and jsonb_array_length(r->'acknowledged_metrics')=2,'durable metric ACKs');
  perform pg_temp.check_metric((select count(*)=2 from public.device_metric_current where device_id=d),'two independent pointers');
  perform pg_temp.check_metric((private.backend_current_metric(d,'do')->>'age_seconds')::numeric < 30,'fresh DO');
  perform pg_temp.check_metric((private.backend_current_metric(d,'feed')->>'age_seconds')::numeric > 290,'stale stock independent');
  r := public.art31_create_manual_feed(d,installation,gen_random_uuid(),gen_random_uuid(),'[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":10}}]',5);
  perform pg_temp.check_metric(r->>'status'='inventory_unavailable','fresh DO cannot bypass stale stock');
  select revisions into before_versions from public.device_resource_versions where device_id=d;
  select last_authenticated_contact_at into before_contact from public.device_state where device_id=d;
  r := public.backend_sync_metrics(d,verifier,boot,seq,env);
  perform pg_temp.check_metric(r->'revisions'=before_versions,'replay revisions unchanged');
  perform pg_temp.check_metric((select last_authenticated_contact_at is not distinct from before_contact from public.device_state where device_id=d),'replay cannot renew contact');
  perform pg_temp.check_metric((select count(*)=2 from public.device_metric_observations where device_id=d),'replay no rows');
  begin
    perform public.backend_sync_metrics(d,verifier,boot,seq,jsonb_set(env,'{live,feed,feed_remaining_g}','17000'));
    raise exception 'T04 changed replay accepted';
  exception when unique_violation then null; end;
  sample := pg_temp.metric_sample('feed',99,600,16000);
  r := public.backend_sync_metrics(d,verifier,boot,101,pg_temp.metric_envelope(null,null,jsonb_build_array(sample)));
  perform pg_temp.check_metric((select sample_sequence=100 from public.device_metric_current where device_id=d and metric='feed'),'backlog no regression');
  r := public.backend_sync_metrics(d,verifier,boot,99,pg_temp.metric_envelope(null,sample));
  perform pg_temp.check_metric((select sample_sequence=100 from public.device_metric_current where device_id=d and metric='feed'),'historical-to-live replay denied');
  r := public.backend_sync_metrics(d,verifier,boot2,1,pg_temp.metric_envelope(pg_temp.metric_sample('do',1,0,2,'valid',boot2)));
  perform pg_temp.check_metric((select sample_sequence=100 from public.device_metric_current where device_id=d and metric='do'),'new boot reset denied');
  -- Invalid last item rolls back earlier item and all contact/revision writes.
  select count(*) into before_rows from public.device_metric_observations where device_id=d;
  select revisions into before_versions from public.device_resource_versions where device_id=d;
  select last_authenticated_contact_at into before_contact from public.device_state where device_id=d;
  bad := pg_temp.metric_sample('do',103)||'{"do_mg_l":"5"}';
  begin
    perform public.backend_sync_metrics(d,verifier,boot,102,pg_temp.metric_envelope(null,null,jsonb_build_array(pg_temp.metric_sample('do',102),bad)));
    raise exception 'T04 invalid batch accepted';
  exception when sqlstate '22023' then null; end;
  perform pg_temp.check_metric((select count(*)=before_rows from public.device_metric_observations where device_id=d),'invalid batch atomic rows');
  perform pg_temp.check_metric((select revisions=before_versions from public.device_resource_versions where device_id=d),'invalid batch atomic revisions');
  perform pg_temp.check_metric((select last_authenticated_contact_at is not distinct from before_contact from public.device_state where device_id=d),'invalid batch atomic contact');
  saved := private.backend_current_metric(d,'do');
  r := public.backend_sync_metrics(d,verifier,boot,104,pg_temp.metric_envelope(null,pg_temp.metric_sample('feed',104,0,null,'error')));
  perform pg_temp.check_metric(private.backend_current_metric(d,'feed')->>'quality'='error','explicit error current');
  perform pg_temp.check_metric(private.backend_current_metric(d,'do')->'latest'=saved->'latest','omitted DO pointer unchanged');
  -- Legacy ingestion remains available, but its fresh inventory cannot override capable error.
  r := public.art27_sync_telemetry(d,verifier,boot,105,jsonb_build_object('sequence',105,'measured_at',pg_temp.metric_sample('do',105)->'measured_at','time_quality','synced','do_mg_l',5,'do_quality','valid','feed_remaining_g',18000,'feed_percent',90,'feed_quality','valid','calibration_revision',1),'[]');
  perform pg_temp.check_metric(r->>'status'='ok','legacy ingestion retained');
  r := public.art31_create_manual_feed(d,installation,gen_random_uuid(),gen_random_uuid(),'[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":10}}]',5);
  perform pg_temp.check_metric(r->>'status'='inventory_unavailable','legacy pointer cannot bypass capable error');
  sample := pg_temp.metric_sample('feed',106,0,22000)||'{"feed_percent":100}';
  r := public.backend_sync_metrics(d,verifier,boot,106,pg_temp.metric_envelope(null,sample));
  perform pg_temp.check_metric(private.backend_current_metric(d,'feed')->>'quality'='error','overcapacity normalized');
  perform pg_temp.check_metric((select input_observation=sample and feed_remaining_g is null from public.device_metric_observations where device_id=d and metric='feed' and sample_sequence=106),'original stock immutable');
  r := public.backend_sync_metrics(d,verifier,boot,106,pg_temp.metric_envelope(null,sample));
  begin
    perform public.backend_sync_metrics(d,verifier,boot,106,pg_temp.metric_envelope(null,sample||'{"feed_remaining_g":23000}'));
    raise exception 'T04 normalized conflict accepted';
  exception when unique_violation then null; end;
  -- Unknown/invalid/future originals never become fresh through receipt or contact.
  for counter in 1..3 loop
    sample := pg_temp.metric_sample('feed',106+counter,0,18000);
    sample := sample || case counter when 1 then '{"time_quality":"uncertain"}'::jsonb
      when 2 then '{"time_quality":"invalid","measured_at":null}'::jsonb
      else jsonb_build_object('measured_at',pg_temp.metric_sample('feed',1,-3600)->'measured_at') end;
    r := public.backend_sync_metrics(d,verifier,boot,106+counter,pg_temp.metric_envelope(null,sample));
    perform pg_temp.check_metric(private.backend_current_metric(d,'feed')->>'time_basis'='unknown','untrusted clock unknown');
    r := public.art31_create_manual_feed(d,installation,gen_random_uuid(),gen_random_uuid(),'[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":10}}]',5);
    perform pg_temp.check_metric(r->>'status'='inventory_unavailable','unknown clock cannot feed');
  end loop;
  -- Required fields/type, duplicate, live binding and byte/count caps are RPC trust boundaries.
  foreach item in array array['metric','boot_id','sequence','measured_at','captured_at','time_quality','quality','do_mg_l','feed_remaining_g','feed_percent','calibration_revision'] loop
    begin
      perform public.backend_sync_metrics(d,verifier,boot,110,pg_temp.metric_envelope(pg_temp.metric_sample('do',110)-item));
      raise exception 'T04 missing field accepted: %',item;
    exception when sqlstate '22023' then null; end;
  end loop;
  for bad in select value from jsonb_array_elements(jsonb_build_array(
    pg_temp.metric_envelope(pg_temp.metric_sample('do',109)),
    pg_temp.metric_envelope(pg_temp.metric_sample('do',110,0,5,'valid',boot2)),
    pg_temp.metric_envelope(pg_temp.metric_sample('do',110),null,jsonb_build_array(pg_temp.metric_sample('do',110))),
    pg_temp.metric_envelope(pg_temp.metric_sample('do',110)||'{"extra":true}'),
    jsonb_build_object('live',jsonb_build_object('do',null),'backlog','[]'::jsonb))) loop
    begin
      perform public.backend_sync_metrics(d,verifier,boot,110,bad);
      raise exception 'T04 invalid envelope accepted';
    exception when sqlstate '22023' then null; end;
  end loop;
  select jsonb_agg(pg_temp.metric_sample('do',n)) into bad from generate_series(1000,1100) n;
  begin
    perform public.backend_sync_metrics(d,verifier,boot,110,pg_temp.metric_envelope(null,null,bad));
    raise exception 'T04 101 observations accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.backend_sync_metrics(d,verifier,boot,110,pg_temp.metric_envelope(pg_temp.metric_sample('do',110)||jsonb_build_object('measured_at','2026-11-13T01:00:00.'||repeat('0',263000)||'Z')));
    raise exception 'T04 oversized envelope accepted';
  exception when sqlstate '22023' then null; end;
  -- Fresh metric crossing, sustained dedup, recovery and renewed crossing.
  select count(*) into before_alerts from public.alert_events where device_id=d;
  r := public.backend_sync_metrics(d,verifier,boot,120,pg_temp.metric_envelope(pg_temp.metric_sample('do',120,0,2)));
  r := public.backend_sync_metrics(d,verifier,boot,121,pg_temp.metric_envelope(pg_temp.metric_sample('do',121,0,2)));
  perform pg_temp.check_metric((select count(*)=before_alerts+1 from public.alert_events where device_id=d),'sustained outside dedup');
  r := public.backend_sync_metrics(d,verifier,boot,122,pg_temp.metric_envelope(pg_temp.metric_sample('do',122,0,5)));
  env := pg_temp.metric_envelope(pg_temp.metric_sample('do',123,0,2));
  r := public.backend_sync_metrics(d,verifier,boot,123,env);
  r := public.backend_sync_metrics(d,verifier,boot,123,env);
  r := public.backend_sync_metrics(d,verifier,boot,124,pg_temp.metric_envelope(null,pg_temp.metric_sample('feed',124,0,18000)));
  r := public.backend_sync_metrics(d,verifier,boot,125,pg_temp.metric_envelope(pg_temp.metric_sample('do',125,0,null,'error')));
  r := public.backend_sync_metrics(d,verifier,boot,126,pg_temp.metric_envelope(null,null,jsonb_build_array(pg_temp.metric_sample('do',126,0,2))));
  perform pg_temp.check_metric((select count(*)=before_alerts+2 from public.alert_events where device_id=d),'recovery crossing then replay/stock/error/backlog no false alerts');
  perform pg_temp.check_metric(not exists(select 1 from public.alert_events a where a.device_id=d and a.observation_metric='do' and not exists(select 1 from public.device_metric_observations o where (o.device_id,o.metric,o.boot_id,o.sample_sequence)=(a.device_id,a.observation_metric,a.boot_id,a.sample_sequence))),'actual observation alert FK');
  perform pg_temp.check_metric((select count(*)=2 from private.alert_push_deliveries where device_id=d and installation_id=installation and state='queued'),'metric crossings retain ART96 enqueue');
  perform pg_temp.check_metric((select min(raised_at)<max(raised_at) from public.alert_events where device_id=d and observation_metric='do'),'strict crossing chronology');
  -- Independent feed crossing cannot re-evaluate cached outside DO.
  r := public.backend_sync_metrics(d,verifier,boot,127,pg_temp.metric_envelope(null,pg_temp.metric_sample('feed',127,0,2000)));
  r := public.backend_sync_metrics(d,verifier,boot,128,pg_temp.metric_envelope(null,pg_temp.metric_sample('feed',128,0,2000)));
  perform pg_temp.check_metric((select count(*)=1 from public.alert_events where device_id=d and observation_metric='feed'),'feed crossing sustained dedup');
  r := public.backend_sync_metrics(d,verifier,boot,129,pg_temp.metric_envelope(pg_temp.metric_sample('do',129,0,5)));
  perform pg_temp.check_metric((select count(*)=1 from public.alert_events where device_id=d and observation_metric='feed'),'DO-only does not re-evaluate stock');
  -- Frozen contract cannot label capture-only alerts or prove acquisition-clock trust.
  sample := pg_temp.metric_sample('feed',130,0,18000)||jsonb_build_object('time_quality','invalid','measured_at',null,'captured_at',pg_temp.metric_sample('feed',1)->'measured_at');
  r := public.backend_sync_metrics(d,verifier,boot,130,pg_temp.metric_envelope(null,sample));
  perform pg_temp.check_metric(private.backend_current_metric(d,'feed')->>'time_basis'='unknown','capture-only unsupported must fail closed');
  r := public.art31_create_manual_feed(d,installation,gen_random_uuid(),gen_random_uuid(),'[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":10}}]',5);
  perform pg_temp.check_metric(r->>'status'='inventory_unavailable','capture-only not fresh inventory');
  -- Legacy and metric alert identity namespaces can coexist without copying observations.
  r := public.art27_sync_telemetry(d,verifier,boot,130,null,jsonb_build_array(jsonb_build_object(
    'boot_id',boot,'sequence',120,'measured_at',pg_temp.metric_sample('do',120)->'measured_at',
    'time_quality','synced','do_mg_l',2,'do_quality','valid','feed_remaining_g',null,'feed_percent',null,
    'feed_quality','unavailable','calibration_revision',null)));
  insert into public.alert_events(device_id,boot_id,sample_sequence,alert_kind,applied_revision,metric_value,limit_value,measured_at,is_simulated)
    select d,boot,120,'do_low',1,2,4,measured_at,true from public.device_telemetry where device_id=d and boot_id=boot and sample_sequence=120;
  perform pg_temp.check_metric((select count(*)=2 from public.alert_events where device_id=d and boot_id=boot and sample_sequence=120 and alert_kind='do_low'),'legacy and new source same identity separated');
  for counter in 1..2 loop
    begin
      insert into public.alert_events(device_id,observation_metric,boot_id,sample_sequence,alert_kind,applied_revision,metric_value,limit_value,measured_at,is_simulated)
        select device_id,observation_metric,boot_id,sample_sequence,alert_kind,applied_revision,metric_value,limit_value,measured_at,is_simulated
        from public.alert_events where device_id=d and sample_sequence=120 and (observation_metric is null)=(counter=1);
      raise exception 'T04 same-source alert duplicate accepted';
    exception when unique_violation then null; end;
  end loop;
  begin
    insert into public.alert_events(device_id,observation_metric,boot_id,sample_sequence,alert_kind,applied_revision,metric_value,limit_value,measured_at,is_simulated)
      values(d,'do',boot,9999,'do_low',1,2,4,clock_timestamp(),true);
    raise exception 'T04 metric alert missing observation accepted';
  exception when foreign_key_violation then null; end;
  begin
    update public.device_metric_observations set quality='error' where device_id=d and metric='do' and sample_sequence=120;
    raise exception 'T04 observation mutation accepted';
  exception when sqlstate '55000' then null; end;
  perform pg_temp.check_metric(exists(select 1 from pg_constraint where conrelid='public.alert_events'::regclass and conname='alert_events_feeding_once'),'feeding-once constraint retained');
  r := public.backend_sync_metrics(d,verifier,boot,131,pg_temp.metric_envelope(pg_temp.metric_sample('do',131,300,5),pg_temp.metric_sample('feed',131,0,18000)));
  r := public.art31_create_manual_feed(d,installation,manual_key,manual_request,'[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":10}}]',5);
  perform pg_temp.check_metric(r->>'status'='created','fresh stock admits despite stale DO');
  r := public.art31_create_manual_feed(d,installation,manual_key,manual_request,'[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":10}}]',5);
  perform pg_temp.check_metric((select count(*)=1 from public.feed_sequences where device_id=d),'manual replay never duplicates command');
  perform pg_temp.check_metric((private.backend_current_metric(d,'feed')#>>'{latest,observation,feed_remaining_g}')::numeric=18000,'requested dose is not measured dispense or stock subtraction');
end $$;

-- RLS/grants/private helpers, client write denial, actual access revocation.
do $$ declare t text; privilege text; begin
  foreach t in array array['device_metric_observations','device_metric_current','device_resource_versions'] loop
    perform pg_temp.check_metric((select relrowsecurity from pg_class where oid=('public.'||t)::regclass),'RLS enabled');
    perform pg_temp.check_metric(has_table_privilege('authenticated','public.'||t,'SELECT') and not has_table_privilege('anon','public.'||t,'SELECT'),'active SELECT surface');
    foreach privilege in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
      perform pg_temp.check_metric(not has_table_privilege('authenticated','public.'||t,privilege) and not has_table_privilege('anon','public.'||t,privilege),'no client mutation');
    end loop;
    foreach privilege in array array['DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      perform pg_temp.check_metric(not has_table_privilege('service_role','public.'||t,privilege),'no ambient destructive service grant');
    end loop;
  end loop;
  perform pg_temp.check_metric(has_function_privilege('service_role','public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb)','EXECUTE') and not has_function_privilege('anon','public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb)','EXECUTE'),'service-only RPC');
  perform pg_temp.check_metric(not has_function_privilege('service_role','private.backend_current_metric(uuid,text)','EXECUTE') and not has_function_privilege('authenticated','private.backend_current_metric(uuid,text)','EXECUTE'),'private helper ACL');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','64646464-6464-4464-8464-646464646464',true);
do $$ begin
  if not exists(select 1 from public.device_metric_observations where device_id='22222222-2222-4222-8222-222222222222') then raise exception 'T04 active RLS access denied'; end if;
end $$;
reset role;
update public.device_access set status='revoked',revoked_at=clock_timestamp() where device_id='22222222-2222-4222-8222-222222222222' and installation_id='64646464-6464-4464-8464-646464646464';
set local role authenticated;
do $$ begin
  if exists(select 1 from public.device_metric_observations where device_id='22222222-2222-4222-8222-222222222222') or exists(select 1 from public.device_metric_current where device_id='22222222-2222-4222-8222-222222222222') or exists(select 1 from public.device_resource_versions where device_id='22222222-2222-4222-8222-222222222222') then raise exception 'T04 revoked RLS leaked metrics'; end if;
end $$;
reset role;
rollback;
