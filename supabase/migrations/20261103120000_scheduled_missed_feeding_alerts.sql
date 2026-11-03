-- Owner refinement: a scheduled occurrence that never starts still needs attention.
-- Reuse feeding_failed with neutral client/sender copy; no new wire kind or backfill.
create or replace function private.art100_feeding_alert_kind(p_device_id uuid, p_sequence_id uuid, p_status text)
returns text
language sql
-- AFTER INSERT classification must see the just-inserted source row, not a
-- STABLE function's caller snapshot. This function still only reads facts.
volatile
set search_path = ''
as $$
  select case
    when p_status in ('rejected', 'expired') then case when exists (
      select 1 from public.feed_sequences s
      where s.device_id = p_device_id and s.sequence_id = p_sequence_id
        and s.source = 'scheduled'
    ) then 'feeding_failed' end
    when p_status = 'failed' then 'feeding_failed'
    when p_status = 'partial' then 'feeding_partial'
    when p_status = 'unknown' then 'feeding_unknown'
    when p_status = 'completed' then case when exists (
      select 1 from public.feed_steps f
      where f.device_id = p_device_id and f.sequence_id = p_sequence_id
        and f.status = 'completed' and f.measurement_quality <> 'valid'
    ) then 'feeding_unmeasured' end
  end
$$;
revoke all on function private.art100_feeding_alert_kind(uuid, uuid, text) from public, anon, authenticated, service_role;

-- Keep the existing security-definer trigger function, device_state row lock,
-- strictly increasing raised_at and (device,sequence,kind) deduplication intact.
-- Merely widening the classifier would not help: the old WHEN excluded these states.
drop trigger feed_sequences_feeding_alert on public.feed_sequences;
create trigger feed_sequences_feeding_alert
  after insert or update of status on public.feed_sequences
  for each row
  when (new.status in ('failed', 'partial', 'unknown', 'completed', 'rejected', 'expired'))
  execute function private.art100_raise_feeding_alert();
