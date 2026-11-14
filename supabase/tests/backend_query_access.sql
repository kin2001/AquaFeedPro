\set ON_ERROR_STOP on
-- T06 Phase A: current access semantics, not policy/index performance evidence.
begin;
set local statement_timeout='15s';
set local lock_timeout='5s';
set local timezone='UTC';
set constraints all deferred;
do $$ begin
  if current_database()<>'aquafeed_backend_test' or not exists (
    select 1 from backend_test.provenance where singleton and migration_fixtures_created and migration_fixtures_cleaned
      and database_oid=(select oid from pg_database where datname=current_database())) then
    raise exception 'T06_ACCESS_DISPOSABLE_REQUIRED';
  end if;
  if exists(select 1 from public.device_metric_observations) or exists(select 1 from public.alert_events) then
    raise exception 'T06_ACCESS_FRESH_FACTS_REQUIRED';
  end if;
end $$;
create function pg_temp.t06_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'T06_ACCESS: %',label; end if; end $$;
-- The assertion stays SECURITY INVOKER; role switches need only this test-local namespace.
do $$ begin
  execute format('grant usage on schema %I to authenticated,anon,service_role',
    (select nspname from pg_namespace where oid=pg_my_temp_schema()));
end $$;
grant execute on function pg_temp.t06_assert(boolean,text) to authenticated,anon,service_role;

insert into auth.users(id,is_anonymous) values
 ('66000000-0000-4000-8000-000000000201',true),('66000000-0000-4000-8000-000000000202',true);
insert into public.device_access(device_id,installation_id,status) values
 ('22222222-2222-4222-8222-222222222222','66000000-0000-4000-8000-000000000201','active'),
 ('33333333-3333-4333-8333-333333333333','66000000-0000-4000-8000-000000000202','active');
-- Privileged fixture obeys D -> S before downstream fact/alert writes.
select device_id from public.devices order by device_id for update;
select device_id from public.device_state order by device_id for update;
insert into public.device_config_revisions(device_id,revision,requested_snapshot,state,applied_at)
 select device_id,1,'{}','applied',clock_timestamp() from public.devices;
insert into public.device_metric_observations(device_id,metric,boot_id,sample_sequence,measured_at,observed_at,
 time_basis,time_quality,quality,do_mg_l,input_observation,received_at,first_live_sequence)
 select device_id,'do','66000000-0000-4000-8000-000000000100',1,'2026-11-13T00:00:00Z','2026-11-13T00:00:00Z',
 'measured','synced','valid',5,
 '{"metric":"do","boot_id":"66000000-0000-4000-8000-000000000100","sequence":1,"measured_at":"2026-11-13T00:00:00Z","captured_at":null,"time_quality":"synced","quality":"valid","do_mg_l":5,"feed_remaining_g":null,"feed_percent":null,"calibration_revision":null}',
 '2026-11-13T00:01:00Z',1 from public.devices;
insert into public.device_metric_current(device_id,metric,boot_id,sample_sequence,live_sequence)
 select device_id,metric,boot_id,sample_sequence,1 from public.device_metric_observations;
insert into public.device_resource_versions(device_id) select device_id from public.devices;
insert into public.alert_events(device_id,observation_metric,boot_id,sample_sequence,alert_kind,applied_revision,
 metric_value,limit_value,measured_at,is_simulated)
 select device_id,metric,boot_id,sample_sequence,'do_low',1,5,6,measured_at,true from public.device_metric_observations;
set constraints all immediate;

-- The invariant being protected: active membership, not possession of an old cursor/subject.
set local role authenticated;
select set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000201',true);
do $$ declare t text; begin
  foreach t in array array['alert_events','device_metric_observations','device_metric_current','device_resource_versions'] loop
    execute format('select pg_temp.t06_assert(count(*)=1 and bool_and(device_id=%L::uuid),%L) from public.%I',
      '22222222-2222-4222-8222-222222222222','active A / unrelated B: '||t,t);
  end loop;
end $$;
select set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000202',true);
do $$ declare t text; begin
  foreach t in array array['alert_events','device_metric_observations','device_metric_current','device_resource_versions'] loop
    execute format('select pg_temp.t06_assert(count(*)=1 and bool_and(device_id=%L::uuid),%L) from public.%I',
      '33333333-3333-4333-8333-333333333333','active B / unrelated A: '||t,t);
  end loop;
end $$;
reset role;
update public.device_access set status='revoked',revoked_at=clock_timestamp()
 where installation_id='66000000-0000-4000-8000-000000000201';
set local role authenticated;
select set_config('request.jwt.claim.sub','66000000-0000-4000-8000-000000000201',true);
do $$ declare t text; begin
  foreach t in array array['alert_events','device_metric_observations','device_metric_current','device_resource_versions'] loop
    execute format('select pg_temp.t06_assert(count(*)=0,%L) from public.%I','revoked: '||t,t);
  end loop;
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
do $$ declare t text; begin
  foreach t in array array['alert_events','device_metric_observations','device_metric_current','device_resource_versions'] loop
    execute format('select pg_temp.t06_assert(count(*)=0,%L) from public.%I','missing subject: '||t,t);
  end loop;
end $$;
reset role;
set local role anon;
do $$ declare t text; begin
  foreach t in array array['alert_events','device_metric_observations','device_metric_current','device_resource_versions'] loop
    begin
      execute format('select count(*) from public.%I',t);
      raise exception 'T06_ACCESS_ANON_READ_ALLOWED';
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;

do $$ declare s text; r text; t text; begin
  foreach s in array array[
    'public.backend_metric_history(uuid,uuid,date,text,timestamptz,text,text)',
    'public.backend_metric_do_graph(uuid,uuid,uuid,text,integer)',
    'public.backend_history_page(uuid,uuid,date,date,text,text,timestamptz,uuid)',
    'public.backend_history_detail(uuid,uuid,uuid)'] loop
    perform pg_temp.t06_assert(has_function_privilege('service_role',s,'execute'),'service required: '||s);
    foreach r in array array['anon','authenticated'] loop
      perform pg_temp.t06_assert(not has_function_privilege(r,s,'execute'),'client RPC denied: '||s);
    end loop;
  end loop;
  foreach s in array array['private.backend_history_observations(uuid)','private.backend_feed_chronology(uuid,uuid)',
    'private.backend_history_record(uuid,uuid)'] loop
    foreach r in array array['anon','authenticated','service_role'] loop
      perform pg_temp.t06_assert(not has_function_privilege(r,s,'execute'),'private helper denied: '||s);
    end loop;
  end loop;
  foreach t in array array['alert_events','device_metric_observations','device_metric_current','device_resource_versions'] loop
    perform pg_temp.t06_assert((select relrowsecurity from pg_class where oid=('public.'||t)::regclass),'RLS remains: '||t);
    foreach r in array array['anon','authenticated'] loop
      perform pg_temp.t06_assert(not has_table_privilege(r,'public.'||t,'insert,update,delete,truncate'),'client writes denied: '||t);
    end loop;
  end loop;
  perform pg_temp.t06_assert(not exists (
    select 1 from pg_constraint c left join pg_index i on i.indexrelid=c.conindid
    where c.conrelid in ('public.device_config_schedules'::regclass,'public.device_config_schedule_slots'::regclass,
      'public.device_metric_observations'::regclass,'public.device_metric_current'::regclass,'public.alert_events'::regclass)
      and c.contype in ('p','u') and (i.indexrelid is null or not i.indisvalid or not i.indisready or not i.indisunique)),
    'all constraint-owned unique indexes valid');
  perform pg_temp.t06_assert(exists(select 1 from pg_constraint where conrelid='public.device_config_schedule_slots'::regclass
    and confrelid='public.device_config_schedules'::regclass and contype='f'),'schedule targeting FK retained');
  perform pg_temp.t06_assert(exists(select 1 from pg_constraint where conrelid='public.device_metric_current'::regclass
    and confrelid='public.device_metric_observations'::regclass and contype='f'),'current observation FK retained');
  begin
    update public.device_metric_observations set do_mg_l=6;
    raise exception 'T06_ACCESS_IMMUTABILITY_LOST';
  exception when sqlstate '55000' then null; end;
  begin
    update public.alert_events set metric_value=6;
    raise exception 'T06_ACCESS_ALERT_IMMUTABILITY_LOST';
  exception when sqlstate '55000' then null; end;
  begin
    insert into public.device_metric_current values('22222222-2222-4222-8222-222222222222','feed','66000000-0000-4000-8000-000000000100',999,999);
    raise exception 'T06_ACCESS_BAD_POINTER_ALLOWED';
  exception when foreign_key_violation or sqlstate '22023' then null; end;
end $$;
set local role service_role;
do $$ declare d uuid:='33333333-3333-4333-8333-333333333333'; a uuid:='66000000-0000-4000-8000-000000000202'; r jsonb; begin
  r:=public.backend_metric_history(d,a,'2026-11-13','do');
  perform pg_temp.t06_assert(r->>'status'='ok' and jsonb_array_length(r->'observations')=1,'active readings RPC');
  perform pg_temp.t06_assert(public.backend_metric_do_graph(d,a,gen_random_uuid(),'1h',60)->>'status'='ok','active graph RPC');
  perform pg_temp.t06_assert(public.backend_metric_history('22222222-2222-4222-8222-222222222222',a,'2026-11-13','do')->>'status'='not_active','unrelated readings RPC');
end $$;
do $$ declare d uuid:='22222222-2222-4222-8222-222222222222'; a uuid:='66000000-0000-4000-8000-000000000201'; begin
  perform pg_temp.t06_assert(public.backend_metric_history(d,a,'2026-11-13','all')->>'status'='not_active','revoked readings RPC');
  perform pg_temp.t06_assert(public.backend_metric_history(d,a,null,'all',null,null,'unknown')->>'status'='not_active','revoked unknown RPC');
  perform pg_temp.t06_assert(public.backend_metric_do_graph(d,a,gen_random_uuid(),'1h',60)->>'status'='not_active','revoked graph RPC');
  perform pg_temp.t06_assert(public.backend_history_page(d,a,'2026-11-13','2026-11-13','all','all')->>'status'='not_active','revoked feed page RPC');
  perform pg_temp.t06_assert(public.backend_history_detail(d,a,gen_random_uuid())->>'status'='not_active','revoked detail RPC');
end $$;
reset role;
rollback;
\echo T06 current access assertions passed
