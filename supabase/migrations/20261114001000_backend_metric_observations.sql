-- Backend T04. Forward ONLY after merged T09 (00900); never rename applied history.
-- Additive evidence, no observation backfill/retention. Shared application NOT authorized.
-- Conditional alert FK generated columns can rewrite/materialize alert_events and take DDL locks.
-- Recover by stopping capability enrollment/new ingestion, retaining all evidence; no down-delete.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- SQL repeats the route's closed runtime boundary; casts alone accept strings/coercions.
create function private.backend_valid_metric_observation(p jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; n numeric; t timestamptz;
begin
  if jsonb_typeof(p) is distinct from 'object'
    or not (p ?& array['metric','boot_id','sequence','measured_at','captured_at','time_quality','quality','do_mg_l','feed_remaining_g','feed_percent','calibration_revision'])
    or p-array['metric','boot_id','sequence','measured_at','captured_at','time_quality','quality','do_mg_l','feed_remaining_g','feed_percent','calibration_revision']::text[] <> '{}'::jsonb
    or p->>'metric' not in ('do','feed') or jsonb_typeof(p->'metric')<>'string'
    or jsonb_typeof(p->'boot_id')<>'string'
    or p->>'boot_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(p->'sequence')<>'number'
    or p->>'time_quality' not in ('synced','rtc','uncertain','invalid')
    or jsonb_typeof(p->'time_quality')<>'string'
    or p->>'quality' not in ('valid','unavailable','uncalibrated','error')
    or jsonb_typeof(p->'quality')<>'string' then return false; end if;
  n := (p->>'sequence')::numeric;
  if n<0 or n>9007199254740991 or trunc(n)<>n then return false; end if;
  foreach k in array array['measured_at','captured_at'] loop
    if p->k <> 'null'::jsonb then
      if jsonb_typeof(p->k)<>'string' or p->>k !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?Z$' then return false; end if;
      t := (p->>k)::timestamptz;
      if not isfinite(t) then return false; end if;
    end if;
  end loop;
  if (p->>'time_quality'='invalid') <> (p->'measured_at'='null'::jsonb) then return false; end if;
  foreach k in array array['do_mg_l','feed_remaining_g','feed_percent','calibration_revision'] loop
    if p->k <> 'null'::jsonb then
      if jsonb_typeof(p->k)<>'number' then return false; end if;
      n := (p->>k)::numeric;
      if n<0 or n>1.7976931348623157e308 or n::text in ('NaN','Infinity','-Infinity') then return false; end if;
      if k='feed_percent' and n>100 then return false; end if;
      if k='calibration_revision' and (n<1 or trunc(n)<>n or n>9007199254740991) then return false; end if;
    end if;
  end loop;
  if p->>'metric'='do' then
    return p->'feed_remaining_g'='null'::jsonb and p->'feed_percent'='null'::jsonb
      and p->'calibration_revision'='null'::jsonb
      and ((p->>'quality'='valid') = (p->'do_mg_l'<>'null'::jsonb));
  end if;
  return p->'do_mg_l'='null'::jsonb and case when p->>'quality'='valid' then
    p->'feed_remaining_g'<>'null'::jsonb and p->'feed_percent'<>'null'::jsonb and p->'calibration_revision'<>'null'::jsonb
    else p->'feed_remaining_g'='null'::jsonb and p->'feed_percent'='null'::jsonb and p->'calibration_revision'='null'::jsonb end;
exception when others then return false;
end $$;
revoke all on function private.backend_valid_metric_observation(jsonb) from public,anon,authenticated,service_role;

create table public.device_metric_observations (
  device_id uuid not null references public.devices(device_id) on delete restrict,
  metric text not null check (metric in ('do','feed')),
  boot_id uuid not null,
  sample_sequence bigint not null check (sample_sequence between 0 and 9007199254740991),
  measured_at timestamptz,
  captured_at timestamptz,
  observed_at timestamptz,
  time_basis text not null check (time_basis in ('measured','captured','unknown')),
  time_quality text not null check (time_quality in ('synced','rtc','uncertain','invalid')),
  quality text not null check (quality in ('valid','unavailable','uncalibrated','error')),
  do_mg_l numeric,
  feed_remaining_g numeric,
  feed_percent numeric,
  calibration_revision bigint,
  input_observation jsonb not null check (private.backend_valid_metric_observation(input_observation)),
  received_at timestamptz not null,
  first_live_sequence bigint check (first_live_sequence between 0 and 9007199254740991),
  primary key(device_id,metric,boot_id,sample_sequence),
  check ((time_quality='invalid')=(measured_at is null)),
  check (case time_basis when 'unknown' then observed_at is null
    when 'measured' then observed_at is not null and observed_at=measured_at and time_quality in ('synced','rtc') and observed_at<=received_at
    when 'captured' then observed_at is not null and observed_at=captured_at and time_quality in ('synced','rtc') and observed_at<=received_at end),
  check (case when metric='do' then
    feed_remaining_g is null and feed_percent is null and calibration_revision is null and
    case when quality='valid' then do_mg_l is not null else do_mg_l is null end
    else do_mg_l is null and case when quality='valid' then feed_remaining_g is not null and feed_percent is not null
      and calibration_revision is not null and calibration_revision between 1 and 9007199254740991
      else feed_remaining_g is null and feed_percent is null and calibration_revision is null end end),
  check (do_mg_l is null or (do_mg_l>=0 and do_mg_l::text not in ('NaN','Infinity','-Infinity'))),
  check (feed_remaining_g is null or (feed_remaining_g>=0 and feed_remaining_g::text not in ('NaN','Infinity','-Infinity'))),
  check (feed_percent is null or (feed_percent between 0 and 100 and feed_percent::text not in ('NaN','Infinity','-Infinity'))),
  check (input_observation->>'metric'=metric and (input_observation->>'boot_id')::uuid=boot_id
    and (input_observation->>'sequence')::numeric::bigint=sample_sequence
    and (input_observation->>'measured_at')::timestamptz is not distinct from measured_at
    and (input_observation->>'captured_at')::timestamptz is not distinct from captured_at
    and input_observation->>'time_quality'=time_quality)
);
create table public.device_metric_current (
  device_id uuid not null,
  metric text not null,
  boot_id uuid not null,
  sample_sequence bigint not null,
  live_sequence bigint not null check (live_sequence between 0 and 9007199254740991 and live_sequence=sample_sequence),
  primary key(device_id,metric),
  foreign key(device_id,metric,boot_id,sample_sequence)
    references public.device_metric_observations(device_id,metric,boot_id,sample_sequence) on delete restrict
);

-- T08 will consume these durable counters; no Broadcast activation in T04.
create table public.device_resource_versions (
  device_id uuid primary key references public.devices(device_id) on delete restrict,
  revisions jsonb not null default '{"do":0,"feed":0,"history":0,"configuration":0,"feeding":0,"contact":0,"alerts":0}',
  check (jsonb_typeof(revisions)='object'
    and revisions ?& array['do','feed','history','configuration','feeding','contact','alerts']
    and revisions-array['do','feed','history','configuration','feeding','contact','alerts']::text[]='{}'::jsonb
    and jsonb_typeof(revisions->'do')='number' and jsonb_typeof(revisions->'feed')='number'
    and jsonb_typeof(revisions->'history')='number' and jsonb_typeof(revisions->'configuration')='number'
    and jsonb_typeof(revisions->'feeding')='number' and jsonb_typeof(revisions->'contact')='number'
    and jsonb_typeof(revisions->'alerts')='number'),
  check ((revisions->>'do')::numeric between 0 and 9007199254740991 and trunc((revisions->>'do')::numeric)=(revisions->>'do')::numeric
    and (revisions->>'feed')::numeric between 0 and 9007199254740991 and trunc((revisions->>'feed')::numeric)=(revisions->>'feed')::numeric
    and (revisions->>'history')::numeric between 0 and 9007199254740991 and trunc((revisions->>'history')::numeric)=(revisions->>'history')::numeric
    and (revisions->>'configuration')::numeric between 0 and 9007199254740991 and trunc((revisions->>'configuration')::numeric)=(revisions->>'configuration')::numeric
    and (revisions->>'feeding')::numeric between 0 and 9007199254740991 and trunc((revisions->>'feeding')::numeric)=(revisions->>'feeding')::numeric
    and (revisions->>'contact')::numeric between 0 and 9007199254740991 and trunc((revisions->>'contact')::numeric)=(revisions->>'contact')::numeric
    and (revisions->>'alerts')::numeric between 0 and 9007199254740991 and trunc((revisions->>'alerts')::numeric)=(revisions->>'alerts')::numeric)
);

do $$ declare t text; begin
  foreach t in array array['device_metric_observations','device_metric_current','device_resource_versions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant select,insert,update on public.%I to service_role',t);
    execute format('create policy %I on public.%I for select to authenticated using (exists(select 1 from public.device_access a where a.device_id=%I.device_id and a.installation_id=(select auth.uid()) and a.status=''active''))',t||'_active_select',t,t);
  end loop;
end $$;

create function private.backend_metric_immutable() returns trigger
language plpgsql security definer set search_path = '' as $$
begin raise exception using errcode='55000',message='metric observation facts are immutable'; end $$;
revoke all on function private.backend_metric_immutable() from public,anon,authenticated,service_role;
create trigger device_metric_observations_immutable before update or delete on public.device_metric_observations
for each row execute function private.backend_metric_immutable();

-- A pointer cannot turn an old backlog/replay identity into a live observation, even via service DML.
create function private.backend_metric_current_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.device_id<>old.device_id or new.metric<>old.metric or new.live_sequence<=old.live_sequence) then
    raise exception using errcode='22023',message='metric current must advance monotonically';
  end if;
  perform 1 from public.device_metric_observations o where
    (o.device_id,o.metric,o.boot_id,o.sample_sequence)=(new.device_id,new.metric,new.boot_id,new.sample_sequence)
    and o.first_live_sequence=new.live_sequence;
  if not found then raise exception using errcode='22023',message='historical metric cannot become current'; end if;
  return new;
end $$;
revoke all on function private.backend_metric_current_guard() from public,anon,authenticated,service_role;
create trigger device_metric_current_guard before insert or update on public.device_metric_current
for each row execute function private.backend_metric_current_guard();

-- Canonical read: capability, not client wall time, selects the authoritative source.
create function private.backend_current_metric(p_device_id uuid,p_metric text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  d public.devices%rowtype; o public.device_metric_observations%rowtype;
  legacy public.device_telemetry%rowtype; sample jsonb; latest jsonb;
  q text := 'unavailable'; basis text := 'unknown'; observed timestamptz;
  received timestamptz; age numeric; capacity numeric;
  now_at timestamptz := clock_timestamp(); source text;
begin
  if p_metric not in ('do','feed') or p_metric is null then raise exception using errcode='22023',message='invalid metric'; end if;
  select * into d from public.devices where device_id=p_device_id;
  if not found then return jsonb_build_object('latest',null,'time_basis','unknown','age_seconds',null,'quality','unavailable'); end if;
  if d.capabilities->'independent_telemetry_v1'='true'::jsonb then
    select t.* into o from public.device_metric_current c join public.device_metric_observations t
      using(device_id,metric,boot_id,sample_sequence) where c.device_id=p_device_id and c.metric=p_metric;
    if found then
      sample := o.input_observation || jsonb_build_object('quality',o.quality,'do_mg_l',o.do_mg_l,
        'feed_remaining_g',o.feed_remaining_g,'feed_percent',o.feed_percent,'calibration_revision',o.calibration_revision);
      q:=o.quality; basis:=o.time_basis; observed:=o.observed_at; received:=o.received_at;
      source:='metric:'||p_metric||':'||o.boot_id::text||':'||o.sample_sequence::text;
    end if;
  else
    select t.* into legacy from public.device_state s join public.device_telemetry t
      on t.device_id=s.device_id and t.boot_id=s.latest_telemetry_boot_id and t.sample_sequence=s.latest_telemetry_sequence
      where s.device_id=p_device_id;
    if found then
      q:=case when p_metric='do' then legacy.do_quality else legacy.feed_quality end;
      if legacy.time_quality in ('synced','rtc') and legacy.measured_at<=legacy.received_at then
        observed:=legacy.measured_at; basis:=case when observed is null then 'unknown' else 'measured' end;
      end if;
      received:=legacy.received_at;
      sample:=jsonb_build_object('metric',p_metric,'boot_id',legacy.boot_id,'sequence',legacy.sample_sequence,
        'measured_at',legacy.measured_at,'captured_at',null,'time_quality',legacy.time_quality,'quality',q,
        'do_mg_l',case when p_metric='do' then legacy.do_mg_l end,
        'feed_remaining_g',case when p_metric='feed' then legacy.feed_remaining_g end,
        'feed_percent',case when p_metric='feed' then legacy.feed_percent end,
        'calibration_revision',case when p_metric='feed' then legacy.calibration_revision end);
      source:='legacy:'||p_metric||':'||legacy.boot_id::text||':'||legacy.sample_sequence::text;
    end if;
  end if;
  if sample is not null then
    if d.capabilities->(case when p_metric='do' then 'do_monitoring' else 'feed_remaining_monitoring' end) is distinct from 'true'::jsonb then
      q:='unavailable';
    end if;
    -- Profile changes must not re-bless incompatible old inventory.
    if p_metric='feed' and q='valid' and d.capabilities->'feed_capacity_g' is not null and d.capabilities->'feed_capacity_g'<>'null'::jsonb then
      if jsonb_typeof(d.capabilities->'feed_capacity_g')<>'number' then q:='error'; else
        capacity:=(d.capabilities->>'feed_capacity_g')::numeric;
        if capacity<=0 or (sample->>'feed_remaining_g')::numeric>capacity
          or abs((sample->>'feed_percent')::numeric-round((sample->>'feed_remaining_g')::numeric*100/capacity,2))>0.05 then q:='error'; end if;
      end if;
    end if;
    sample:=sample||jsonb_build_object('quality',q,
      'do_mg_l',case when p_metric='do' and q='valid' then sample->'do_mg_l' else 'null'::jsonb end,
      'feed_remaining_g',case when p_metric='feed' and q='valid' then sample->'feed_remaining_g' else 'null'::jsonb end,
      'feed_percent',case when p_metric='feed' and q='valid' then sample->'feed_percent' else 'null'::jsonb end,
      'calibration_revision',case when p_metric='feed' and q='valid' then sample->'calibration_revision' else 'null'::jsonb end);
    if observed<=now_at then age:=extract(epoch from now_at-observed); end if;
    latest:=jsonb_build_object('observation',sample,'stable_identity',source,'observed_at',observed,'time_basis',basis,'received_at',received);
  end if;
  return jsonb_build_object('latest',latest,'time_basis',basis,'age_seconds',age,'quality',q);
end $$;
revoke all on function private.backend_current_metric(uuid,text) from public,anon,authenticated,service_role;

-- Exact-match forward patches preserve all other predecessor logic and existing ACLs.
create function pg_temp.backend_metric_patch(p_function regprocedure,p_old text,p_new text) returns void
language plpgsql as $$ declare body text; definition text; begin
  select replace(prosrc,E'\r\n',E'\n'),replace(pg_get_functiondef(oid),E'\r\n',E'\n') into strict body,definition from pg_proc where oid=p_function;
  if length(body)-length(replace(body,p_old,''))<>length(p_old) then
    raise exception 'T04 predecessor mismatch: %',p_function;
  end if;
  execute replace(definition,p_old,p_new);
end $$;
select pg_temp.backend_metric_patch('public.art31_create_manual_feed(uuid,uuid,uuid,uuid,jsonb,integer)',
$o$  v_stock := public.art27_monitoring_snapshot(p_device_id, p_installation_id, p_request_id);
  if v_stock->>'status' <> 'ok' then
    return jsonb_build_object('status', 'inventory_unavailable');
  end if;
  v_latest_sample := v_stock->'latest_sample';
  if jsonb_typeof(v_latest_sample) <> 'object'
     or v_latest_sample->>'feed_quality' <> 'valid'
     or v_latest_sample->>'feed_freshness' <> 'fresh'
     or jsonb_typeof(v_latest_sample->'feed_remaining_g') <> 'number' then
    return jsonb_build_object('status', 'inventory_unavailable');
  end if;
  v_stock_remaining := (v_latest_sample->>'feed_remaining_g')::numeric;$o$,
$n$  v_stock := private.backend_current_metric(p_device_id, 'feed');
  v_latest_sample := v_stock->'latest'->'observation';
  if jsonb_typeof(v_latest_sample) is distinct from 'object'
     or v_stock->>'quality' is distinct from 'valid'
     -- Frozen alert/time contract currently supports trustworthy source time only.
     or v_stock->>'time_basis' is distinct from 'measured'
     or v_stock->>'age_seconds' is null
     or (v_stock->>'age_seconds')::numeric not between 0 and 30
     or jsonb_typeof(v_latest_sample->'feed_remaining_g') is distinct from 'number' then
    return jsonb_build_object('status', 'inventory_unavailable');
  end if;
  v_stock_remaining := (v_latest_sample->>'feed_remaining_g')::numeric;$n$);

-- New metric alerts will reference their real source; legacy/feed rows need no DML.
alter table public.alert_events
  add column observation_metric text,
  add column legacy_boot_id uuid generated always as (case when observation_metric is null then boot_id end) stored,
  add column legacy_sample_sequence bigint generated always as (case when observation_metric is null then sample_sequence end) stored,
  add constraint alert_events_metric_kind check (observation_metric is null or
    (observation_metric='do' and alert_kind in ('do_low','do_high')) or
    (observation_metric='feed' and alert_kind='feed_low'));
do $$ declare fk text; uq text; begin
  select conname into strict fk from pg_constraint where conrelid='public.alert_events'::regclass
    and confrelid='public.device_telemetry'::regclass and contype='f';
  select conname into strict uq from pg_constraint where conrelid='public.alert_events'::regclass and contype='u'
    and pg_get_constraintdef(oid)='UNIQUE (device_id, boot_id, sample_sequence, alert_kind)';
  execute format('alter table public.alert_events drop constraint %I, drop constraint %I',fk,uq);
end $$;
alter table public.alert_events
  add constraint alert_events_legacy_observation_fkey foreign key(device_id,legacy_boot_id,legacy_sample_sequence)
    references public.device_telemetry(device_id,boot_id,sample_sequence) on delete restrict,
  add constraint alert_events_metric_observation_fkey foreign key(device_id,observation_metric,boot_id,sample_sequence)
    references public.device_metric_observations(device_id,metric,boot_id,sample_sequence) on delete restrict,
  add constraint alert_events_source_identity unique nulls not distinct(device_id,observation_metric,boot_id,sample_sequence,alert_kind,sequence_id);
select pg_temp.backend_metric_patch('private.art95_evaluate_alert_crossings()',
$o$  on conflict (device_id, boot_id, sample_sequence, alert_kind) do nothing;$o$,
$n$  on conflict (device_id, observation_metric, boot_id, sample_sequence, alert_kind, sequence_id) do nothing;$n$);
select pg_temp.backend_metric_patch('private.art95_evaluate_alert_crossings()',
$o$  if not found or v_device.applied_revision is null then$o$,
$n$  if not found or v_device.applied_revision is null
     or v_device.capabilities->'independent_telemetry_v1'='true'::jsonb then$n$);

drop function pg_temp.backend_metric_patch(regprocedure,text,text);

-- Source-labelled captured alerts need a separately approved contract/consumer change.
-- Supported flow uses genuine trustworthy source measurement time, never receipt/capture relabel.
create function private.backend_evaluate_metric_alerts(p_device_id uuid,p_metric text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices%rowtype; resource jsonb; sample jsonb; snapshot jsonb;
  rule record; threshold jsonb; value numeric; outside boolean; was_outside boolean;
  latest_raised timestamptz; raised timestamptz; inserted integer; total integer := 0;
begin
  resource:=private.backend_current_metric(p_device_id,p_metric);
  sample:=resource->'latest'->'observation';
  if resource->>'quality' is distinct from 'valid'
    or resource->>'time_basis' is distinct from 'measured'
    or resource->>'age_seconds' is null or (resource->>'age_seconds')::numeric not between 0 and 30 then return 0; end if;
  select * into strict d from public.devices where device_id=p_device_id;
  select requested_snapshot into snapshot from public.device_config_revisions
    where device_id=p_device_id and revision=d.applied_revision and state='applied' and applied_at is not null;
  if not found then return 0; end if;
  for rule in select * from (values
    ('do','do_low','do_low_mg_l','below'),('do','do_high','do_high_mg_l','above'),
    ('feed','feed_low','low_feed_threshold_pct','below')) as rules(metric,kind,key,direction)
    where metric=p_metric
  loop
    threshold:=case when p_metric='do' then snapshot->'monitoring_limits'->rule.key else snapshot->rule.key end;
    if threshold is null then continue; end if;
    if threshold='null'::jsonb then
      insert into private.device_alert_state(device_id,alert_kind,is_outside) values(p_device_id,rule.kind,false)
        on conflict(device_id,alert_kind) do update set is_outside=false,last_valid_boot_id=null,last_valid_sample_sequence=null;
      continue;
    end if;
    if jsonb_typeof(threshold)<>'number' then continue; end if;
    value:=(sample->>(case when p_metric='do' then 'do_mg_l' else 'feed_percent' end))::numeric;
    outside:=case when rule.direction='below' then value<threshold::text::numeric else value>threshold::text::numeric end;
    insert into private.device_alert_state(device_id,alert_kind,is_outside) values(p_device_id,rule.kind,false)
      on conflict(device_id,alert_kind) do nothing;
    select is_outside into strict was_outside from private.device_alert_state
      where device_id=p_device_id and alert_kind=rule.kind for update;
    if outside and not was_outside then
      -- Caller already owns S. Match ART95/100 strict chronology and preserve ART96 enqueue G.
      select raised_at into latest_raised from public.alert_events where device_id=p_device_id order by raised_at desc,event_id desc limit 1;
      raised:=greatest(clock_timestamp(),coalesce(latest_raised+interval '1 microsecond',clock_timestamp()));
      insert into public.alert_events(device_id,observation_metric,boot_id,sample_sequence,alert_kind,applied_revision,
        metric_value,limit_value,measured_at,raised_at,is_simulated)
      values(p_device_id,p_metric,(sample->>'boot_id')::uuid,(sample->>'sequence')::bigint,rule.kind,d.applied_revision,
        value,threshold::text::numeric,(sample->>'measured_at')::timestamptz,raised,d.is_simulated)
      on conflict(device_id,observation_metric,boot_id,sample_sequence,alert_kind,sequence_id) do nothing;
      get diagnostics inserted=row_count;
      total:=total+inserted;
    end if;
    update private.device_alert_state set is_outside=outside,last_valid_boot_id=(sample->>'boot_id')::uuid,
      last_valid_sample_sequence=(sample->>'sequence')::bigint where device_id=p_device_id and alert_kind=rule.kind;
  end loop;
  return total;
end $$;
revoke all on function private.backend_evaluate_metric_alerts(uuid,text) from public,anon,authenticated,service_role;

create function public.backend_sync_metrics(p_device_id uuid,p_device_verifier_hex text,p_boot_id uuid,
  p_live_sequence bigint,p_metric_telemetry jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.devices%rowtype; s public.device_state%rowtype;
  existing public.device_metric_observations%rowtype;
  wrapped jsonb; sample jsonb; v_rows jsonb; live jsonb; ack jsonb := '[]';
  v_revisions jsonb; identity text; seen text[] := array[]::text[];
  v_metric text; boot uuid; seq bigint; is_live boolean; is_existing boolean;
  measured timestamptz; captured timestamptz; observed timestamptz; basis text;
  q text; oxygen numeric; remaining numeric; percent numeric; calibration bigint; capacity numeric;
  now_at timestamptz := clock_timestamp(); history_changed boolean := false;
  advanced text[] := array[]::text[]; changed text[] := array[]::text[]; alert_count integer := 0;
begin
  if p_device_id is null or p_device_verifier_hex is null or p_device_verifier_hex !~ '^[0-9a-fA-F]{64}$' then
    return jsonb_build_object('status','auth_required'); end if;
  perform 1 from private.device_credentials c where c.device_id=p_device_id and c.revoked_at is null
    and c.credential_verifier=decode(lower(p_device_verifier_hex),'hex') for share;
  if not found then return jsonb_build_object('status','auth_required'); end if;
  -- C -> D -> S agrees with T02; no new advisory lock or later first acquisition of this prefix.
  select * into d from public.devices where device_id=p_device_id and protocol_major=2 for update;
  if not found then raise exception using errcode='22023',message='unknown device'; end if;
  select * into strict s from public.device_state where device_id=p_device_id for update;
  if d.capabilities->'independent_telemetry_v1' is distinct from 'true'::jsonb then
    raise exception using errcode='22023',message='independent telemetry unsupported'; end if;
  if p_boot_id is null or p_boot_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_live_sequence is null or p_live_sequence not between 0 and 9007199254740991
    or p_metric_telemetry is null or jsonb_typeof(p_metric_telemetry)<>'object'
    or not (p_metric_telemetry ?& array['live','backlog'])
    or p_metric_telemetry-array['live','backlog']::text[]<>'{}'::jsonb
    or octet_length(p_metric_telemetry::text)>262144 then
    raise exception using errcode='22023',message='invalid metric envelope'; end if;
  live:=p_metric_telemetry->'live';
  if jsonb_typeof(live) is distinct from 'object' or not (live ?& array['do','feed'])
    or live-array['do','feed']::text[]<>'{}'::jsonb
    or jsonb_typeof(p_metric_telemetry->'backlog') is distinct from 'array' then
    raise exception using errcode='22023',message='invalid metric live/backlog'; end if;
  if jsonb_array_length(p_metric_telemetry->'backlog')+
    (case when live->'do'='null'::jsonb then 0 else 1 end)+
    (case when live->'feed'='null'::jsonb then 0 else 1 end)>100 then
    raise exception using errcode='22023',message='metric batch exceeds 100'; end if;
  if d.capabilities->'feed_capacity_g' is not null and d.capabilities->'feed_capacity_g'<>'null'::jsonb then
    if jsonb_typeof(d.capabilities->'feed_capacity_g')<>'number' then
      raise exception using errcode='22023',message='invalid device capacity'; end if;
    capacity:=(d.capabilities->>'feed_capacity_g')::numeric;
    if capacity<=0 then raise exception using errcode='22023',message='invalid device capacity'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('observation',value,'live',false)),'[]'::jsonb)
    into v_rows from jsonb_array_elements(p_metric_telemetry->'backlog');
  foreach v_metric in array array['do','feed'] loop
    if live->v_metric<>'null'::jsonb then
      sample:=live->v_metric;
      if not private.backend_valid_metric_observation(sample) then
        raise exception using errcode='22023',message='invalid metric live observation'; end if;
      if sample->>'metric'<>v_metric or (sample->>'boot_id')::uuid<>p_boot_id
        or (sample->>'sequence')::numeric<>p_live_sequence then
        raise exception using errcode='22023',message='metric live identity mismatch'; end if;
      v_rows:=v_rows||jsonb_build_array(jsonb_build_object('observation',sample,'live',true));
    end if;
  end loop;
  for wrapped in select value from jsonb_array_elements(v_rows) loop
    sample:=wrapped->'observation'; is_live:=(wrapped->>'live')::boolean;
    if not private.backend_valid_metric_observation(sample) then
      raise exception using errcode='22023',message='invalid metric observation'; end if;
    boot:=(sample->>'boot_id')::uuid; seq:=(sample->>'sequence')::numeric::bigint; v_metric:=sample->>'metric';
    sample:=sample||jsonb_build_object('boot_id',boot);
    identity:=v_metric||':'||boot::text||':'||seq::text;
    if identity=any(seen) then raise exception using errcode='22023',message='duplicate metric identity'; end if;
    seen:=array_append(seen,identity);
    select * into existing from public.device_metric_observations o
      where o.device_id=p_device_id and o.metric=v_metric and o.boot_id=boot and o.sample_sequence=seq;
    is_existing:=found;
    if is_existing then
      if existing.input_observation is distinct from sample then
        raise exception using errcode='23505',message='immutable metric identity conflict'; end if;
    else
      measured:=(sample->>'measured_at')::timestamptz; captured:=(sample->>'captured_at')::timestamptz;
      observed:=null; basis:='unknown';
      -- Existing wire has one quality. Never infer capture trust from arrival/contact alone.
      -- Clockless/uncertain source remains unknown under frozen 2.8.0 (documented acceptance gap).
      if sample->>'time_quality' in ('synced','rtc') then
        if measured<=now_at then observed:=measured; basis:='measured';
        elsif captured<=now_at then observed:=captured; basis:='captured'; end if;
      end if;
      q:=sample->>'quality'; oxygen:=(sample->>'do_mg_l')::numeric;
      remaining:=(sample->>'feed_remaining_g')::numeric; percent:=(sample->>'feed_percent')::numeric;
      calibration:=(sample->>'calibration_revision')::numeric::bigint;
      if v_metric='feed' and q='valid' and capacity is not null
        and (remaining>capacity or abs(percent-round(remaining*100/capacity,2))>0.05) then
        q:='error'; remaining:=null; percent:=null; calibration:=null;
      end if;
      insert into public.device_metric_observations(device_id,metric,boot_id,sample_sequence,measured_at,captured_at,
        observed_at,time_basis,time_quality,quality,do_mg_l,feed_remaining_g,feed_percent,calibration_revision,
        input_observation,received_at,first_live_sequence)
      values(p_device_id,v_metric,boot,seq,measured,captured,observed,basis,sample->>'time_quality',q,
        oxygen,remaining,percent,calibration,sample,now_at,case when is_live then p_live_sequence end);
      history_changed:=true;
      if is_live and p_live_sequence>s.live_sequence then
        insert into public.device_metric_current(device_id,metric,boot_id,sample_sequence,live_sequence)
        values(p_device_id,v_metric,boot,seq,p_live_sequence)
        on conflict(device_id,metric) do update set boot_id=excluded.boot_id,sample_sequence=excluded.sample_sequence,
          live_sequence=excluded.live_sequence where public.device_metric_current.live_sequence<excluded.live_sequence;
        if found then advanced:=array_append(advanced,v_metric); end if;
      end if;
    end if;
    ack:=ack||jsonb_build_array(jsonb_build_object('metric',v_metric,'boot_id',boot,'sequence',seq));
  end loop;
  if history_changed then changed:=array_append(changed,'history'); end if;
  changed:=changed||advanced;
  if p_live_sequence>s.live_sequence then
    update public.device_state set live_sequence=p_live_sequence,last_authenticated_contact_at=now_at,
      contact_freshness='fresh',updated_at=now_at where device_id=p_device_id;
    changed:=array_append(changed,'contact');
  end if;
  -- All current writers complete before alert enqueue takes existing G. No cached other metric evaluation.
  foreach v_metric in array advanced loop alert_count:=alert_count+private.backend_evaluate_metric_alerts(p_device_id,v_metric); end loop;
  if alert_count>0 then changed:=array_append(changed,'alerts'); end if;
  insert into public.device_resource_versions(device_id) values(p_device_id) on conflict(device_id) do nothing;
  select v.revisions into strict v_revisions from public.device_resource_versions v where v.device_id=p_device_id;
  foreach v_metric in array changed loop
    v_revisions:=jsonb_set(v_revisions,array[v_metric],to_jsonb((v_revisions->>v_metric)::bigint+1));
  end loop;
  if cardinality(changed)>0 then update public.device_resource_versions v set revisions=v_revisions where v.device_id=p_device_id; end if;
  return jsonb_build_object('status','ok','server_time',now_at,'acknowledged_metrics',ack,'revisions',v_revisions);
end $$;
revoke all on function public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.backend_sync_metrics(uuid,text,uuid,bigint,jsonb) to service_role;
commit;
