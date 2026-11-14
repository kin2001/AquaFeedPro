-- T05: immutable compatibility reads. No feed reconciliation, backfill or new index.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function private.backend_history_observations(p_device_id uuid)
returns table(observed_at timestamptz, received_at timestamptz, stable_identity text, reading jsonb)
language sql stable security definer set search_path='' as $$
  select o.observed_at,o.received_at,'metric:'||o.metric||':'||o.boot_id||':'||o.sample_sequence,
    jsonb_build_object('observation',o.input_observation||jsonb_build_object('quality',o.quality,'do_mg_l',o.do_mg_l,
      'feed_remaining_g',o.feed_remaining_g,'feed_percent',o.feed_percent,'calibration_revision',o.calibration_revision),
      'stable_identity','metric:'||o.metric||':'||o.boot_id||':'||o.sample_sequence,
      'observed_at',o.observed_at,'time_basis',o.time_basis,'received_at',o.received_at)
  from public.device_metric_observations o where o.device_id=p_device_id
  union all
  select case when t.time_quality in ('synced','rtc') and t.measured_at<=t.received_at then t.measured_at end,
    t.received_at,'legacy:'||m.metric||':'||t.boot_id||':'||t.sample_sequence,
    jsonb_build_object('observation',jsonb_build_object('metric',m.metric,'boot_id',t.boot_id,'sequence',t.sample_sequence,
      'measured_at',t.measured_at,'captured_at',null,'time_quality',t.time_quality,
      'quality',case when m.metric='do' then t.do_quality else t.feed_quality end,
      'do_mg_l',case when m.metric='do' then t.do_mg_l end,
      'feed_remaining_g',case when m.metric='feed' then t.feed_remaining_g end,
      'feed_percent',case when m.metric='feed' then t.feed_percent end,
      'calibration_revision',case when m.metric='feed' then t.calibration_revision end),
      'stable_identity','legacy:'||m.metric||':'||t.boot_id||':'||t.sample_sequence,
      'observed_at',case when t.time_quality in ('synced','rtc') and t.measured_at<=t.received_at then t.measured_at end,
      'time_basis',case when t.time_quality in ('synced','rtc') and t.measured_at<=t.received_at then 'measured' else 'unknown' end,
      'received_at',t.received_at)
  from public.device_telemetry t cross join (values ('do'),('feed')) m(metric) where t.device_id=p_device_id
$$;
revoke all on function private.backend_history_observations(uuid) from public,anon,authenticated,service_role;

create function public.backend_metric_history(p_device_id uuid,p_installation_id uuid,p_date date,p_metric text,
  p_cursor_time timestamptz default null,p_cursor_identity text default null,p_time_mode text default 'known')
returns jsonb language plpgsql security definer set search_path='' as $$
declare start_at timestamptz; end_at timestamptz; result jsonb; now_at timestamptz:=clock_timestamp();
begin
  perform 1 from public.device_access where device_id=p_device_id and installation_id=p_installation_id and status='active' for share;
  if not found then return jsonb_build_object('status','not_active'); end if;
  if p_metric is null or p_metric not in ('all','do','feed') or p_time_mode is null or p_time_mode not in ('known','unknown')
    or (p_time_mode='known' and (p_date is null or not isfinite(p_date))) or (p_time_mode='unknown' and p_date is not null)
    or ((p_cursor_time is null)<>(p_cursor_identity is null))
    or (p_cursor_time is not null and (not isfinite(p_cursor_time) or length(p_cursor_identity)>160
      or p_cursor_identity!~'^(metric|legacy):(do|feed):[0-9a-f-]{36}:[0-9]+$'
      or (p_metric<>'all' and split_part(p_cursor_identity,':',2)<>p_metric))) then
    return jsonb_build_object('status','invalid');
  end if;
  if p_time_mode='known' then
    start_at:=p_date::timestamp at time zone 'Asia/Manila'; end_at:=(p_date+1)::timestamp at time zone 'Asia/Manila';
  else
    -- Unknown source time has a bounded receipt search, never an invented observation day.
    start_at:=now_at-interval '366 days'; end_at:=now_at;
  end if;
  if p_cursor_time is not null and (p_cursor_time<start_at or p_cursor_time>=end_at) then return jsonb_build_object('status','invalid'); end if;
  with eligible as (
    select *,case when p_time_mode='known' then o.observed_at else o.received_at end as sort_time
    from private.backend_history_observations(p_device_id) o
    where (p_metric='all' or o.reading#>>'{observation,metric}'=p_metric)
      and case when p_time_mode='known' then o.observed_at>=start_at and o.observed_at<end_at
        else o.observed_at is null and o.received_at>=start_at and o.received_at<end_at end
  ), page as materialized (
    select * from eligible where p_cursor_time is null or (sort_time,stable_identity collate "C")<(p_cursor_time,p_cursor_identity collate "C")
    order by sort_time desc,stable_identity collate "C" desc limit 51
  ), limited as (select * from page order by sort_time desc,stable_identity collate "C" desc limit 50)
  select jsonb_build_object('status','ok','device_id',p_device_id,'server_time',now_at,'date',p_date,'time',p_time_mode,'metric',p_metric,
    'observations',coalesce((select jsonb_agg(reading order by sort_time desc,stable_identity collate "C" desc) from limited),'[]'::jsonb),
    'next',case when (select count(*) from page)>50 then (select jsonb_build_object('time',sort_time,'identity',stable_identity) from limited order by sort_time,stable_identity collate "C" limit 1) else null end)
  into result;
  return result;
end $$;
revoke all on function public.backend_metric_history(uuid,uuid,date,text,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.backend_metric_history(uuid,uuid,date,text,timestamptz,text,text) to service_role;

create function public.backend_metric_do_graph(p_device_id uuid,p_installation_id uuid,p_request_id uuid,p_window text,p_count integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare end_at timestamptz:=clock_timestamp(); start_at timestamptz; span interval; result jsonb;
begin
  perform 1 from public.device_access where device_id=p_device_id and installation_id=p_installation_id and status='active' for share;
  if not found then return jsonb_build_object('status','not_active'); end if;
  if p_request_id is null or p_window is null or p_window not in ('1h','6h','24h') or p_count is null or p_count<1 or p_count>100 then return jsonb_build_object('status','invalid'); end if;
  start_at:=end_at-case p_window when '1h' then interval '1 hour' when '6h' then interval '6 hours' else interval '24 hours' end;
  span:=(end_at-start_at)/p_count;
  with observations as materialized (select * from private.backend_history_observations(p_device_id) where reading#>>'{observation,metric}'='do'
    and ((observed_at>=start_at and observed_at<end_at) or (observed_at is null and received_at>=start_at and received_at<end_at))),
  buckets as (select n,start_at+n*span as lo,start_at+(n+1)*span as hi from generate_series(0,p_count-1) n),
  points as (select b.*, (select count(*) from observations o where o.observed_at>=b.lo and o.observed_at<b.hi) as sample_count,
    (select o.reading from observations o where o.observed_at>=b.lo and o.observed_at<b.hi order by o.observed_at desc,o.stable_identity collate "C" desc limit 1) as reading from buckets b)
  select jsonb_build_object('status','ok','request_id',p_request_id,'device_id',p_device_id,'server_time',end_at,'window',p_window,
    'window_start',start_at,'window_end',end_at,'requested_count',p_count,'returned_count',p_count,
    'invalid_time_sample_count',(select count(*) from observations where observed_at is null),
    'samples',(select jsonb_agg(jsonb_build_object('bucket_start',lo,'bucket_end',hi,'observation',reading,'sample_count',sample_count) order by n) from points)) into result;
  return result;
end $$;
revoke all on function public.backend_metric_do_graph(uuid,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.backend_metric_do_graph(uuid,uuid,uuid,text,integer) to service_role;

create function private.backend_feed_chronology(p_device_id uuid,p_sequence_id uuid)
returns table(occurred_at timestamptz,started_at timestamptz,completed_at timestamptz,received_at timestamptz)
language sql stable security definer set search_path='' as $$
  with trusted as (
    select e.event_type,(e.payload->>'device_at')::timestamptz as at
    from public.device_events e
    where e.device_id=p_device_id and e.sequence_id=p_sequence_id
      and e.event_type in ('running','completed') and e.payload->>'outcome_status'=e.event_type
      and e.payload->>'time_quality' in ('synced','rtc') and e.payload->>'device_at' is not null
      and (e.payload->>'device_at')::timestamptz<=e.created_at
  ), times as (select min(at) filter(where event_type='running') as started,
    max(at) filter(where event_type='completed') as completed from trusted)
  select coalesce(started,completed),started,completed,
    coalesce((select min(e.created_at) from public.device_events e where e.device_id=p_device_id and e.sequence_id=p_sequence_id),s.created_at)
  from times cross join public.feed_sequences s where s.device_id=p_device_id and s.sequence_id=p_sequence_id
$$;
revoke all on function private.backend_feed_chronology(uuid,uuid) from public,anon,authenticated,service_role;

create function private.backend_history_record(p_device_id uuid,p_sequence_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select private.art31_history_record_json(p_device_id,p_sequence_id)||jsonb_build_object('occurred_at',c.occurred_at,
    'time_basis',case when c.occurred_at is null then 'unknown' else 'measured' end,
    'received_at',c.received_at,'started_at',c.started_at,'completed_at',c.completed_at)
  from private.backend_feed_chronology(p_device_id,p_sequence_id) c
$$;
revoke all on function private.backend_history_record(uuid,uuid) from public,anon,authenticated,service_role;

create function public.backend_history_detail(p_device_id uuid,p_installation_id uuid,p_sequence_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
  perform 1 from public.device_access where device_id=p_device_id and installation_id=p_installation_id and status='active' for share;
  if not found then return jsonb_build_object('status','not_active'); end if;
  r:=private.backend_history_record(p_device_id,p_sequence_id);
  if r is null then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object('status','ok','timezone','Asia/Manila','timezone_known',true,'record',r);
end $$;
revoke all on function public.backend_history_detail(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.backend_history_detail(uuid,uuid,uuid) to service_role;

create function public.backend_history_page(p_device_id uuid,p_installation_id uuid,p_from_date date,p_to_date date,p_source text,p_status text,
  p_before_created_at timestamptz default null,p_before_sequence_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare from_day date; to_day date; result jsonb;
begin
  perform 1 from public.device_access where device_id=p_device_id and installation_id=p_installation_id and status='active' for share;
  if not found then return jsonb_build_object('status','not_active'); end if;
  to_day:=coalesce(p_to_date,(clock_timestamp() at time zone 'Asia/Manila')::date); from_day:=coalesce(p_from_date,to_day-6);
  if p_source is null or p_source not in ('all','manual','scheduled') or p_status is null or p_status not in ('all','completed','failed','in_progress','unknown')
    or not isfinite(from_day) or not isfinite(to_day) or from_day>to_day or to_day-from_day>366
    or ((p_before_created_at is null)<>(p_before_sequence_id is null)) or (p_before_created_at is not null and not isfinite(p_before_created_at)) then return jsonb_build_object('status','invalid'); end if;
  with filtered as materialized (
    select s.sequence_id,s.status,coalesce(c.occurred_at,c.received_at) as sort_time from public.feed_sequences s
    cross join lateral private.backend_feed_chronology(s.device_id,s.sequence_id) c where s.device_id=p_device_id
      and coalesce(c.occurred_at,c.received_at)>=from_day::timestamp at time zone 'Asia/Manila'
      and coalesce(c.occurred_at,c.received_at)<(to_day+1)::timestamp at time zone 'Asia/Manila'
      and (p_source='all' or s.source=p_source)
      and (p_status='all' or (p_status='completed' and s.status='completed') or (p_status='failed' and s.status in ('failed','rejected','expired'))
        or (p_status='in_progress' and s.status in ('queued','accepted','running')) or (p_status='unknown' and s.status in ('partial','unknown')))
  ), page as materialized (select * from filtered where p_before_created_at is null or (sort_time,sequence_id)<(p_before_created_at,p_before_sequence_id) order by sort_time desc,sequence_id desc limit 51),
  limited as (select * from page order by sort_time desc,sequence_id desc limit 50)
  select jsonb_build_object('status','ok','from_date',from_day,'to_date',to_day,'timezone','Asia/Manila','timezone_known',true,
    'total',(select count(*) from filtered),'completed_total',(select count(*) from filtered where status='completed'),
    'needs_attention_total',(select count(*) from filtered where status in ('partial','failed','rejected','expired','unknown')),
    'in_progress_total',(select count(*) from filtered where status in ('queued','accepted','running')),
    'records',coalesce((select jsonb_agg(private.backend_history_record(p_device_id,sequence_id) order by sort_time desc,sequence_id desc) from limited),'[]'::jsonb),
    'has_more',(select count(*)>50 from page),'next',(select jsonb_build_object('created_at',sort_time,'sequence_id',sequence_id) from limited order by sort_time,sequence_id limit 1)) into result;
  return result;
end $$;
revoke all on function public.backend_history_page(uuid,uuid,date,date,text,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.backend_history_page(uuid,uuid,date,date,text,text,timestamptz,uuid) to service_role;
commit;
