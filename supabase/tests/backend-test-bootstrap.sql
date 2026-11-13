\set ON_ERROR_STOP on
-- Test-only Supabase prerequisites for a NEW disposable PostgreSQL cluster.
-- This is not a migration, Auth server, or a substitute for supported-platform acceptance.
do $$
begin
  if current_database() <> 'aquafeed_backend_test'
     or exists(select 1 from pg_namespace where nspname in ('auth','private','backend_test'))
     or to_regclass('public.devices') is not null
     or exists(select 1 from pg_roles where rolname in ('anon','authenticated','service_role')) then
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
