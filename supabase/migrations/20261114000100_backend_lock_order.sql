-- Backend T02 / F-01: credential/access -> devices -> device_state -> sequences/steps.
-- Depends on the immutable chain through 20261103120000; RPC signatures and grants stay intact.
-- Guarded forward function replacements only: no row rewrite, retention, capability or API change.
-- Feeding access/idempotency/uncertain lockout/ordered nozzles/measured stock remain unchanged.
-- Verify: backend_lock_order.mjs (disposable OLD RED / forward GREEN), ART31/33/95 SQL suites.
-- Recovery: docs/operations/backend-migrations.md and BACKEND_RECOVERY.md; reviewed forward
-- repair only, never erase feeding evidence/retry physical work. Old app/API/device remain compatible.
-- Shared application still requires separate approval + backup/restore gate. No irreversible data change.
-- Trusted direct DML is NOT protected by RPC ordering: prelock D then S before Q/steps (see recovery).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Follow the existing ART98/100 exact-match replacement pattern, preserving deployed body,
-- owner, security mode, search_path and ACLs. Unexpected predecessor text fails atomically.
create function pg_temp.backend_lock_patch(p_function regprocedure, p_old text, p_new text)
returns void language plpgsql as $$
declare
  v_source text;
  v_definition text;
begin
  select replace(p.prosrc,E'\r\n',E'\n'),
         replace(pg_catalog.pg_get_functiondef(p.oid),E'\r\n',E'\n')
    into strict v_source,v_definition from pg_catalog.pg_proc p where p.oid=p_function;
  if length(v_source)-length(replace(v_source,p_old,''))<>length(p_old)
     or length(v_definition)-length(replace(v_definition,p_old,''))<>length(p_old) then
    raise exception 'Backend T02 predecessor mismatch: %',p_function;
  end if;
  execute replace(v_definition,p_old,p_new);
end $$;

select pg_temp.backend_lock_patch('public.art27_sync_telemetry(uuid,text,uuid,bigint,jsonb,jsonb)',
$o$  select * into strict v_state from public.device_state s where s.device_id=p_device_id for update;
  select d.* into v_device from public.devices d where d.device_id=p_device_id and d.protocol_major=2 for update;
  if not found then raise exception using errcode='22023', message='unknown device'; end if;$o$,
$n$  select d.* into v_device from public.devices d where d.device_id=p_device_id and d.protocol_major=2 for update;
  if not found then raise exception using errcode='22023', message='unknown device'; end if;
  select * into strict v_state from public.device_state s where s.device_id=p_device_id for update;$n$);

-- Readers/configuration/metadata already hold A before D. Admission and the saved-request
-- fence must agree; the nested monitoring snapshot only reacquires this same held A lock.
do $$
declare v_function regprocedure;
begin
  foreach v_function in array array[
    'public.art31_create_manual_feed(uuid,uuid,uuid,uuid,jsonb,integer)'::regprocedure,
    'public.art31_resolve_manual_feed_no_admission(uuid,uuid,uuid,uuid,jsonb,integer)'::regprocedure
  ] loop
    perform pg_temp.backend_lock_patch(v_function,
$o$  select * into v_device from public.devices d
    where d.device_id = p_device_id for update;
  if not found or v_device.protocol_major <> 2 then
    return jsonb_build_object('status', 'not_found');
  end if;
  select a.device_id into v_access from public.device_access a
    where a.device_id = p_device_id and a.installation_id = p_installation_id
      and a.status = 'active' for share;$o$,
$n$  select a.device_id into v_access from public.device_access a
    where a.device_id = p_device_id and a.installation_id = p_installation_id
      and a.status = 'active' for share;
  select * into v_device from public.devices d
    where d.device_id = p_device_id for update;
  if not found or v_device.protocol_major <> 2 then
    return jsonb_build_object('status', 'not_found');
  end if;
  -- Preserve not_found precedence without reacquiring access after D.
  perform 1 where v_access is not null;$n$);
  end loop;
end $$;

-- Rotation holds C first, then the COMPLETE active membership set in stable order.
-- C prevents pairing from adding/reactivating a membership until rotation commits.
-- Keep the same-credential early return, all validation and the original revocation UPDATE.
select pg_temp.backend_lock_patch('public.art38_provision_simulated_device(uuid,text,boolean)',
$o$  insert into public.devices
    (device_id, model, firmware_version, protocol_major, is_simulated,$o$,
$n$  perform 1 from public.device_access a
    where a.device_id=p_device_id and a.status='active'
    order by a.installation_id for update;

  insert into public.devices
    (device_id, model, firmware_version, protocol_major, is_simulated,$n$);

-- Revocation's AFTER access trigger takes the existing push lock; its subsequent audit
-- insert has an immediate device FK. Acquire D before the trigger, not G -> D via that FK.
select pg_temp.backend_lock_patch('public.art38_revoke_device_access(uuid,uuid)',
$o$begin
  update public.device_access a$o$,
$n$begin
  perform 1 from public.device_access a
    where a.device_id=p_device_id and a.installation_id=p_installation_id
      and a.status='active' for update;
  if not found then return jsonb_build_object('status','not_active'); end if;
  perform 1 from public.devices d where d.device_id=p_device_id for update;
  update public.device_access a$n$);

-- Every reconciliation caller (including history/command reads) enters here before Q.
-- ART100's AFTER Q alert trigger then reacquires S, never first acquires it after Q.
select pg_temp.backend_lock_patch('private.art31_reconcile_manual_feed(uuid)',
$o$  if not found then return; end if;

  for v_sequence in$o$,
$n$  if not found then return; end if;
  perform 1 from public.device_state s where s.device_id=p_device_id for update;

  for v_sequence in$n$);
select pg_temp.backend_lock_patch('private.art31_reconcile_manual_feed(uuid)',
$o$    order by s.created_at for update$o$,
$n$    order by s.created_at,s.sequence_id for update$n$);
select pg_temp.backend_lock_patch('private.art31_reconcile_manual_feed(uuid)',
$o$  loop
    if v_sequence.delivered_at is null then$o$,
$n$  loop
    perform 1 from public.feed_steps f
      where f.device_id=p_device_id and f.sequence_id=v_sequence.sequence_id
      order by f.step_index for update;
    if v_sequence.delivered_at is null then$n$);

-- Scheduled event finalization can emit feeding alerts even without an unknown outcome.
select pg_temp.backend_lock_patch('public.art33_record_scheduled_events(uuid,text,jsonb,text,integer,text,uuid)',
$o$  for v_event in select value from jsonb_array_elements(p_events) loop$o$,
$n$  perform 1 from public.device_state s where s.device_id=p_device_id for update;
  perform 1 from public.feed_sequences s where s.device_id=p_device_id
    and s.sequence_id in (select (value->>'sequence_id')::uuid from jsonb_array_elements(p_events))
    order by s.created_at,s.sequence_id for update;
  perform 1 from public.feed_steps f where f.device_id=p_device_id
    and f.sequence_id in (select (value->>'sequence_id')::uuid from jsonb_array_elements(p_events))
    order by f.sequence_id,f.step_index for update;
  for v_event in select value from jsonb_array_elements(p_events) loop$n$);

-- Manual sync already owns C/D/S. Lock existing batch + reconciliation sequences, then
-- their steps, deterministically before processing semantic event order (do not reorder events).
select pg_temp.backend_lock_patch('public.art31_sync_manual_feed(uuid,text,integer,jsonb,text,uuid,text,integer)',
$o$  for v_event_record in$o$,
$n$  perform 1 from public.feed_sequences s where s.device_id=p_device_id
    and (s.unresolved and s.status in ('queued','accepted','running')
      or s.sequence_id in (select (value->>'sequence_id')::uuid from jsonb_array_elements(p_events)))
    order by s.created_at,s.sequence_id for update;
  perform 1 from public.feed_steps f where f.device_id=p_device_id
    and f.sequence_id in (select s.sequence_id from public.feed_sequences s where s.device_id=p_device_id
      and (s.unresolved and s.status in ('queued','accepted','running')
        or s.sequence_id in (select (value->>'sequence_id')::uuid from jsonb_array_elements(p_events))))
    order by f.sequence_id,f.step_index for update;

  for v_event_record in$n$);

drop function pg_temp.backend_lock_patch(regprocedure,text,text);
commit;
