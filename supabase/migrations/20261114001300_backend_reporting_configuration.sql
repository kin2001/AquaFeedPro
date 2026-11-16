-- T07: frozen 2.8.0 reporting settings / exact ACK / independent protected snapshot.
-- Depends on complete 24-migration chain through 20261114001200. No enrollment/backfill.
-- Preserves ART33 CAS/replay, C/A -> D -> revision locks and schedule/feeding behavior.
-- Verification: backend_reporting_configuration.sql + existing safety/access/ACL suites,
-- actual Edge/runtime checks and strict parent-generated public types (25/01300 provenance).
-- Recovery: docs/operations/backend-migrations.md and BACKEND_METRICS_RECOVERY.md.
-- Stop new enrollment/negotiated writes, retain new-key revisions and all observations;
-- forward repair only. Old writers/reporters fail closed on new-key revisions. No deletion.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Keep the complete effective ART98 validator, including Both targets, in one place.
alter function private.art33_validate_snapshot(uuid,jsonb) rename to backend_validate_legacy_snapshot;
revoke all on function private.backend_validate_legacy_snapshot(uuid,jsonb) from public,anon,authenticated,service_role;
create function private.art33_validate_snapshot(p_device_id uuid,p_snapshot jsonb) returns text
language plpgsql stable set search_path='' as $$
declare interval_value jsonb; capable boolean;
begin
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' then return 'VALIDATION_FAILED'; end if;
 if p_snapshot ? 'oxygen_report_interval_seconds' then
   interval_value:=p_snapshot->'oxygen_report_interval_seconds';
   if interval_value is distinct from 'null'::jsonb and (jsonb_typeof(interval_value) is distinct from 'number'
     or interval_value not in ('15'::jsonb,'30'::jsonb,'60'::jsonb,'3600'::jsonb,'7200'::jsonb,'14400'::jsonb,'28800'::jsonb)) then return 'VALIDATION_FAILED'; end if;
   select capabilities->'independent_telemetry_v1'='true'::jsonb into capable from public.devices where device_id=p_device_id;
   if capable is distinct from true and (interval_value<>'null'::jsonb or exists(
     select 1 from public.device_config_revisions r join public.devices d on d.device_id=r.device_id
     where r.device_id=p_device_id and r.revision in (d.desired_revision,d.applied_revision)
       and r.requested_snapshot->'oxygen_report_interval_seconds'<>'null'::jsonb)) then return 'CAPABILITY_MISMATCH'; end if;
 end if;
 return private.backend_validate_legacy_snapshot(p_device_id,p_snapshot-'oxygen_report_interval_seconds');
end $$;
revoke all on function private.art33_validate_snapshot(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.art33_validate_snapshot(uuid,jsonb) to service_role;

-- Clone the effective report body as a non-callable core, not a GUC/security bypass.
do $$ declare definition text; begin
 select pg_get_functiondef('public.art33_device_configuration_report(uuid,text,bigint,bigint,text,text)'::regprocedure) into definition;
 definition:=replace(definition,'CREATE OR REPLACE FUNCTION public.art33_device_configuration_report(', 'CREATE OR REPLACE FUNCTION private.backend_configuration_report(');
 if position('FUNCTION private.backend_configuration_report(' in definition)=0 then raise exception 'T07 report predecessor mismatch'; end if;
 execute definition;
end $$;
revoke all on function private.backend_configuration_report(uuid,text,bigint,bigint,text,text) from public,anon,authenticated,service_role;

-- The original full writer also protects stored nullable keys from legacy stripping.
do $$ declare source text; old text := $old$  if p_based_on_revision is distinct from coalesce(v_device.desired_revision,0) then$old$; begin
 select replace(pg_get_functiondef('public.art33_write_configuration(uuid,uuid,uuid,bigint,jsonb)'::regprocedure),E'\r\n',E'\n') into source;
 if length(source)-length(replace(source,old,''))<>length(old) then raise exception 'T07 writer predecessor mismatch'; end if;
 -- Projection to legacy is decided here under A -> D, never guessed from an app null.
 if position($guard$  select r.* into v_existing from public.device_config_revisions r
    where r.device_id = p_device_id and r.request_id = p_request_id;$guard$ in source)=0 then raise exception 'T07 projection predecessor mismatch'; end if;
 source:=replace(source,$old2$  select r.* into v_existing from public.device_config_revisions r
    where r.device_id = p_device_id and r.request_id = p_request_id;$old2$,$new2$  if p_snapshot->'oxygen_report_interval_seconds'='null'::jsonb then
    if exists(select 1 from public.device_config_revisions r where r.device_id=p_device_id and r.request_id=p_request_id
      and not (r.requested_snapshot ? 'oxygen_report_interval_seconds')) then
      p_snapshot:=p_snapshot-'oxygen_report_interval_seconds';
    elsif v_device.capabilities->'independent_telemetry_v1' is distinct from 'true'::jsonb then
      if exists(select 1 from public.device_config_revisions r where r.device_id=p_device_id
        and r.revision in (v_device.desired_revision,v_device.applied_revision) and r.requested_snapshot ? 'oxygen_report_interval_seconds') then
        return jsonb_build_object('status','upgrade_required');
      end if;
      p_snapshot:=p_snapshot-'oxygen_report_interval_seconds';
    end if;
  end if;
  select r.* into v_existing from public.device_config_revisions r
    where r.device_id = p_device_id and r.request_id = p_request_id;$new2$);
 execute replace(source,old,$new$  if not coalesce(p_snapshot ? 'oxygen_report_interval_seconds',false) and exists (
    select 1 from public.device_config_revisions r where r.device_id=p_device_id
      and r.revision in (v_device.desired_revision,v_device.applied_revision)
      and r.requested_snapshot ? 'oxygen_report_interval_seconds') then
    return jsonb_build_object('status','upgrade_required');
  end if;
  if p_based_on_revision is distinct from coalesce(v_device.desired_revision,0) then$new$);
end $$;

-- Legacy entry point must never apply a negotiated revision by revision alone.
create or replace function public.art33_device_configuration_report(
 p_device_id uuid,p_device_verifier_hex text,p_applied_revision bigint,p_last_attempt_revision bigint,p_last_attempt_status text,p_error_code text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices%rowtype;
begin
 if p_device_verifier_hex is null or p_device_verifier_hex !~ '^[0-9a-fA-F]{64}$' then return jsonb_build_object('status','auth_required'); end if;
 perform 1 from private.device_credentials where device_id=p_device_id and revoked_at is null
   and credential_verifier=decode(lower(p_device_verifier_hex),'hex') for share;
 if not found then return jsonb_build_object('status','auth_required'); end if;
 select * into d from public.devices where device_id=p_device_id for update;
 if not found then return jsonb_build_object('status','invalid'); end if;
 if exists(select 1 from public.device_config_revisions r where r.device_id=p_device_id
   and r.revision in (d.applied_revision,d.desired_revision,p_last_attempt_revision)
   and r.requested_snapshot ? 'oxygen_report_interval_seconds') then return jsonb_build_object('status','invalid'); end if;
 return private.backend_configuration_report(p_device_id,p_device_verifier_hex,p_applied_revision,p_last_attempt_revision,p_last_attempt_status,p_error_code);
end $$;
revoke all on function public.art33_device_configuration_report(uuid,text,bigint,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.art33_device_configuration_report(uuid,text,bigint,bigint,text,text) to service_role;

create function public.backend_device_configuration_report(p_device_id uuid,p_device_verifier_hex text,p_configuration jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices%rowtype; applied bigint; attempt bigint; status text; expected jsonb; result jsonb;
begin
 if p_device_verifier_hex is null or p_device_verifier_hex !~ '^[0-9a-fA-F]{64}$' then return jsonb_build_object('status','auth_required'); end if;
 perform 1 from private.device_credentials where device_id=p_device_id and revoked_at is null
   and credential_verifier=decode(lower(p_device_verifier_hex),'hex') for share;
 if not found then return jsonb_build_object('status','auth_required'); end if;
 select * into d from public.devices where device_id=p_device_id for update;
 if not found or d.capabilities->'independent_telemetry_v1' is distinct from 'true'::jsonb then return jsonb_build_object('status','invalid'); end if;
 if p_configuration is null or jsonb_typeof(p_configuration)<>'object'
   or not (p_configuration ?& array['applied_revision','last_attempt_revision','last_attempt_status','error_code','oxygen_report_interval_seconds'])
   or p_configuration-array['applied_revision','last_attempt_revision','last_attempt_status','error_code','oxygen_report_interval_seconds']::text[]<>'{}'::jsonb
   or jsonb_typeof(p_configuration->'applied_revision') not in ('null','number')
   or jsonb_typeof(p_configuration->'last_attempt_revision') not in ('null','number') then return jsonb_build_object('status','invalid'); end if;
 if (p_configuration->'applied_revision'<>'null'::jsonb and ((p_configuration->>'applied_revision')::numeric not between 0 and 9007199254740991 or trunc((p_configuration->>'applied_revision')::numeric)<>(p_configuration->>'applied_revision')::numeric))
   or (p_configuration->'last_attempt_revision'<>'null'::jsonb and ((p_configuration->>'last_attempt_revision')::numeric not between 1 and 9007199254740991 or trunc((p_configuration->>'last_attempt_revision')::numeric)<>(p_configuration->>'last_attempt_revision')::numeric))
   or jsonb_typeof(p_configuration->'last_attempt_status') not in ('null','string')
   or jsonb_typeof(p_configuration->'error_code') not in ('null','string') then return jsonb_build_object('status','invalid'); end if;
 applied:=(p_configuration->>'applied_revision')::bigint; attempt:=(p_configuration->>'last_attempt_revision')::bigint; status:=p_configuration->>'last_attempt_status';
 if (status is null and (attempt is not null or p_configuration->>'error_code' is not null))
   or (status is not null and (status not in ('pending','applied','rejected') or attempt is null))
   or (status='applied' and applied is distinct from attempt)
   or (status='rejected' and p_configuration->>'error_code' is null)
   or (status is distinct from 'rejected' and p_configuration->>'error_code' is not null) then return jsonb_build_object('status','invalid'); end if;
 expected:='null'::jsonb;
 if applied is not null and applied<>0 then
   select coalesce(requested_snapshot->'oxygen_report_interval_seconds','null'::jsonb) into expected
     from public.device_config_revisions where device_id=p_device_id and revision=applied;
   if not found then return jsonb_build_object('status','stale'); end if;
 end if;
 if p_configuration->'oxygen_report_interval_seconds' is distinct from expected then return jsonb_build_object('status','invalid'); end if;
 result:=private.backend_configuration_report(p_device_id,p_device_verifier_hex,applied,attempt,status,p_configuration->>'error_code');
 if jsonb_typeof(result->'desired_configuration')='object' then
   result:=jsonb_set(result,'{desired_configuration}',jsonb_build_object('oxygen_report_interval_seconds',null)||(result->'desired_configuration'));
 end if;
 return result;
end $$;
revoke all on function public.backend_device_configuration_report(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.backend_device_configuration_report(uuid,text,jsonb) to service_role;

create function public.backend_metric_snapshot(p_device_id uuid,p_installation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.devices%rowtype; contact_at timestamptz; config jsonb; candidate text; snapshot jsonb; versions jsonb; now_at timestamptz;
begin
 perform 1 from public.device_access where device_id=p_device_id and installation_id=p_installation_id and status='active' for share;
 if not found then return jsonb_build_object('status','not_active'); end if;
 select * into d from public.devices where device_id=p_device_id for share;
 if not found then return jsonb_build_object('status','not_found'); end if;
 if d.capabilities->'independent_telemetry_v1' is distinct from 'true'::jsonb then return jsonb_build_object('status','unsupported'); end if;
 config:=public.art33_read_configuration(p_device_id,p_installation_id,null)-'status';
 foreach candidate in array array['desired_snapshot','applied_snapshot'] loop
   snapshot:=config->candidate;
   if jsonb_typeof(snapshot)='object' then config:=jsonb_set(config,array[candidate],jsonb_build_object('oxygen_report_interval_seconds',null)||snapshot); end if;
 end loop;
 config:=config||jsonb_build_object('request_id',p_request_id);
 select last_authenticated_contact_at into contact_at from public.device_state where device_id=p_device_id;
 select revisions into versions from public.device_resource_versions where device_id=p_device_id;
 now_at:=clock_timestamp();
 return jsonb_build_object('status','ok','request_id',p_request_id,'device_id',p_device_id,'server_time',now_at,
   'contact',jsonb_build_object('last_seen_at',contact_at,'online',coalesce(contact_at<=now_at and contact_at>now_at-interval '45 seconds',false)),
   'configuration',config,'resources',jsonb_build_object('do',private.backend_current_metric(p_device_id,'do'),'feed',private.backend_current_metric(p_device_id,'feed')),
   'revisions',coalesce(versions,'{"do":0,"feed":0,"history":0,"configuration":0,"feeding":0,"contact":0,"alerts":0}'::jsonb));
end $$;
revoke all on function public.backend_metric_snapshot(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.backend_metric_snapshot(uuid,uuid,uuid) to service_role;
commit;
