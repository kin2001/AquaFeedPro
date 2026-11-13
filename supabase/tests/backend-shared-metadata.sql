-- Shared-development catalog inspection only. No business RPCs or application rows.
-- Parent must review these exact bytes before remote execution.
begin read only;
set local statement_timeout = '10s';
set local lock_timeout = '1s';

with expected_functions(signature) as (values
  ('public.art38_provision_simulated_device(uuid,text,boolean)'),
  ('public.art31_create_manual_feed(uuid,uuid,uuid,uuid,jsonb,integer)'),
  ('public.art31_sync_manual_feed(uuid,text,integer,jsonb,text,uuid,text,integer)'),
  ('public.art31_read_manual_command(uuid,uuid,uuid,boolean)'),
  ('public.art31_history_page(uuid,uuid,date,date,text,text,timestamp with time zone,uuid)'),
  ('public.art33_read_configuration(uuid,uuid,uuid)'),
  ('public.art33_write_configuration(uuid,uuid,uuid,bigint,jsonb)'),
  ('public.art33_device_configuration_report(uuid,text,bigint,bigint,text,text)'),
  ('public.art33_record_scheduled_events(uuid,text,jsonb,text,integer,text,uuid)'),
  ('public.art27_sync_telemetry(uuid,text,uuid,bigint,jsonb,jsonb)'),
  ('public.art27_monitoring_snapshot(uuid,uuid,uuid)'),
  ('public.art96_register_push_token(uuid,uuid,text,text)'),
  ('public.art96_claim_push_deliveries(integer,integer)'),
  ('public.art96_begin_push_send(uuid,uuid,bigint)'),
  ('public.art102_update_device_metadata(uuid,uuid,text,text,bigint)')
), function_metadata as (
  select e.signature, p.oid is not null as installed, p.prosecdef as security_definer,
    pg_catalog.has_function_privilege(a.oid,p.oid,'EXECUTE') as anon_execute,
    pg_catalog.has_function_privilege(u.oid,p.oid,'EXECUTE') as authenticated_execute,
    pg_catalog.has_function_privilege(s.oid,p.oid,'EXECUTE') as service_execute
  from expected_functions e
  left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(e.signature)
  left join pg_catalog.pg_roles a on a.rolname='anon'
  left join pg_catalog.pg_roles u on u.rolname='authenticated'
  left join pg_catalog.pg_roles s on s.rolname='service_role'
), expected_tables(relation) as (values
  ('public.devices'), ('public.device_access'), ('public.device_state'),
  ('public.device_config_revisions'), ('public.device_telemetry'),
  ('public.feed_sequences'), ('public.feed_steps'), ('public.feed_sequence_targets'),
  ('public.scheduled_occurrences'), ('public.device_events'), ('public.alert_events')
), table_metadata as (
  select e.relation, c.oid is not null as installed, c.relrowsecurity as rls_enabled
  from expected_tables e
  left join pg_catalog.pg_class c on c.oid=pg_catalog.to_regclass(e.relation)
), expected_indexes(relation) as (values
  ('public.feed_sequences_manual_idempotency'), ('public.one_unresolved_manual_sequence'),
  ('public.one_active_device_sequence'), ('public.scheduled_occurrences_pkey'),
  ('public.device_events_pkey')
), index_metadata as (
  select e.relation, i.indexrelid is not null as installed,
    i.indisunique as unique_index, i.indisvalid as valid_index
  from expected_indexes e
  left join pg_catalog.pg_index i on i.indexrelid=pg_catalog.to_regclass(e.relation)
), expected_columns(relation,column_name) as (values
  ('public.devices','capabilities_revision'), ('public.devices','desired_revision'),
  ('public.devices','applied_revision'), ('public.device_config_revisions','based_on_revision'),
  ('public.feed_steps','measured_dispensed_g'), ('public.feed_steps','measurement_quality')
), checks(name,passed) as (values
  ('roles_present', (select count(*)=3 from pg_catalog.pg_roles
    where rolname in ('anon','authenticated','service_role'))),
  ('client_roles_do_not_bypass_rls', (select count(*)=2 and not bool_or(rolbypassrls or rolsuper)
    from pg_catalog.pg_roles where rolname in ('anon','authenticated'))),
  ('private_schema_protected', (select count(*)=1 and bool_and(
    not pg_catalog.has_schema_privilege('anon',oid,'USAGE')
    and not pg_catalog.has_schema_privilege('authenticated',oid,'USAGE'))
    from pg_catalog.pg_namespace where nspname='private')),
  ('private_credentials_protected', pg_catalog.to_regclass('private.device_credentials') is not null
    and not pg_catalog.has_table_privilege('anon',pg_catalog.to_regclass('private.device_credentials'),'SELECT')
    and not pg_catalog.has_table_privilege('authenticated',pg_catalog.to_regclass('private.device_credentials'),'SELECT')),
  ('service_rpcs_not_client_executable', (select bool_and(installed and not anon_execute
    and not authenticated_execute and service_execute) from function_metadata)),
  ('public_tables_rls_enabled', (select bool_and(installed and rls_enabled) from table_metadata)),
  ('durable_unique_indexes_valid', (select bool_and(installed and unique_index and valid_index) from index_metadata)),
  ('revision_measurement_columns_present', (select count(*)=6 from expected_columns e
    join pg_catalog.pg_attribute a on a.attrelid=pg_catalog.to_regclass(e.relation)
      and a.attname=e.column_name and a.attnum>0 and not a.attisdropped)),
  ('service_cannot_delete_journal', not pg_catalog.has_table_privilege('service_role',pg_catalog.to_regclass('public.device_events'),'DELETE')
    and not pg_catalog.has_table_privilege('service_role',pg_catalog.to_regclass('public.scheduled_occurrences'),'DELETE')
    and not pg_catalog.has_table_privilege('service_role',pg_catalog.to_regclass('public.device_execution_reservations'),'DELETE')),
  ('private_not_published', not exists(select 1 from pg_catalog.pg_publication_tables where schemaname='private'))
)
select pg_catalog.jsonb_build_object(
  'kind','aquafeed_shared_metadata_v1',
  'database',pg_catalog.current_database(),
  'server_version',pg_catalog.current_setting('server_version'),
  'transaction_read_only',pg_catalog.current_setting('transaction_read_only'),
  'statement_timeout',pg_catalog.current_setting('statement_timeout'),
  'lock_timeout',pg_catalog.current_setting('lock_timeout'),
  'checks',(select pg_catalog.jsonb_object_agg(name,passed) from checks),
  'functions',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f) order by signature) from function_metadata f),
  'tables',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t) order by relation) from table_metadata t),
  'indexes',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) order by relation) from index_metadata i),
  'migrations',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('version',version,'name',name) order by version)
    from supabase_migrations.schema_migrations)
) as backend_shared_metadata;

commit;
