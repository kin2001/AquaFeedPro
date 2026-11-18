\set ON_ERROR_STOP on
-- Test-only Supabase prerequisites for a NEW disposable PostgreSQL cluster.
-- This is not a migration, Auth server, or a substitute for supported-platform acceptance.
do $$
begin
  if current_database() <> 'aquafeed_backend_test'
     or exists(select 1 from pg_namespace where nspname in ('auth','private','backend_test','realtime'))
     or to_regclass('public.devices') is not null
     or exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role','supabase_admin','supabase_realtime_admin')) then
    raise exception 'bootstrap requires a fresh isolated aquafeed_backend_test cluster';
  end if;
end $$;

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- Test-owner-only provenance; never installed by a production migration.
create schema backend_test;
revoke all on schema backend_test from public, anon, authenticated, service_role;
create table backend_test.provenance (
  singleton boolean primary key check (singleton),
  database_oid oid not null,
  migration_fixtures_created boolean not null default false,
  migration_fixtures_cleaned boolean not null default false
);
insert into backend_test.provenance(singleton,database_oid)
  select true,oid from pg_database where datname=current_database();

create schema auth;
-- Only the real Auth columns consumed by these rollback suites; id remains a real FK parent.
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_anonymous boolean not null default false
);

-- Supabase auth.uid() semantics: JWT subject setting, with JSON-claims fallback.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Auth fixture inserts run as the privileged test owner; app roles get no Auth table writes.

-- The first immutable migration creates and protects private itself.
-- This publication checks membership/exclusion, not delivery by a running Realtime server.
create publication supabase_realtime;

-- B1 SUBSTITUTED native boundary, guarded by the fresh-cluster check above.
-- Unpartitioned, no Realtime server/maintenance/JWT probes. Synthetic NOLOGIN
-- platform owners; local postgres is privileged, NOT the managed DDL mechanism.
create role supabase_admin nologin noinherit;
create role supabase_realtime_admin nologin noinherit;
create schema realtime authorization supabase_admin;
grant usage, create on schema realtime to supabase_realtime_admin;
grant usage on schema realtime to anon, authenticated, service_role;
grant usage on schema realtime to postgres with grant option;
create table realtime.messages (
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  -- UTC is an explicit TEST-ONLY default: native timezone literal was redacted.
  updated_at timestamp without time zone not null default timezone('UTC',clock_timestamp()),
  inserted_at timestamp without time zone not null default timezone('UTC',clock_timestamp()),
  id uuid not null default gen_random_uuid(),
  binary_payload bytea,
  skip_broadcast boolean not null default false,
  expires_at timestamp without time zone
);
alter table realtime.messages owner to supabase_realtime_admin;
alter table realtime.messages enable row level security;
grant select, insert, update on realtime.messages to anon, authenticated, service_role;
grant select, insert on realtime.messages to postgres with grant option;
grant update on realtime.messages to postgres;
-- Deliberately NO client INSERT policy and NO SECURITY DEFINER shortcut.
-- Behavioral model only; not copied private source or a source-hash match.
create function realtime.send(payload jsonb,event text,topic text,private boolean default true)
returns void language plpgsql volatile security invoker as $$
declare v_id uuid; v_payload jsonb;
begin
  begin
    v_id := gen_random_uuid();
    v_payload := case when payload ? 'id' then payload
      else jsonb_set(payload,'{id}',to_jsonb(v_id)) end;
    perform set_config('realtime.topic',topic,true);
    insert into realtime.messages(id,payload,event,topic,private,extension)
      values(v_id,v_payload,event,topic,private,'broadcast');
  exception when others then
    -- TEST-ONLY format; native warning text is redacted and unsanitized.
    raise warning 'T08_FIXTURE_SEND: %',SQLERRM;
  end;
end $$;
create function realtime.topic() returns text language sql stable security invoker as $$
  select nullif(current_setting('realtime.topic',true),'')::text
$$;
alter function realtime.send(jsonb,text,text,boolean) owner to supabase_realtime_admin;
alter function realtime.topic() owner to supabase_realtime_admin;
grant execute on function realtime.send(jsonb,text,text,boolean),realtime.topic() to public;
