\set ON_ERROR_STOP on
-- Parent-controlled disposable baseline only; rollback preserves every fixture.
begin;
set constraints all deferred;
set local timezone='UTC';
do $$ begin
  if current_database()<>'aquafeed_backend_test' or not exists(select 1 from backend_test.provenance where singleton and migration_fixtures_cleaned and database_oid=(select oid from pg_database where datname=current_database())) then
    raise exception 'T05 requires fresh disposable baseline';
  end if;
  if to_regprocedure('public.backend_metric_history(uuid,uuid,date,text,timestamp with time zone,text,text)') is null then raise exception 'T05_HISTORY_NOT_INSTALLED'; end if;
end $$;
create function pg_temp.check_history(ok boolean,message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'T05: %',message; end if;
end $$;
create function pg_temp.feed_fixture(d uuid,sid uuid,actual timestamptz,receipt timestamptz,event_kind text,clock_quality text)
returns void language plpgsql as $$
declare dose jsonb:='{"mode":"grams","amount_g":10}';
begin
  insert into public.feed_sequences(device_id,sequence_id,source,target_count,capabilities_revision,due_at,start_before,status,unresolved,created_at)
    values(d,sid,'scheduled',1,1,actual-interval '1 hour',actual+interval '1 minute',case when event_kind='rejected' then 'rejected' else 'completed' end,false,receipt);
  insert into public.feed_sequence_targets(device_id,sequence_id,step_index,nozzle_number,requested_dose,first_step_index,first_nozzle_number)
    values(d,sid,1,1,dose,1,1);
  insert into public.feed_steps(device_id,sequence_id,step_index,nozzle_number,requested_dose,status,measurement_quality,started_at,stopped_at)
    values(d,sid,1,1,dose,case when event_kind='rejected' then 'rejected' else 'completed' end,'unavailable',case when event_kind='running' then actual end,actual+interval '10 seconds');
  insert into public.device_events(device_id,sequence_id,event_sequence,step_index,nozzle_number,requested_dose,event_type,payload,created_at)
    values(d,sid,1,1,1,dose,event_kind,jsonb_build_object('device_at',to_char(actual at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'time_quality',clock_quality,'outcome_status',event_kind),receipt);
end $$;
do $$
declare
  d constant uuid := '22222222-2222-4222-8222-222222222222';
  installation constant uuid := '65656565-6565-4565-8565-656565656565';
  boot constant uuid := '65000000-0000-4000-8000-000000000001';
  t timestamptz := (clock_timestamp() at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila';
  r jsonb; r2 jsonb; sample jsonb; first_id text; n integer;
  sid uuid:=gen_random_uuid(); sid2 uuid:=gen_random_uuid(); sid3 uuid:=gen_random_uuid(); sid4 uuid:=gen_random_uuid(); before_rows jsonb;
begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,raw_app_meta_data,raw_user_meta_data,is_anonymous)
  values('00000000-0000-0000-0000-000000000000',installation,'authenticated','authenticated','t05@invalid.example','','{}','{}',true);
  insert into public.device_access(device_id,installation_id,status) values(d,installation,'active');
  for n in 1..51 loop
    sample:=jsonb_build_object('metric','do','boot_id',boot,'sequence',n,'measured_at',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'captured_at',null,'time_quality','synced','quality','valid','do_mg_l',5,'feed_remaining_g',null,'feed_percent',null,'calibration_revision',null);
    insert into public.device_metric_observations(device_id,metric,boot_id,sample_sequence,measured_at,captured_at,observed_at,time_basis,time_quality,quality,do_mg_l,feed_remaining_g,feed_percent,calibration_revision,received_at,input_observation)
    values(d,'do',boot,n,t,null,t,'measured','synced','valid',5,null,null,null,clock_timestamp(),sample);
  end loop;
  r:=public.backend_metric_history(d,installation,(t at time zone 'Asia/Manila')::date,'do',null,null,'known');
  perform pg_temp.check_history(r->>'status'='ok' and jsonb_array_length(r->'observations')=50 and r->'next' is not null,'50 tied records and next');
  first_id:=r#>>'{observations,0,stable_identity}';
  r2:=public.backend_metric_history(d,installation,(t at time zone 'Asia/Manila')::date,'do',(r#>>'{next,time}')::timestamptz,r#>>'{next,identity}','known');
  perform pg_temp.check_history(jsonb_array_length(r2->'observations')=1 and r2#>>'{observations,0,stable_identity}'<>first_id,'stable tied continuation');
  perform pg_temp.check_history((r2#>>'{observations,0,observed_at}')::timestamptz=t,'PH midnight inclusive');
  r2:=public.backend_metric_history(d,installation,(t at time zone 'Asia/Manila')::date-1,'do',null,null,'known');
  perform pg_temp.check_history(jsonb_array_length(r2->'observations')=0,'PH midnight exclusive previous day');
  r2:=public.backend_metric_history(d,installation,null,'all',null,null,'unknown');
  perform pg_temp.check_history(r2->>'status'='ok' and r2->'date'='null'::jsonb,'unknown query separate');
  r2:=public.backend_metric_history(d,installation,current_date,'all',null,null,'unknown');
  perform pg_temp.check_history(r2->>'status'='invalid','unknown cannot invent date');
  r2:=public.backend_metric_history(d,installation,current_date,'all',t,null,'known');
  perform pg_temp.check_history(r2->>'status'='invalid','partial cursor rejected');
  r2:=public.backend_metric_do_graph(d,installation,gen_random_uuid(),'24h',96);
  perform pg_temp.check_history(exists(select 1 from jsonb_array_elements(r2->'samples') b where b#>>'{observation,stable_identity}'=first_id),'new-only DO reaches normalized graph');
  -- One legacy combined sample creates two distinct observations; same new/legacy identity components never collide.
  insert into public.device_telemetry(device_id,boot_id,sample_sequence,measured_at,time_quality,do_mg_l,do_quality,feed_remaining_g,feed_percent,feed_quality,calibration_revision,received_at)
    values(d,boot,1,t,'synced',4,'valid',100,0.5,'valid',1,clock_timestamp());
  perform pg_temp.check_history((select count(*)=3 and count(distinct stable_identity)=3 from private.backend_history_observations(d) where stable_identity in ('legacy:do:'||boot||':1','legacy:feed:'||boot||':1','metric:do:'||boot||':1')),'legacy combined split and source-qualified identity');
  insert into public.device_telemetry(device_id,boot_id,sample_sequence,measured_at,time_quality,do_mg_l,do_quality,feed_remaining_g,feed_percent,feed_quality,calibration_revision,received_at)
    values(d,boot,900,null,'invalid',null,'error',null,null,'unavailable',null,clock_timestamp());
  r2:=public.backend_metric_history(d,installation,null,'all',null,null,'unknown');
  perform pg_temp.check_history(jsonb_array_length(r2->'observations')=2 and r2#>'{observations,0,observed_at}'='null'::jsonb and r2#>>'{observations,0,time_basis}'='unknown','unknown original clocks remain null and error quality survives');
  -- Late previous-day execution is filtered by actual source time, not upload or schedule due time.
  perform pg_temp.feed_fixture(d,sid,t-interval '1 minute',t+interval '7 minutes','running','synced');
  perform pg_temp.feed_fixture(d,sid2,t-interval '2 minutes',t+interval '7 minutes','completed','rtc');
  perform pg_temp.feed_fixture(d,sid3,t-interval '3 minutes',t+interval '7 minutes','completed','uncertain');
  perform pg_temp.feed_fixture(d,sid4,t-interval '4 minutes',t+interval '7 minutes','rejected','synced');
  select jsonb_agg(to_jsonb(s) order by s.sequence_id) into before_rows from public.feed_sequences s where s.device_id=d;
  r2:=public.backend_history_detail(d,installation,sid);
  perform pg_temp.check_history((r2#>>'{record,occurred_at}')::timestamptz=t-interval '1 minute' and (r2#>>'{record,received_at}')::timestamptz=t+interval '7 minutes','actual execution precedes late upload');
  perform pg_temp.check_history((r2#>>'{record,created_at}')::timestamptz=t+interval '7 minutes','created_at immutable');
  r2:=public.backend_history_detail(d,installation,sid2);
  perform pg_temp.check_history(r2#>'{record,started_at}'='null'::jsonb and (r2#>>'{record,occurred_at}')::timestamptz=t-interval '2 minutes','completion-only has no invented start');
  r2:=public.backend_history_detail(d,installation,sid3);
  perform pg_temp.check_history(r2#>'{record,occurred_at}'='null'::jsonb and r2#>>'{record,time_basis}'='unknown','uncertain execution stays null');
  r2:=public.backend_history_detail(d,installation,sid4);
  perform pg_temp.check_history(r2#>'{record,occurred_at}'='null'::jsonb and r2#>'{record,started_at}'='null'::jsonb,'rejected/no-start cannot gain execution from due_at or stopped_at');
  r2:=public.backend_history_page(d,installation,(t at time zone 'Asia/Manila')::date-1,(t at time zone 'Asia/Manila')::date-1,'all','all',null,null);
  perform pg_temp.check_history((r2->>'total')::integer=2,'late execution belongs to actual previous Philippine day');
  perform pg_temp.check_history(before_rows=(select jsonb_agg(to_jsonb(s) order by s.sequence_id) from public.feed_sequences s where s.device_id=d),'read-only feed history never reconciles/mutates');
  update public.device_access set status='revoked',revoked_at=clock_timestamp() where device_id=d and installation_id=installation;
  r2:=public.backend_metric_history(d,installation,current_date,'all',null,null,'known');
  perform pg_temp.check_history(r2->>'status'='not_active','revoked known read');
  r2:=public.backend_metric_history(d,installation,null,'all',null,null,'unknown');
  perform pg_temp.check_history(r2->>'status'='not_active','revoked unknown read');
  r2:=public.backend_metric_do_graph(d,installation,gen_random_uuid(),'1h',60);
  perform pg_temp.check_history(r2->>'status'='not_active','revoked graph');
  r2:=public.backend_history_page(d,installation,current_date,current_date,'all','all',null,null);
  perform pg_temp.check_history(r2->>'status'='not_active','revoked feed page');
  r2:=public.backend_history_detail(d,installation,gen_random_uuid());
  perform pg_temp.check_history(r2->>'status'='not_active','revoked detail');
  perform pg_temp.check_history(not has_function_privilege('authenticated','public.backend_metric_history(uuid,uuid,date,text,timestamptz,text,text)','execute') and not has_function_privilege('anon','public.backend_metric_do_graph(uuid,uuid,uuid,text,integer)','execute'),'service-only ACL');
end $$;
rollback;
\echo T05 history assertions passed
