\set ON_ERROR_STOP on
-- T07: disposable rollback-only. Parent observes predecessor RED, never shared SQL.
begin;
set constraints all deferred;
set local timezone='UTC';
do $$ begin
  if current_database()<>'aquafeed_backend_test' or not exists(select 1 from backend_test.provenance
    where singleton and migration_fixtures_cleaned and database_oid=(select oid from pg_database where datname=current_database())) then
    raise exception 'T07 requires fresh disposable baseline'; end if;
  if to_regprocedure('public.backend_device_configuration_report(uuid,text,jsonb)') is null then
    raise exception 'T07_EXACT_REPORTING_ACK_NOT_INSTALLED'; end if;
end $$;
create function pg_temp.reporting_check(ok boolean,msg text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'T07: %',msg; end if; end $$;
do $$
declare
 d uuid := '22222222-2222-4222-8222-222222222222'; i uuid := '70707070-7070-4070-8070-707070707070';
 k uuid := gen_random_uuid(); verifier text; r jsonb; s jsonb; report jsonb; invalid_report jsonb; before_state jsonb; stock jsonb; v bigint; n bigint; choice integer;
begin
 perform public.art38_provision_simulated_device(d,repeat('a',64),true);
 select encode(credential_verifier,'hex') into strict verifier from private.device_credentials where device_id=d;
 insert into auth.users(instance_id,id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,is_anonymous)
 values('00000000-0000-0000-0000-000000000000',i,'authenticated','authenticated','t07@invalid.example','','{}','{}',true);
 insert into public.device_access(device_id,installation_id,status) values(d,i,'active');
 s := '{"timezone":"UTC","monitoring_limits":{"do_low_mg_l":null,"do_high_mg_l":null},"low_feed_threshold_pct":null,"schedules":[]}';
 r := public.art33_write_configuration(d,i,k,0,s);
 perform pg_temp.reporting_check(r->>'status'='ok','legacy null-limits bootstrap unchanged');
 r := public.art33_device_configuration_report(d,verifier,1,1,'applied',null);
 perform pg_temp.reporting_check(r->>'status'='ok','legacy ACK still works');
 update public.devices set capabilities=capabilities||'{"independent_telemetry_v1":true}' where device_id=d;
 s := s||'{"oxygen_report_interval_seconds":28800,"schedules":[{"schedule_id":"70707070-7070-4070-8070-707070707072","local_time":"08:00","weekdays":[1,3],"enabled":true,"targets":[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":10}},{"nozzle_number":2,"dose":{"mode":"grams","amount_g":12}}]}]}'; k:=gen_random_uuid();
 r := public.art33_write_configuration(d,i,k,1,s); v:=(r->'receipt'->>'revision')::bigint;
 perform pg_temp.reporting_check(r->>'status'='ok','capable interval saved');
 perform pg_temp.reporting_check((select applied_revision=1 from public.devices where device_id=d),'save not application');
 r := public.art33_write_configuration(d,i,k,1,s);
 perform pg_temp.reporting_check((r->'receipt'->>'revision')::bigint=v,'same request one revision');
 r := public.art33_write_configuration(d,i,k,1,jsonb_set(s,'{oxygen_report_interval_seconds}','30'));
 perform pg_temp.reporting_check(r->>'status'='idempotency_conflict','changed replay conflicts');
 report:=jsonb_build_object('applied_revision',v,'last_attempt_revision',v,'last_attempt_status','applied','error_code',null,'oxygen_report_interval_seconds',30);
 r:=public.backend_device_configuration_report(d,verifier,report);
 perform pg_temp.reporting_check(r->>'status'='invalid','wrong exact value rejected');
 before_state:=private.art33_configuration_state(d);
 for invalid_report in select value from jsonb_array_elements(jsonb_build_array(
   report-'oxygen_report_interval_seconds',
   jsonb_set(report,'{oxygen_report_interval_seconds}','null'),
   jsonb_set(report,'{oxygen_report_interval_seconds}','0'),
   jsonb_set(report,'{oxygen_report_interval_seconds}','31'),
   jsonb_set(report,'{oxygen_report_interval_seconds}','"28800"'),
   jsonb_set(report,'{oxygen_report_interval_seconds}','false'),
   jsonb_set(report,'{oxygen_report_interval_seconds}','[]'),
   jsonb_set(report,'{oxygen_report_interval_seconds}','{}'))) loop
   r:=public.backend_device_configuration_report(d,verifier,invalid_report);
   perform pg_temp.reporting_check(r->>'status'='invalid','missing/invalid/mismatched interval cannot acknowledge a negotiated revision');
   perform pg_temp.reporting_check(private.art33_configuration_state(d)=before_state
     and (select state='requested' from public.device_config_revisions where device_id=d and revision=v),'invalid interval leaves pending and previous applied state unchanged');
 end loop;
 r:=public.art33_device_configuration_report(d,verifier,v,v,'applied',null);
 perform pg_temp.reporting_check(r->>'status'='invalid','old signature cannot acknowledge new revision');
 perform pg_temp.reporting_check((select applied_revision=1 and last_attempt_status='pending' from public.devices where device_id=d),'invalid ACK retains pending and prior applied');
 r:=public.backend_device_configuration_report(d,verifier,jsonb_set(report,'{oxygen_report_interval_seconds}','28800'));
 perform pg_temp.reporting_check(r->>'status'='ok','exact revision and interval applies');
 perform pg_temp.reporting_check((select requested_snapshot->'schedules'=s->'schedules' and requested_snapshot->'monitoring_limits'=s->'monitoring_limits' from public.device_config_revisions where device_id=d and revision=v),'ordered Both targets, IDs and limits retained');
 r:=public.backend_device_configuration_report(d,verifier,jsonb_set(report,'{oxygen_report_interval_seconds}','28800'));
 perform pg_temp.reporting_check(r->>'status'='ok','ACK replay safe');
 r:=public.art33_write_configuration(d,i,gen_random_uuid(),v,s-'oxygen_report_interval_seconds');
 perform pg_temp.reporting_check(r->>'status'='upgrade_required','old writer cannot strip field');
 r:=public.art33_write_configuration(d,i,gen_random_uuid(),0,s);
 perform pg_temp.reporting_check(r->>'status'='conflict','stale edit denied');
 foreach choice in array array[15,30,60,3600,7200,14400,28800] loop
   perform pg_temp.reporting_check(private.art33_validate_snapshot(d,jsonb_set(s,'{oxygen_report_interval_seconds}',to_jsonb(choice))) is null,'seven intervals accepted');
 end loop;
 foreach choice in array array[0,14,31,-1] loop
   perform pg_temp.reporting_check(private.art33_validate_snapshot(d,jsonb_set(s,'{oxygen_report_interval_seconds}',to_jsonb(choice)))='VALIDATION_FAILED','invalid interval refused');
 end loop;
 update public.devices set capabilities=capabilities||'{"independent_telemetry_v1":false}' where device_id=d;
 perform pg_temp.reporting_check(private.art33_validate_snapshot(d,jsonb_set(s,'{oxygen_report_interval_seconds}','null'))='CAPABILITY_MISMATCH','cannot clear configured interval after capability loss');
 update public.devices set capabilities=capabilities||'{"independent_telemetry_v1":true}' where device_id=d;
 r:=public.backend_metric_snapshot(d,i,gen_random_uuid());
 perform pg_temp.reporting_check(r->>'status'='ok' and r->'configuration'->'applied_snapshot'->>'timezone'='UTC','snapshot preserves actual nonPH applied zone');
 perform pg_temp.reporting_check(r->'resources'->'feed'->'latest'='null'::jsonb,'no stock fabricated');
 r:=public.backend_sync_metrics(d,verifier,'70707070-7070-4070-8070-707070707073',100,
   jsonb_build_object('live',jsonb_build_object('do',jsonb_build_object('metric','do','boot_id','70707070-7070-4070-8070-707070707073','sequence',100,'measured_at',to_char(clock_timestamp(),'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'captured_at',null,'time_quality','synced','quality','valid','do_mg_l',5,'feed_remaining_g',null,'feed_percent',null,'calibration_revision',null),
   'feed',jsonb_build_object('metric','feed','boot_id','70707070-7070-4070-8070-707070707073','sequence',100,'measured_at',to_char(clock_timestamp()-interval '31 seconds','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'captured_at',null,'time_quality','synced','quality','valid','do_mg_l',null,'feed_remaining_g',18000,'feed_percent',90,'calibration_revision',1)), 'backlog','[]'::jsonb));
 perform pg_temp.reporting_check(r->>'status'='ok' and jsonb_array_length(r->'acknowledged_metrics')=2,'stale-stock control ingested both metric observations');
 stock:=private.backend_current_metric(d,'feed');
 perform pg_temp.reporting_check(stock->>'quality'='valid' and stock->>'time_basis'='measured'
   and (stock->>'age_seconds')::numeric>30
   and stock#>>'{latest,observation,sequence}'='100'
   and (stock#>>'{latest,observation,feed_remaining_g}')::numeric=18000,'canonical current stock exists, is measured/valid and older than30s');
 perform pg_temp.reporting_check((select revision.requested_snapshot->'oxygen_report_interval_seconds'='28800'::jsonb
   from public.devices dev join public.device_config_revisions revision on revision.device_id=dev.device_id and revision.revision=dev.applied_revision
   where dev.device_id=d),'8h interval is actually applied before stock admission controls');
 r:=public.art31_create_manual_feed(d,i,gen_random_uuid(),gen_random_uuid(),'[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":10}}]',5);
 perform pg_temp.reporting_check(r->>'status'='inventory_unavailable','8h DO config cannot admit stock older than30s');
 -- A real positive admission must succeed with fresh measured stock; roll back its
 -- synthetic observation/reservation so subsequent configuration tests remain idle.
 begin
   r:=public.backend_sync_metrics(d,verifier,'70707070-7070-4070-8070-707070707073',101,
     jsonb_build_object('live',jsonb_build_object('do',null,'feed',jsonb_build_object('metric','feed','boot_id','70707070-7070-4070-8070-707070707073','sequence',101,'measured_at',to_char(clock_timestamp()-interval '5 seconds','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'captured_at',null,'time_quality','synced','quality','valid','do_mg_l',null,'feed_remaining_g',18000,'feed_percent',90,'calibration_revision',1)), 'backlog','[]'::jsonb));
   perform pg_temp.reporting_check(r->>'status'='ok' and jsonb_array_length(r->'acknowledged_metrics')=1,'positive control ingested fresh stock');
   stock:=private.backend_current_metric(d,'feed');
   perform pg_temp.reporting_check(stock->>'quality'='valid' and stock->>'time_basis'='measured'
     and (stock->>'age_seconds')::numeric between 0 and 30
     and stock#>>'{latest,observation,sequence}'='101'
     and (stock#>>'{latest,observation,feed_remaining_g}')::numeric=18000,'positive control has canonical valid measured stock within30s');
   r:=public.art31_create_manual_feed(d,i,gen_random_uuid(),gen_random_uuid(),'[{"nozzle_number":1,"dose":{"mode":"grams","amount_g":10}}]',5);
   perform pg_temp.reporting_check(r->>'status'='created','fresh measured stock still admits a manual feed under8h DO reporting');
   set constraints all immediate;
   raise exception using errcode='P7707',message='T07_POSITIVE_ADMISSION_ROLLBACK';
 exception when sqlstate 'P7707' then null;
 end;
 perform pg_temp.reporting_check(not exists(select 1 from public.device_execution_reservations where device_id=d and phase in ('active','settling'))
   and private.backend_current_metric(d,'feed')#>>'{latest,observation,sequence}'='100','positive admission and fresh pointer rolled back; fixture is idle again');
 -- Explicit migration keeps old timezone active until exact full revision ACK.
 s:=jsonb_set(s,'{timezone}','"Asia/Manila"');
 r:=public.art33_write_configuration(d,i,gen_random_uuid(),v,s); n:=(r->'receipt'->>'revision')::bigint;
 r:=public.backend_metric_snapshot(d,i,gen_random_uuid());
 perform pg_temp.reporting_check(r->'configuration'->'applied_snapshot'->>'timezone'='UTC' and r->'configuration'->'desired_snapshot'->>'timezone'='Asia/Manila','migration pending not applied');
 report:=jsonb_build_object('applied_revision',v,'last_attempt_revision',n,'last_attempt_status','pending','error_code',null,'oxygen_report_interval_seconds',28800);
 r:=public.backend_device_configuration_report(d,verifier,report);
 perform pg_temp.reporting_check(r->>'status'='ok' and (select applied_revision=v and last_attempt_status='pending' from public.devices where device_id=d),'pending echo does not apply desired revision');
 report:=report||'{"last_attempt_status":"rejected","error_code":"CLOCK_UNTRUSTED"}';
 r:=public.backend_device_configuration_report(d,verifier,report);
 perform pg_temp.reporting_check(r->>'status'='ok' and (select applied_revision=v and last_attempt_status='rejected' from public.devices where device_id=d),'rejected echo preserves previous applied revision');
 r:=public.backend_metric_snapshot(d,i,gen_random_uuid());
 perform pg_temp.reporting_check(r->'configuration'->'applied_snapshot'->>'timezone'='UTC','rejected migration cannot relabel applied zone');
 -- A distinct, explicit corrected request is allowed against the rejected desired revision.
 r:=public.art33_write_configuration(d,i,gen_random_uuid(),n,s); n:=(r->'receipt'->>'revision')::bigint;
 perform pg_temp.reporting_check(r->>'status'='ok','explicit corrected migration has a new request/revision');
 report:=jsonb_build_object('applied_revision',n,'last_attempt_revision',n,'last_attempt_status','applied','error_code',null,'oxygen_report_interval_seconds',28800);
 perform public.backend_device_configuration_report(d,verifier,report);
 r:=public.backend_metric_snapshot(d,i,gen_random_uuid());
 perform pg_temp.reporting_check(r->'configuration'->'applied_snapshot'->>'timezone'='Asia/Manila','migration ACK applies PH');
 r:=public.backend_device_configuration_report(d,verifier,jsonb_set(report,'{applied_revision}',to_jsonb(v)));
 perform pg_temp.reporting_check(r->>'status' in ('invalid','stale'),'old revision cannot regress');
 before_state:=private.art33_configuration_state(d);
 report:=jsonb_build_object('applied_revision',v,'last_attempt_revision',v,'last_attempt_status','applied','error_code',null,
   'oxygen_report_interval_seconds',(select requested_snapshot->'oxygen_report_interval_seconds' from public.device_config_revisions where device_id=d and revision=v));
 r:=public.backend_device_configuration_report(d,verifier,report);
 perform pg_temp.reporting_check(r->>'status'='stale','self-consistent exact old ACK is stale after a newer full revision applies');
 perform pg_temp.reporting_check(private.art33_configuration_state(d)=before_state,'self-consistent old ACK cannot change newer applied/attempt state');
 r:=public.backend_metric_snapshot(d,i,gen_random_uuid());
 perform pg_temp.reporting_check(r->'configuration'->'applied_snapshot'->>'revision'=n::text
   and r->'configuration'->'applied_snapshot'->'oxygen_report_interval_seconds'='28800'::jsonb
   and r->'configuration'->'applied_snapshot'->>'timezone'='Asia/Manila','newer revision, exact interval and applied Philippine zone survive old ACK replay');
 -- Stored nullable key remains protected even after capability loss.
 update public.devices set capabilities=capabilities||'{"independent_telemetry_v1":false}' where device_id=d;
 r:=public.art33_write_configuration(d,i,gen_random_uuid(),n,jsonb_set(s,'{oxygen_report_interval_seconds}','null'));
 perform pg_temp.reporting_check(r->>'status'='upgrade_required','incapable writer never strips a persisted negotiated key');
 update public.device_access set status='revoked' where device_id=d and installation_id=i;
 r:=public.backend_metric_snapshot(d,i,gen_random_uuid());
 perform pg_temp.reporting_check(r->>'status'='not_active','revoked snapshot denied');
 r:=public.art33_write_configuration(d,i,gen_random_uuid(),n,s);
 perform pg_temp.reporting_check(r->>'status'='not_active','revoked write denied');
end $$;
-- Incapable devices: only a locked, proven legacy projection can use legacy ACK.
do $$
declare d uuid:='33333333-3333-4333-8333-333333333333'; i uuid:='70707070-7070-4070-8070-707070707074'; verifier text; r jsonb;
 s jsonb:='{"timezone":"Asia/Manila","monitoring_limits":{"do_low_mg_l":null,"do_high_mg_l":null},"low_feed_threshold_pct":null,"schedules":[],"oxygen_report_interval_seconds":null}';
begin
 perform public.art38_provision_simulated_device(d,repeat('b',64),true);
 select encode(credential_verifier,'hex') into strict verifier from private.device_credentials where device_id=d;
 insert into auth.users(instance_id,id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,is_anonymous)
 values('00000000-0000-0000-0000-000000000000',i,'authenticated','authenticated','t07legacy@invalid.example','','{}','{}',true);
 insert into public.device_access(device_id,installation_id,status) values(d,i,'active');
 r:=public.art33_write_configuration(d,i,gen_random_uuid(),0,s);
 perform pg_temp.reporting_check(r->>'status'='ok' and not (r->'receipt'->'snapshot' ? 'oxygen_report_interval_seconds'),'server proves projected legacy null without persisting a new key');
 update public.devices set capabilities=capabilities||'{"independent_telemetry_v1":true}' where device_id=d;
 r:=public.backend_device_configuration_report(d,verifier,'{"applied_revision":null,"last_attempt_revision":null,"last_attempt_status":null,"error_code":null,"oxygen_report_interval_seconds":null}');
 perform pg_temp.reporting_check(r->>'status'='ok' and r->'desired_configuration'->'oxygen_report_interval_seconds'='null'::jsonb,'new capable sync projects legacy desired key without rewriting stored provenance');
 update public.devices set capabilities=capabilities||'{"independent_telemetry_v1":false}' where device_id=d;
 r:=public.art33_device_configuration_report(d,verifier,1,1,'applied',null);
 perform pg_temp.reporting_check(r->>'status'='ok','projected legacy-null retains legacy ACK');
 update public.devices set capabilities=capabilities||'{"independent_telemetry_v1":true}' where device_id=d;
 r:=public.art33_write_configuration(d,i,gen_random_uuid(),1,s);
 perform pg_temp.reporting_check(r->'receipt'->'snapshot' ? 'oxygen_report_interval_seconds','capable explicit null is persisted');
 update public.devices set capabilities=capabilities||'{"independent_telemetry_v1":false}' where device_id=d;
 r:=public.art33_device_configuration_report(d,verifier,2,2,'applied',null);
 perform pg_temp.reporting_check(r->>'status'='invalid','persisted null cannot use legacy ACK after capability loss');
 r:=public.art33_write_configuration(d,i,gen_random_uuid(),2,s);
 perform pg_temp.reporting_check(r->>'status'='upgrade_required','persisted null cannot be mistaken for projected null');
end $$;
-- New RPCs and private core must resist ambient default EXECUTE grants.
do $$ declare name text; role_name text; begin
 foreach name in array array['public.backend_device_configuration_report(uuid,text,jsonb)','public.backend_metric_snapshot(uuid,uuid,uuid)'] loop
   foreach role_name in array array['anon','authenticated'] loop
     perform pg_temp.reporting_check(not has_function_privilege(role_name,name,'EXECUTE'),'client EXECUTE denied');
   end loop;
   perform pg_temp.reporting_check(has_function_privilege('service_role',name,'EXECUTE'),'service RPC available');
 end loop;
 perform pg_temp.reporting_check(not has_function_privilege('service_role','private.backend_configuration_report(uuid,text,bigint,bigint,text,text)','EXECUTE'),'private core not a service bypass');
end $$;
set constraints all immediate;
rollback;
