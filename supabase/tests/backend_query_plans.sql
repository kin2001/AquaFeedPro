\set ON_ERROR_STOP on
-- Baseline plus disposable policy A/B/A. Never run on shared SQL; no forward migration.
begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
set local timezone='UTC';
set local t06.stage='setup';
set constraints all deferred;
create temp table t06_clock as select clock_timestamp() as begun,date_trunc('second',clock_timestamp()) as anchor;
create function pg_temp.t06_check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then
    raise exception 'T06_BENCHMARK: %',label using detail='T06_STAGE: '||current_setting('t06.stage',true);
  end if;
  if clock_timestamp()>(select begun+interval '180 seconds' from t06_clock) then raise exception 'T06_WORKLOAD_DEADLINE'; end if;
end $$;
do $$ begin
  perform pg_temp.t06_check(current_database()='aquafeed_backend_test' and exists(
    select 1 from backend_test.provenance where singleton and migration_fixtures_created and migration_fixtures_cleaned
      and database_oid=(select oid from pg_database where datname=current_database())),'disposable provenance');
  perform pg_temp.t06_check(not exists(select 1 from public.devices where device_id::text like '66000000-%'),'fresh device identities');
  perform pg_temp.t06_check(not exists(select 1 from private.installation_push_tokens),'no registered tokens');
  perform pg_temp.t06_check(not exists(select 1 from private.alert_push_deliveries),'no deliveries');
  perform pg_temp.t06_check(current_setting('enable_seqscan')='on','unforced planner');
end $$;
create temp table t06_expected as select * from jsonb_to_recordset(__T06_BODIES__::jsonb) x(signature text,body_md5 text);
do $$ declare x record; begin
  for x in select * from t06_expected loop
    perform pg_temp.t06_check(exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid=to_regprocedure(x.signature) and md5(replace(p.prosrc,E'\r\n',E'\n'))=x.body_md5
        and p.prosecdef and p.proconfig=array['search_path=""']::text[] and l.lanname in ('sql','plpgsql')),'exact installed body/settings');
  end loop;
end $$;
create temp table t06_devices(device uuid primary key,do_count integer,feed_count integer,legacy_count integer,feed_sequences integer);
insert into t06_devices values
 ('66000000-0000-4000-8000-000000000001',57600,14400,28800,1440),
 ('66000000-0000-4000-8000-000000000002',28800,7200,14400,720),
 ('66000000-0000-4000-8000-000000000003',14400,3600,7200,360),
 ('66000000-0000-4000-8000-000000000004',7200,1800,3600,180),
 ('66000000-0000-4000-8000-000000000005',3600,900,1800,90);
insert into public.devices(device_id,model,firmware_version,protocol_major,is_simulated,capabilities_revision,capabilities)
 select b.device,'T06 synthetic benchmark',d.firmware_version,2,true,d.capabilities_revision,
   d.capabilities||'{"independent_telemetry_v1":true}' from t06_devices b
 cross join public.devices d where d.device_id='22222222-2222-4222-8222-222222222222';
insert into public.device_state(device_id) select device from t06_devices;
-- Test-owner D -> S prefix before Q/F/G, with deterministic cross-device order.
do $$ begin
  perform 1 from public.devices where device_id in (select device from t06_devices) order by device_id for update;
  perform 1 from public.device_state where device_id in (select device from t06_devices) order by device_id for update;
end $$;
create temp table t06_metric_fixture as
 with numbered as (
   select d.device,m.metric,n,anchor,anchor-interval '1 second'-floor((m.total-n)/4.0)*(interval '180 days'*4/m.total) as base
   from t06_devices d cross join lateral (values('do',d.do_count),('feed',d.feed_count)) m(metric,total)
   cross join lateral generate_series(1,m.total) n cross join t06_clock
 ), times as (
   select *,case when n%100=0 then null when n%100=2 then anchor+interval '1 day' else base end as measured,
     case when n%100=2 then base end as captured,case when n%100 in (0,1) then null else base end as observed,
     case when n%100=0 then 'invalid' when n%100=1 then 'uncertain' else 'synced' end as tq,
     case when n%100 in (0,1) then 'unknown' when n%100=2 then 'captured' else 'measured' end as basis,
     case when n%20=0 then 'error' else 'valid' end as quality,
     least(anchor-interval '1 microsecond',base+interval '7 minutes') as receipt
   from numbered
 ) select *,case when metric='do' and quality='valid' then 5 end::numeric as oxygen,
   case when metric='feed' and quality='valid' then 100 end::numeric as remaining,
   case when metric='feed' and quality='valid' then 0.5 end::numeric as percent,
   case when metric='feed' and quality='valid' then 1 end::bigint as calibration from times;
insert into public.device_metric_observations(device_id,metric,boot_id,sample_sequence,measured_at,captured_at,observed_at,
 time_basis,time_quality,quality,do_mg_l,feed_remaining_g,feed_percent,calibration_revision,input_observation,received_at)
 select device,metric,'66000000-0000-4000-8000-000000000100',n,measured,captured,observed,basis,tq,quality,oxygen,remaining,percent,calibration,
   jsonb_build_object('metric',metric,'boot_id','66000000-0000-4000-8000-000000000100','sequence',n,
     'measured_at',case when measured is not null then to_char(measured,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
     'captured_at',case when captured is not null then to_char(captured,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
     'time_quality',tq,'quality',quality,'do_mg_l',oxygen,'feed_remaining_g',remaining,'feed_percent',percent,'calibration_revision',calibration),receipt
 from t06_metric_fixture;
create temp table t06_legacy_fixture as
 select d.device,n,anchor,anchor-interval '1 second'-floor((d.legacy_count-n)/4.0)*(interval '180 days'*4/d.legacy_count) as base
 from t06_devices d cross join lateral generate_series(1,d.legacy_count) n cross join t06_clock;
insert into public.device_telemetry(device_id,boot_id,sample_sequence,measured_at,time_quality,do_mg_l,do_quality,
 feed_remaining_g,feed_percent,feed_quality,calibration_revision,received_at,
 input_feed_remaining_g,input_feed_percent,input_feed_quality,input_calibration_revision)
 select device,'66000000-0000-4000-8000-000000000100',n,case when n%100<>0 then base end,
   case when n%100=0 then 'invalid' when n%100=1 then 'uncertain' else 'synced' end,
   case when n%20<>0 then 5 end,case when n%20=0 then 'error' else 'valid' end,
   case when n%20<>0 then 100 end,case when n%20<>0 then 0.5 end,case when n%20=0 then 'error' else 'valid' end,
   case when n%20<>0 then 1 end,least(anchor-interval '1 microsecond',base+interval '7 minutes'),
   case when n%20<>0 then 100 end,case when n%20<>0 then 0.5 end,case when n%20=0 then 'error' else 'valid' end,
   case when n%20<>0 then 1 end from t06_legacy_fixture;
create temp table t06_feed_fixture as
 select d.device,n,('66000000-0000-4000-8'||right(d.device::text,3)||'-'||lpad(n::text,12,'0'))::uuid as sequence_id,
   anchor-interval '10 minutes 1 second'-floor((d.feed_sequences-n)/4.0)*(interval '180 days'*4/d.feed_sequences) as base
 from t06_devices d cross join lateral generate_series(1,d.feed_sequences) n cross join t06_clock;
insert into public.feed_sequences(device_id,sequence_id,source,target_count,capabilities_revision,status,unresolved,created_at)
 select device,sequence_id,'scheduled',1,3,'queued',true,base+interval '7 minutes' from t06_feed_fixture;
insert into public.feed_sequence_targets(device_id,sequence_id,step_index,nozzle_number,requested_dose,first_step_index,first_nozzle_number)
 select device,sequence_id,1,1,'{"mode":"grams","amount_g":10}',1,1 from t06_feed_fixture;
insert into public.feed_steps(device_id,sequence_id,step_index,nozzle_number,requested_dose,status,measurement_quality,started_at,stopped_at)
 select device,sequence_id,1,1,'{"mode":"grams","amount_g":10}','completed','unavailable',
   case when n%10 not in (0,1) then base end,base+interval '10 seconds' from t06_feed_fixture;
insert into public.device_events(device_id,sequence_id,event_sequence,step_index,nozzle_number,requested_dose,event_type,payload,created_at)
 select device,sequence_id,e.seq,1,1,'{"mode":"grams","amount_g":10}',e.kind,
   jsonb_build_object('device_at',to_char(base+e.offset_time,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
     'time_quality',case when n%10=0 or (n%10=1 and e.kind='running') then 'uncertain' else 'synced' end,
     'outcome_status',e.kind),base+interval '7 minutes'
 from t06_feed_fixture cross join (values(1,'accepted',interval '-1 second'),(2,'running',interval '0 seconds'),(3,'completed',interval '10 seconds')) e(seq,kind,offset_time);
update public.feed_sequences set status='completed',unresolved=false where device_id in (select device from t06_devices);
-- Real deferred integrity/FK checks must succeed before EXPLAIN, not disappear in ROLLBACK.
set constraints all immediate;
analyze public.device_metric_observations;
analyze public.device_telemetry;
analyze public.feed_sequences;
analyze public.feed_steps;
analyze public.feed_sequence_targets;
analyze public.device_events;
analyze public.alert_events;
do $$ begin
  perform pg_temp.t06_check((select count(*)=139500 and count(*) filter(where observed_at is null)=2790
    and count(*) filter(where time_basis='captured')=1395 from public.device_metric_observations),'metric counts');
  perform pg_temp.t06_check((select count(*)=55800 from public.device_telemetry),'legacy counts');
  perform pg_temp.t06_check((select count(*)=2790 from public.feed_sequences),'feed counts');
  perform pg_temp.t06_check((select count(*)=8370 from public.device_events),'journal counts');
  perform pg_temp.t06_check((select count(*)=2790 and bool_and(alert_kind='feeding_unmeasured') from public.alert_events),'real alert trigger counts');
  perform pg_temp.t06_check(not exists(select 1 from private.alert_push_deliveries),'zero deliveries');
  perform pg_temp.t06_check(not exists(select 1 from public.feed_sequences where unresolved or safety_lockout),'no open feed identities');
end $$;
select jsonb_build_object('kind','settings','postgres',version(),'settings',
 (select jsonb_object_agg(name,setting) from pg_settings where name in ('work_mem','jit','random_page_cost','seq_page_cost','effective_cache_size',
 'enable_seqscan','enable_indexscan','enable_bitmapscan','enable_sort','plan_cache_mode','statement_timeout','lock_timeout')));
select jsonb_build_object('kind','fixture','anchor',(select anchor from t06_clock),'synthetic',true,
 'devices',(select jsonb_agg(to_jsonb(d) order by device) from t06_devices d),
 'metric_rows',(select count(*) from public.device_metric_observations),'legacy_rows',(select count(*) from public.device_telemetry),
 'events',(select count(*) from public.device_events),'alerts',(select count(*) from public.alert_events),
 'normalized_rows',(select count(*) from public.device_metric_observations)+2*(select count(*) from public.device_telemetry),
 'normalized_unknown',(select count(*) from public.device_metric_observations where observed_at is null)+
   2*(select count(*) from public.device_telemetry where case when time_quality in ('synced','rtc') and measured_at<=received_at then measured_at end is null),
 'captured_rows',(select count(*) from public.device_metric_observations where time_basis='captured'),
 'tied_metric_groups',(select count(*) from (select device_id,metric,observed_at from public.device_metric_observations
   where observed_at is not null group by device_id,metric,observed_at having count(*)>1) ties),
 'metric_time_range',(select jsonb_build_array(min(observed_at),max(observed_at)) from public.device_metric_observations),
 'legacy_time_range',(select jsonb_build_array(min(measured_at),max(measured_at)) from public.device_telemetry),
 'bytes',(select jsonb_object_agg(c.relname,jsonb_build_object('table',pg_table_size(c.oid),'indexes',pg_indexes_size(c.oid)))
 from pg_class c where c.oid in ('public.device_metric_observations'::regclass,'public.device_telemetry'::regclass,'public.device_events'::regclass,'public.feed_sequences'::regclass)));
select jsonb_build_object('kind','catalog',
 'schedule_indexes',(select jsonb_agg(jsonb_build_object('name',ic.relname,'definition',pg_get_indexdef(i.indexrelid),
   'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'keys',i.indkey::text,'collations',i.indcollation::text,
   'opclasses',i.indclass::text,'options',i.indoption::text,'predicate',pg_get_expr(i.indpred,i.indrelid),
   'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'kind',contype,'definition',pg_get_constraintdef(oid))) from pg_constraint where conindid=i.indexrelid),
   'dependencies',(select jsonb_agg(jsonb_build_array(classid::regclass::text,objid,objsubid,refclassid::regclass::text,refobjid,refobjsubid,deptype))
      from pg_depend where (classid='pg_class'::regclass and objid=i.indexrelid) or (refclassid='pg_class'::regclass and refobjid=i.indexrelid))) order by ic.relname)
   from pg_index i join pg_class ic on ic.oid=i.indexrelid where i.indrelid='public.device_config_schedules'::regclass),
 'alert_policy',(select jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,'roles',polroles::text,'qual',pg_get_expr(polqual,polrelid)))
   from pg_policy where polrelid='public.alert_events'::regclass),
 'function_bodies',(select jsonb_agg(to_jsonb(e)) from t06_expected e));

-- Extract the installed SELECT, preserving function/materialization boundaries and C collation.
create function pg_temp.t06_query(sig text,params jsonb) returns text language plpgsql as $$
declare body text; lang text; item record;
begin
  select replace(p.prosrc,E'\r\n',E'\n'),l.lanname into strict body,lang from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=sig::regprocedure;
  if lang='plpgsql' then
    body:=substring(body from '(?s)  with .*');
    perform pg_temp.t06_check(body is not null and position(' into result;' in body)>0,'SELECT extraction');
    body:=split_part(body,' into result;',1);
  end if;
  for item in select key,value from jsonb_each_text(params) order by length(key) desc loop
    body:=regexp_replace(body,'\m'||item.key||'\M',item.value,'g');
  end loop;
  return body;
end $$;
create function pg_temp.t06_plan(label text,query text) returns jsonb language plpgsql as $$
declare p jsonb;
begin
  perform pg_temp.t06_check(true,'capture deadline');
  execute 'explain (analyze,buffers,wal,settings,format json) '||query into p;
  perform pg_temp.t06_check(octet_length(p::text)<240000,'per-capture bytes');
  return jsonb_build_object('label',label,'query_md5',md5(query),'plan',p);
end $$;
-- These are actual helper-body plans, NOT evidence that outer filters push through the helper.
create function pg_temp.t06_helpers() returns setof jsonb language plpgsql as $$
declare d record; q text; n bigint; unknowns bigint;
begin
  for d in select * from t06_devices order by device loop
    q:=pg_temp.t06_query('private.backend_history_observations(uuid)',jsonb_build_object('p_device_id',quote_literal(d.device)||'::uuid'));
    return next pg_temp.t06_plan('normalized-helper',q)||jsonb_build_object('kind','helper','device',right(d.device::text,1));
    select count(*),count(*) filter(where observed_at is null) into n,unknowns from private.backend_history_observations(d.device);
    perform pg_temp.t06_check(n=d.do_count+d.feed_count+2*d.legacy_count and unknowns=n/50,'normalized/source-qualified counts');
  end loop;
end $$;
set local t06.stage='helpers';
select * from pg_temp.t06_helpers();

-- Independent fixture keys/time oracle; never used by the production SELECT or its EXPLAIN.
create temp table t06_reference as
 select device,metric,observed as observed_at,receipt as received_at,
   'metric:'||metric||':66000000-0000-4000-8000-000000000100:'||n as identity from t06_metric_fixture
 union all
 select device,metric,case when n%100 not in (0,1) then base end,
   least(anchor-interval '1 microsecond',base+interval '7 minutes'),
   'legacy:'||metric||':66000000-0000-4000-8000-000000000100:'||n
 from t06_legacy_fixture cross join (values('do'),('feed')) m(metric);
create temp table t06_queries(device uuid,label text,query text,primary key(device,label));
create temp table t06_results(device uuid,label text,fingerprint text,row_count integer,primary key(device,label));
create function pg_temp.t06_prepare(d uuid) returns void language plpgsql as $$
declare a timestamptz; lo timestamptz; hi timestamptz; metric text; mode text; graph_window text; range_name text; n integer; probe_n integer;
 p jsonb; q text; r jsonb; cursor_time text; cursor_id text; period integer; sid uuid;
begin
  select anchor into a from t06_clock;
  foreach mode in array array['known','unknown'] loop
    lo:=case when mode='known' then ((a at time zone 'Asia/Manila')::date-1)::timestamp at time zone 'Asia/Manila' else a-interval '366 days' end;
    hi:=case when mode='known' then (a at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila' else a end;
    foreach metric in array array['all','do','feed'] loop
      p:=jsonb_build_object('p_device_id',quote_literal(d)||'::uuid','p_metric',quote_literal(metric),'p_time_mode',quote_literal(mode),
        'p_date',case when mode='known' then quote_literal((a at time zone 'Asia/Manila')::date-1)||'::date' else 'null::date' end,
        'start_at',quote_literal(lo)||'::timestamptz','end_at',quote_literal(hi)||'::timestamptz','now_at',quote_literal(a)||'::timestamptz',
        'p_cursor_time','null::timestamptz','p_cursor_identity','null::text');
      q:=pg_temp.t06_query('public.backend_metric_history(uuid,uuid,date,text,timestamptz,text,text)',p);
      insert into t06_queries values(d,mode||'-'||metric||'-first',q);
      execute q into r;
      -- Sparse slow-device known pages can legitimately have no continuation.
      cursor_time:=coalesce(r#>>'{next,time}',case when mode='known' then r#>>'{observations,-1,observed_at}' else r#>>'{observations,-1,received_at}' end,lo::text);
      cursor_id:=coalesce(r#>>'{next,identity}',r#>>'{observations,-1,stable_identity}','metric:do:66000000-0000-4000-8000-000000000100:0');
      p:=p||jsonb_build_object('p_cursor_time',quote_literal(cursor_time)||'::timestamptz','p_cursor_identity',quote_literal(cursor_id)||'::text');
      insert into t06_queries values(d,mode||'-'||metric||'-next',pg_temp.t06_query('public.backend_metric_history(uuid,uuid,date,text,timestamptz,text,text)',p));
    end loop;
  end loop;
  foreach graph_window in array array['1h','6h','24h'] loop
    period:=case graph_window when '1h' then 1 when '6h' then 6 else 24 end; n:=case graph_window when '1h' then 60 when '6h' then 72 else 96 end;
    p:=jsonb_build_object('p_device_id',quote_literal(d)||'::uuid','p_request_id',quote_literal('66000000-0000-4000-8000-000000000300')||'::uuid',
      'p_window',quote_literal(graph_window),'p_count',n::text,'end_at',quote_literal(a)||'::timestamptz',
      'start_at',quote_literal(a-period*interval '1 hour')||'::timestamptz','span',quote_literal(period*interval '1 hour'/n)||'::interval');
    insert into t06_queries values(d,'graph-'||graph_window,pg_temp.t06_query('public.backend_metric_do_graph(uuid,uuid,uuid,text,integer)',p));
  end loop;
  foreach range_name in array array['7','180','completed'] loop
    period:=case when range_name='7' then 7 else 180 end;
    p:=jsonb_build_object('p_device_id',quote_literal(d)||'::uuid','p_source',quote_literal('all'),
      'p_status',quote_literal(case when range_name='completed' then 'completed' else 'all' end),
      'from_day',quote_literal((a at time zone 'Asia/Manila')::date-period+1)||'::date','to_day',quote_literal((a at time zone 'Asia/Manila')::date)||'::date',
      'p_before_created_at','null::timestamptz','p_before_sequence_id','null::uuid');
    q:=pg_temp.t06_query('public.backend_history_page(uuid,uuid,date,date,text,text,timestamptz,uuid)',p);
    insert into t06_queries values(d,'feed-'||range_name||'-first',q);
    execute q into r;
    p:=p||jsonb_build_object('p_before_created_at',quote_literal(r#>>'{next,created_at}')||'::timestamptz',
      'p_before_sequence_id',quote_literal(r#>>'{next,sequence_id}')||'::uuid');
    insert into t06_queries values(d,'feed-'||range_name||'-next',pg_temp.t06_query('public.backend_history_page(uuid,uuid,date,date,text,text,timestamptz,uuid)',p));
  end loop;
  for range_name,probe_n in values('start',2),('complete',1),('unknown',10) loop
    select sequence_id into strict sid from t06_feed_fixture where device=d and t06_feed_fixture.n=probe_n;
    q:=pg_temp.t06_query('private.backend_feed_chronology(uuid,uuid)',jsonb_build_object('p_device_id',quote_literal(d)||'::uuid','p_sequence_id',quote_literal(sid)||'::uuid'));
    -- Negative control: an extracted SELECT does not inherit RETURNS TABLE names.
    execute 'select to_jsonb(x) from ('||q||') x' into r;
    perform pg_temp.t06_check(not (r ?& array['occurred_at','started_at','completed_at','received_at']),
      'raw chronology lacks declared output names');
    insert into t06_queries values(d,'chron-'||range_name,
      'select to_jsonb(x) from ('||q||') x(occurred_at,started_at,completed_at,received_at)');
  end loop;
end $$;
-- Independent top-level statements keep timeout effective per query, not per whole matrix.
set local t06.stage='prepare';
do $$ begin perform pg_temp.t06_prepare('66000000-0000-4000-8000-000000000001'); end $$;
do $$ begin perform pg_temp.t06_prepare('66000000-0000-4000-8000-000000000005'); end $$;
set local statement_timeout='12s';
create function pg_temp.t06_warmup(d uuid,k text) returns void language plpgsql as $$
declare x record; r jsonb; count_rows integer; expected_keys jsonb; actual_keys jsonb; a timestamptz;
 lo timestamptz; hi timestamptz; offset_rows integer; filter_metric text; expected_count integer;
begin
    select anchor into a from t06_clock;
    offset_rows:=case when k like '%-next' then 50 else 0 end;
    select * into strict x from t06_queries where device=d and label=k;
    perform pg_temp.t06_check(true,'warmup deadline');
    execute x.query into r; -- One unreported warmup and fixed full-result reference.
    perform pg_temp.t06_check(r is not null,'non-null query result');
    if x.label like 'known-%' or x.label like 'unknown-%' then
      count_rows:=jsonb_array_length(r->'observations');
      perform pg_temp.t06_check(count_rows<=50 and r->>'status'='ok','reading shape');
      perform pg_temp.t06_check(not exists(select 1 from jsonb_array_elements(r->'observations') v
        where (v->>'observed_at' is null)<>(x.label like 'unknown-%')),'honest unknown time');
      filter_metric:=split_part(k,'-',2);
      lo:=case when k like 'known-%' then ((a at time zone 'Asia/Manila')::date-1)::timestamp at time zone 'Asia/Manila' else a-interval '366 days' end;
      hi:=case when k like 'known-%' then (a at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila' else a end;
      select coalesce(jsonb_agg(identity order by sort_time desc,identity collate "C" desc),'[]') into expected_keys from (
        select identity,case when k like 'known-%' then observed_at else received_at end as sort_time
        from t06_reference where device=d and (filter_metric='all' or metric=filter_metric)
          and case when k like 'known-%' then observed_at>=lo and observed_at<hi
            else observed_at is null and received_at>=lo and received_at<hi end
        order by sort_time desc,identity collate "C" desc limit 50 offset offset_rows) reference_page;
      select coalesce(jsonb_agg(v->>'stable_identity' order by position),'[]') into actual_keys
        from jsonb_array_elements(r->'observations') with ordinality item(v,position);
      perform pg_temp.t06_check(actual_keys=expected_keys,'independent exact reading scope/C-order/cursor');
    elsif x.label like 'graph-%' then
      count_rows:=jsonb_array_length(r->'samples');
      perform pg_temp.t06_check(count_rows=(r->>'requested_count')::integer,'graph buckets');
      lo:=(r->>'window_start')::timestamptz; hi:=(r->>'window_end')::timestamptz;
      with eligible as (
        select identity,observed_at,floor(extract(epoch from observed_at-lo)*count_rows/extract(epoch from hi-lo))::integer as bucket
        from t06_reference where device=d and metric='do' and observed_at>=lo and observed_at<hi
      ), grouped as (
        select bucket,count(*) as samples,(array_agg(identity order by observed_at desc,identity collate "C" desc))[1] as last_id
        from eligible group by bucket
      ) select jsonb_agg(jsonb_build_array(coalesce(samples,0),last_id) order by n) into expected_keys
        from generate_series(0,count_rows-1) n left join grouped on bucket=n;
      select jsonb_agg(jsonb_build_array((v->>'sample_count')::integer,v#>>'{observation,stable_identity}') order by position) into actual_keys
        from jsonb_array_elements(r->'samples') with ordinality item(v,position);
      perform pg_temp.t06_check(actual_keys=expected_keys,'independent graph count/last reading');
      select count(*) into expected_count from t06_reference where device=d and metric='do' and observed_at is null and received_at>=lo and received_at<hi;
      perform pg_temp.t06_check((r->>'invalid_time_sample_count')::integer=expected_count,'independent graph unknown count');
    elsif x.label like 'feed-%' then count_rows:=jsonb_array_length(r->'records');
      perform pg_temp.t06_check(count_rows<=50 and (r->>'total')::integer>0,'feed shape');
      lo:=((a at time zone 'Asia/Manila')::date-case when k like 'feed-7-%' then 6 else 179 end)::timestamp at time zone 'Asia/Manila';
      hi:=((a at time zone 'Asia/Manila')::date+1)::timestamp at time zone 'Asia/Manila';
      select coalesce(jsonb_agg(sequence_id order by sort_time desc,sequence_id desc),'[]') into expected_keys from (
        select sequence_id,case when n%10=0 then base+interval '7 minutes' when n%10=1 then base+interval '10 seconds' else base end as sort_time
        from t06_feed_fixture where device=d) f where sort_time>=lo and sort_time<hi;
      perform pg_temp.t06_check(jsonb_array_length(expected_keys)=(r->>'total')::integer,'independent feed total');
      select coalesce(jsonb_agg(v order by position),'[]') into expected_keys
        from jsonb_array_elements(expected_keys) with ordinality item(v,position) where position>offset_rows and position<=offset_rows+50;
      select coalesce(jsonb_agg(v->>'sequence_id' order by position),'[]') into actual_keys
        from jsonb_array_elements(r->'records') with ordinality item(v,position);
      perform pg_temp.t06_check(actual_keys=expected_keys,'independent feed chronology/cursor');
    else count_rows:=1;
      select jsonb_build_object('occurred_at',case when n%10=0 then null when n%10=1 then base+interval '10 seconds' else base end,
        'started_at',case when n%10 not in (0,1) then base end,'completed_at',case when n%10<>0 then base+interval '10 seconds' end,
        'received_at',base+interval '7 minutes') into expected_keys from t06_feed_fixture
        where device=d and n=case k when 'chron-start' then 2 when 'chron-complete' then 1 else 10 end;
      perform pg_temp.t06_check(r=expected_keys,'independent exact source chronology/receipt');
    end if;
    insert into t06_results values(d,k,md5(r::text),count_rows);
end $$;
set local t06.stage='warmup';
select format('do $warm$ begin perform pg_temp.t06_warmup(%L::uuid,%L); end $warm$;',device,label)
 from t06_queries order by device,label
\gexec
select jsonb_build_object('kind','correctness','label',label,'fingerprint',fingerprint,'rows',row_count)
 from t06_results where right(device::text,1)='5' order by label;
create function pg_temp.t06_measure(d uuid,k text,iteration integer) returns jsonb language plpgsql as $$
declare x record; baseline record; r jsonb; captured jsonb;
begin
  select * into strict x from t06_queries where device=d and label=k;
  select * into strict baseline from t06_results where device=d and label=k;
  captured:=pg_temp.t06_plan(k,x.query);
  execute x.query into r;
  perform pg_temp.t06_check(md5(r::text)=baseline.fingerprint,'full-result fingerprint equality');
  return captured||jsonb_build_object('kind','query','repetition',iteration,'fingerprint',baseline.fingerprint,'rows',baseline.row_count);
end $$;
set local t06.stage='measure';
select format('select pg_temp.t06_measure(%L::uuid,%L,%s);',device,label,n)
 from t06_queries cross join generate_series(1,3) n where right(device::text,1)='1' order by label,n
\gexec

-- Each write probe uses the real tables/checks/FKs/triggers, then rolls back its own inserts.
create function pg_temp.t06_write(metric_rows boolean,repetition integer) returns jsonb language plpgsql as $$
declare q text; p jsonb; relation regclass; before_bytes jsonb; boot text;
begin
  if metric_rows then
    q:=$q$insert into public.device_metric_observations(device_id,metric,boot_id,sample_sequence,measured_at,observed_at,time_basis,time_quality,quality,
      do_mg_l,feed_remaining_g,feed_percent,calibration_revision,input_observation,received_at)
    select d.device,m.metric,'66000000-0000-4000-8000-000000000111',n,anchor,anchor,'measured','synced','valid',
      case when m.metric='do' then 5 end,case when m.metric='feed' then 100 end,case when m.metric='feed' then 0.5 end,case when m.metric='feed' then 1 end,
      jsonb_build_object('metric',m.metric,'boot_id','66000000-0000-4000-8000-000000000111','sequence',n,'measured_at',to_char(anchor,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'captured_at',null,'time_quality','synced','quality','valid','do_mg_l',case when m.metric='do' then 5 end,
        'feed_remaining_g',case when m.metric='feed' then 100 end,'feed_percent',case when m.metric='feed' then 0.5 end,'calibration_revision',case when m.metric='feed' then 1 end),anchor
    from t06_devices d cross join generate_series(1,1000) n cross join lateral (select case when n%2=0 then 'do' else 'feed' end as metric) m cross join t06_clock$q$;
  else
    q:=$q$insert into public.device_telemetry(device_id,boot_id,sample_sequence,measured_at,time_quality,do_mg_l,do_quality,feed_remaining_g,feed_percent,feed_quality,calibration_revision,received_at)
    select device,'66000000-0000-4000-8000-000000000111',n,anchor,'synced',5,'valid',100,0.5,'valid',1,anchor
    from t06_devices cross join generate_series(1,500) n cross join t06_clock$q$;
  end if;
  boot:='66000000-0000-4000-8000-00000000011'||repetition;
  q:=replace(q,'66000000-0000-4000-8000-000000000111',boot);
  relation:=case when metric_rows then 'public.device_metric_observations'::regclass else 'public.device_telemetry'::regclass end;
  before_bytes:=jsonb_build_object('table',pg_table_size(relation),'indexes',pg_indexes_size(relation));
  p:=pg_temp.t06_plan(case when metric_rows then 'metric-insert-5000' else 'legacy-insert-2500' end,q);
  if metric_rows then
    perform pg_temp.t06_check((select count(*)=5000 from public.device_metric_observations where boot_id=boot::uuid),'metric inserted rows');
  else
    perform pg_temp.t06_check((select count(*)=2500 from public.device_telemetry where boot_id=boot::uuid),'legacy inserted rows');
  end if;
  return p||jsonb_build_object('kind','write','repetition',repetition,'rows',case when metric_rows then 5000 else 2500 end,
    'bytes_before',before_bytes,'bytes_after',jsonb_build_object('table',pg_table_size(relation),'indexes',pg_indexes_size(relation)));
end $$;
set local t06.stage='write';
savepoint t06_write;
select pg_temp.t06_write(true,1);
select pg_temp.t06_write(false,1);
rollback to savepoint t06_write;
select pg_temp.t06_write(true,2);
select pg_temp.t06_write(false,2);
rollback to savepoint t06_write;
select pg_temp.t06_write(true,3);
select pg_temp.t06_write(false,3);
rollback to savepoint t06_write;
do $$ begin
  perform pg_temp.t06_check(not exists(select 1 from public.device_metric_observations where boot_id in ('66000000-0000-4000-8000-000000000111','66000000-0000-4000-8000-000000000112','66000000-0000-4000-8000-000000000113'))
    and not exists(select 1 from public.device_telemetry where boot_id in ('66000000-0000-4000-8000-000000000111','66000000-0000-4000-8000-000000000112','66000000-0000-4000-8000-000000000113')),'write rollback');
end $$;

-- SELECT-policy-only control: no index changes or extra write probes.
set local t06.stage='policy';
insert into auth.users(id,is_anonymous) values
 ('66000000-0000-4000-8000-000000000201',true),('66000000-0000-4000-8000-000000000202',true);
insert into public.device_access(device_id,installation_id,status) values
 ('66000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000201','active'),
 ('66000000-0000-4000-8000-000000000002','66000000-0000-4000-8000-000000000202','active');

-- Hash exact catalog rows (including column ACLs, bodies, constraints and dependencies).
-- Only the one target polqual is excluded from the unchanged-catalog fingerprint.
create function pg_temp.t06_policy_catalog() returns jsonb language sql as $$
 with namespaces as (select oid from pg_namespace where nspname in ('public','private','auth')),
 relations as (select c.* from pg_class c where c.relnamespace in (select oid from namespaces)),
 functions as (select p.* from pg_proc p where p.pronamespace in (select oid from namespaces))
 select jsonb_build_object('qual',(select pg_get_expr(polqual,polrelid) from pg_policy
   where polrelid='public.alert_events'::regclass and polname='alert_events_active_member_select'),
 'unchanged_md5',md5(jsonb_build_object(
   'schemas',(select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n where oid in (select oid from namespaces)),
   'relations',(select jsonb_agg(to_jsonb(c) order by c.oid) from relations c),
   'columns',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a where attrelid in (select oid from relations)),
   'indexes',(select jsonb_agg(to_jsonb(i) order by indexrelid) from pg_index i where indrelid in (select oid from relations)),
   'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c where connamespace in (select oid from namespaces)),
   'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t where tgrelid in (select oid from relations)),
   'policies',(select jsonb_agg(case when polrelid='public.alert_events'::regclass and polname='alert_events_active_member_select'
     then to_jsonb(p)-'polqual' else to_jsonb(p) end order by p.oid) from pg_policy p where polrelid in (select oid from relations)),
   'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from functions p),
   'dependencies',(select jsonb_agg(to_jsonb(d) order by to_jsonb(d)::text) from pg_depend d where
     (classid='pg_class'::regclass and objid in (select oid from relations)) or
     (refclassid='pg_class'::regclass and refobjid in (select oid from relations)) or
     (classid='pg_proc'::regclass and objid in (select oid from functions)) or
     (refclassid='pg_proc'::regclass and refobjid in (select oid from functions))),
   'roles',(select jsonb_agg(to_jsonb(r)-'rolpassword' order by oid) from pg_roles r where rolname in ('anon','authenticated','service_role')),
   'memberships',(select jsonb_agg(to_jsonb(m) order by to_jsonb(m)::text) from pg_auth_members m)
 )::text))
$$;
create function pg_temp.t06_policy_fixture() returns text language plpgsql as $$
declare t text; fingerprint text; result jsonb:='{}';
begin
  foreach t in array array['auth.users','public.devices','public.device_state','public.device_access',
    'public.device_config_revisions','public.device_config_schedules','public.device_config_schedule_slots',
    'public.device_metric_observations','public.device_metric_current','public.device_resource_versions','public.device_telemetry',
    'public.feed_sequences','public.feed_sequence_targets','public.feed_steps','public.device_events','public.scheduled_occurrences',
    'public.device_execution_reservations','public.alert_events','private.device_alert_state','private.installation_alert_event_state',
    'private.installation_alert_bulk_state','private.installation_push_tokens','private.alert_push_deliveries','private.alert_push_sender_state'] loop
    execute format('select md5(coalesce(string_agg(md5(to_jsonb(x)::text),'''' order by md5(to_jsonb(x)::text)),'''')) from %s x',t::regclass) into fingerprint;
    result:=result||jsonb_build_object(t,fingerprint);
  end loop;
  return md5(result::text);
end $$;
create function pg_temp.t06_policy_hash(q text) returns jsonb language plpgsql as $$
declare n integer; fingerprint text;
begin
  execute 'select count(*)::integer,md5(coalesce(jsonb_agg(jsonb_build_array(event_id,raised_at) order by raised_at desc,event_id desc),''[]''::jsonb)::text) from ('||q||') x'
    into n,fingerprint;
  return jsonb_build_object('rows',n,'fingerprint',fingerprint);
end $$;
-- The expected owner-visible sets use a fixed synthetic membership map, NOT the RLS predicate.
create temp table t06_policy_reference(label text primary key,full_result jsonb,page_result jsonb);
insert into t06_policy_reference
 select label,pg_temp.t06_policy_hash('select event_id,raised_at from public.alert_events where device_id='||quote_literal(device)||'::uuid'),
   pg_temp.t06_policy_hash('select event_id,raised_at from public.alert_events where device_id='||quote_literal(device)||'::uuid order by raised_at desc,event_id desc limit 50')
 from (values('activeA','66000000-0000-4000-8000-000000000001'),('activeB','66000000-0000-4000-8000-000000000002')) m(label,device);
insert into t06_policy_reference select label,
 jsonb_build_object('rows',0,'fingerprint',md5(case when label='anon' then '42501' else '[]' end)),
 jsonb_build_object('rows',0,'fingerprint',md5(case when label='anon' then '42501' else '[]' end))
 from (values('unrelated'),('revoked'),('missing'),('anon')) m(label);
create temp table t06_policy_cursor as select raised_at,event_id from public.alert_events
 where device_id='66000000-0000-4000-8000-000000000001' order by raised_at desc,event_id desc offset 49 limit 1;
do $$ begin
  perform pg_temp.t06_check((select full_result->>'rows'='1440' and page_result->>'rows'='50' from t06_policy_reference where label='activeA')
    and (select full_result->>'rows'='720' and page_result->>'rows'='50' from t06_policy_reference where label='activeB')
    and (select count(*)=1 from t06_policy_cursor),'policy fixture');
  execute format('grant usage on schema %I to authenticated,anon',(select nspname from pg_namespace where oid=pg_my_temp_schema()));
end $$;
grant select on t06_clock,t06_policy_reference,t06_policy_cursor to authenticated,anon;

create function pg_temp.t06_policy_context(subject text,expected_role text) returns jsonb language plpgsql as $$
declare uid uuid; matched boolean; rls boolean; r record; owned boolean;
begin
  uid:=case subject when 'subjectA' then '66000000-0000-4000-8000-000000000201'::uuid
    when 'subjectB' then '66000000-0000-4000-8000-000000000202'::uuid end;
  matched:=auth.uid() is not distinct from uid
    and current_setting('request.jwt.claim.sub',true)=coalesce(uid::text,'')
    and current_setting('request.jwt.claims',true)::jsonb=case when uid is null then '{}'::jsonb else jsonb_build_object('sub',uid) end;
  select * into strict r from pg_roles where rolname=current_user;
  select relowner=r.oid into owned from pg_class where oid='public.alert_events'::regclass;
  rls:=row_security_active('public.alert_events') and current_setting('row_security')='on';
  perform pg_temp.t06_check(subject in ('subjectA','subjectB','none') and expected_role in ('authenticated','anon')
    and current_user=expected_role and matched and rls and not r.rolsuper and not r.rolbypassrls and not owned,'policy role/JWT/RLS');
  return jsonb_build_object('role',current_user,'subject',subject,'claims_match',matched,'rls',rls,
    'superuser',r.rolsuper,'bypassrls',r.rolbypassrls,'owner',owned);
end $$;
create function pg_temp.t06_policy_case(k text) returns jsonb language plpgsql as $$
declare reference record; full_result jsonb; page_result jsonb; context jsonb; subject text; scope text; state text:='00000';
begin
  select * into strict reference from t06_policy_reference where label=k;
  subject:=case k when 'activeB' then 'subjectB' when 'missing' then 'none' when 'anon' then 'none' else 'subjectA' end;
  context:=pg_temp.t06_policy_context(subject,case when k='anon' then 'anon' else 'authenticated' end);
  scope:=' where device_id='||quote_literal(case when k in ('activeB','unrelated') then '66000000-0000-4000-8000-000000000002' else '66000000-0000-4000-8000-000000000001' end)||'::uuid';
  begin
    full_result:=pg_temp.t06_policy_hash('select event_id,raised_at from public.alert_events'||case when k='unrelated' then scope else '' end);
    page_result:=pg_temp.t06_policy_hash('select event_id,raised_at from public.alert_events'||scope||
      case when k='revoked' then ' and (raised_at,event_id)<(select raised_at,event_id from t06_policy_cursor)' else '' end||
      ' order by raised_at desc,event_id desc limit 50');
  exception when insufficient_privilege then
    if k<>'anon' then raise; end if;
    state:='42501';
    full_result:=jsonb_build_object('rows',0,'fingerprint',md5('42501')); page_result:=full_result;
  end;
  perform pg_temp.t06_check(full_result=reference.full_result and page_result=reference.page_result
    and (state='42501')=(k='anon'),'policy result fingerprints');
  return jsonb_build_object('label',k,'rows',(full_result->>'rows')::integer,'page_rows',(page_result->>'rows')::integer,
    'full_fingerprint',full_result->>'fingerprint','page_fingerprint',page_result->>'fingerprint',
    'expected_full',reference.full_result->>'fingerprint','expected_page',reference.page_result->>'fingerprint',
    'sqlstate',state,'context',context);
end $$;
-- SECURITY INVOKER coordinator; every alert probe runs after an actual SET ROLE.
create function pg_temp.t06_policy_access() returns jsonb language plpgsql as $$
declare cases jsonb:='[]'; revoked jsonb;
begin
  perform set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000201',true);
  perform set_config('request.jwt.claims','{"sub":"66000000-0000-4000-8000-000000000201"}',true);
  execute 'set local role authenticated'; cases:=cases||jsonb_build_array(pg_temp.t06_policy_case('activeA')); execute 'reset role';
  perform set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000202',true);
  perform set_config('request.jwt.claims','{"sub":"66000000-0000-4000-8000-000000000202"}',true);
  execute 'set local role authenticated'; cases:=cases||jsonb_build_array(pg_temp.t06_policy_case('activeB')); execute 'reset role';
  perform set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000201',true);
  perform set_config('request.jwt.claims','{"sub":"66000000-0000-4000-8000-000000000201"}',true);
  execute 'set local role authenticated'; cases:=cases||jsonb_build_array(pg_temp.t06_policy_case('unrelated')); execute 'reset role';
  begin
    update public.device_access set status='revoked',revoked_at=clock_timestamp()
      where installation_id='66000000-0000-4000-8000-000000000201' and device_id='66000000-0000-4000-8000-000000000001';
    execute 'set local role authenticated'; revoked:=pg_temp.t06_policy_case('revoked'); execute 'reset role';
    -- Exception subtransaction rolls back the revocation AND role/config changes, not PL/pgSQL variables.
    raise exception using errcode='Z0600',message='T06 test-local revocation rollback';
  exception when sqlstate 'Z0600' then null; end;
  cases:=cases||jsonb_build_array(revoked);
  perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated'; cases:=cases||jsonb_build_array(pg_temp.t06_policy_case('missing')); execute 'reset role';
  execute 'set local role anon'; cases:=cases||jsonb_build_array(pg_temp.t06_policy_case('anon')); execute 'reset role';
  return cases;
end $$;
-- Pinned PG17 predecessor deparse from the actual Phase A catalog, not a permissive parser.
create temp table t06_policy_saved as select pg_temp.t06_policy_catalog() as catalog,pg_temp.t06_policy_fixture() as fixture,
 E'(EXISTS ( SELECT 1\n   FROM device_access a\n  WHERE ((a.device_id = alert_events.device_id) AND (a.installation_id = auth.uid()) AND (a.status = ''active''::text))))' as qual;
do $$ begin
  perform pg_temp.t06_check((select catalog->>'qual'=qual from t06_policy_saved)
    and (select count(*)=1 and bool_and(polcmd='r' and polpermissive and polwithcheck is null
      and polroles=array[(select oid from pg_roles where rolname='authenticated')]) from pg_policy where polrelid='public.alert_events'::regclass)
    and (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.alert_events'::regclass),'policy predecessor');
end $$;
create function pg_temp.t06_policy_run(phase text) returns setof jsonb language plpgsql as $$
declare saved record; catalog jsonb; fixture text; expected_qual text; cases jsonb; k text; q text; n integer; context jsonb;
begin
  perform pg_temp.t06_check(phase in ('A','B','A2') and current_user=session_user,'policy phase');
  select * into strict saved from t06_policy_saved;
  catalog:=pg_temp.t06_policy_catalog();
  expected_qual:=case when phase='B' then replace(saved.qual,'a.installation_id = auth.uid()',
    'a.installation_id = ( SELECT auth.uid() AS uid)') else saved.qual end;
  perform pg_temp.t06_check(catalog->>'qual'=expected_qual,'policy qualifier');
  perform pg_temp.t06_check(catalog->>'unchanged_md5'=saved.catalog->>'unchanged_md5'
    and (phase='B' or catalog=saved.catalog),'policy catalog restoration');
  cases:=pg_temp.t06_policy_access();
  perform set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000201',true);
  perform set_config('request.jwt.claims','{"sub":"66000000-0000-4000-8000-000000000201"}',true);
  execute 'set local role authenticated';
  context:=pg_temp.t06_policy_context('subjectA','authenticated');
  foreach k in array array['alert-page','alert-visible-count'] loop
    q:=case k when 'alert-page' then
      'select event_id,raised_at from public.alert_events where device_id=''66000000-0000-4000-8000-000000000001''::uuid order by raised_at desc,event_id desc limit 50'
      else 'select count(*) from public.alert_events' end;
    execute q; -- One unreported authenticated warmup per query per phase.
    for n in 1..3 loop
      return next pg_temp.t06_plan(k,q)||jsonb_build_object('kind','policy-plan','phase',phase,'repetition',n,'context',context);
    end loop;
  end loop;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claims','{}',true);
  perform pg_temp.t06_check(pg_temp.t06_policy_catalog()=catalog,'policy catalog restoration');
  fixture:=pg_temp.t06_policy_fixture();
  perform pg_temp.t06_check(fixture=saved.fixture,'policy fixture restoration');
  perform pg_temp.t06_check((select count(*)=2 from auth.users where id in ('66000000-0000-4000-8000-000000000201','66000000-0000-4000-8000-000000000202'))
    and (select count(*)=2 and bool_and(status='active' and revoked_at is null and
      (installation_id,device_id) in (('66000000-0000-4000-8000-000000000201'::uuid,'66000000-0000-4000-8000-000000000001'::uuid),
      ('66000000-0000-4000-8000-000000000202'::uuid,'66000000-0000-4000-8000-000000000002'::uuid))) from public.device_access
      where installation_id in ('66000000-0000-4000-8000-000000000201','66000000-0000-4000-8000-000000000202')),'policy fixture');
  return next jsonb_build_object('kind','policy-control','phase',phase,'cases',cases,'auth_rows',2,'memberships',2,'qual_matches',true,
    'qual_md5',md5(catalog->>'qual'),'catalog_md5',md5(catalog::text),'unchanged_md5',catalog->>'unchanged_md5','fixture_md5',fixture);
end $$;
select * from pg_temp.t06_policy_run('A');
savepoint t06_policy_control;
alter policy alert_events_active_member_select on public.alert_events using (exists (
 select 1 from public.device_access a where a.device_id=alert_events.device_id
 and a.installation_id=(select auth.uid()) and a.status='active'));
select * from pg_temp.t06_policy_run('B');
rollback to savepoint t06_policy_control;
select * from pg_temp.t06_policy_run('A2');
rollback;
do $$ begin
  if exists(select 1 from auth.users where id in ('66000000-0000-4000-8000-000000000201','66000000-0000-4000-8000-000000000202'))
    or exists(select 1 from public.device_access where installation_id in ('66000000-0000-4000-8000-000000000201','66000000-0000-4000-8000-000000000202'))
    or exists(select 1 from public.devices where device_id::text like '66000000-%')
    or exists(select 1 from public.device_metric_observations) or exists(select 1 from public.device_events)
    or exists(select 1 from public.feed_sequences) or exists(select 1 from public.alert_events)
    or exists(select 1 from private.alert_push_deliveries) then raise exception 'T06_FIXTURE_ROLLBACK_FAILED'; end if;
end $$;
select jsonb_build_object('kind','rollback','clean',true);
