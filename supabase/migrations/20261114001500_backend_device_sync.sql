-- T08 B2-1 reconciliation terminal slice ONLY; no other producers or atomic sync RPC.
-- Phase 1 below is the accepted N8/N11 pilot; phase 2 migrates its five remaining callers.
-- Parent observed exact REDs for the released exits; device_busy remains runtime-unverified.
-- Retain the old void ACL/compatibility at this checkpoint pending full coverage review.
-- DO NOT deploy this incomplete producer boundary or claim the future aggregate/type artifact exists.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local check_function_bodies = on;
set local search_path = '';

do $pilot$
declare
  f record;
  v_n8_before jsonb;
  v_n11_before jsonb;
  v_n8_source text;
  v_n8_definition text;
  v_n11_source text;
  v_n11_definition text;
  v_core_source text;
  v_lookup_source text;
  v_source text;
  v_definition text;
  v_actual jsonb;
  v_pairs text[];
  i integer;
  v_shim constant text := $shim$
begin
  -- Intermediate compatibility only: other roots still own their original boundaries.
  -- Intentionally nonpublishing until all five remaining callers consume the flags.
  perform private.backend_reconcile_manual_feed(p_device_id);
end;
$shim$;
begin
  if current_user<>'postgres' or to_regclass('public.device_resource_versions') is null
    or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname='backend_reconcile_manual_feed') then
    raise exception 'T08_B2_PILOT_PREREQUISITE_MISMATCH';
  end if;
  -- Unchanged B1 is the only version/publication boundary; do not substitute or repair it.
  for f in select e.*,p.oid,p.prosrc,p.prosecdef,p.proconfig,p.provolatile,p.proowner,l.lanname
    from (values
      ('private.backend_finalize_updates(uuid,text[])','4e9f060dccaad9379b3baff3848a34c2c2f72ab8f588c2be2bec95f3a363f9dc',true),
      ('private.backend_publish_update_hint(uuid,text[],jsonb)','97296850317950ecaaea90dac6cd5b8087177ce173731cc41ef3acf319294c72',false)
    ) e(signature,sha,definer)
    left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.signature)
    left join pg_catalog.pg_language l on l.oid=p.prolang
  loop
    if f.oid is null or f.prosecdef is distinct from f.definer or f.provolatile is distinct from 'v'::"char"
      or f.lanname is distinct from 'plpgsql' or pg_catalog.pg_get_userbyid(f.proowner) is distinct from 'postgres'
      or f.proconfig is distinct from array['search_path=""']::text[]
      or pg_catalog.strpos(pg_catalog.replace(f.prosrc,E'\r\n',E'\n'),pg_catalog.chr(13))>0
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(f.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') is distinct from f.sha then
      raise exception 'T08_B2_PILOT_B1_MISMATCH';
    end if;
  end loop;

  -- Full parent-accepted LF bodies plus closed metadata/ACLs, before any replacement.
  -- CRLF->LF only; bare CR fails. Definitions are kept in memory and never emitted.
  for f in select e.*,p.*,l.lanname,
      (select count(*) from pg_catalog.pg_proc q join pg_catalog.pg_namespace n on n.oid=q.pronamespace
        where n.nspname=e.schema_name and q.proname=e.function_name) as overload_count
    from (values
      ('N8','private.art31_reconcile_manual_feed(uuid)','private','art31_reconcile_manual_feed',
        4568,'2b9e84bfb0b69c77a555509d94ea1a0bd9fb849da6ddcb68cf3c141004aacc5a',
        array['p_device_id']::text[],'void'::pg_catalog.regtype::oid,0,null::text),
      ('N11','public.art31_read_manual_command(uuid,uuid,uuid,boolean)','public','art31_read_manual_command',
        1042,'86354f21e80e64560629f0f6f52805d0bceecaf6b32a83b0dce099255cdcf6e2',
        array['p_device_id','p_installation_id','p_lookup','p_by_key']::text[],'jsonb'::pg_catalog.regtype::oid,1,'false')
    ) e(id,signature,schema_name,function_name,src_bytes,sha,arg_names,result_type,defaults_count,defaults_sql)
    left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.signature)
    left join pg_catalog.pg_language l on l.oid=p.prolang
  loop
    if f.oid is null or f.overload_count<>1 or f.prokind is distinct from 'f'::"char"
      or pg_catalog.pg_get_userbyid(f.proowner) is distinct from 'postgres'
      or f.lanname is distinct from 'plpgsql' or f.prosecdef is distinct from true
      or f.provolatile is distinct from 'v'::"char" or f.proconfig is distinct from array['search_path=""']::text[]
      or f.proargnames is distinct from f.arg_names or f.proargmodes is not null or f.proallargtypes is not null
      or f.prorettype is distinct from f.result_type or f.proretset or f.proisstrict or f.proleakproof
      or f.proparallel is distinct from 'u'::"char" or f.provariadic<>0 or f.prosupport::oid<>0
      or f.procost<>100 or f.prorows<>0 or f.protrftypes is not null
      or f.pronargdefaults is distinct from f.defaults_count
      or pg_catalog.pg_get_expr(f.proargdefaults,0) is distinct from f.defaults_sql
      or pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE')
      or exists(select 1 from pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
        where a.privilege_type<>'EXECUTE' or a.grantee=0 or a.grantee not in (f.proowner,'service_role'::pg_catalog.regrole)
          or (a.grantee='service_role'::pg_catalog.regrole and a.is_grantable)) then
      raise exception 'T08_B2_PILOT_PREDECESSOR_METADATA_MISMATCH';
    end if;
    v_source:=pg_catalog.replace(f.prosrc,E'\r\n',E'\n');
    v_definition:=pg_catalog.replace(pg_catalog.pg_get_functiondef(f.oid),E'\r\n',E'\n');
    if pg_catalog.strpos(v_source,pg_catalog.chr(13))>0 or pg_catalog.octet_length(v_source)<>f.src_bytes
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_source,'UTF8')),'hex')<>f.sha
      or length(v_definition)-length(replace(v_definition,v_source,''))<>length(v_source) then
      raise exception 'T08_B2_PILOT_PREDECESSOR_SOURCE_MISMATCH';
    end if;
    if f.id='N8' then
      select pg_catalog.to_jsonb(p) into strict v_n8_before from pg_catalog.pg_proc p where p.oid=f.oid;
      v_n8_source:=v_source; v_n8_definition:=v_definition;
    else
      select pg_catalog.to_jsonb(p) into strict v_n11_before from pg_catalog.pg_proc p where p.oid=f.oid;
      v_n11_source:=v_source; v_n11_definition:=v_definition;
    end if;
  end loop;

  v_source:=v_n8_source;
  v_definition:=v_n8_definition;
  v_pairs:=array[
$old$  v_now timestamptz := pg_catalog.clock_timestamp();$old$,
$new$  v_now timestamptz := pg_catalog.clock_timestamp();
  v_feeding_changed boolean := false;
  v_alert_before uuid;
  v_alert_after uuid;
  v_changed_resources text[] := array[]::text[];$new$,
$old$  if not found then return; end if;
  perform 1 from public.device_state s where s.device_id=p_device_id for update;

  for v_sequence in$old$,
$new$  if not found then return array[]::text[]; end if;
  perform 1 from public.device_state s where s.device_id=p_device_id for update;
  -- S serializes immutable alert insertion; compare a fresh-statement frontier, not row_count.
  select e.event_id into v_alert_before from public.alert_events e where e.device_id=p_device_id
    order by e.raised_at desc,e.event_id desc limit 1;

  for v_sequence in$new$,
$old$            and phase in ('active', 'settling');
      end if;
      continue;$old$,
$new$            and phase in ('active', 'settling');
        -- This branch necessarily changed queued/accepted to expired, even without a reservation.
        v_feeding_changed := true;
      end if;
      continue;$new$,
$old$        released_at = null;
  end loop;
end;
$old$,
$new$        released_at = null;
    -- The selected queued/accepted/running step and sequence actually transitioned above.
    v_feeding_changed := true;
  end loop;
  select e.event_id into v_alert_after from public.alert_events e where e.device_id=p_device_id
    order by e.raised_at desc,e.event_id desc limit 1;
  if v_feeding_changed then v_changed_resources := array['feeding']::text[]; end if;
  if v_alert_after is distinct from v_alert_before then
    v_changed_resources := pg_catalog.array_append(v_changed_resources,'alerts');
  end if;
  return v_changed_resources;
end;
$new$
  ];
  for i in 1..array_length(v_pairs,1) by 2 loop
    if length(v_source)-length(replace(v_source,v_pairs[i],''))<>length(v_pairs[i])
      or length(v_definition)-length(replace(v_definition,v_pairs[i],''))<>length(v_pairs[i]) then
      raise exception 'T08_B2_PILOT_RECONCILE_ANCHOR_MISMATCH';
    end if;
    v_source:=replace(v_source,v_pairs[i],v_pairs[i+1]);
    v_definition:=replace(v_definition,v_pairs[i],v_pairs[i+1]);
  end loop;
  v_core_source:=v_source;
  -- Fixed identity/type substitution only; preserve the accepted argument/attribute header.
  if length(v_definition)-length(replace(v_definition,'CREATE OR REPLACE FUNCTION private.art31_reconcile_manual_feed(',''))
      <>length('CREATE OR REPLACE FUNCTION private.art31_reconcile_manual_feed(')
    or length(v_definition)-length(replace(v_definition,'RETURNS void',''))<>length('RETURNS void') then
    raise exception 'T08_B2_PILOT_RECONCILE_DEFINITION_MISMATCH';
  end if;
  v_definition:=replace(v_definition,'CREATE OR REPLACE FUNCTION private.art31_reconcile_manual_feed(',
    'CREATE OR REPLACE FUNCTION private.backend_reconcile_manual_feed(');
  execute replace(v_definition,'RETURNS void','RETURNS text[]');
  alter function private.backend_reconcile_manual_feed(uuid) owner to postgres;
  revoke all on function private.backend_reconcile_manual_feed(uuid) from public,anon,authenticated,service_role;
  -- Keep the old void signature/ACL and all five unmigrated callers nonpublishing for this pilot.
  execute replace(v_n8_definition,v_n8_source,v_shim);

  v_source:=v_n11_source;
  v_definition:=v_n11_definition;
  v_pairs:=array[
$old$  v_command jsonb;$old$,
$new$  v_command jsonb;
  v_changed_resources text[];
  v_result jsonb;$new$,
$old$  perform private.art31_reconcile_manual_feed(p_device_id);$old$,
$new$  v_changed_resources := private.backend_reconcile_manual_feed(p_device_id);$new$,
$old$  if v_sequence is null then return jsonb_build_object('status', 'not_found'); end if;$old$,
$new$  if v_sequence is null then
    v_result := jsonb_build_object('status', 'not_found');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;
  end if;$new$,
$old$  return jsonb_build_object('status', 'found', 'command', v_command);$old$,
$new$  v_result := jsonb_build_object('status', 'found', 'command', v_command);
  perform private.backend_finalize_updates(p_device_id,v_changed_resources);
  return v_result;$new$
  ];
  for i in 1..array_length(v_pairs,1) by 2 loop
    if length(v_source)-length(replace(v_source,v_pairs[i],''))<>length(v_pairs[i])
      or length(v_definition)-length(replace(v_definition,v_pairs[i],''))<>length(v_pairs[i]) then
      raise exception 'T08_B2_PILOT_LOOKUP_ANCHOR_MISMATCH';
    end if;
    v_source:=replace(v_source,v_pairs[i],v_pairs[i+1]);
    v_definition:=replace(v_definition,v_pairs[i],v_pairs[i+1]);
  end loop;
  v_lookup_source:=v_source;
  execute v_definition;

  -- Existing OIDs, signatures/defaults, owners, attributes and exact ACL arrays survive replacement.
  select pg_catalog.to_jsonb(p)-'prosrc' into strict v_actual from pg_catalog.pg_proc p
    where p.oid=pg_catalog.to_regprocedure('private.art31_reconcile_manual_feed(uuid)');
  if v_actual is distinct from v_n8_before-'prosrc' then
    raise exception 'T08_B2_PILOT_VOID_METADATA_CHANGED';
  end if;
  -- CREATE OR REPLACE can change raw default-node source locations, never the false default itself.
  select pg_catalog.to_jsonb(p)-array['prosrc','proargdefaults'] into strict v_actual from pg_catalog.pg_proc p
    where p.oid=pg_catalog.to_regprocedure('public.art31_read_manual_command(uuid,uuid,uuid,boolean)');
  if v_actual is distinct from v_n11_before-array['prosrc','proargdefaults']
    or (select pg_catalog.pg_get_expr(p.proargdefaults,0) from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('public.art31_read_manual_command(uuid,uuid,uuid,boolean)')) is distinct from 'false' then
    raise exception 'T08_B2_PILOT_LOOKUP_METADATA_CHANGED';
  end if;
  select pg_catalog.to_jsonb(p)-array['oid','proname','prorettype','prosrc','proacl'] into strict v_actual
    from pg_catalog.pg_proc p where p.oid=pg_catalog.to_regprocedure('private.backend_reconcile_manual_feed(uuid)');
  if v_actual is distinct from v_n8_before-array['oid','proname','prorettype','prosrc','proacl'] then
    raise exception 'T08_B2_PILOT_CORE_METADATA_CHANGED';
  end if;
  if (select p.prorettype from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('private.backend_reconcile_manual_feed(uuid)'))<>'text[]'::pg_catalog.regtype
    or exists(select 1 from pg_catalog.pg_proc p cross join lateral
      pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=pg_catalog.to_regprocedure('private.backend_reconcile_manual_feed(uuid)')
        and (a.grantee<>p.proowner or a.privilege_type<>'EXECUTE'))
    or pg_catalog.has_function_privilege('anon','private.backend_reconcile_manual_feed(uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated','private.backend_reconcile_manual_feed(uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role','private.backend_reconcile_manual_feed(uuid)','EXECUTE') then
    raise exception 'T08_B2_PILOT_CORE_ACL_MISMATCH';
  end if;
  if (select replace(p.prosrc,E'\r\n',E'\n') from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('private.backend_reconcile_manual_feed(uuid)')) is distinct from v_core_source
    or (select replace(p.prosrc,E'\r\n',E'\n') from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('private.art31_reconcile_manual_feed(uuid)')) is distinct from v_shim
    or (select replace(p.prosrc,E'\r\n',E'\n') from pg_catalog.pg_proc p
      where p.oid=pg_catalog.to_regprocedure('public.art31_read_manual_command(uuid,uuid,uuid,boolean)')) is distinct from v_lookup_source then
    raise exception 'T08_B2_PILOT_INSTALLED_SOURCE_MISMATCH';
  end if;
end $pilot$;

-- Phase 2: parent-observed exit REDs. All five predecessors are checked before their movement.
-- The old void shim is deliberately untouched; all six business callers bypass it after this block.
do $terminals$
declare
  f record;
  i integer;
  j integer;
  v_signatures text[] := array[]::text[];
  v_sources text[] := array[]::text[];
  v_definitions text[] := array[]::text[];
  v_before jsonb[] := array[]::jsonb[];
  v_installed text[] := array[]::text[];
  v_defaults text[] := array[]::text[];
  v_source text;
  v_definition text;
  v_pairs text[];
  v_actual jsonb;
  v_protected jsonb;
  v_manual_source text;
  v_wrapper constant text := $wrapper$
declare
  v_result jsonb;
begin
  v_result := private.backend_manual_sync_core(p_device_id,p_device_verifier_hex,p_capabilities_revision,
    p_events,p_actuator_state,p_active_sequence_id,p_clock_quality,p_clock_uncertainty_ms);
  if v_result->>'status'='ok' then
    perform private.backend_finalize_updates(p_device_id,
      array(select pg_catalog.jsonb_array_elements_text(v_result->'_changed_resources')));
  end if;
  return v_result-'_changed_resources';
end;
$wrapper$;
begin
  if current_user<>'postgres' or exists(select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname='backend_manual_sync_core')
    or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private')
        and strpos(p.prosrc,'private.art31_reconcile_manual_feed(')>0)<>5 then
    raise exception 'T08_B2_TERMINAL_PREREQUISITE_MISMATCH';
  end if;
  select jsonb_agg(to_jsonb(p) order by p.oid) into v_protected from pg_catalog.pg_proc p
    where p.oid in (
      'private.art31_reconcile_manual_feed(uuid)'::regprocedure,
      'private.backend_reconcile_manual_feed(uuid)'::regprocedure,
      'public.art31_read_manual_command(uuid,uuid,uuid,boolean)'::regprocedure,
      'private.backend_finalize_updates(uuid,text[])'::regprocedure,
      'private.backend_publish_update_hint(uuid,text[],jsonb)'::regprocedure);
  for f in select e.*,p.*,l.lanname,
      (select count(*) from pg_catalog.pg_proc q join pg_catalog.pg_namespace n on n.oid=q.pronamespace
        where n.nspname='public' and q.proname=e.function_name) as overload_count
    from (values
      (1,'public.art31_sync_manual_feed(uuid,text,integer,jsonb,text,uuid,text,integer)','art31_sync_manual_feed',
        25081,'3dd32552b0e285826c93303185a3b511ad906579355d65b706f8fbccbf543ba5',
        array['p_device_id','p_device_verifier_hex','p_capabilities_revision','p_events','p_actuator_state','p_active_sequence_id','p_clock_quality','p_clock_uncertainty_ms']::text[],0,null::text),
      (2,'public.art31_create_manual_feed(uuid,uuid,uuid,uuid,jsonb,integer)','art31_create_manual_feed',
        8673,'fd6f152e307e97dd3e8e9934bc844c0cf7b698ef571b7951c30e07ee5680eaf3',
        array['p_device_id','p_installation_id','p_request_id','p_idempotency_key','p_targets','p_capabilities_revision']::text[],0,null::text),
      (3,'public.art31_resolve_manual_feed_no_admission(uuid,uuid,uuid,uuid,jsonb,integer)','art31_resolve_manual_feed_no_admission',
        5094,'cf3caed3defe35259b47660eac35d60940e036acaca62fd2604cab3cacee6785',
        array['p_device_id','p_installation_id','p_request_id','p_idempotency_key','p_targets','p_capabilities_revision']::text[],0,null::text),
      (4,'public.art31_history_page(uuid,uuid,date,date,text,text,timestamp with time zone,uuid)','art31_history_page',
        3499,'39b09b16106a6d556196344dceafb3697e65428377d767c5970a34241a7b422c',
        array['p_device_id','p_installation_id','p_from_date','p_to_date','p_source','p_status','p_before_created_at','p_before_sequence_id']::text[],2,'NULL::timestamp with time zone, NULL::uuid'),
      (5,'public.art31_history_detail(uuid,uuid,uuid)','art31_history_detail',
        1022,'b1d460af9bdf2ebe72c861d50ab44a6a4f5afe029178da028a39c67a44692941',
        array['p_device_id','p_installation_id','p_sequence_id']::text[],0,null::text)
    ) e(ordinal,signature,function_name,src_bytes,sha,arg_names,defaults_count,defaults_sql)
    left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.signature)
    left join pg_catalog.pg_language l on l.oid=p.prolang
    order by e.ordinal
  loop
    if f.oid is null or f.overload_count<>1 or f.prokind is distinct from 'f'::"char"
      or pg_catalog.pg_get_userbyid(f.proowner) is distinct from 'postgres'
      or f.lanname is distinct from 'plpgsql' or f.prosecdef is distinct from true
      or f.provolatile is distinct from 'v'::"char" or f.proconfig is distinct from array['search_path=""']::text[]
      or f.proargnames is distinct from f.arg_names or f.proargmodes is not null or f.proallargtypes is not null
      or f.prorettype<>'jsonb'::regtype or f.proretset or f.proisstrict or f.proleakproof
      or f.proparallel is distinct from 'u'::"char" or f.provariadic<>0 or f.prosupport::oid<>0
      or f.procost<>100 or f.prorows<>0 or f.protrftypes is not null
      or f.pronargdefaults is distinct from f.defaults_count
      or pg_catalog.pg_get_expr(f.proargdefaults,0) is distinct from f.defaults_sql
      or pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE')
      or exists(select 1 from pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
        where a.privilege_type<>'EXECUTE' or a.grantee=0 or a.grantee not in (f.proowner,'service_role'::regrole)
          or (a.grantee='service_role'::regrole and a.is_grantable)) then
      raise exception 'T08_B2_TERMINAL_PREDECESSOR_METADATA_MISMATCH';
    end if;
    v_source:=replace(f.prosrc,E'\r\n',E'\n');
    v_definition:=replace(pg_catalog.pg_get_functiondef(f.oid),E'\r\n',E'\n');
    if strpos(v_source,chr(13))>0 or octet_length(v_source)<>f.src_bytes
      or encode(sha256(convert_to(v_source,'UTF8')),'hex')<>f.sha
      or length(v_definition)-length(replace(v_definition,v_source,''))<>length(v_source)
      or length(v_source)-length(replace(v_source,'perform private.art31_reconcile_manual_feed(p_device_id);',''))
        <>length('perform private.art31_reconcile_manual_feed(p_device_id);') then
      raise exception 'T08_B2_TERMINAL_PREDECESSOR_SOURCE_MISMATCH';
    end if;
    v_signatures[f.ordinal]:=f.signature;
    v_sources[f.ordinal]:=v_source;
    v_definitions[f.ordinal]:=v_definition;
    v_defaults[f.ordinal]:=f.defaults_sql;
    select to_jsonb(p) into strict v_actual from pg_catalog.pg_proc p where p.oid=f.oid;
    v_before[f.ordinal]:=v_actual;
  end loop;

  for i in 1..5 loop
    v_source:=v_sources[i];
    v_definition:=v_definitions[i];
    case i
    when 1 then
      -- N7: only contact, new immutable journal evidence, first delivery and reconciliation mutate.
      -- All event/maintenance/continuation branches remain behind the one actual INSERT below.
      v_pairs:=array[
$old$  v_evidence jsonb;
begin$old$,
$new$  v_evidence jsonb;
  v_feeding_changed boolean := false;
  v_contact_changed boolean := false;
  v_first_delivery boolean := false;
  v_alert_before uuid;
  v_alert_after uuid;
  v_reconcile_resources text[] := array[]::text[];
  v_changed_resources text[] := array[]::text[];
begin$new$,
$old$    return jsonb_build_object('status', 'auth_required');
  end if;
  select c.device_id into v_credential_device_id$old$,
$new$    return jsonb_build_object('status', 'auth_required', '_changed_resources', array[]::text[]);
  end if;
  select c.device_id into v_credential_device_id$new$,
$old$  if not found then return jsonb_build_object('status', 'auth_required'); end if;$old$,
$new$  if not found then return jsonb_build_object('status', 'auth_required', '_changed_resources', array[]::text[]); end if;$new$,
$old$  update public.device_state set
    last_authenticated_contact_at = pg_catalog.clock_timestamp(),
    contact_freshness = 'fresh', updated_at = pg_catalog.clock_timestamp()
    where device_id = p_device_id;$old$,
$new$  select e.event_id into v_alert_before from public.alert_events e where e.device_id=p_device_id
    order by e.raised_at desc,e.event_id desc limit 1;
  update public.device_state set
    last_authenticated_contact_at = pg_catalog.clock_timestamp(),
    contact_freshness = 'fresh', updated_at = pg_catalog.clock_timestamp()
    where device_id = p_device_id
    returning last_authenticated_contact_at is distinct from v_state.last_authenticated_contact_at
      or contact_freshness is distinct from v_state.contact_freshness into v_contact_changed;$new$,
$old$      p_device_id, v_sequence.sequence_id, v_event_sequence, v_step_index,
      v_nozzle_number, v_target.requested_dose, v_event->>'event_type', v_event
    );$old$,
$new$      p_device_id, v_sequence.sequence_id, v_event_sequence, v_step_index,
      v_nozzle_number, v_target.requested_dose, v_event->>'event_type', v_event
    );
    v_feeding_changed := true;$new$,
$old$  perform private.art31_reconcile_manual_feed(p_device_id);$old$,
$new$  v_reconcile_resources := private.backend_reconcile_manual_feed(p_device_id);$new$,
$old$      update public.feed_sequences set delivered_at = coalesce(delivered_at, pg_catalog.clock_timestamp())
        where device_id = p_device_id and sequence_id = v_sequence.sequence_id;$old$,
$new$      update public.feed_sequences set delivered_at = coalesce(delivered_at, pg_catalog.clock_timestamp())
        where device_id = p_device_id and sequence_id = v_sequence.sequence_id
        returning delivered_at is distinct from v_sequence.delivered_at into v_first_delivery;
      if v_first_delivery then v_feeding_changed := true; end if;$new$,
$old$  return jsonb_build_object(
    'status', 'ok', 'server_time', pg_catalog.clock_timestamp(),
    'acknowledged_events', v_acknowledged, 'command', v_command,
    'next_sync_after_ms', 1000
  );$old$,
$new$  select e.event_id into v_alert_after from public.alert_events e where e.device_id=p_device_id
    order by e.raised_at desc,e.event_id desc limit 1;
  if v_feeding_changed or 'feeding'=any(v_reconcile_resources) then
    v_changed_resources := array['feeding']::text[];
  end if;
  if v_contact_changed then v_changed_resources := array_append(v_changed_resources,'contact'); end if;
  if v_alert_after is distinct from v_alert_before or 'alerts'=any(v_reconcile_resources) then
    v_changed_resources := array_append(v_changed_resources,'alerts');
  end if;
  return jsonb_build_object(
    'status', 'ok', 'server_time', pg_catalog.clock_timestamp(),
    'acknowledged_events', v_acknowledged, 'command', v_command,
    'next_sync_after_ms', 1000
  )||jsonb_build_object('_changed_resources',v_changed_resources);$new$
      ];
    when 2 then
      -- N9: all 15 terminal returns, including the still-runtime-unverified device_busy exit.
      v_pairs:=array[
$old$  v_fixed_portions integer := 0;$old$,
$new$  v_fixed_portions integer := 0;
  v_changed_resources text[];
  v_result jsonb;$new$,
$old$  perform private.art31_reconcile_manual_feed(p_device_id);$old$,
$new$  v_changed_resources := private.backend_reconcile_manual_feed(p_device_id);$new$,
$old$      return jsonb_build_object('status', 'idempotency_conflict');$old$,
$new$      v_result := jsonb_build_object('status', 'idempotency_conflict');
      perform private.backend_finalize_updates(p_device_id,v_changed_resources);
      return v_result;$new$,
$old$    return jsonb_build_object(
      'status', 'existing',
      'command', private.art31_command_status_json(p_device_id, v_existing.sequence_id)
    );$old$,
$new$    v_result := jsonb_build_object(
      'status', 'existing',
      'command', private.art31_command_status_json(p_device_id, v_existing.sequence_id)
    );
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;$new$,
$old$    return jsonb_build_object('status', 'capability_mismatch');$old$,
$new$    v_result := jsonb_build_object('status', 'capability_mismatch');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;$new$,
$old$  if v_count = 2 and nullif(v_device.capabilities->>'scheduler_wake_grace_ms', '') is null then
    return jsonb_build_object('status', 'dose_unsupported');
  end if;$old$,
$new$  if v_count = 2 and nullif(v_device.capabilities->>'scheduler_wake_grace_ms', '') is null then
    v_result := jsonb_build_object('status', 'dose_unsupported');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;
  end if;$new$,
$old$  if not found then return jsonb_build_object('status', 'unavailable'); end if;$old$,
$new$  if not found then
    v_result := jsonb_build_object('status', 'unavailable');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;
  end if;$new$,
$old$  if v_state.safety_lockout then return jsonb_build_object('status', 'safety_lockout'); end if;$old$,
$new$  if v_state.safety_lockout then
    v_result := jsonb_build_object('status', 'safety_lockout');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;
  end if;$new$,
$old$    return jsonb_build_object('status', 'device_busy');$old$,
$new$    v_result := jsonb_build_object('status', 'device_busy');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;$new$,
$old$    return jsonb_build_object('status', 'device_offline');$old$,
$new$    v_result := jsonb_build_object('status', 'device_offline');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;$new$,
$old$    if coalesce((v_nozzle->>'enabled')::boolean, false) is not true then
      return jsonb_build_object('status', 'dose_unsupported');
    end if;$old$,
$new$    if coalesce((v_nozzle->>'enabled')::boolean, false) is not true then
      v_result := jsonb_build_object('status', 'dose_unsupported');
      perform private.backend_finalize_updates(p_device_id,v_changed_resources);
      return v_result;
    end if;$new$,
$old$      if v_amount <= 0 or v_min is null or v_max is null or v_step is null then
        return jsonb_build_object('status', 'dose_unsupported');
      end if;$old$,
$new$      if v_amount <= 0 or v_min is null or v_max is null or v_step is null then
        v_result := jsonb_build_object('status', 'dose_unsupported');
        perform private.backend_finalize_updates(p_device_id,v_changed_resources);
        return v_result;
      end if;$new$,
$old$        return jsonb_build_object('status', 'dose_out_of_range');$old$,
$new$        v_result := jsonb_build_object('status', 'dose_out_of_range');
        perform private.backend_finalize_updates(p_device_id,v_changed_resources);
        return v_result;$new$,
$old$    else
      return jsonb_build_object('status', 'dose_unsupported');
    end if;
  end loop;$old$,
$new$    else
      v_result := jsonb_build_object('status', 'dose_unsupported');
      perform private.backend_finalize_updates(p_device_id,v_changed_resources);
      return v_result;
    end if;
  end loop;$new$,
$old$    return jsonb_build_object('status', 'inventory_unavailable');$old$,
$new$    v_result := jsonb_build_object('status', 'inventory_unavailable');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;$new$,
$old$    return jsonb_build_object('status', 'insufficient_inventory');$old$,
$new$    v_result := jsonb_build_object('status', 'insufficient_inventory');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;$new$,
$old$  return jsonb_build_object(
    'status', 'created',
    'command', private.art31_command_status_json(p_device_id, v_sequence)
  );$old$,
$new$  if not ('feeding'=any(v_changed_resources)) then
    v_changed_resources := array_append(v_changed_resources,'feeding');
  end if;
  v_result := jsonb_build_object(
    'status', 'created',
    'command', private.art31_command_status_json(p_device_id, v_sequence)
  );
  perform private.backend_finalize_updates(p_device_id,v_changed_resources);
  return v_result;$new$
      ];
    when 3 then
      -- N10's created path is a rejected/non-unresolved receipt, never ordinary admission.
      v_pairs:=array[
$old$  v_now timestamptz := pg_catalog.clock_timestamp();$old$,
$new$  v_now timestamptz := pg_catalog.clock_timestamp();
  v_changed_resources text[];
  v_result jsonb;$new$,
$old$  perform private.art31_reconcile_manual_feed(p_device_id);$old$,
$new$  v_changed_resources := private.backend_reconcile_manual_feed(p_device_id);$new$,
$old$      return jsonb_build_object('status', 'idempotency_conflict');$old$,
$new$      v_result := jsonb_build_object('status', 'idempotency_conflict');
      perform private.backend_finalize_updates(p_device_id,v_changed_resources);
      return v_result;$new$,
$old$    return jsonb_build_object(
      'status', 'existing',
      'command', private.art31_command_status_json(p_device_id, v_existing.sequence_id)
    );$old$,
$new$    v_result := jsonb_build_object(
      'status', 'existing',
      'command', private.art31_command_status_json(p_device_id, v_existing.sequence_id)
    );
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;$new$,
$old$  return jsonb_build_object(
    'status', 'created',
    'command', private.art31_command_status_json(p_device_id, v_sequence)
  );$old$,
$new$  if not ('feeding'=any(v_changed_resources)) then
    v_changed_resources := array_append(v_changed_resources,'feeding');
  end if;
  v_result := jsonb_build_object(
    'status', 'created',
    'command', private.art31_command_status_json(p_device_id, v_sequence)
  );
  perform private.backend_finalize_updates(p_device_id,v_changed_resources);
  return v_result;$new$
      ];
    when 4 then
      v_pairs:=array[
$old$  v_result jsonb;$old$,
$new$  v_result jsonb;
  v_changed_resources text[];$new$,
$old$  perform private.art31_reconcile_manual_feed(p_device_id);$old$,
$new$  v_changed_resources := private.backend_reconcile_manual_feed(p_device_id);$new$,
$old$     or ((p_before_created_at is null) <> (p_before_sequence_id is null)) then
    return jsonb_build_object('status', 'invalid');
  end if;$old$,
$new$     or ((p_before_created_at is null) <> (p_before_sequence_id is null)) then
    v_result := jsonb_build_object('status', 'invalid');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;
  end if;$new$,
$old$  if v_from_date > v_to_date then
    return jsonb_build_object('status', 'invalid');
  end if;$old$,
$new$  if v_from_date > v_to_date then
    v_result := jsonb_build_object('status', 'invalid');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;
  end if;$new$,
$old$  ) into v_result from summary;
  return v_result;$old$,
$new$  ) into v_result from summary;
  perform private.backend_finalize_updates(p_device_id,v_changed_resources);
  return v_result;$new$
      ];
    when 5 then
      v_pairs:=array[
$old$  v_record jsonb;$old$,
$new$  v_record jsonb;
  v_changed_resources text[];
  v_result jsonb;$new$,
$old$  perform private.art31_reconcile_manual_feed(p_device_id);$old$,
$new$  v_changed_resources := private.backend_reconcile_manual_feed(p_device_id);$new$,
$old$  if v_record is null then return jsonb_build_object('status', 'not_found'); end if;$old$,
$new$  if v_record is null then
    v_result := jsonb_build_object('status', 'not_found');
    perform private.backend_finalize_updates(p_device_id,v_changed_resources);
    return v_result;
  end if;$new$,
$old$  return jsonb_build_object('status', 'ok', 'timezone', coalesce(v_timezone, 'UTC'),
    'timezone_known', v_timezone_known, 'record', v_record);$old$,
$new$  v_result := jsonb_build_object('status', 'ok', 'timezone', coalesce(v_timezone, 'UTC'),
    'timezone_known', v_timezone_known, 'record', v_record);
  perform private.backend_finalize_updates(p_device_id,v_changed_resources);
  return v_result;$new$
      ];
    end case;
    for j in 1..array_length(v_pairs,1) by 2 loop
      if length(v_source)-length(replace(v_source,v_pairs[j],''))<>length(v_pairs[j])
        or length(v_definition)-length(replace(v_definition,v_pairs[j],''))<>length(v_pairs[j]) then
        raise exception 'T08_B2_TERMINAL_ANCHOR_MISMATCH';
      end if;
      v_source:=replace(v_source,v_pairs[j],v_pairs[j+1]);
      v_definition:=replace(v_definition,v_pairs[j],v_pairs[j+1]);
    end loop;
    if i=1 then
      if length(v_definition)-length(replace(v_definition,'CREATE OR REPLACE FUNCTION public.art31_sync_manual_feed(',''))
          <>length('CREATE OR REPLACE FUNCTION public.art31_sync_manual_feed(') then
        raise exception 'T08_B2_TERMINAL_MANUAL_DEFINITION_MISMATCH';
      end if;
      v_manual_source:=v_source;
      execute replace(v_definition,'CREATE OR REPLACE FUNCTION public.art31_sync_manual_feed(',
        'CREATE OR REPLACE FUNCTION private.backend_manual_sync_core(');
      alter function private.backend_manual_sync_core(uuid,text,integer,jsonb,text,uuid,text,integer) owner to postgres;
      revoke all on function private.backend_manual_sync_core(uuid,text,integer,jsonb,text,uuid,text,integer)
        from public,anon,authenticated,service_role;
      execute replace(v_definitions[i],v_sources[i],v_wrapper);
      v_installed[i]:=v_wrapper;
    else
      execute v_definition;
      v_installed[i]:=v_source;
    end if;
  end loop;

  for i in 1..5 loop
    -- Canonical CREATE OR REPLACE may alter raw default-node locations, not their meaning/count.
    select to_jsonb(p)-array['prosrc','proargdefaults'] into strict v_actual
      from pg_catalog.pg_proc p where p.oid=to_regprocedure(v_signatures[i]);
    if v_actual is distinct from v_before[i]-array['prosrc','proargdefaults']
      or (select pg_get_expr(p.proargdefaults,0) from pg_catalog.pg_proc p
        where p.oid=to_regprocedure(v_signatures[i])) is distinct from v_defaults[i]
      or (select replace(p.prosrc,E'\r\n',E'\n') from pg_catalog.pg_proc p
        where p.oid=to_regprocedure(v_signatures[i])) is distinct from v_installed[i] then
      raise exception 'T08_B2_TERMINAL_INSTALLED_ENTRY_MISMATCH';
    end if;
  end loop;
  select to_jsonb(p)-array['oid','proname','pronamespace','prosrc','proacl'] into strict v_actual
    from pg_catalog.pg_proc p
    where p.oid='private.backend_manual_sync_core(uuid,text,integer,jsonb,text,uuid,text,integer)'::regprocedure;
  if v_actual is distinct from v_before[1]-array['oid','proname','pronamespace','prosrc','proacl']
    or (select replace(p.prosrc,E'\r\n',E'\n') from pg_catalog.pg_proc p
      where p.oid='private.backend_manual_sync_core(uuid,text,integer,jsonb,text,uuid,text,integer)'::regprocedure)
      is distinct from v_manual_source
    or exists(select 1 from pg_catalog.pg_proc p cross join lateral
      aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid='private.backend_manual_sync_core(uuid,text,integer,jsonb,text,uuid,text,integer)'::regprocedure
        and (a.grantee<>p.proowner or a.privilege_type<>'EXECUTE'))
    or has_function_privilege('anon','private.backend_manual_sync_core(uuid,text,integer,jsonb,text,uuid,text,integer)','EXECUTE')
    or has_function_privilege('authenticated','private.backend_manual_sync_core(uuid,text,integer,jsonb,text,uuid,text,integer)','EXECUTE')
    or has_function_privilege('service_role','private.backend_manual_sync_core(uuid,text,integer,jsonb,text,uuid,text,integer)','EXECUTE') then
    raise exception 'T08_B2_TERMINAL_MANUAL_CORE_MISMATCH';
  end if;
  if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and strpos(p.prosrc,'private.art31_reconcile_manual_feed(')>0) then
    raise exception 'T08_B2_TERMINAL_OLD_BUSINESS_CALLER_REMAINS';
  end if;
  select jsonb_agg(to_jsonb(p) order by p.oid) into v_actual from pg_catalog.pg_proc p
    where p.oid in (
      'private.art31_reconcile_manual_feed(uuid)'::regprocedure,
      'private.backend_reconcile_manual_feed(uuid)'::regprocedure,
      'public.art31_read_manual_command(uuid,uuid,uuid,boolean)'::regprocedure,
      'private.backend_finalize_updates(uuid,text[])'::regprocedure,
      'private.backend_publish_update_hint(uuid,text[],jsonb)'::regprocedure);
  if v_actual is distinct from v_protected then
    raise exception 'T08_B2_TERMINAL_PROTECTED_PILOT_CHANGED';
  end if;
end $terminals$;

-- Phase 3: parent-observed standalone REDs; fixed nine-root installation, no aggregate.
-- Preserve both preceding DO bodies and old void ACL; only public outer boundaries publish.
do $producers$
declare
  f record;
  i integer;
  j integer;
  v_signatures text[] := array[]::text[];
  v_sources text[] := array[]::text[];
  v_definitions text[] := array[]::text[];
  v_before jsonb[] := array[]::jsonb[];
  v_installed text[] := array[]::text[];
  v_core_sources text[] := array[]::text[];
  v_core_signatures constant text[] := array['private.backend_sync_metrics_core(uuid,text,uuid,bigint,jsonb)','private.backend_sync_telemetry_core(uuid,text,uuid,bigint,jsonb,jsonb)',null,'private.backend_legacy_configuration_report_core(uuid,text,bigint,bigint,text,text)','private.backend_negotiated_configuration_report_core(uuid,text,jsonb)','private.backend_scheduled_events_core(uuid,text,jsonb,text,integer,text,uuid)',null,null,null]::text[];
  v_wrappers constant text[] := array[
$wrapper1$
declare
  v_result jsonb;
  v_revisions jsonb;
begin
  v_result := private.backend_sync_metrics_core(p_device_id,p_device_verifier_hex,p_boot_id,p_live_sequence,p_metric_telemetry);
  if v_result->>'status'='ok' then
    v_revisions := private.backend_finalize_updates(p_device_id,
      array(select pg_catalog.jsonb_array_elements_text(v_result->'_changed_resources')));
    return (v_result-'_changed_resources')||jsonb_build_object('revisions',v_revisions);
  end if;
  return v_result-'_changed_resources';
end;
$wrapper1$,
$wrapper2$
declare
  v_result jsonb;
begin
  v_result := private.backend_sync_telemetry_core(p_device_id,p_device_verifier_hex,p_boot_id,p_live_sequence,p_latest_sample,p_backlog_samples);
  if v_result->>'status'='ok' then
    perform private.backend_finalize_updates(p_device_id,
      array(select pg_catalog.jsonb_array_elements_text(v_result->'_changed_resources')));
  end if;
  return v_result-'_changed_resources';
end;
$wrapper2$,
null,
$wrapper4$
declare
  v_result jsonb;
begin
  v_result := private.backend_legacy_configuration_report_core(p_device_id,p_device_verifier_hex,p_applied_revision,p_last_attempt_revision,p_last_attempt_status,p_error_code);
  if v_result->>'status'='ok' then
    perform private.backend_finalize_updates(p_device_id,
      array(select pg_catalog.jsonb_array_elements_text(v_result->'_changed_resources')));
  end if;
  return v_result-'_changed_resources';
end;
$wrapper4$,
$wrapper5$
declare
  v_result jsonb;
begin
  v_result := private.backend_negotiated_configuration_report_core(p_device_id,p_device_verifier_hex,p_configuration);
  if v_result->>'status'='ok' then
    perform private.backend_finalize_updates(p_device_id,
      array(select pg_catalog.jsonb_array_elements_text(v_result->'_changed_resources')));
  end if;
  return v_result-'_changed_resources';
end;
$wrapper5$,
$wrapper6$
declare
  v_result jsonb;
begin
  v_result := private.backend_scheduled_events_core(p_device_id,p_device_verifier_hex,p_events,p_clock_quality,p_clock_uncertainty_ms,p_actuator_state,p_active_sequence_id);
  if v_result->>'status'='ok' then
    perform private.backend_finalize_updates(p_device_id,
      array(select pg_catalog.jsonb_array_elements_text(v_result->'_changed_resources')));
  end if;
  return v_result-'_changed_resources';
end;
$wrapper6$,
null,
null,
null
  ];
  v_protected_oids oid[] := array[
    'private.art31_reconcile_manual_feed(uuid)'::regprocedure::oid,
    'private.backend_reconcile_manual_feed(uuid)'::regprocedure::oid,
    'public.art31_read_manual_command(uuid,uuid,uuid,boolean)'::regprocedure::oid,
    'public.art31_sync_manual_feed(uuid,text,integer,jsonb,text,uuid,text,integer)'::regprocedure::oid,
    'private.backend_manual_sync_core(uuid,text,integer,jsonb,text,uuid,text,integer)'::regprocedure::oid,
    'public.art31_create_manual_feed(uuid,uuid,uuid,uuid,jsonb,integer)'::regprocedure::oid,
    'public.art31_resolve_manual_feed_no_admission(uuid,uuid,uuid,uuid,jsonb,integer)'::regprocedure::oid,
    'public.art31_history_page(uuid,uuid,date,date,text,text,timestamp with time zone,uuid)'::regprocedure::oid,
    'public.art31_history_detail(uuid,uuid,uuid)'::regprocedure::oid,
    'private.backend_finalize_updates(uuid,text[])'::regprocedure::oid,
    'private.backend_publish_update_hint(uuid,text[],jsonb)'::regprocedure::oid
  ];
  v_protected jsonb;
  v_actual jsonb;
  v_source text;
  v_definition text;
  v_old_name text;
  v_new_name text;
  v_pairs text[];
begin
  if current_user<>'postgres' or exists(select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname in ('backend_sync_metrics_core','backend_sync_telemetry_core','backend_legacy_configuration_report_core','backend_negotiated_configuration_report_core','backend_scheduled_events_core'))
    or (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and strpos(p.prosrc,'private.backend_configuration_report(')>0)<>2
    or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and strpos(p.prosrc,'private.backend_configuration_report(')>0
        and p.oid not in ('public.art33_device_configuration_report(uuid,text,bigint,bigint,text,text)'::regprocedure,
          'public.backend_device_configuration_report(uuid,text,jsonb)'::regprocedure)) then
    raise exception 'T08_B2_PRODUCERS_PREREQUISITE_MISMATCH';
  end if;
  select jsonb_agg(to_jsonb(p) order by p.oid) into v_protected from pg_catalog.pg_proc p
    where p.oid=any(v_protected_oids);

  -- Check all nine exact accepted bodies and closed attributes/ACLs before moving any target.
  for f in select e.*,p.*,l.lanname,
      (select count(*) from pg_catalog.pg_proc q join pg_catalog.pg_namespace n on n.oid=q.pronamespace
        where n.nspname=e.schema_name and q.proname=e.function_name) as overload_count
    from (values
      (1,'public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb)','public','backend_sync_metrics',
        8801,'54c6bfcd46d1c89f6bc4a7b63988d0c05a964ead286c47891eedb6a9ca33f73f',array['p_device_id','p_device_verifier_hex','p_boot_id','p_live_sequence','p_metric_telemetry']::text[],true,true),
      (2,'public.art27_sync_telemetry(uuid,text,uuid,bigint,jsonb,jsonb)','public','art27_sync_telemetry',
        9912,'c280dc6229112e756164ff62bc0f01cac89d92ab3495fec46014580baa0310c6',array['p_device_id','p_device_verifier_hex','p_boot_id','p_live_sequence','p_latest_sample','p_backlog_samples']::text[],true,true),
      (3,'private.backend_configuration_report(uuid,text,bigint,bigint,text,text)','private','backend_configuration_report',
        6379,'eac69e938caf690a7123111731ed6e357bef3ab504841eb64855f608b9b7a431',array['p_device_id','p_device_verifier_hex','p_applied_revision','p_last_attempt_revision','p_last_attempt_status','p_error_code']::text[],true,false),
      (4,'public.art33_device_configuration_report(uuid,text,bigint,bigint,text,text)','public','art33_device_configuration_report',
        1055,'c08f673fd521e9906aea1e2ccd1be08d462d5daa2e0aea866687b57d002b7c4b',array['p_device_id','p_device_verifier_hex','p_applied_revision','p_last_attempt_revision','p_last_attempt_status','p_error_code']::text[],true,true),
      (5,'public.backend_device_configuration_report(uuid,text,jsonb)','public','backend_device_configuration_report',
        3607,'0bb1383d5dbacd8ec598ed381f2a7d4c46dd57a3ab2eb602e8f7b3b6b424c086',array['p_device_id','p_device_verifier_hex','p_configuration']::text[],true,true),
      (6,'public.art33_record_scheduled_events(uuid,text,jsonb,text,integer,text,uuid)','public','art33_record_scheduled_events',
        22272,'1d67c66f72072132fc39ed7c89bba2c3a684fd1dd255fd1c4359659fc39b654c',array['p_device_id','p_device_verifier_hex','p_events','p_clock_quality','p_clock_uncertainty_ms','p_actuator_state','p_active_sequence_id']::text[],true,true),
      (7,'public.art33_write_configuration(uuid,uuid,uuid,bigint,jsonb)','public','art33_write_configuration',
        5429,'5de8e5dbd28eea80a32acb601ec145a0759d14e23e26fbf4ebc66f796d638b87',array['p_device_id','p_installation_id','p_request_id','p_based_on_revision','p_snapshot']::text[],true,true),
      (8,'public.art102_update_device_metadata(uuid,uuid,text,text,bigint)','public','art102_update_device_metadata',
        1464,'d8240d4bac51af30870a2ea8ccfe1028b905df1cc93713cd31dd85ddd99d401b',array['p_device_id','p_installation_id','p_alias','p_location','p_expected_revision']::text[],false,true),
      (9,'public.art38_revoke_device_access(uuid,uuid)','public','art38_revoke_device_access',
        909,'a4f00caad9a4f336894558cf9a780b3555ae535de0d3124d49011ade3f890c23',array['p_device_id','p_installation_id']::text[],false,true)
    ) e(ordinal,signature,schema_name,function_name,src_bytes,sha,arg_names,definer,service_execute)
    left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.signature)
    left join pg_catalog.pg_language l on l.oid=p.prolang
    order by e.ordinal
  loop
    if f.oid is null or f.overload_count<>1 or f.prokind is distinct from 'f'::"char"
      or pg_catalog.pg_get_userbyid(f.proowner) is distinct from 'postgres'
      or f.lanname is distinct from 'plpgsql' or f.prosecdef is distinct from f.definer
      or f.provolatile is distinct from 'v'::"char" or f.proconfig is distinct from array['search_path=""']::text[]
      or f.proargnames is distinct from f.arg_names or f.proargmodes is not null or f.proallargtypes is not null
      or f.prorettype<>'jsonb'::regtype or f.proretset or f.proisstrict or f.proleakproof
      or f.proparallel is distinct from 'u'::"char" or f.provariadic<>0 or f.prosupport::oid<>0
      or f.procost<>100 or f.prorows<>0 or f.protrftypes is not null
      or f.pronargdefaults<>0 or f.proargdefaults is not null
      or pg_catalog.has_function_privilege('anon',f.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',f.oid,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',f.oid,'EXECUTE') is distinct from f.service_execute
      or exists(select 1 from pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
        where a.privilege_type<>'EXECUTE' or a.grantee=0
          or (a.grantee<>f.proowner and (not f.service_execute or a.grantee<>'service_role'::regrole))
          or (a.grantee='service_role'::regrole and a.is_grantable)) then
      raise exception 'T08_B2_PRODUCERS_PREDECESSOR_METADATA_MISMATCH';
    end if;
    v_source:=replace(f.prosrc,E'\r\n',E'\n');
    v_definition:=replace(pg_catalog.pg_get_functiondef(f.oid),E'\r\n',E'\n');
    if strpos(v_source,chr(13))>0 or octet_length(v_source)<>f.src_bytes
      or encode(sha256(convert_to(v_source,'UTF8')),'hex')<>f.sha
      or length(v_definition)-length(replace(v_definition,v_source,''))<>length(v_source) then
      raise exception 'T08_B2_PRODUCERS_PREDECESSOR_SOURCE_MISMATCH';
    end if;
    v_signatures[f.ordinal]:=f.signature;
    v_sources[f.ordinal]:=v_source;
    v_definitions[f.ordinal]:=v_definition;
    select to_jsonb(p) into strict v_actual from pg_catalog.pg_proc p where p.oid=f.oid;
    v_before[f.ordinal]:=v_actual;
  end loop;

  for i in 1..9 loop
    v_source:=v_sources[i];
    v_definition:=v_definitions[i];
    case i
    when 1 then -- N1
      v_pairs:=array[
$old$  v_revisions jsonb; identity text;$old$,
$new$  identity text;$new$,
$old$  insert into public.device_resource_versions(device_id) values(p_device_id) on conflict(device_id) do nothing;
  select v.revisions into strict v_revisions from public.device_resource_versions v where v.device_id=p_device_id;
  foreach v_metric in array changed loop
    v_revisions:=jsonb_set(v_revisions,array[v_metric],to_jsonb((v_revisions->>v_metric)::bigint+1));
  end loop;
  if cardinality(changed)>0 then update public.device_resource_versions v set revisions=v_revisions where v.device_id=p_device_id; end if;
  return jsonb_build_object('status','ok','server_time',now_at,'acknowledged_metrics',ack,'revisions',v_revisions);$old$,
$new$  return jsonb_build_object('status','ok','server_time',now_at,'acknowledged_metrics',ack,
    '_changed_resources',to_jsonb(changed));$new$,
$old$    return jsonb_build_object('status','auth_required');$old$,
$new$    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$,
$old$  if not found then return jsonb_build_object('status','auth_required');$old$,
$new$  if not found then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$
      ];
    when 2 then -- N2
      v_pairs:=array[
$old$  v_freshness text;$old$,
$new$  v_freshness text;
  v_history_changed boolean := false;
  v_pointer_changed boolean := false;
  v_contact_changed boolean := false;
  v_alert_before uuid;
  v_alert_after uuid;
  v_changed_resources text[] := array[]::text[];$new$,
$old$  v_rows := p_backlog_samples;$old$,
$new$  select e.event_id into v_alert_before from public.alert_events e where e.device_id=p_device_id
    order by e.raised_at desc,e.event_id desc limit 1;
  v_rows := p_backlog_samples;$new$,
$old$        v_input_remaining,v_input_percent,v_input_feed_quality,v_input_calibration,v_now);$old$,
$new$        v_input_remaining,v_input_percent,v_input_feed_quality,v_input_calibration,v_now);
      v_history_changed := true;$new$,
$old$        where device_id=p_device_id;
      v_state.live_sequence := p_live_sequence;$old$,
$new$        where device_id=p_device_id
        returning (latest_telemetry_boot_id,latest_telemetry_sequence) is distinct from
          (v_state.latest_telemetry_boot_id,v_state.latest_telemetry_sequence) into v_pointer_changed;
      v_state.live_sequence := p_live_sequence;$new$,
$old$  update public.device_state set last_authenticated_contact_at=v_now,
    contact_freshness='fresh', updated_at=v_now where device_id=p_device_id;$old$,
$new$  update public.device_state set last_authenticated_contact_at=v_now,
    contact_freshness='fresh', updated_at=v_now where device_id=p_device_id
    returning last_authenticated_contact_at is distinct from v_state.last_authenticated_contact_at
      or contact_freshness is distinct from v_state.contact_freshness into v_contact_changed;$new$,
$old$  return jsonb_build_object('status','ok','server_time',v_now,'acknowledged_samples',v_ack);$old$,
$new$  select e.event_id into v_alert_after from public.alert_events e where e.device_id=p_device_id
    order by e.raised_at desc,e.event_id desc limit 1;
  if v_pointer_changed and v_device.capabilities->'independent_telemetry_v1' is distinct from 'true'::jsonb then
    v_changed_resources := array['do','feed'];
  end if;
  if v_history_changed then v_changed_resources := array_append(v_changed_resources,'history'); end if;
  if v_contact_changed then v_changed_resources := array_append(v_changed_resources,'contact'); end if;
  if v_alert_after is distinct from v_alert_before then v_changed_resources := array_append(v_changed_resources,'alerts'); end if;
  return jsonb_build_object('status','ok','server_time',v_now,'acknowledged_samples',v_ack,
    '_changed_resources',to_jsonb(v_changed_resources));$new$,
$old$    return jsonb_build_object('status','auth_required');$old$,
$new$    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$,
$old$  if not found then return jsonb_build_object('status','auth_required');$old$,
$new$  if not found then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$
      ];
    when 3 then -- N3
      v_pairs:=array[
$old$  v_old_snapshot jsonb;$old$,
$new$  v_old_snapshot jsonb;
  v_semantic_before jsonb;
  v_semantic_after jsonb;
  v_new_tombstones integer := 0;
  v_changed_resources text[] := array[]::text[];$new$,
$old$  if p_last_attempt_status='applied' then$old$,
$new$  v_semantic_before := jsonb_build_array(v_device.applied_revision,v_device.last_attempt_revision,
    v_device.last_attempt_status,v_device.configuration_error_code,v_revision.state,v_revision.error_code,v_revision.applied_at);
  if p_last_attempt_status='applied' then$new$,
$old$          where new_item.value->>'schedule_id'=old_item.value->>'schedule_id') on conflict do nothing;$old$,
$new$          where new_item.value->>'schedule_id'=old_item.value->>'schedule_id') on conflict do nothing;
      get diagnostics v_new_tombstones = row_count;$new$,
$old$  end if;
  return jsonb_build_object('status','ok','desired_configuration',null);
end;$old$,
$new$  end if;
  -- Fresh semantic state under already held D/R; affected-row count is not an apply change.
  select jsonb_build_array(d.applied_revision,d.last_attempt_revision,d.last_attempt_status,d.configuration_error_code,
    r.state,r.error_code,r.applied_at) into strict v_semantic_after
    from public.devices d join public.device_config_revisions r on r.device_id=d.device_id
    where d.device_id=p_device_id and r.revision=p_last_attempt_revision;
  if v_semantic_after is distinct from v_semantic_before or v_new_tombstones>0 then
    v_changed_resources := array['configuration'];
  end if;
  return jsonb_build_object('status','ok','desired_configuration',null,'_changed_resources',to_jsonb(v_changed_resources));
end;$new$,
$old$    return jsonb_build_object('status','auth_required');$old$,
$new$    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$,
$old$  if not found then return jsonb_build_object('status','auth_required');$old$,
$new$  if not found then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$,
$old$  if not found then return jsonb_build_object('status','invalid');$old$,
$new$  if not found then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$,
$old$     and p_error_code is null and p_applied_revision is not distinct from v_device.applied_revision then
    return jsonb_build_object('status','ok','desired_configuration',case
      when v_device.desired_revision is not null and v_device.last_attempt_status='pending'
      then private.art33_snapshot_json(p_device_id,v_device.desired_revision) else null end);$old$,
$new$     and p_error_code is null and p_applied_revision is not distinct from v_device.applied_revision then
    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','ok','desired_configuration',case
      when v_device.desired_revision is not null and v_device.last_attempt_status='pending'
      then private.art33_snapshot_json(p_device_id,v_device.desired_revision) else null end);$new$,
$old$    return jsonb_build_object('status','ok','desired_configuration',private.art33_snapshot_json(p_device_id,v_device.desired_revision));$old$,
$new$    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','ok','desired_configuration',private.art33_snapshot_json(p_device_id,v_device.desired_revision));$new$,
$old$     and p_last_attempt_revision is not distinct from v_device.applied_revision
     and p_applied_revision is not distinct from v_device.applied_revision then
    return jsonb_build_object('status','ok','desired_configuration',null);$old$,
$new$     and p_last_attempt_revision is not distinct from v_device.applied_revision
     and p_applied_revision is not distinct from v_device.applied_revision then
    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','ok','desired_configuration',null);$new$,
$old$  if p_last_attempt_status='rejected' and p_last_attempt_revision is distinct from v_device.desired_revision then
    return jsonb_build_object('status','stale');$old$,
$new$  if p_last_attempt_status='rejected' and p_last_attempt_revision is distinct from v_device.desired_revision then
    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','stale');$new$,
$old$       or p_applied_revision is distinct from p_last_attempt_revision) then
    return jsonb_build_object('status','invalid');$old$,
$new$       or p_applied_revision is distinct from p_last_attempt_revision) then
    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$,
$old$     or (p_last_attempt_status <> 'rejected' and p_error_code is not null) then
    return jsonb_build_object('status','invalid');$old$,
$new$     or (p_last_attempt_status <> 'rejected' and p_error_code is not null) then
    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$,
$old$      return jsonb_build_object('status','stale');$old$,
$new$      return jsonb_build_object('_changed_resources','[]'::jsonb,'status','stale');$new$,
$old$    end if;
    return jsonb_build_object('status','ok','desired_configuration',case
      when v_device.desired_revision is not null and v_device.last_attempt_status='pending'
      then private.art33_snapshot_json(p_device_id,v_device.desired_revision) else null end);$old$,
$new$    end if;
    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','ok','desired_configuration',case
      when v_device.desired_revision is not null and v_device.last_attempt_status='pending'
      then private.art33_snapshot_json(p_device_id,v_device.desired_revision) else null end);$new$,
$old$  if p_last_attempt_revision is null or p_last_attempt_revision is distinct from v_device.desired_revision then
    return jsonb_build_object('status','stale');$old$,
$new$  if p_last_attempt_revision is null or p_last_attempt_revision is distinct from v_device.desired_revision then
    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','stale');$new$,
$old$  if not found or v_revision.state not in ('requested','applied','rejected') then
    return jsonb_build_object('status','stale');$old$,
$new$  if not found or v_revision.state not in ('requested','applied','rejected') then
    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','stale');$new$,
$old$     and v_device.last_attempt_revision=p_last_attempt_revision
     and p_applied_revision is not distinct from v_device.applied_revision then
    return jsonb_build_object('status','ok','desired_configuration',null);$old$,
$new$     and v_device.last_attempt_revision=p_last_attempt_revision
     and p_applied_revision is not distinct from v_device.applied_revision then
    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','ok','desired_configuration',null);$new$,
$old$  if p_last_attempt_status='rejected' and v_revision.state<>'requested' then
    return jsonb_build_object('status','stale');$old$,
$new$  if p_last_attempt_status='rejected' and v_revision.state<>'requested' then
    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','stale');$new$,
$old$    if v_revision.state='rejected' then return jsonb_build_object('status','stale');$old$,
$new$    if v_revision.state='rejected' then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','stale');$new$
      ];
    when 4 then -- N4
      v_pairs:=array[
$old$ if p_device_verifier_hex is null or p_device_verifier_hex !~ '^[0-9a-fA-F]{64}$' then return jsonb_build_object('status','auth_required');$old$,
$new$ if p_device_verifier_hex is null or p_device_verifier_hex !~ '^[0-9a-fA-F]{64}$' then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$,
$old$ if not found then return jsonb_build_object('status','auth_required');$old$,
$new$ if not found then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$,
$old$ if not found then return jsonb_build_object('status','invalid');$old$,
$new$ if not found then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$,
$old$   and r.requested_snapshot ? 'oxygen_report_interval_seconds') then return jsonb_build_object('status','invalid');$old$,
$new$   and r.requested_snapshot ? 'oxygen_report_interval_seconds') then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$
      ];
    when 5 then -- N5
      v_pairs:=array[
$old$ if p_device_verifier_hex is null or p_device_verifier_hex !~ '^[0-9a-fA-F]{64}$' then return jsonb_build_object('status','auth_required');$old$,
$new$ if p_device_verifier_hex is null or p_device_verifier_hex !~ '^[0-9a-fA-F]{64}$' then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$,
$old$ if not found then return jsonb_build_object('status','auth_required');$old$,
$new$ if not found then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$,
$old$ if not found or d.capabilities->'independent_telemetry_v1' is distinct from 'true'::jsonb then return jsonb_build_object('status','invalid');$old$,
$new$ if not found or d.capabilities->'independent_telemetry_v1' is distinct from 'true'::jsonb then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$,
$old$   or jsonb_typeof(p_configuration->'last_attempt_revision') not in ('null','number') then return jsonb_build_object('status','invalid');$old$,
$new$   or jsonb_typeof(p_configuration->'last_attempt_revision') not in ('null','number') then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$,
$old$   or jsonb_typeof(p_configuration->'error_code') not in ('null','string') then return jsonb_build_object('status','invalid');$old$,
$new$   or jsonb_typeof(p_configuration->'error_code') not in ('null','string') then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$,
$old$   or (status is distinct from 'rejected' and p_configuration->>'error_code' is not null) then return jsonb_build_object('status','invalid');$old$,
$new$   or (status is distinct from 'rejected' and p_configuration->>'error_code' is not null) then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$,
$old$   if not found then return jsonb_build_object('status','stale');$old$,
$new$   if not found then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','stale');$new$,
$old$ if p_configuration->'oxygen_report_interval_seconds' is distinct from expected then return jsonb_build_object('status','invalid');$old$,
$new$ if p_configuration->'oxygen_report_interval_seconds' is distinct from expected then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$
      ];
    when 6 then -- N6
      v_pairs:=array[
$old$  v_failed integer;$old$,
$new$  v_failed integer;
  v_feeding_changed boolean := false;
  v_alert_before uuid;
  v_alert_after uuid;
  v_changed_resources text[] := array[]::text[];$new$,
$old$  for v_event in select value from jsonb_array_elements(p_events) loop$old$,
$new$  select e.event_id into v_alert_before from public.alert_events e where e.device_id=p_device_id
    order by e.raised_at desc,e.event_id desc limit 1;
  for v_event in select value from jsonb_array_elements(p_events) loop$new$,
$old$      values(p_device_id,v_sequence,(v_event->>'event_sequence')::bigint,v_step_index,v_nozzle,v_event->'requested_dose',v_event->>'event_type',v_event);$old$,
$new$      values(p_device_id,v_sequence,(v_event->>'event_sequence')::bigint,v_step_index,v_nozzle,v_event->'requested_dose',v_event->>'event_type',v_event);
    v_feeding_changed := true;$new$,
$old$  return jsonb_build_object('status','ok','acknowledged_events',v_ack);$old$,
$new$  select e.event_id into v_alert_after from public.alert_events e where e.device_id=p_device_id
    order by e.raised_at desc,e.event_id desc limit 1;
  if v_feeding_changed then v_changed_resources := array['feeding']; end if;
  if v_alert_after is distinct from v_alert_before then v_changed_resources := array_append(v_changed_resources,'alerts'); end if;
  return jsonb_build_object('status','ok','acknowledged_events',v_ack,'_changed_resources',to_jsonb(v_changed_resources));$new$,
$old$    return jsonb_build_object('status','auth_required');$old$,
$new$    return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$,
$old$  if not found then return jsonb_build_object('status','auth_required');$old$,
$new$  if not found then return jsonb_build_object('_changed_resources','[]'::jsonb,'status','auth_required');$new$,
$old$  return jsonb_build_object('status','conflict');$old$,
$new$  return jsonb_build_object('_changed_resources','[]'::jsonb,'status','conflict');$new$,
$old$  return jsonb_build_object('status','invalid');$old$,
$new$  return jsonb_build_object('_changed_resources','[]'::jsonb,'status','invalid');$new$
      ];
    when 7 then -- N14
      v_pairs:=array[
$old$  v_id uuid;$old$,
$new$  v_id uuid;
  v_result jsonb;$new$,
$old$    return jsonb_build_object('status','rejected','receipt',null,
      'current_state',private.art33_configuration_state(p_device_id),'error_code',v_error);$old$,
$new$    v_result := jsonb_build_object('status','rejected','receipt',null,
      'current_state',private.art33_configuration_state(p_device_id),'error_code',v_error);
    perform private.backend_finalize_updates(p_device_id,array['configuration']);
    return v_result;$new$,
$old$  return jsonb_build_object('status','ok','receipt',jsonb_build_object(
    'revision',v_revision,'based_on_revision',p_based_on_revision,'snapshot',p_snapshot),
    'current_state',private.art33_configuration_state(p_device_id));$old$,
$new$  v_result := jsonb_build_object('status','ok','receipt',jsonb_build_object(
    'revision',v_revision,'based_on_revision',p_based_on_revision,'snapshot',p_snapshot),
    'current_state',private.art33_configuration_state(p_device_id));
  perform private.backend_finalize_updates(p_device_id,array['configuration']);
  return v_result;$new$
      ];
    when 8 then -- N15
      v_pairs:=array[
$old$  v_device public.devices%rowtype;$old$,
$new$  v_device public.devices%rowtype;
  v_result jsonb;$new$,
$old$  return pg_catalog.jsonb_build_object(
    'status', 'updated', 'device_id', v_device.device_id,
    'alias', v_device.alias, 'location', v_device.location,
    'metadata_revision', v_device.metadata_revision, 'metadata_conflict', v_device.metadata_conflict
  );$old$,
$new$  v_result := pg_catalog.jsonb_build_object(
    'status', 'updated', 'device_id', v_device.device_id,
    'alias', v_device.alias, 'location', v_device.location,
    'metadata_revision', v_device.metadata_revision, 'metadata_conflict', v_device.metadata_conflict
  );
  perform private.backend_finalize_updates(p_device_id,array['configuration']);
  return v_result;$new$
      ];
    when 9 then -- N16
      v_pairs:=array[
$old$  v_access public.device_access%rowtype;$old$,
$new$  v_access public.device_access%rowtype;
  v_result jsonb;$new$,
$old$  return jsonb_build_object('status', 'revoked', 'revoked_at', v_access.revoked_at);$old$,
$new$  v_result := jsonb_build_object('status', 'revoked', 'revoked_at', v_access.revoked_at);
  perform private.backend_finalize_updates(p_device_id,array['contact']);
  return v_result;$new$
      ];
    end case;
    for j in 1..array_length(v_pairs,1) by 2 loop
      if length(v_source)-length(replace(v_source,v_pairs[j],''))<>length(v_pairs[j])
        or length(v_definition)-length(replace(v_definition,v_pairs[j],''))<>length(v_pairs[j]) then
        raise exception 'T08_B2_PRODUCERS_ANCHOR_MISMATCH';
      end if;
      v_source:=replace(v_source,v_pairs[j],v_pairs[j+1]);
      v_definition:=replace(v_definition,v_pairs[j],v_pairs[j+1]);
    end loop;
    if v_core_signatures[i] is not null then
      v_old_name:='CREATE OR REPLACE FUNCTION '||split_part(v_signatures[i],'(',1)||'(';
      v_new_name:='CREATE OR REPLACE FUNCTION '||split_part(v_core_signatures[i],'(',1)||'(';
      if length(v_definition)-length(replace(v_definition,v_old_name,''))<>length(v_old_name) then
        raise exception 'T08_B2_PRODUCERS_DEFINITION_NAME_MISMATCH';
      end if;
      execute replace(v_definition,v_old_name,v_new_name);
      execute format('alter function %s owner to postgres',v_core_signatures[i]);
      execute format('revoke all on function %s from public,anon,authenticated,service_role',v_core_signatures[i]);
      v_core_sources[i]:=v_source;
      execute replace(v_definitions[i],v_sources[i],v_wrappers[i]);
      v_installed[i]:=v_wrappers[i];
    else
      execute v_definition;
      v_installed[i]:=v_source;
    end if;
  end loop;

  for i in 1..9 loop
    select to_jsonb(p)-array['prosrc'] into strict v_actual
      from pg_catalog.pg_proc p where p.oid=to_regprocedure(v_signatures[i]);
    if v_actual is distinct from v_before[i]-array['prosrc']
      or (select replace(p.prosrc,E'\r\n',E'\n') from pg_catalog.pg_proc p
        where p.oid=to_regprocedure(v_signatures[i])) is distinct from v_installed[i] then
      raise exception 'T08_B2_PRODUCERS_INSTALLED_ENTRY_MISMATCH';
    end if;
    if v_core_signatures[i] is not null then
      select to_jsonb(p)-array['oid','proname','pronamespace','prosrc','proacl'] into strict v_actual
        from pg_catalog.pg_proc p where p.oid=to_regprocedure(v_core_signatures[i]);
      if v_actual is distinct from v_before[i]-array['oid','proname','pronamespace','prosrc','proacl']
        or (select replace(p.prosrc,E'\r\n',E'\n') from pg_catalog.pg_proc p
          where p.oid=to_regprocedure(v_core_signatures[i])) is distinct from v_core_sources[i]
        or exists(select 1 from pg_catalog.pg_proc p cross join lateral
          aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          where p.oid=to_regprocedure(v_core_signatures[i]) and (a.grantee<>p.proowner or a.privilege_type<>'EXECUTE'))
        or has_function_privilege('anon',v_core_signatures[i],'EXECUTE')
        or has_function_privilege('authenticated',v_core_signatures[i],'EXECUTE')
        or has_function_privilege('service_role',v_core_signatures[i],'EXECUTE') then
        raise exception 'T08_B2_PRODUCERS_INSTALLED_CORE_MISMATCH';
      end if;
    end if;
  end loop;
  if (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and strpos(p.prosrc,'private.backend_configuration_report(')>0)<>2
    or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and strpos(p.prosrc,'private.backend_configuration_report(')>0
        and p.oid not in ('private.backend_legacy_configuration_report_core(uuid,text,bigint,bigint,text,text)'::regprocedure,
          'private.backend_negotiated_configuration_report_core(uuid,text,jsonb)'::regprocedure))
    or exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and strpos(p.prosrc,'private.art31_reconcile_manual_feed(')>0) then
    raise exception 'T08_B2_PRODUCERS_CALL_GRAPH_MISMATCH';
  end if;
  select jsonb_agg(to_jsonb(p) order by p.oid) into v_actual from pg_catalog.pg_proc p
    where p.oid=any(v_protected_oids);
  if v_actual is distinct from v_protected then
    raise exception 'T08_B2_PRODUCERS_EARLIER_BOUNDARY_CHANGED';
  end if;
end $producers$;

-- B2-2 fixed aggregate. C/D/S + existing R/I/Q/T/E before business/G; V/B last.
do $aggregate$
declare
  previous_oids oid[]; previous_functions jsonb; actual_functions jsonb;
  expected record; installed record;
begin
  if current_user<>'postgres' or current_setting('server_encoding')<>'UTF8' then
    raise exception 'T08_B2_AGGREGATE_OWNER_ENCODING_REQUIRED';
  end if;
  if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname=any(array['backend_sync_keys','backend_sync_number','backend_sync_uuid','backend_sync_utc','backend_sync_dose','backend_sync_telemetry_values','backend_sync_entry','backend_sync_snapshot','backend_sync_command','backend_sync_flags','backend_sync_prelock']::text[]))
      or (n.nspname='public' and p.proname='backend_sync_device')) then
    raise exception 'T08_B2_AGGREGATE_NEW_NAME_EXISTS';
  end if;
  -- Earlier three fixed blocks already checked every effective predecessor. Preserve every installed tuple.
  select array_agg(p.oid order by p.oid),jsonb_agg(to_jsonb(p) order by p.oid)
    into previous_oids,previous_functions from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private');
  execute $definition_0$create function private.backend_sync_keys(p jsonb, required_keys text[], optional_keys text[]) returns boolean
language plpgsql immutable security invoker set search_path='' as $body$
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  return p ?& required_keys and p-(required_keys||optional_keys)='{}'::jsonb;
end;
$body$;$definition_0$;
  alter function private.backend_sync_keys(jsonb,text[],text[]) owner to postgres;
  revoke all on function private.backend_sync_keys(jsonb,text[],text[]) from public,anon,authenticated,service_role;
  execute $definition_1$create function private.backend_sync_number(p jsonb, minimum numeric, maximum numeric, integral boolean) returns boolean
language plpgsql immutable security invoker set search_path='' as $body$
declare n numeric;
begin
  if jsonb_typeof(p) is distinct from 'number' then return false; end if;
  n:=(p#>>'{}')::numeric;
  return n between minimum and maximum and (not integral or trunc(n)=n);
end;
$body$;$definition_1$;
  alter function private.backend_sync_number(jsonb,numeric,numeric,boolean) owner to postgres;
  revoke all on function private.backend_sync_number(jsonb,numeric,numeric,boolean) from public,anon,authenticated,service_role;
  execute $definition_2$create function private.backend_sync_uuid(p jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $body$
begin
  return coalesce(jsonb_typeof(p)='string' and (p#>>'{}') collate "C" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false);
end;
$body$;$definition_2$;
  alter function private.backend_sync_uuid(jsonb) owner to postgres;
  revoke all on function private.backend_sync_uuid(jsonb) from public,anon,authenticated,service_role;
  execute $definition_3$create function private.backend_sync_utc(p jsonb, allow_offset boolean) returns boolean
language plpgsql immutable security invoker set search_path='' as $body$
declare s text; y integer; m integer; d integer; last_day integer;
begin
  if jsonb_typeof(p) is distinct from 'string' then return false; end if;
  s:=p#>>'{}';
  if s collate "C" !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?(Z|\+00:00)$'
    or (not allow_offset and right(s,1)<>'Z') then return false; end if;
  y:=substr(s,1,4)::integer; m:=substr(s,6,2)::integer; d:=substr(s,9,2)::integer;
  if m not between 1 and 12 then return false; end if;
  last_day:=case m when 2 then case when y%400=0 or (y%4=0 and y%100<>0) then 29 else 28 end
    when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end;
  -- Calendar-only: JS accepts year0000 and arbitrary fractional precision. Native casts stay in their stage.
  return d between 1 and last_day;
end;
$body$;$definition_3$;
  alter function private.backend_sync_utc(jsonb,boolean) owner to postgres;
  revoke all on function private.backend_sync_utc(jsonb,boolean) from public,anon,authenticated,service_role;
  execute $definition_4$create function private.backend_sync_dose(p jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $body$
begin
  if private.backend_sync_keys(p,array['mode','amount_g'],array[]::text[]) then
    if p->'mode'<>'"grams"'::jsonb or not private.backend_sync_number(p->'amount_g',0,1.7976931348623157e308,false) then return false; end if;
    return (p->>'amount_g')::numeric>0;
  elsif private.backend_sync_keys(p,array['mode','fixed_portion_id'],array[]::text[]) then
    return coalesce(p->'mode'='"fixed_portion"'::jsonb and jsonb_typeof(p->'fixed_portion_id')='string'
      and (p->>'fixed_portion_id') collate "C" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$',false);
  end if;
  return false;
end;
$body$;$definition_4$;
  alter function private.backend_sync_dose(jsonb) owner to postgres;
  revoke all on function private.backend_sync_dose(jsonb) from public,anon,authenticated,service_role;
  execute $definition_5$create function private.backend_sync_telemetry_values(p jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $body$
declare k text;
begin
  if not private.backend_sync_keys(p,array['measured_at','time_quality','do_mg_l','do_quality','feed_remaining_g','feed_percent','feed_quality','calibration_revision'],array[]::text[]) then return false; end if;
  if not (p->'time_quality'=any(array['"synced"','"rtc"','"uncertain"','"invalid"']::jsonb[]))
    or not (p->'do_quality'=any(array['"valid"','"unavailable"','"uncalibrated"','"error"']::jsonb[]))
    or not (p->'feed_quality'=any(array['"valid"','"unavailable"','"uncalibrated"','"error"']::jsonb[])) then return false; end if;
  if p->>'time_quality'='invalid' then
    if p->'measured_at'<>'null'::jsonb then return false; end if;
  elsif not private.backend_sync_utc(p->'measured_at',false) then return false; end if;
  foreach k in array array['do_mg_l','feed_remaining_g','feed_percent','calibration_revision'] loop
    if p->k<>'null'::jsonb and not private.backend_sync_number(p->k,
      case when k='calibration_revision' then 1 else 0 end,
      case when k='feed_percent' then 100 when k='calibration_revision' then 9007199254740991 else 1.7976931348623157e308 end,
      k='calibration_revision') then return false; end if;
  end loop;
  return ((p->>'do_quality'='valid')=(p->'do_mg_l'<>'null'::jsonb)) and
    case when p->>'feed_quality'='valid' then p->'feed_remaining_g'<>'null'::jsonb and p->'feed_percent'<>'null'::jsonb and p->'calibration_revision'<>'null'::jsonb
    else p->'feed_remaining_g'='null'::jsonb and p->'feed_percent'='null'::jsonb and p->'calibration_revision'='null'::jsonb end;
end;
$body$;$definition_5$;
  alter function private.backend_sync_telemetry_values(jsonb) owner to postgres;
  revoke all on function private.backend_sync_telemetry_values(jsonb) from public,anon,authenticated,service_role;
  execute $definition_6$create function private.backend_sync_entry(p jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $body$
declare
  metric boolean; c jsonb; a jsonb; report jsonb; e jsonb; sample jsonb; values_only jsonb; batch jsonb;
  k text; identity text; seen text[]:=array[]::text[];
begin
  if not private.backend_sync_keys(p,array['protocol_major','request_id','boot_id','live_sequence','capabilities_revision','clock','actuator','configuration','latest_sample','backlog_samples','event_keys','scheduled_events_json','manual_events_json'],array['metric_telemetry']) then return false; end if;
  metric:=p?'metric_telemetry'; c:=p->'clock'; a:=p->'actuator'; report:=p->'configuration';
  if p->'protocol_major'<>'2'::jsonb or not private.backend_sync_uuid(p->'request_id') or not private.backend_sync_uuid(p->'boot_id')
    or not private.backend_sync_number(p->'live_sequence',0,9007199254740991,true)
    or not private.backend_sync_number(p->'capabilities_revision',1,9007199254740991,true)
    or not private.backend_sync_keys(c,array['quality','uncertainty_ms'],array[]::text[])
    or not private.backend_sync_keys(a,array['state','active_sequence_id'],array[]::text[])
    or not private.backend_sync_keys(report,array['applied_revision','last_attempt_revision','last_attempt_status','error_code']||case when metric then array['oxygen_report_interval_seconds'] else array[]::text[] end,array[]::text[])
    then return false; end if;
  if not (c->'quality'=any(array['"synced"','"rtc"','"uncertain"','"invalid"']::jsonb[])) then return false; end if;
  if c->>'quality'='invalid' then
    if c->'uncertainty_ms'<>'null'::jsonb then return false; end if;
  elsif not private.backend_sync_number(c->'uncertainty_ms',0,9007199254740991,true) then return false; end if;
  if not (a->'state'=any(array['"idle"','"feeding"','"fault"','"unknown"']::jsonb[]))
    or (a->'active_sequence_id'<>'null'::jsonb and not private.backend_sync_uuid(a->'active_sequence_id'))
    or (a->>'state'='idle' and a->'active_sequence_id'<>'null'::jsonb)
    or (a->>'state'='feeding' and a->'active_sequence_id'='null'::jsonb) then return false; end if;
  if (report->'applied_revision'<>'null'::jsonb and not private.backend_sync_number(report->'applied_revision',0,9007199254740991,true))
    or (report->'last_attempt_revision'<>'null'::jsonb and not private.backend_sync_number(report->'last_attempt_revision',1,9007199254740991,true))
    or not (report->'last_attempt_status'=any(array['null','"pending"','"applied"','"rejected"']::jsonb[]))
    or (report->'error_code'<>'null'::jsonb and not (report->'error_code'=any(array['"INVALID_INPUT"','"AUTH_REQUIRED"','"ACCESS_DENIED"','"RESOURCE_NOT_FOUND"','"DEVICE_OFFLINE"','"DEVICE_BUSY"','"DOSE_UNSUPPORTED"','"DOSE_OUT_OF_RANGE"','"CONFIG_CONFLICT"','"CONFIG_PENDING"','"CLOCK_UNTRUSTED"','"PAIRING_EXPIRED"','"PAIRING_INVALID"','"ACCESS_REVOKED"','"COMMAND_EXPIRED"','"IDEMPOTENCY_CONFLICT"','"SAFETY_LOCKOUT"','"PROTOCOL_UNSUPPORTED"','"PAYLOAD_TOO_LARGE"','"RATE_LIMITED"','"SERVICE_UNAVAILABLE"','"CAPABILITY_MISMATCH"','"VALIDATION_FAILED"']::jsonb[])))
    or (report->'last_attempt_status'='null'::jsonb and (report->'last_attempt_revision'<>'null'::jsonb or report->'error_code'<>'null'::jsonb))
    or (report->'last_attempt_status'<>'null'::jsonb and report->'last_attempt_revision'='null'::jsonb)
    or (report->>'last_attempt_status'='applied' and report->'applied_revision'<>report->'last_attempt_revision')
    or ((report->'last_attempt_status'='"rejected"'::jsonb) is distinct from (report->'error_code'<>'null'::jsonb)) then return false; end if;
  if metric and not (report->'oxygen_report_interval_seconds'=any(array['null','15','30','60','3600','7200','14400','28800']::jsonb[])) then return false; end if;
  if jsonb_typeof(p->'backlog_samples') is distinct from 'array'
    or jsonb_typeof(p->'event_keys') is distinct from 'array'
    or jsonb_typeof(p->'scheduled_events_json') is distinct from 'string'
    or jsonb_typeof(p->'manual_events_json') is distinct from 'string' then return false; end if;
  if jsonb_array_length(p->'event_keys')>100 then return false; end if;
  for e in select value from jsonb_array_elements(p->'event_keys') loop
    if not private.backend_sync_keys(e,array['source','sequence_id','event_sequence','schedule_id','configuration_revision','occurrence_local_date','nozzle_number','step_index'],array[]::text[])
      or not (e->'source'=any(array['"manual"','"scheduled"']::jsonb[]))
      or not private.backend_sync_uuid(e->'sequence_id')
      or not private.backend_sync_number(e->'event_sequence',1,9007199254740991,true)
      or (e->'schedule_id'<> 'null'::jsonb and not private.backend_sync_uuid(e->'schedule_id'))
      or (e->'configuration_revision'<> 'null'::jsonb and not private.backend_sync_number(e->'configuration_revision',1,9007199254740991,true))
      or (e->'occurrence_local_date'<> 'null'::jsonb and (jsonb_typeof(e->'occurrence_local_date')<>'string' or not private.backend_sync_utc(to_jsonb((e->>'occurrence_local_date')||'T00:00:00Z'),false)))
      or not (e->'nozzle_number'=any(array['1','2']::jsonb[])) or not (e->'step_index'=any(array['1','2']::jsonb[])) then return false; end if;
    if e->>'source'='manual' then
      if e->'schedule_id'<>'null'::jsonb or e->'configuration_revision'<>'null'::jsonb or e->'occurrence_local_date'<>'null'::jsonb then return false; end if;
    else
      if e->'schedule_id'='null'::jsonb or e->'configuration_revision'='null'::jsonb or e->'occurrence_local_date'='null'::jsonb then return false; end if;
    end if;
  end loop;
  if metric then
    if p->'latest_sample'<>'null'::jsonb or p->'backlog_samples'<>'[]'::jsonb
      or not private.backend_sync_keys(p->'metric_telemetry',array['live','backlog'],array[]::text[])
      or not private.backend_sync_keys(p#>'{metric_telemetry,live}',array['do','feed'],array[]::text[])
      then return false; end if;
    if jsonb_typeof(p#>'{metric_telemetry,backlog}') is distinct from 'array' then return false; end if;
    batch:=p#>'{metric_telemetry,backlog}';
    foreach k in array array['do','feed'] loop
      sample:=p#>array['metric_telemetry','live',k];
      if sample='null'::jsonb then continue; end if;
      if jsonb_typeof(sample) is distinct from 'object' or sample->'metric' is distinct from to_jsonb(k)
        or sample->'sequence' is distinct from p->'live_sequence'
        or not private.backend_sync_uuid(sample->'boot_id')
        or lower(sample->>'boot_id')<>lower(p->>'boot_id') then return false; end if;
      batch:=batch||jsonb_build_array(sample);
    end loop;
    if jsonb_array_length(batch)>100 then return false; end if;
    for sample in select value from jsonb_array_elements(batch) loop
      if not private.backend_sync_keys(sample,array['metric','boot_id','sequence','measured_at','captured_at','time_quality','quality','do_mg_l','feed_remaining_g','feed_percent','calibration_revision'],array[]::text[])
        or not (sample->'metric'=any(array['"do"','"feed"']::jsonb[]))
        or not private.backend_sync_uuid(sample->'boot_id') or not private.backend_sync_number(sample->'sequence',0,9007199254740991,true)
        or (sample->'captured_at'<>'null'::jsonb and not private.backend_sync_utc(sample->'captured_at',false)) then return false; end if;
      values_only:=jsonb_build_object('measured_at',sample->'measured_at','time_quality',sample->'time_quality',
        'do_mg_l',sample->'do_mg_l','do_quality',case when sample->>'metric'='do' then sample->'quality' else '"unavailable"'::jsonb end,
        'feed_remaining_g',sample->'feed_remaining_g','feed_percent',sample->'feed_percent',
        'feed_quality',case when sample->>'metric'='feed' then sample->'quality' else '"unavailable"'::jsonb end,'calibration_revision',sample->'calibration_revision');
      if not private.backend_sync_telemetry_values(values_only) then return false; end if;
      identity:=(sample->>'metric')||':'||lower(sample->>'boot_id')||':'||((sample->>'sequence')::numeric::bigint)::text;
      if identity=any(seen) then return false; end if; seen:=array_append(seen,identity);
    end loop;
  else
    batch:=p->'backlog_samples';
    if jsonb_array_length(batch)>(case when p->'latest_sample'='null'::jsonb then 100 else 99 end) then return false; end if;
    if p->'latest_sample'<>'null'::jsonb then
      sample:=p->'latest_sample';
      if not private.backend_sync_keys(sample,array['sequence','measured_at','time_quality','do_mg_l','do_quality','feed_remaining_g','feed_percent','feed_quality','calibration_revision'],array[]::text[])
        or sample->'sequence' is distinct from p->'live_sequence' then return false; end if;
      batch:=batch||jsonb_build_array(sample||jsonb_build_object('boot_id',p->'boot_id'));
    end if;
    for sample in select value from jsonb_array_elements(batch) loop
      if not private.backend_sync_keys(sample,array['boot_id','sequence','measured_at','time_quality','do_mg_l','do_quality','feed_remaining_g','feed_percent','feed_quality','calibration_revision'],array[]::text[])
        or not private.backend_sync_uuid(sample->'boot_id') or not private.backend_sync_number(sample->'sequence',0,9007199254740991,true)
        or not private.backend_sync_telemetry_values(sample-array['boot_id','sequence']::text[]) then return false; end if;
      identity:=lower(sample->>'boot_id')||':'||((sample->>'sequence')::numeric::bigint)::text;
      if identity=any(seen) then return false; end if; seen:=array_append(seen,identity);
    end loop;
  end if;
  return true;
end;
$body$;$definition_6$;
  alter function private.backend_sync_entry(jsonb) owner to postgres;
  revoke all on function private.backend_sync_entry(jsonb) from public,anon,authenticated,service_role;
  execute $definition_7$create function private.backend_sync_snapshot(p jsonb, metric boolean) returns boolean
language plpgsql immutable security invoker set search_path='' as $body$
declare s jsonb; t jsonb; day jsonb; seen integer[]; targets integer; i integer;
begin
  if not private.backend_sync_keys(p,array['revision','based_on_revision','timezone','monitoring_limits','low_feed_threshold_pct','schedules']||case when metric then array['oxygen_report_interval_seconds'] else array[]::text[] end,array[]::text[])
    or not private.backend_sync_number(p->'revision',1,9007199254740991,true)
    or not private.backend_sync_number(p->'based_on_revision',0,9007199254740991,true)
    or jsonb_typeof(p->'timezone')<>'string'
    or not private.backend_sync_keys(p->'monitoring_limits',array['do_low_mg_l','do_high_mg_l'],array[]::text[]) then return false; end if;
  if (p#>'{monitoring_limits,do_low_mg_l}'<>'null'::jsonb and not private.backend_sync_number(p#>'{monitoring_limits,do_low_mg_l}',0,1.7976931348623157e308,false))
    or (p#>'{monitoring_limits,do_high_mg_l}'<>'null'::jsonb and not private.backend_sync_number(p#>'{monitoring_limits,do_high_mg_l}',0,1.7976931348623157e308,false))
    or (p->'low_feed_threshold_pct'<>'null'::jsonb and not private.backend_sync_number(p->'low_feed_threshold_pct',0,100,false))
    or (metric and not (p->'oxygen_report_interval_seconds'=any(array['null','15','30','60','3600','7200','14400','28800']::jsonb[])))
    or jsonb_typeof(p->'schedules') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p->'schedules')>100 then return false; end if;
  for s in select value from jsonb_array_elements(p->'schedules') loop
    if not private.backend_sync_keys(s,array['schedule_id','local_time','weekdays','enabled','targets'],array[]::text[])
      or not private.backend_sync_uuid(s->'schedule_id') or jsonb_typeof(s->'local_time')<>'string'
      or (s->>'local_time') collate "C" !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or jsonb_typeof(s->'enabled')<>'boolean'
      or jsonb_typeof(s->'weekdays') is distinct from 'array' or jsonb_typeof(s->'targets') is distinct from 'array' then return false; end if;
    if jsonb_array_length(s->'weekdays') not between 1 and 7 or jsonb_array_length(s->'targets') not between 1 and 2 then return false; end if;
    seen:=array[]::integer[];
    for day in select value from jsonb_array_elements(s->'weekdays') loop
      if not private.backend_sync_number(day,1,7,true) then return false; end if;
      i:=(day#>>'{}')::numeric::integer; if i=any(seen) then return false; end if; seen:=array_append(seen,i);
    end loop;
    targets:=jsonb_array_length(s->'targets'); i:=0;
    for t in select value from jsonb_array_elements(s->'targets') loop
      i:=i+1;
      if not private.backend_sync_keys(t,array['nozzle_number','dose'],array[]::text[]) or not private.backend_sync_dose(t->'dose')
        or not (t->'nozzle_number'=any(array['1','2']::jsonb[]))
        or (targets=2 and t->'nozzle_number'<>to_jsonb(i)) then return false; end if;
    end loop;
  end loop;
  return true;
end;
$body$;$definition_7$;
  alter function private.backend_sync_snapshot(jsonb,boolean) owner to postgres;
  revoke all on function private.backend_sync_snapshot(jsonb,boolean) from public,anon,authenticated,service_role;
  execute $definition_8$create function private.backend_sync_command(p jsonb, device_id uuid) returns boolean
language plpgsql immutable security invoker set search_path='' as $body$
declare t jsonb; targets integer; i integer:=0;
begin
  if not private.backend_sync_keys(p,array['command_type','command_id','sequence_id','device_id','request_id','idempotency_key','targets','capabilities_revision','created_at','start_before','scheduler_wake_grace_ms','status'],array[]::text[])
    or p->'command_type'<>'"feed"'::jsonb or p->'status'<>'"queued"'::jsonb
    or not private.backend_sync_uuid(p->'command_id') or not private.backend_sync_uuid(p->'sequence_id')
    or lower(p->>'command_id')<>lower(p->>'sequence_id') or not private.backend_sync_uuid(p->'device_id')
    or not private.backend_sync_uuid(p->'request_id') or not private.backend_sync_uuid(p->'idempotency_key')
    or not private.backend_sync_number(p->'capabilities_revision',1,9007199254740991,true)
    or not private.backend_sync_utc(p->'created_at',true) or not private.backend_sync_utc(p->'start_before',true)
    or (p->'scheduler_wake_grace_ms'<>'null'::jsonb and not private.backend_sync_number(p->'scheduler_wake_grace_ms',0,9007199254740991,true))
    or jsonb_typeof(p->'targets') is distinct from 'array' then return false; end if;
  if (p->>'device_id')::uuid<>device_id then return false; end if;
  targets:=jsonb_array_length(p->'targets'); if targets not between 1 and 2 then return false; end if;
  for t in select value from jsonb_array_elements(p->'targets') loop
    i:=i+1;
    if not private.backend_sync_keys(t,array['nozzle_number','dose'],array[]::text[]) or not private.backend_sync_dose(t->'dose')
      or not (t->'nozzle_number'=any(array['1','2']::jsonb[]))
      or (targets=2 and t->'nozzle_number'<>to_jsonb(i)) then return false; end if;
  end loop;
  return true;
end;
$body$;$definition_8$;
  alter function private.backend_sync_command(jsonb,uuid) owner to postgres;
  revoke all on function private.backend_sync_command(jsonb,uuid) from public,anon,authenticated,service_role;
  execute $definition_9$create function private.backend_sync_flags(p jsonb) returns text[]
language plpgsql immutable security invoker set search_path='' as $body$
declare item jsonb; k text; flags text[]:=array[]::text[];
begin
  if jsonb_typeof(p) is distinct from 'array' then raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
  for item in select value from jsonb_array_elements(p) loop
    k:=item#>>'{}';
    if jsonb_typeof(item)<>'string' or k not in ('do','feed','history','configuration','feeding','contact','alerts') or k=any(flags) then
      raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
    flags:=array_append(flags,k);
  end loop;
  return flags;
end;
$body$;$definition_9$;
  alter function private.backend_sync_flags(jsonb) owner to postgres;
  revoke all on function private.backend_sync_flags(jsonb) from public,anon,authenticated,service_role;
  execute $definition_10$create function private.backend_sync_prelock(p_device_id uuid, p_sync jsonb) returns void
language plpgsql volatile security invoker set search_path='' as $body$
declare
  d public.devices%rowtype; s public.device_state%rowtype; event jsonb; item jsonb; candidate record;
  revisions bigint[]; applied_revisions bigint[]; identities uuid[]:=array[]::uuid[]; sequences uuid[]:=array[]::uuid[];
  occurrence_keys jsonb:='[]'::jsonb; candidate_date date; candidate_revision bigint; candidate_schedule uuid; candidate_nozzle smallint;
begin
  -- Caller already holds C/D/S and validated structure. Discovery is read-only under D serialization.
  select * into strict d from public.devices where device_id=p_device_id;
  select * into strict s from public.device_state where device_id=p_device_id;
  applied_revisions:=array[d.applied_revision,(p_sync#>>'{configuration,applied_revision}')::numeric::bigint,
    (p_sync#>>'{configuration,last_attempt_revision}')::numeric::bigint];
  revisions:=array_append(applied_revisions,d.desired_revision);
  if s.lockout_sequence_id is not null then sequences:=array_append(sequences,s.lockout_sequence_id); end if;
  for event in select value from jsonb_array_elements(p_sync->'event_keys') loop
    sequences:=array_append(sequences,(event->>'sequence_id')::uuid);
    if event->>'source'<>'scheduled' then continue; end if;
    candidate_revision:=(event->>'configuration_revision')::numeric::bigint;
    candidate_schedule:=(event->>'schedule_id')::uuid; candidate_nozzle:=(event->>'nozzle_number')::numeric::smallint;
    revisions:=array_append(revisions,candidate_revision); identities:=array_append(identities,candidate_schedule);
    -- JS accepts year0000; if native date cast cannot succeed, N6 fails before any occurrence FK.
    if not pg_input_is_valid(event->>'occurrence_local_date','date') then continue; end if;
    candidate_date:=(event->>'occurrence_local_date')::date;
    occurrence_keys:=occurrence_keys||jsonb_build_array(jsonb_build_object('schedule_id',candidate_schedule,
      'occurrence_local_date',event->'occurrence_local_date'));
    -- Conservative slot discovery does not move dose/admission checks ahead of telemetry/config.
    for candidate in
      select distinct companion.schedule_id
      from public.device_config_schedule_slots target_slot
      join public.device_config_schedule_slots companion_slot
        on companion_slot.device_id=target_slot.device_id and companion_slot.revision=target_slot.revision
        and companion_slot.iso_weekday=target_slot.iso_weekday and companion_slot.local_time=target_slot.local_time
      join public.device_config_schedules companion
        on companion.device_id=companion_slot.device_id and companion.revision=companion_slot.revision
        and companion.schedule_id=companion_slot.schedule_id and companion.nozzle_number=companion_slot.nozzle_number
      where target_slot.device_id=p_device_id and target_slot.revision=candidate_revision
        and target_slot.schedule_id=candidate_schedule and target_slot.nozzle_number=candidate_nozzle
        and target_slot.iso_weekday=extract(isodow from candidate_date)::smallint and companion.enabled
    loop
      identities:=array_append(identities,candidate.schedule_id);
      occurrence_keys:=occurrence_keys||jsonb_build_array(jsonb_build_object('schedule_id',candidate.schedule_id,
        'occurrence_local_date',event->'occurrence_local_date'));
    end loop;
  end loop;
  -- N3 reads old serialized schedules and new attempt.requested_snapshot. Cover every UUID its cast can use,
  -- including valid PostgreSQL non-RFC spellings in damaged persisted JSON, without recasting payloads.
  for candidate in select r.requested_snapshot from public.device_config_revisions r
    where r.device_id=p_device_id and r.revision=any(applied_revisions) order by r.revision
  loop
    for item in select value from jsonb_array_elements(case when jsonb_typeof(candidate.requested_snapshot->'schedules')='array'
      then candidate.requested_snapshot->'schedules' else '[]'::jsonb end)
    loop
      if pg_input_is_valid(item->>'schedule_id','uuid') then identities:=array_append(identities,(item->>'schedule_id')::uuid); end if;
    end loop;
    -- A nonarray cannot enumerate a later FK; original N3 either never uses it or errors before that enumeration.
  end loop;
  select coalesce(array_agg(distinct x.schedule_id),array[]::uuid[])||identities into identities
    from public.device_config_schedules x where x.device_id=p_device_id and x.revision=any(applied_revisions);
  select coalesce(array_agg(q.sequence_id),array[]::uuid[])||sequences into sequences
    from public.feed_sequences q where q.device_id=p_device_id and q.unresolved and q.status in ('queued','accepted','running');
  select coalesce(array_agg(r.sequence_id),array[]::uuid[])||sequences into sequences
    from public.device_execution_reservations r where r.device_id=p_device_id and r.phase in ('active','settling');
  select coalesce(array_agg(distinct o.sequence_id),array[]::uuid[])||sequences into sequences
    from public.scheduled_occurrences o where o.device_id=p_device_id and (
      o.sequence_id=any(sequences) or exists(select 1 from jsonb_array_elements(occurrence_keys) k
        where (k->>'schedule_id')::uuid=o.schedule_id and (k->>'occurrence_local_date')::date=o.occurrence_local_date));
  select coalesce(array_agg(distinct o.schedule_id),array[]::uuid[])||identities into identities
    from public.scheduled_occurrences o where o.device_id=p_device_id and o.sequence_id=any(sequences);
  -- Only existing, affected rows; no synthetic inserts/gap locks. D excludes supported same-device creators.
  perform 1 from public.device_config_revisions r where r.device_id=p_device_id and r.revision=any(revisions)
    order by r.revision for update;
  perform 1 from public.device_schedule_identities i where i.device_id=p_device_id and i.schedule_id=any(identities)
    order by i.schedule_id for key share;
  perform 1 from public.device_schedule_tombstones t where t.device_id=p_device_id and t.schedule_id=any(identities)
    order by t.schedule_id for key share;
  perform 1 from public.device_config_schedules c where c.device_id=p_device_id and c.revision=any(revisions) and c.schedule_id=any(identities)
    order by c.revision,c.schedule_id,c.nozzle_number for key share;
  perform 1 from public.device_config_schedule_slots x where x.device_id=p_device_id and x.revision=any(revisions) and x.schedule_id=any(identities)
    order by x.revision,x.schedule_id,x.nozzle_number,x.iso_weekday,x.local_time for key share;
  perform 1 from public.feed_sequences q where q.device_id=p_device_id and q.sequence_id=any(sequences)
    order by q.created_at,q.sequence_id for update;
  for candidate in
    select t.sequence_id,t.step_index from public.feed_sequence_targets t where t.device_id=p_device_id and t.sequence_id=any(sequences)
    union select f.sequence_id,f.step_index from public.feed_steps f where f.device_id=p_device_id and f.sequence_id=any(sequences)
    order by sequence_id,step_index
  loop
    perform 1 from public.feed_sequence_targets t where t.device_id=p_device_id and t.sequence_id=candidate.sequence_id and t.step_index=candidate.step_index for key share;
    perform 1 from public.feed_steps f where f.device_id=p_device_id and f.sequence_id=candidate.sequence_id and f.step_index=candidate.step_index for update;
  end loop;
  perform 1 from public.device_execution_reservations r where r.device_id=p_device_id and r.sequence_id=any(sequences)
    order by r.sequence_id for update;
  perform 1 from public.scheduled_occurrences o where o.device_id=p_device_id and (
    o.sequence_id=any(sequences) or exists(select 1 from jsonb_array_elements(occurrence_keys) k
      where (k->>'schedule_id')::uuid=o.schedule_id and (k->>'occurrence_local_date')::date=o.occurrence_local_date))
    order by o.schedule_id,o.occurrence_local_date for update;
end;
$body$;$definition_10$;
  alter function private.backend_sync_prelock(uuid,jsonb) owner to postgres;
  revoke all on function private.backend_sync_prelock(uuid,jsonb) from public,anon,authenticated,service_role;
  execute $definition_11$create function public.backend_sync_device(p_device_id uuid, p_device_verifier_hex text, p_sync jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set TimeZone to 'UTC' as $body$
declare
  d public.devices%rowtype; authenticated uuid; metric boolean; boot uuid; live_sequence bigint;
  telemetry jsonb; configuration jsonb; scheduled jsonb; manual jsonb; result jsonb;
  scheduled_text text; manual_text text; scheduled_events jsonb; manual_events jsonb; event_keys jsonb;
  scheduled_expected_keys jsonb; scheduled_actual_keys jsonb; manual_expected_keys jsonb; manual_actual_keys jsonb;
  samples jsonb; actual jsonb; expected jsonb;
  item jsonb; ack jsonb; key text; tuple_id text; seen text[]; flags text[]:=array[]::text[]; revisions jsonb;
  owners constant text[]:=array['do','feed','history','configuration','feeding','contact','alerts'];
begin
  if p_device_verifier_hex is null or p_device_verifier_hex collate "C" !~ '^[0-9a-fA-F]{64}$' then
    raise exception using errcode='P8A01',message='T08_SYNC_AUTH_REQUIRED'; end if;
  select c.device_id into authenticated from private.device_credentials c
    where c.device_id=p_device_id and c.revoked_at is null
      and c.credential_verifier=decode(lower(p_device_verifier_hex),'hex') for share;
  if not found then raise exception using errcode='P8A01',message='T08_SYNC_AUTH_REQUIRED'; end if;
  select * into d from public.devices where device_id=p_device_id for update;
  if not found then raise exception using errcode='P8A01',message='T08_SYNC_AUTH_REQUIRED'; end if;
  perform 1 from public.device_state where device_id=p_device_id for update;
  if not found then raise exception using errcode='P8T01',message='T08_SYNC_TELEMETRY_FAILED'; end if;
  if not private.backend_sync_entry(p_sync) then
    raise exception using errcode='22023',message='T08_SYNC_INVALID_INPUT'; end if;
  metric:=p_sync?'metric_telemetry';
  if metric and (d.capabilities->'independent_telemetry_v1' is distinct from 'true'::jsonb
    or p_sync->'capabilities_revision' is distinct from to_jsonb(d.capabilities_revision)) then
    raise exception using errcode='P8K01',message='T08_SYNC_CAPABILITY_MISMATCH'; end if;
  boot:=(p_sync->>'boot_id')::uuid; live_sequence:=(p_sync->>'live_sequence')::numeric::bigint;
  event_keys:=p_sync->'event_keys';
  scheduled_text:=p_sync->>'scheduled_events_json';
  manual_text:=p_sync->>'manual_events_json';
  perform private.backend_sync_prelock(p_device_id,p_sync);

  if metric then
    telemetry:=private.backend_sync_metrics_core(p_device_id,p_device_verifier_hex,boot,live_sequence,p_sync->'metric_telemetry');
  else
    telemetry:=private.backend_sync_telemetry_core(p_device_id,p_device_verifier_hex,boot,live_sequence,p_sync->'latest_sample',p_sync->'backlog_samples');
  end if;
  if telemetry->'status'='"auth_required"'::jsonb then raise exception using errcode='P8A01',message='T08_SYNC_AUTH_REQUIRED'; end if;
  if telemetry->'status' is distinct from '"ok"'::jsonb or not private.backend_sync_keys(telemetry,
    array['status','server_time','_changed_resources']||case when metric then array['acknowledged_metrics'] else array['acknowledged_samples'] end,array[]::text[])
    then raise exception using errcode='P8T01',message='T08_SYNC_TELEMETRY_FAILED'; end if;
  if not private.backend_sync_utc(telemetry->'server_time',true) then
    raise exception using errcode='P8T01',message='T08_SYNC_TELEMETRY_FAILED'; end if;
  flags:=flags||private.backend_sync_flags(telemetry->'_changed_resources');
  if metric then
    samples:=p_sync#>'{metric_telemetry,backlog}';
    foreach key in array array['do','feed'] loop
      item:=p_sync#>array['metric_telemetry','live',key];
      if item<>'null'::jsonb then samples:=samples||jsonb_build_array(item); end if;
    end loop;
    expected:='[]'::jsonb;
    for item in select value from jsonb_array_elements(samples) loop
      expected:=expected||jsonb_build_array(jsonb_build_object('metric',item->'metric','boot_id',lower(item->>'boot_id'),'sequence',item->'sequence'));
    end loop;
    if jsonb_typeof(telemetry->'acknowledged_metrics') is distinct from 'array' then
      raise exception using errcode='P8T01',message='T08_SYNC_TELEMETRY_FAILED'; end if;
    actual:='[]'::jsonb; seen:=array[]::text[];
    for ack in select value from jsonb_array_elements(telemetry->'acknowledged_metrics') loop
      if not private.backend_sync_keys(ack,array['metric','boot_id','sequence'],array[]::text[])
        or not (ack->'metric'=any(array['"do"','"feed"']::jsonb[])) or not private.backend_sync_uuid(ack->'boot_id')
        or not private.backend_sync_number(ack->'sequence',0,9007199254740991,true) then
        raise exception using errcode='P8T01',message='T08_SYNC_TELEMETRY_FAILED'; end if;
      tuple_id:=(ack->>'metric')||':'||lower(ack->>'boot_id')||':'||((ack->>'sequence')::numeric::bigint)::text;
      if tuple_id=any(seen) then raise exception using errcode='P8T01',message='T08_SYNC_TELEMETRY_FAILED'; end if;
      seen:=array_append(seen,tuple_id);
      actual:=actual||jsonb_build_array(jsonb_build_object('metric',ack->'metric','boot_id',lower(ack->>'boot_id'),'sequence',ack->'sequence'));
    end loop;
    if jsonb_array_length(actual)<>jsonb_array_length(expected) or not (actual @> expected and expected @> actual) then
      raise exception using errcode='P8T01',message='T08_SYNC_TELEMETRY_FAILED'; end if;
  else
    samples:=p_sync->'backlog_samples';
    if p_sync->'latest_sample'<>'null'::jsonb then samples:=samples||jsonb_build_array((p_sync->'latest_sample')||jsonb_build_object('boot_id',boot)); end if;
    select coalesce(jsonb_agg(jsonb_build_object('boot_id',lower(x.value->>'boot_id'),'sequence',x.value->'sequence') order by x.ordinality),'[]'::jsonb)
      into expected from jsonb_array_elements(samples) with ordinality x(value,ordinality);
    if jsonb_typeof(telemetry->'acknowledged_samples') is distinct from 'array' then
      raise exception using errcode='P8T01',message='T08_SYNC_TELEMETRY_FAILED'; end if;
    actual:='[]'::jsonb;
    for ack in select value from jsonb_array_elements(telemetry->'acknowledged_samples') loop
      if not private.backend_sync_keys(ack,array['boot_id','sequence'],array[]::text[]) or not private.backend_sync_uuid(ack->'boot_id')
        or not private.backend_sync_number(ack->'sequence',0,9007199254740991,true) then
        raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
      actual:=actual||jsonb_build_array(jsonb_build_object('boot_id',lower(ack->>'boot_id'),'sequence',ack->'sequence'));
    end loop;
    if actual is distinct from expected then raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
  end if;

  begin
    if metric then
      configuration:=private.backend_negotiated_configuration_report_core(p_device_id,p_device_verifier_hex,p_sync->'configuration');
    else
      configuration:=private.backend_legacy_configuration_report_core(p_device_id,p_device_verifier_hex,
        (p_sync#>>'{configuration,applied_revision}')::numeric::bigint,(p_sync#>>'{configuration,last_attempt_revision}')::numeric::bigint,
        p_sync#>>'{configuration,last_attempt_status}',p_sync#>>'{configuration,error_code}');
    end if;
  exception when sqlstate '22023' or sqlstate '23505' then
    raise exception using errcode='P8C03',message='T08_SYNC_CONFIGURATION_FAILED';
  end;
  if configuration->'status'='"auth_required"'::jsonb then raise exception using errcode='P8A01',message='T08_SYNC_AUTH_REQUIRED'; end if;
  if configuration->'status'='"stale"'::jsonb then raise exception using errcode='P8C01',message='T08_SYNC_CONFIGURATION_STALE'; end if;
  if configuration->'status' is distinct from '"ok"'::jsonb then raise exception using errcode='P8C02',message='T08_SYNC_CONFIGURATION_INVALID'; end if;
  if not private.backend_sync_keys(configuration,array['status','desired_configuration','_changed_resources'],array[]::text[]) then
    raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
  flags:=flags||private.backend_sync_flags(configuration->'_changed_resources');

  -- Scheduled boundary: whole-batch decode before business
  begin
    scheduled_events:=scheduled_text::jsonb;
  exception when others then
    raise exception using errcode='P8D01',message='T08_SYNC_SCHEDULED_DECODE_FAILED';
  end;
  if jsonb_typeof(scheduled_events) is distinct from 'array' then
    raise exception using errcode='P8D01',message='T08_SYNC_SCHEDULED_DECODE_FAILED';
  end if;
  select coalesce(jsonb_agg(e.value order by ordinality),'[]'::jsonb) into scheduled_expected_keys
    from jsonb_array_elements(event_keys) with ordinality e(value,ordinality) where e.value->>'source'='scheduled';
  select coalesce(jsonb_agg(jsonb_build_object('source',v.value->>'source','sequence_id',v.value->'sequence_id','event_sequence',v.value->'event_sequence','schedule_id',v.value->'schedule_id','configuration_revision',v.value->'configuration_revision','occurrence_local_date',v.value->'occurrence_local_date','nozzle_number',v.value->'nozzle_number','step_index',v.value->'step_index') order by ordinality),'[]'::jsonb) into scheduled_actual_keys
    from jsonb_array_elements(scheduled_events) with ordinality v(value,ordinality);
  if scheduled_actual_keys is distinct from scheduled_expected_keys then
    raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT';
  end if;
  if jsonb_array_length(scheduled_events)>0 then
    scheduled:=private.backend_scheduled_events_core(p_device_id,p_device_verifier_hex,scheduled_events,
      p_sync#>>'{clock,quality}',(p_sync#>>'{clock,uncertainty_ms}')::numeric::integer,
      p_sync#>>'{actuator,state}',(p_sync#>>'{actuator,active_sequence_id}')::uuid);
    if scheduled->'status'='"auth_required"'::jsonb then raise exception using errcode='P8A01',message='T08_SYNC_AUTH_REQUIRED'; end if;
    if scheduled->'status'='"conflict"'::jsonb then raise exception using errcode='P8S01',message='T08_SYNC_SCHEDULED_CONFLICT'; end if;
    if scheduled->'status' is distinct from '"ok"'::jsonb or jsonb_typeof(scheduled->'acknowledged_events') is distinct from 'array' then
      raise exception using errcode='P8S02',message='T08_SYNC_SCHEDULED_INVALID'; end if;
  else
    scheduled:=jsonb_build_object('acknowledged_events','[]'::jsonb,'_changed_resources','[]'::jsonb,'status','ok');
  end if;

  -- Manual boundary only after scheduled success
  begin
    manual_events:=manual_text::jsonb;
  exception when others then
    raise exception using errcode='P8D02',message='T08_SYNC_MANUAL_DECODE_FAILED';
  end;
  if jsonb_typeof(manual_events) is distinct from 'array' then
    raise exception using errcode='P8D02',message='T08_SYNC_MANUAL_DECODE_FAILED';
  end if;
  select coalesce(jsonb_agg(e.value order by ordinality),'[]'::jsonb) into manual_expected_keys
    from jsonb_array_elements(event_keys) with ordinality e(value,ordinality) where e.value->>'source'='manual';
  select coalesce(jsonb_agg(jsonb_build_object('source',v.value->>'source','sequence_id',v.value->'sequence_id','event_sequence',v.value->'event_sequence','schedule_id',v.value->'schedule_id','configuration_revision',v.value->'configuration_revision','occurrence_local_date',v.value->'occurrence_local_date','nozzle_number',v.value->'nozzle_number','step_index',v.value->'step_index') order by ordinality),'[]'::jsonb) into manual_actual_keys
    from jsonb_array_elements(manual_events) with ordinality v(value,ordinality);
  if manual_actual_keys is distinct from manual_expected_keys then
    raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT';
  end if;
  manual:=private.backend_manual_sync_core(p_device_id,p_device_verifier_hex,(p_sync->>'capabilities_revision')::numeric::integer,
    manual_events,p_sync#>>'{actuator,state}',(p_sync#>>'{actuator,active_sequence_id}')::uuid,
    p_sync#>>'{clock,quality}',(p_sync#>>'{clock,uncertainty_ms}')::numeric::integer);
  if manual->'status'='"auth_required"'::jsonb then raise exception using errcode='P8A01',message='T08_SYNC_AUTH_REQUIRED'; end if;
  if manual->'status' is distinct from '"ok"'::jsonb or not private.backend_sync_keys(manual,
    array['status','server_time','acknowledged_events','command','next_sync_after_ms','_changed_resources'],array[]::text[])
    or jsonb_typeof(manual->'acknowledged_events') is distinct from 'array' then
    raise exception using errcode='P8M01',message='T08_SYNC_MANUAL_FAILED'; end if;
  actual:='[]'::jsonb;
  for ack in select value from jsonb_array_elements(manual->'acknowledged_events') loop
    if not private.backend_sync_keys(ack,array['sequence_id','event_sequence'],array[]::text[])
      or not private.backend_sync_uuid(ack->'sequence_id') or not private.backend_sync_number(ack->'event_sequence',1,9007199254740991,true) then
      raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
    actual:=actual||jsonb_build_array(jsonb_build_object('sequence_id',lower(ack->>'sequence_id'),'event_sequence',ack->'event_sequence'));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('sequence_id',x.sequence_id,'event_sequence',x.event_sequence) order by x.sequence_id,x.event_sequence),'[]'::jsonb)
    into expected from (select distinct (e.value->>'sequence_id')::uuid sequence_id,(e.value->>'event_sequence')::numeric event_sequence
      from jsonb_array_elements(manual_events) e(value)) x;
  if actual is distinct from expected or not private.backend_sync_utc(manual->'server_time',true)
    or manual->'next_sync_after_ms' is distinct from '1000'::jsonb then
    raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
  if manual->'command'<>'null'::jsonb and not private.backend_sync_command(manual->'command',p_device_id) then
    raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
  flags:=flags||private.backend_sync_flags(manual->'_changed_resources');

  -- Deferred strict checks after N7
  if configuration->'desired_configuration'<>'null'::jsonb and not private.backend_sync_snapshot(configuration->'desired_configuration',metric) then
    raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
  if jsonb_array_length(scheduled_events)>0 then
    if not private.backend_sync_keys(scheduled,array['status','acknowledged_events','_changed_resources'],array[]::text[]) then
      raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
    actual:='[]'::jsonb;
    for ack in select value from jsonb_array_elements(scheduled->'acknowledged_events') loop
      if not private.backend_sync_keys(ack,array['sequence_id','event_sequence'],array[]::text[])
        or not private.backend_sync_uuid(ack->'sequence_id') or not private.backend_sync_number(ack->'event_sequence',1,9007199254740991,true) then
        raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
      actual:=actual||jsonb_build_array(jsonb_build_object('sequence_id',lower(ack->>'sequence_id'),'event_sequence',ack->'event_sequence'));
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('sequence_id',lower(x.value->>'sequence_id'),'event_sequence',x.value->'event_sequence') order by x.ordinality),'[]'::jsonb)
      into expected from jsonb_array_elements(scheduled_events) with ordinality x(value,ordinality);
    if actual is distinct from expected then raise exception using errcode='P8O01',message='T08_SYNC_INVALID_OUTPUT'; end if;
    flags:=flags||private.backend_sync_flags(scheduled->'_changed_resources');
  end if;

  select coalesce(array_agg(o.owner order by o.ordinality),array[]::text[]) into flags
    from unnest(owners) with ordinality o(owner,ordinality) where o.owner=any(flags);
  result:=jsonb_build_object('status','ok','server_time',manual->'server_time',
    'acknowledged_samples',case when metric then '[]'::jsonb else telemetry->'acknowledged_samples' end,
    'acknowledged_events',(manual->'acknowledged_events')||(scheduled->'acknowledged_events'),
    'desired_configuration',configuration->'desired_configuration','command',manual->'command','next_sync_after_ms',manual->'next_sync_after_ms');
  if metric then result:=result||jsonb_build_object('acknowledged_metrics',telemetry->'acknowledged_metrics'); end if;
  begin
    revisions:=private.backend_finalize_updates(p_device_id,flags);
  exception when sqlstate '22023' or sqlstate '23505' then
    raise exception using errcode='P8F01',message='T08_SYNC_FINALIZATION_FAILED';
  end;
  return result||jsonb_build_object('revisions',revisions);
end;
$body$;$definition_11$;
  alter function public.backend_sync_device(uuid,text,jsonb) owner to postgres;
  revoke all on function public.backend_sync_device(uuid,text,jsonb) from public,anon,authenticated,service_role;
  grant execute on function public.backend_sync_device(uuid,text,jsonb) to service_role;
  -- Fixed closed install manifest only; no persistent registry or general installer survives.
  for expected in select * from (values
    ('private.backend_sync_keys(jsonb,text[],text[])','f4be80accd7fbb622d72da4ce56c2eb8a066b226e7c217e57876157ed9b54b80','boolean','i',false,array['p','required_keys','optional_keys']::text[]),
    ('private.backend_sync_number(jsonb,numeric,numeric,boolean)','3f3744c40a85d254270d33ced8d7a84e2cb005b0455579d8a0e45da050338d35','boolean','i',false,array['p','minimum','maximum','integral']::text[]),
    ('private.backend_sync_uuid(jsonb)','f34ffd5af969ca4a7fbda1c7a0138075c4f3376c51798f1b5abe3c0f9084d647','boolean','i',false,array['p']::text[]),
    ('private.backend_sync_utc(jsonb,boolean)','0bd84f7a14413b874f712de5556cca3732eb1bd0852bab0ff51d466a9d130d83','boolean','i',false,array['p','allow_offset']::text[]),
    ('private.backend_sync_dose(jsonb)','61a1b61dcf55376c69b7934f376c34cf8e29069039fe798aeb8e1ccfc8de9f95','boolean','i',false,array['p']::text[]),
    ('private.backend_sync_telemetry_values(jsonb)','89c9b2ff993fa12eab911f0e106b05c747d612522cd8a6ba8324004dd5dcf162','boolean','i',false,array['p']::text[]),
    ('private.backend_sync_entry(jsonb)','13d1f787e7d601940b0a9293885439ffe7a8395f84f6a8f7af09c46a8281cea9','boolean','i',false,array['p']::text[]),
    ('private.backend_sync_snapshot(jsonb,boolean)','6455418eb3945be0664b0790bb6b48b77c6535dab11be5b5df484cb8abcaf622','boolean','i',false,array['p','metric']::text[]),
    ('private.backend_sync_command(jsonb,uuid)','b2e7fb54195f20e345b733142c14a49f22845ea22b02032625847f26bfe22ae3','boolean','i',false,array['p','device_id']::text[]),
    ('private.backend_sync_flags(jsonb)','5902e9ad84680a4df8d4d6d4b82861e2f7472045826e2a0f3c112d77fc3dacd8','text[]','i',false,array['p']::text[]),
    ('private.backend_sync_prelock(uuid,jsonb)','fd0bf43850326b2caae06d3fab7a9c35e7c1bcdf4179d832f331405fa7eb3402','void','v',false,array['p_device_id','p_sync']::text[]),
    ('public.backend_sync_device(uuid,text,jsonb)','a126efcff1f043c2469957c04bb192e2aa278b3fcfb99f07d2c7399bfae9c68c','jsonb','v',true,array['p_device_id','p_device_verifier_hex','p_sync']::text[])
  ) as manifest(signature,source_sha,result_type,volatility,security_definer,argument_names)
  loop
    select p.*,l.lanname into installed from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
      where p.oid=pg_catalog.to_regprocedure(expected.signature);
    if not found or pg_get_userbyid(installed.proowner)<>'postgres' or installed.lanname<>'plpgsql'
      or installed.prokind<>'f' or installed.prosecdef is distinct from expected.security_definer
      or installed.provolatile::text<>expected.volatility or installed.proparallel<>'u'
      or installed.proisstrict or installed.proleakproof or installed.proretset or installed.pronargdefaults<>0
      or installed.proargdefaults is not null or installed.proargmodes is not null or installed.proallargtypes is not null
      or installed.prorettype<>expected.result_type::regtype or installed.proargnames is distinct from expected.argument_names
      or installed.proconfig is distinct from (
        case when expected.signature='public.backend_sync_device(uuid,text,jsonb)'
          then array['search_path=""','TimeZone=UTC']::text[] else array['search_path=""']::text[] end)
      or installed.procost<>100 or installed.prorows<>0
      or encode(sha256(convert_to(installed.prosrc,'UTF8')),'hex')<>expected.source_sha
      or exists(select 1 from aclexplode(coalesce(installed.proacl,acldefault('f',installed.proowner))) a
        where a.privilege_type<>'EXECUTE' or (a.grantee<>installed.proowner and not (
          expected.signature='public.backend_sync_device(uuid,text,jsonb)' and a.grantee='service_role'::regrole and not a.is_grantable)))
      or has_function_privilege('anon',installed.oid,'EXECUTE') or has_function_privilege('authenticated',installed.oid,'EXECUTE')
      or has_function_privilege('service_role',installed.oid,'EXECUTE') is distinct from (expected.signature='public.backend_sync_device(uuid,text,jsonb)') then
      raise exception 'T08_B2_AGGREGATE_INSTALLED_FUNCTION_MISMATCH';
    end if;
  end loop;
  select jsonb_agg(to_jsonb(p) order by p.oid) into actual_functions from pg_catalog.pg_proc p where p.oid=any(previous_oids);
  if actual_functions is distinct from previous_functions then raise exception 'T08_B2_AGGREGATE_EARLIER_FUNCTION_CHANGED'; end if;
end $aggregate$;
commit;
