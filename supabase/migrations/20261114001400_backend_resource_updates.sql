-- T08 B1: UNWIRED private hint boundary. No business function/route calls these yet.
-- Parent-reviewed native policy CREATE path; deployment/native sockets NOT accepted.
-- No platform object creation, ownership/grant/RLS change or down-delete.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = '';

-- Ordinary INVOKER DO, as in the parent's rollback-only permission probe.
-- Unexpected platform/policy state aborts; never drop arbitrary policies or skip.
do $$
declare messages oid := to_regclass('realtime.messages'); f record; r text;
begin
  if current_user <> 'postgres' or messages is null
    or to_regclass('public.device_resource_versions') is null
    or to_regprocedure('auth.uid()') is null
    or to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
    or to_regprocedure('realtime.topic()') is null
    or to_regprocedure('private.backend_finalize_updates(uuid,text[])') is not null
    or to_regprocedure('private.backend_publish_update_hint(uuid,text[],jsonb)') is not null then
    raise exception 'T08_INCOMPATIBLE_PREREQUISITES';
  end if;
  if not exists(select 1 from pg_class c where c.oid=messages and c.relkind in ('r','p')
      and c.relrowsecurity and not c.relforcerowsecurity
      and pg_get_userbyid(c.relowner)='supabase_realtime_admin')
    or not exists(select 1 from pg_namespace where nspname='realtime' and pg_get_userbyid(nspowner)='supabase_admin')
    or exists(select 1 from pg_policy where polrelid=messages)
    or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='realtime' and p.proname in ('send','topic'))<>2 then
    raise exception 'T08_INCOMPATIBLE_NATIVE_BOUNDARY';
  end if;
  if exists (
    select 1 from (values
      (1,'topic','text',true),(2,'extension','text',true),(3,'payload','jsonb',false),
      (4,'event','text',false),(5,'private','boolean',false),
      (6,'updated_at','timestamp without time zone',true),
      (7,'inserted_at','timestamp without time zone',true),(8,'id','uuid',true),
      (9,'binary_payload','bytea',false),(10,'skip_broadcast','boolean',true),
      (11,'expires_at','timestamp without time zone',false)
    ) expected(ordinal,name,type,required)
    full join (select attnum,attname,format_type(atttypid,atttypmod) type,attnotnull,attacl,attgenerated,attidentity
      from pg_attribute where attrelid=messages and attnum>0 and not attisdropped) actual
      on actual.attnum=expected.ordinal
    where actual.attname is distinct from expected.name or actual.type is distinct from expected.type
      or actual.attnotnull is distinct from expected.required or actual.attacl is not null
      or actual.attgenerated<>'' or actual.attidentity<>''
  ) or exists (
    select 1 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=messages and a.attnum>0 and not a.attisdropped and case
      -- Native timestamp timezone literals are deliberately NOT guessed or logged.
      when a.attname in ('updated_at','inserted_at') then d.oid is null
      when a.attname='id' then pg_get_expr(d.adbin,d.adrelid) is distinct from 'gen_random_uuid()'
      when a.attname in ('private','skip_broadcast') then pg_get_expr(d.adbin,d.adrelid) is distinct from 'false'
      else d.oid is not null end
  ) then raise exception 'T08_INCOMPATIBLE_MESSAGE_COLUMNS'; end if;
  for f in select p.*,l.lanname from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid in ('realtime.send(jsonb,text,text,boolean)'::regprocedure,'realtime.topic()'::regprocedure) loop
    if f.prosecdef or f.proconfig is not null or f.prokind<>'f' or f.proretset or f.proparallel<>'u'
      or pg_get_userbyid(f.proowner)<>'supabase_realtime_admin'
      or not exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE')
      or (f.proname='send' and (f.prorettype<>'void'::regtype or f.provolatile<>'v'
        or f.lanname<>'plpgsql' or f.pronargdefaults<>1 or pg_get_expr(f.proargdefaults,0) is distinct from 'true'))
      or (f.proname='topic' and (f.prorettype<>'text'::regtype or f.provolatile<>'s'
        or f.lanname<>'sql' or f.pronargdefaults<>0)) then
      raise exception 'T08_INCOMPATIBLE_NATIVE_FUNCTIONS';
    end if;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    if not has_schema_privilege(r::name,'realtime','USAGE')
      or not has_table_privilege(r::name,messages,'SELECT')
      or not has_table_privilege(r::name,messages,'INSERT')
      or not has_table_privilege(r::name,messages,'UPDATE')
      or (r<>'service_role' and exists(select 1 from pg_roles where rolname=r and (rolsuper or rolbypassrls))) then
      raise exception 'T08_INCOMPATIBLE_NATIVE_GRANTS';
    end if;
  end loop;
  if not has_schema_privilege('service_role','private','USAGE')
    or has_schema_privilege('anon','private','USAGE') or has_schema_privilege('authenticated','private','USAGE') then
    raise exception 'T08_INCOMPATIBLE_PRIVATE_USAGE';
  end if;
  create policy backend_device_updates_select on realtime.messages for select to authenticated
    using (extension='broadcast' and exists (
      select 1 from public.device_access a where a.installation_id=(select auth.uid())
        and a.status='active' and realtime.topic()='device:'||a.device_id::text||':updates'
    ));
end $$;

-- Owner-only invoker: finalizer enters as postgres, native send stays INVOKER.
create function private.backend_publish_update_hint(p_device_id uuid,p_resources text[],p_revisions jsonb)
returns void language plpgsql volatile security invoker set search_path = '' as $$
declare
  owners constant text[] := array['do','feed','history','configuration','feeding','contact','alerts'];
  canonical text[]; k text; n numeric; payload jsonb;
begin
  if p_device_id is null or p_device_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_resources is null or coalesce(array_ndims(p_resources),1)<>1
    or exists(select 1 from unnest(p_resources) r where r is null or not (r=any(owners))) then
    raise exception using errcode='22023',message='T08_INVALID_HINT';
  end if;
  select coalesce(array_agg(r order by ordinal),array[]::text[]) into canonical
    from unnest(owners) with ordinality a(r,ordinal) where r=any(p_resources);
  if p_resources is distinct from canonical or jsonb_typeof(p_revisions) is distinct from 'object'
    or not (p_revisions ?& canonical) or p_revisions-canonical<>'{}'::jsonb then
    raise exception using errcode='22023',message='T08_INVALID_HINT';
  end if;
  foreach k in array canonical loop
    if jsonb_typeof(p_revisions->k) is distinct from 'number' then
      raise exception using errcode='22023',message='T08_INVALID_HINT'; end if;
    n:=(p_revisions->>k)::numeric;
    if n<0 or n>9007199254740991 or trunc(n)<>n then
      raise exception using errcode='22023',message='T08_INVALID_HINT'; end if;
  end loop;
  if cardinality(canonical)=0 then return; end if;
  payload:=jsonb_build_object('device_id',p_device_id,'resources',canonical,'revisions',p_revisions);
  -- ONLY the send call is tolerated. Native inner INSERT failures can warn/return
  -- void; neither void nor this catch is an insertion/delivery/failure receipt.
  begin
    perform realtime.send(payload,'resource_update','device:'||p_device_id::text||':updates',true);
  exception when others then raise warning 'T08_BROADCAST_FAILED'; end;
end $$;
alter function private.backend_publish_update_hint(uuid,text[],jsonb) owner to postgres;
revoke all on function private.backend_publish_update_hint(uuid,text[],jsonb) from public,anon,authenticated,service_role;

-- Trusted callers MUST hold their full authorized business prefix (including D),
-- finish all business/G work, then enter V last. No business reads/reconciliation.
create function private.backend_finalize_updates(p_device_id uuid,p_resources text[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  owners constant text[] := array['do','feed','history','configuration','feeding','contact','alerts'];
  changed text[]; v_revisions jsonb; subset jsonb := '{}'; k text; n numeric;
begin
  if p_device_id is null or p_device_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_resources is null or coalesce(array_ndims(p_resources),1)<>1
    or exists(select 1 from unnest(p_resources) r where r is null or not (r=any(owners))) then
    raise exception using errcode='22023',message='T08_INVALID_RESOURCES';
  end if;
  select coalesce(array_agg(r order by ordinal),array[]::text[]) into changed
    from unnest(owners) with ordinality a(r,ordinal) where r=any(p_resources);
  -- A real existing device can lack V; FK/init/STRICT errors stay authoritative.
  insert into public.device_resource_versions(device_id) values(p_device_id) on conflict(device_id) do nothing;
  select v.revisions into strict v_revisions from public.device_resource_versions v
    where v.device_id=p_device_id for update;
  if jsonb_typeof(v_revisions) is distinct from 'object' or not (v_revisions ?& owners)
    or v_revisions-owners<>'{}'::jsonb then
    raise exception using errcode='22023',message='T08_INVALID_REVISIONS'; end if;
  foreach k in array owners loop
    if jsonb_typeof(v_revisions->k) is distinct from 'number' then
      raise exception using errcode='22023',message='T08_INVALID_REVISIONS'; end if;
    n:=(v_revisions->>k)::numeric;
    if n<0 or n>9007199254740991 or trunc(n)<>n then
      raise exception using errcode='22023',message='T08_INVALID_REVISIONS'; end if;
    if k=any(changed) then
      if n=9007199254740991 then
        raise exception using errcode='22003',message='T08_REVISION_OVERFLOW'; end if;
      -- Numeric arithmetic accepts exact integer 1.0; no bigint text cast/wrap.
      v_revisions:=jsonb_set(v_revisions,array[k],to_jsonb(n+1));
      subset:=subset||jsonb_build_object(k,n+1);
    end if;
  end loop;
  if cardinality(changed)>0 then
    update public.device_resource_versions v set revisions=v_revisions where v.device_id=p_device_id;
    perform private.backend_publish_update_hint(p_device_id,changed,subset);
  end if;
  return v_revisions;
end $$;
alter function private.backend_finalize_updates(uuid,text[]) owner to postgres;
revoke all on function private.backend_finalize_updates(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function private.backend_finalize_updates(uuid,text[]) to service_role;

-- Unknown inherited default ACL entries must abort, not silently widen helpers.
do $$ declare f record; begin
  for f in select * from pg_proc where oid in (
    'private.backend_finalize_updates(uuid,text[])'::regprocedure,
    'private.backend_publish_update_hint(uuid,text[],jsonb)'::regprocedure) loop
    if exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
      where a.grantee<>f.proowner and not (f.proname='backend_finalize_updates'
        and a.grantee='service_role'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable)) then
      raise exception 'T08_INCOMPATIBLE_HELPER_ACL';
    end if;
  end loop;
end $$;
commit;
