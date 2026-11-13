-- Backend T09: preserve the ART96 queue, but never automatically resend uncertain transport work.
-- Depends on ART102 claim naming and T02 lock ordering. No API/schema/ACL/retention changes.
-- Function replacements only: no rows change while applying this migration. On subsequent claims,
-- expired sending and historical retry/transport_retry rows become terminal failed. This can lose
-- notifications whose acceptance cannot be established; it deliberately avoids duplicate sends.
-- Stop/drain the invoker before rollout; deploy the matching sender before considering re-enablement.
-- Accepted tickets/receipt retries and explicit rate-limit rejections retain their existing bounds.
-- Recovery/impact: docs/operations/push-readiness.md; never restore automatic uncertain resends.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Preserve deployed ownership/security/search_path/grants; fail atomically on predecessor drift.
create function pg_temp.backend_push_patch(p_function regprocedure, p_old text, p_new text)
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
    raise exception 'Backend T09 predecessor mismatch: %',p_function;
  end if;
  execute replace(v_definition,p_old,p_new);
end $$;

select pg_temp.backend_push_patch('public.art96_claim_push_deliveries(integer,integer)',
$o$  update private.alert_push_deliveries d
     set state = 'retry', lease_id = null, lease_until = null,
         next_attempt_at = pg_catalog.clock_timestamp()
   where d.state in ('leased', 'sending') and d.lease_until < pg_catalog.clock_timestamp()
     and d.attempt_count < 5 and d.expires_at > pg_catalog.clock_timestamp();$o$,
$n$  -- A crossed begin fence may have reached Expo. Old transport retries have the same uncertainty.
  update private.alert_push_deliveries d
     set state = 'failed', lease_id = null, lease_until = null, last_error = 'transport_retry'
   where (d.state = 'sending' and d.lease_until <= pg_catalog.clock_timestamp())
      or (d.state = 'retry' and d.last_error = 'transport_retry');
  -- Before begin no provider call was permitted; only these expired leases are safe to reclaim.
  update private.alert_push_deliveries d
     set state = 'retry', lease_id = null, lease_until = null,
         next_attempt_at = pg_catalog.clock_timestamp()
   where d.state = 'leased' and d.lease_until < pg_catalog.clock_timestamp()
     and d.attempt_count < 5 and d.expires_at > pg_catalog.clock_timestamp();$n$);

select pg_temp.backend_push_patch('public.art96_record_push_send(uuid,uuid,bigint,text,text,text)',
$o$  elsif p_outcome in ('retry', 'ambiguous', 'rejected') then$o$,
$n$  elsif p_outcome = 'ambiguous' then
    update private.alert_push_deliveries set state = 'failed', lease_id = null, lease_until = null,
      last_error = 'transport_retry' where delivery_id = p_delivery_id;
  elsif p_outcome in ('retry', 'rejected') then$n$);

drop function pg_temp.backend_push_patch(regprocedure,text,text);
commit;
