\set ON_ERROR_STOP on
-- B1 DRAFT: real PostgreSQL assertions against the guarded SUBSTITUTED transport.
-- Not native socket/probe/partition evidence; no business core is wired to these helpers.
begin;
set local timezone = 'UTC';
set local plpgsql.check_asserts = on;
set constraints all deferred;
do $$ begin
  if current_database() <> 'aquafeed_backend_test' or not exists (
    select 1 from backend_test.provenance where singleton and migration_fixtures_cleaned
      and database_oid=(select oid from pg_database where datname=current_database())) then
    raise exception 'T08 requires fresh disposable baseline';
  end if;
  assert to_regprocedure('private.backend_finalize_updates(uuid,text[])') is not null;
  assert to_regprocedure('private.backend_publish_update_hint(uuid,text[],jsonb)') is not null;
end $$;
create function pg_temp.update_check(ok boolean) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'T08 assertion failed'; end if; end $$;

-- Existing canonical disposable profiles are sufficient; no provisioning/feed RPC calls.
-- All identities/rows below roll back, including the deferred Auth FK fixtures.
insert into auth.users(id,is_anonymous) values
 ('80808080-8080-4080-8080-808080808081',true),
 ('80808080-8080-4080-8080-808080808082',true),
 ('80808080-8080-4080-8080-808080808083',true);
insert into public.device_access(device_id,installation_id,status) values
 ('22222222-2222-4222-8222-222222222222','80808080-8080-4080-8080-808080808081','active'),
 ('22222222-2222-4222-8222-222222222222','80808080-8080-4080-8080-808080808082','active'),
 ('33333333-3333-4333-8333-333333333333','80808080-8080-4080-8080-808080808083','active');

do $$
declare
 d uuid := '22222222-2222-4222-8222-222222222222';
 owners text[] := array['do','feed','history','configuration','feeding','contact','alerts'];
 flags text[]; previous jsonb; actual jsonb; m realtime.messages%rowtype;
 mask integer; k text; n bigint; before_count bigint; bad jsonb;
begin
 perform pg_temp.update_check(not exists(select 1 from public.device_resource_versions where device_id=d));
 actual := private.backend_finalize_updates(d,array[]::text[]);
 perform pg_temp.update_check(actual='{"do":0,"feed":0,"history":0,"configuration":0,"feeding":0,"contact":0,"alerts":0}'::jsonb);
 perform pg_temp.update_check((select count(*)=0 from realtime.messages));
 for mask in 1..127 loop
   select array_agg(resource order by ordinal) into flags
     from unnest(owners) with ordinality as a(resource,ordinal)
     where (mask & (1 << (ordinal::integer-1)))<>0;
   previous := actual;
   select count(*) into before_count from realtime.messages;
   actual := private.backend_finalize_updates(d,flags);
   foreach k in array owners loop
     perform pg_temp.update_check((actual->>k)::numeric=(previous->>k)::numeric+case when k=any(flags) then 1 else 0 end);
   end loop;
   perform pg_temp.update_check((select count(*)=before_count+1 from realtime.messages));
   select * into strict m from realtime.messages where payload->'resources'=to_jsonb(flags);
   perform pg_temp.update_check(m.topic='device:'||d::text||':updates' and m.extension='broadcast'
     and m.event='resource_update' and m.private is true and m.skip_broadcast is false);
   perform pg_temp.update_check(m.payload ?& array['id','device_id','resources','revisions']
     and m.payload-array['id','device_id','resources','revisions']='{}'::jsonb
     and m.payload->>'device_id'=d::text and m.payload->>'id'=m.id::text
     and m.payload->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and (m.payload->'revisions')-flags='{}'::jsonb
     and m.payload->'revisions' ?& flags);
   foreach k in array flags loop
     perform pg_temp.update_check(m.payload->'revisions'->k=actual->k);
   end loop;
 end loop;
 foreach k in array owners loop perform pg_temp.update_check((actual->>k)::numeric=64); end loop;
 actual := private.backend_finalize_updates(d,array['contact','do','contact','do']);
 perform pg_temp.update_check((actual->>'do')::numeric=65 and (actual->>'contact')::numeric=65);
 perform pg_temp.update_check((select count(*)=1 from realtime.messages
   where payload->'resources'='["do","contact"]'::jsonb and payload->'revisions'='{"do":65,"contact":65}'::jsonb));
 select count(*) into before_count from realtime.messages;
 perform pg_temp.update_check(private.backend_finalize_updates(d,array[]::text[])=actual);
 perform pg_temp.update_check((select count(*)=before_count from realtime.messages));

 -- Invalid flags are authoritative errors, never tolerated as publication errors.
 foreach flags slice 1 in array array[array['unknown'],array[''],array['DO'],array[' contact'],array[null::text]] loop
   begin
     perform private.backend_finalize_updates(d,flags);
     raise exception 'T08 invalid flags accepted';
   exception when invalid_parameter_value then null; end;
 end loop;
 begin perform private.backend_finalize_updates(d,null); raise exception 'T08 null flags accepted';
 exception when invalid_parameter_value then null; end;
 begin perform private.backend_finalize_updates(d,array[['do','feed']]); raise exception 'T08 multidimensional flags accepted';
 exception when invalid_parameter_value then null; end;
 begin perform private.backend_finalize_updates(null,array['do']); raise exception 'T08 null device accepted';
 exception when invalid_parameter_value then null; end;
 begin perform private.backend_finalize_updates('00000000-0000-0000-0000-000000000000',array['do']); raise exception 'T08 non-RFC device accepted';
 exception when invalid_parameter_value then null; end;
 begin perform private.backend_finalize_updates('80808080-8080-4080-8080-808080808089',array['do']); raise exception 'T08 unknown device accepted';
 exception when foreign_key_violation then null; end;
 perform pg_temp.update_check((select revisions=actual from public.device_resource_versions where device_id=d));
 perform pg_temp.update_check((select count(*)=before_count from realtime.messages));

 -- Existing T04 accepts exact numeric integer 1.0; no bigint text-cast refusal.
 update public.device_resource_versions set revisions=jsonb_set(revisions,'{do}','1.0') where device_id=d;
 actual := private.backend_finalize_updates(d,array['do']);
 perform pg_temp.update_check((actual->>'do')::numeric=2);
 update public.device_resource_versions set revisions=jsonb_set(revisions,'{alerts}','9007199254740990') where device_id=d;
 actual := private.backend_finalize_updates(d,array['alerts']);
 perform pg_temp.update_check((actual->>'alerts')::numeric=9007199254740991);
 select count(*) into before_count from realtime.messages;
 begin perform private.backend_finalize_updates(d,array['do','alerts']); raise exception 'T08 overflow accepted';
 exception when numeric_value_out_of_range then null; end;
 perform pg_temp.update_check((select revisions=actual from public.device_resource_versions where device_id=d));
 perform pg_temp.update_check((select count(*)=before_count from realtime.messages));

 -- Malformed persisted state is already excluded by unchanged T04 constraints.
 -- Test that boundary without dropping/weakening those constraints.
 for bad in select value from jsonb_array_elements('[null,[],{}, {"do":"1"}, {"do":0.5}, {"do":-1}, {"do":9007199254740992}]') loop
   begin
     update public.device_resource_versions set revisions=bad where device_id=d;
     raise exception 'T08 malformed state accepted';
   exception when check_violation then null; end;
 end loop;
 for bad in select value from jsonb_array_elements('["1",null,0.5,-1,9007199254740992]') loop
   begin
     update public.device_resource_versions set revisions=jsonb_set(actual,'{do}',bad) where device_id=d;
     raise exception 'T08 malformed counter accepted';
   exception when check_violation then null; end;
 end loop;
 for bad in select value from jsonb_array_elements('[null,[],{}, {"contact":"1"}, {"contact":null}, {"contact":0.5}, {"contact":-1}, {"contact":9007199254740992}, {"contact":1,"do":1}]') loop
   begin perform private.backend_publish_update_hint(d,array['contact'],bad); raise exception 'T08 malformed hint accepted';
   exception when invalid_parameter_value then null; end;
 end loop;
 begin perform private.backend_publish_update_hint(d,array['contact','do'],'{"contact":1,"do":1}'); raise exception 'T08 unordered hint accepted';
 exception when invalid_parameter_value then null; end;
 begin perform private.backend_publish_update_hint(d,array['do','do'],'{"do":1}'); raise exception 'T08 duplicate hint accepted';
 exception when invalid_parameter_value then null; end;
 perform pg_temp.update_check((select count(*)=before_count from realtime.messages));
end $$;

-- Controlled failed initialization, missing post-init row and malformed initialization.
-- Fixture-only trigger is removed and checked; no authoritative constraints disabled.
create function pg_temp.block_version_init() returns trigger language plpgsql as $$
begin
 if new.device_id='33333333-3333-4333-8333-333333333333' then
   if current_setting('backend_test.init_mode')='missing' then return null; end if;
   if current_setting('backend_test.init_mode')='malformed' then new.revisions:='{}'; return new; end if;
   raise exception using errcode='P8V01',message='T08_TEST_INIT_FAILURE';
 end if;
 return new;
end $$;
create trigger t08_block_init before insert on public.device_resource_versions
 for each row execute function pg_temp.block_version_init();
do $$ declare n bigint; begin
 select count(*) into n from realtime.messages;
 perform set_config('backend_test.init_mode','failed',true);
 begin perform private.backend_finalize_updates('33333333-3333-4333-8333-333333333333',array['contact']); raise exception 'T08 init failure hidden';
 exception when sqlstate 'P8V01' then null; end;
 perform set_config('backend_test.init_mode','missing',true);
 begin perform private.backend_finalize_updates('33333333-3333-4333-8333-333333333333',array['contact']); raise exception 'T08 missing init hidden';
 exception when no_data_found then null; end;
 perform set_config('backend_test.init_mode','malformed',true);
 begin perform private.backend_finalize_updates('33333333-3333-4333-8333-333333333333',array['contact']); raise exception 'T08 malformed init hidden';
 exception when check_violation then null; end;
 perform pg_temp.update_check(not exists(select 1 from public.device_resource_versions where device_id='33333333-3333-4333-8333-333333333333'));
 perform pg_temp.update_check((select count(*)=n from realtime.messages));
end $$;
drop trigger t08_block_init on public.device_resource_versions;
drop function pg_temp.block_version_init();

-- Native-model inner INSERT failure: exactly one synthetic WARNING, normal void,
-- authoritative V survives, ZERO new message, NO T08_BROADCAST_FAILED outer marker.
-- Actual process warning evidence is required separately by the disposable runner.
create function pg_temp.fail_hint_insert() returns trigger language plpgsql as $$
begin raise exception 'T08_TEST_INSERT_FAILURE'; end $$;
create trigger t08_insert_failure before insert on realtime.messages
 for each row execute function pg_temp.fail_hint_insert();
do $$ declare previous jsonb; actual jsonb; n bigint; begin
 select revisions into previous from public.device_resource_versions where device_id='22222222-2222-4222-8222-222222222222';
 select count(*) into n from realtime.messages;
 actual:=private.backend_finalize_updates('22222222-2222-4222-8222-222222222222',array['contact']);
 perform pg_temp.update_check((actual->>'contact')::numeric=(previous->>'contact')::numeric+1);
 perform pg_temp.update_check((select revisions=actual from public.device_resource_versions where device_id='22222222-2222-4222-8222-222222222222'));
 perform pg_temp.update_check((select count(*)=n from realtime.messages));
end $$;
drop trigger t08_insert_failure on realtime.messages;
drop function pg_temp.fail_hint_insert();

-- Enclosing error and a synthetic deferred FK fired AFTER helper return roll both
-- V and the transactional message back. No business integrity trigger is altered.
create temporary table t08_parent(id integer primary key);
create temporary table t08_child(id integer,
 constraint t08_deferred_fk foreign key(id) references pg_temp.t08_parent(id) deferrable initially deferred);
do $$ declare previous jsonb; n bigint; begin
 select revisions into previous from public.device_resource_versions where device_id='22222222-2222-4222-8222-222222222222';
 select count(*) into n from realtime.messages;
 begin
   perform private.backend_finalize_updates('22222222-2222-4222-8222-222222222222',array['contact']);
   raise exception using errcode='P8Z01',message='T08_TEST_ENCLOSING_FAILURE';
 exception when sqlstate 'P8Z01' then null; end;
 perform pg_temp.update_check((select revisions=previous from public.device_resource_versions where device_id='22222222-2222-4222-8222-222222222222'));
 perform pg_temp.update_check((select count(*)=n from realtime.messages));
 begin
   perform private.backend_finalize_updates('22222222-2222-4222-8222-222222222222',array['contact']);
   insert into pg_temp.t08_child values(1);
   set constraints pg_temp.t08_deferred_fk immediate;
   raise exception 'T08 deferred failure absent';
 exception when foreign_key_violation then null; end;
 perform pg_temp.update_check((select revisions=previous from public.device_resource_versions where device_id='22222222-2222-4222-8222-222222222222'));
 perform pg_temp.update_check((select count(*)=n from realtime.messages));
 perform pg_temp.update_check(not exists(select 1 from pg_temp.t08_child));
end $$;

-- Native-model ID preservation and transaction-local topic, NOT app-producer shape.
do $$ declare n bigint; begin
 select count(*) into n from realtime.messages;
 perform realtime.send('{"id":"fixture-preserved","probe":true}','fixture-id','fixture-topic',true);
 perform pg_temp.update_check(realtime.topic()='fixture-topic');
 perform pg_temp.update_check((select count(*)=n+1 from realtime.messages));
 perform pg_temp.update_check((select payload->>'id'='fixture-preserved' from realtime.messages where event='fixture-id'));
end $$;

-- Policy is requested-topic authorization, not a row.topic/private filter. This
-- substituted probe deliberately has neither; real native server probes UNVERIFIED.
insert into realtime.messages(topic,extension,event,private) values('fixture-probe','broadcast','T08_POLICY_PROBE',false);
insert into realtime.messages(topic,extension,event,private) values('fixture-probe','presence','T08_POLICY_PROBE',false);
select set_config('request.jwt.claim.sub','80808080-8080-4080-8080-808080808081',true);
select set_config('realtime.topic','device:22222222-2222-4222-8222-222222222222:updates',true);
set local role authenticated;
do $$ declare topic text; begin
 assert (select count(*)=1 from realtime.messages where event='T08_POLICY_PROBE');
 foreach topic in array array[
   'device:33333333-3333-4333-8333-333333333333:updates',
   'device:22222222-2222-4222-8222-222222222222',
   'device:22222222-2222-4222-8222-222222222222:updates:extra',
   'device:not-a-uuid:updates','',
   'DEVICE:22222222-2222-4222-8222-222222222222:updates',
   'device:AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA:updates'] loop
   perform set_config('realtime.topic',topic,true);
   assert (select count(*)=0 from realtime.messages where event='T08_POLICY_PROBE');
 end loop;
 perform set_config('realtime.topic','device:22222222-2222-4222-8222-222222222222:updates',true);
 begin insert into realtime.messages(topic,extension) values('fixture-forbidden','broadcast');
   raise exception 'T08 client insert accepted';
 exception when insufficient_privilege then null; end;
 -- Native public EXECUTE is real: RLS denial may be swallowed, not EXECUTE-denied.
 perform realtime.send('{}','T08_UNAUTHORIZED','fixture-forbidden',true);
 begin perform private.backend_finalize_updates('22222222-2222-4222-8222-222222222222',array['contact']);
   raise exception 'T08 client finalizer accepted';
 exception when insufficient_privilege then null; end;
 begin update public.device_resource_versions set revisions='{}'; raise exception 'T08 client V mutation accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','80808080-8080-4080-8080-808080808082',true);
set local role authenticated;
do $$ begin assert (select count(*)=1 from realtime.messages where event='T08_POLICY_PROBE'); end $$;
reset role;
update public.device_access set status='revoked',revoked_at=clock_timestamp()
 where device_id='22222222-2222-4222-8222-222222222222' and installation_id='80808080-8080-4080-8080-808080808082';
set local role authenticated;
do $$ begin assert (select count(*)=0 from realtime.messages where event='T08_POLICY_PROBE'); end $$;
reset role;
select set_config('request.jwt.claim.sub','80808080-8080-4080-8080-808080808083',true);
set local role authenticated;
do $$ begin assert (select count(*)=0 from realtime.messages where event='T08_POLICY_PROBE'); end $$;
reset role;
select set_config('request.jwt.claim.sub','80808080-8080-4080-8080-808080808081',true);
set local role anon;
do $$ begin
 assert (select count(*)=0 from realtime.messages where event='T08_POLICY_PROBE');
 begin insert into realtime.messages(topic,extension) values('fixture-forbidden','broadcast');
   raise exception 'T08 anon insert accepted';
 exception when insufficient_privilege then null; end;
 perform realtime.send('{}','T08_UNAUTHORIZED','fixture-forbidden',true);
end $$;
reset role;

-- Exact private ACL/security/defaults; preserve existing private USAGE baseline.
do $$ declare f record; r text; begin
 assert not exists(select 1 from realtime.messages where event='T08_UNAUTHORIZED');
 assert not exists(select 1 from pg_trigger where tgname in ('t08_block_init','t08_insert_failure'));
 assert has_schema_privilege('service_role','private','USAGE');
 assert not has_schema_privilege('anon','private','USAGE');
 assert not has_schema_privilege('authenticated','private','USAGE');
 for f in select * from pg_proc where oid in (
   'private.backend_finalize_updates(uuid,text[])'::regprocedure,
   'private.backend_publish_update_hint(uuid,text[],jsonb)'::regprocedure) loop
   assert pg_get_userbyid(f.proowner)='postgres' and f.provolatile='v'
     and f.proconfig=array['search_path=""'] and f.pronargdefaults=0;
   assert f.prosecdef=(f.proname='backend_finalize_updates');
   assert not exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
     where a.grantee<>f.proowner and not (f.proname='backend_finalize_updates'
       and a.grantee='service_role'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable));
   foreach r in array array['anon','authenticated'] loop
     assert not has_function_privilege(r::name,f.oid,'EXECUTE');
   end loop;
   assert has_function_privilege('service_role',f.oid,'EXECUTE')=(f.proname='backend_finalize_updates');
 end loop;
 for f in select * from pg_proc where oid in ('realtime.send(jsonb,text,text,boolean)'::regprocedure,'realtime.topic()'::regprocedure) loop
   assert not f.prosecdef and f.proconfig is null and pg_get_userbyid(f.proowner)='supabase_realtime_admin';
   assert f.provolatile=case when f.proname='send' then 'v'::"char" else 's'::"char" end;
   assert exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE');
 end loop;
 assert (select count(*)=1 from pg_policy where polrelid='realtime.messages'::regclass);
 assert (select polcmd='r' and polpermissive and polroles=array['authenticated'::regrole::oid]
   from pg_policy where polrelid='realtime.messages'::regclass and polname='backend_device_updates_select');
end $$;
set local role service_role;
do $$ declare r jsonb; begin
 r:=private.backend_finalize_updates('33333333-3333-4333-8333-333333333333',array['contact']);
 assert r->'contact'='1'::jsonb;
 begin perform private.backend_publish_update_hint('33333333-3333-4333-8333-333333333333',array['contact'],'{"contact":1}');
   raise exception 'T08 service publisher accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
