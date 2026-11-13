# T04 forward metric migration / recovery boundary

`20261114001000_backend_metric_observations.sql` depends on the complete immutable chain through T02 `00100` and merged T09 `00900`. The approved plan's old `00200` timestamp would sort before already merged T09, so the parent reserved `01000`. Do not rename old migration files, repair shared history or run shared SQL from this document.

## Deployment impact — not a zero-impact migration

New observation/current/resource-version tables are empty; no legacy observation backfill, copy, normalization rewrite, automatic deletion or retention job is added. Existing observation inputs remain immutable, including original overcapacity stock and times. However, `alert_events` gains two **generated STORED FK selector columns**, source discrimination, replacement FK/unique constraints and validated new constraints. PostgreSQL may physically rewrite/materialize the existing alert table, build an index, scan history and take strong DDL locks. Existing alert rows are not business-DML updated or relabelled, but **do not describe this as no row/storage impact**. The migration is transactional with5s lock/30s statement timeouts; timeout rolls back the whole change, not partially migrated evidence. Real production size/duration has not been measured.

Parent must measure the exact migration on disposable PostgreSQL with representative history before any release approval. A minimal catalog-only *disposable* pre/post observation (not permission to query shared data):

```sql
select pg_relation_filenode('public.alert_events'::regclass) as relfilenode,
       pg_relation_size('public.alert_events'::regclass) as heap_bytes,
       pg_total_relation_size('public.alert_events'::regclass) as total_bytes;
select a.attname,a.attgenerated
from pg_attribute a where a.attrelid='public.alert_events'::regclass
  and a.attname in ('legacy_boot_id','legacy_sample_sequence') and not a.attisdropped;
```

Record pre/post relfilenode/size, actual migration duration/lock waits, PostgreSQL version and migration hash. Empty CI tables do not establish representative shared deployment cost. Capture-only source labels and the no-meter-clock case remain an explicit acceptance exception, not grounds to rewrite old event measured_at values.

## Supported lock graph

Before T04, supported RPCs follow credential C or access A -> device D -> device_state S -> sequences Q -> steps F. ART95 reading and ART100 feeding alerts run while S is held, create immutable alert facts, then ART96 enqueue takes existing global push lock G964209601. T09 preserves that existing G lifecycle and prevents uncertain-send reclamation; it adds no physical retry.

After T04:

- Metric sync authenticates and locks C SHARE -> D UPDATE -> S UPDATE. It validates/retains observation identities and updates metric current pointers/resource counters only under this prefix.
- All batch observation/current writes finish before threshold evaluation. Only the advanced metric is read through `private.backend_current_metric`; no cached other metric is evaluated. Crossing state/alert facts follow S; ART96 enqueue then takes existing G. Subsequent S/D FK work only reacquires already-held prefix locks. No Q/F writer is introduced by the metric RPC.
- Manual admission still locks A -> D -> S -> Q/F through the existing flow. Only its inventory read block changes to the canonical capability-aware feed resource. It uses true elapsed age <=30 seconds, not contact/receipt/DO cadence, and never subtracts requested feed from stock.
- Legacy sync remains C -> D -> S. Its reading-alert trigger skips capable profiles; old-profile legacy alerts still use their original logic with the new source-qualified conflict target. Legacy data cannot override capable unavailable/error current stock.
- ART100 reentrant S-before-alert, sequence-once constraint, ART96 enqueue/revocation G and all T09 claim/send/receipt rules remain unchanged. No new advisory serialization mask or retry loop.

**Boundary unchanged:** direct privileged table DML and Auth maintenance are not automatically RPC-ordered. Maintenance must obtain the documented C/A then D/S prefix before touching feeding/alert state or reaching G; do not introduce G -> first D/S acquisition. Service clients use the RPC, not direct current/observation mutations. Client roles have only active-access SELECT; new private helper/evaluator/guard functions remain non-callable by clients/service_role. New public RPC is service-role EXECUTE only.

## Safe rollback / uncertain feeds

1. Stop capability enrollment/new metric ingestion with compatible API rollback or server admission gate; do not pretend legacy state is authoritative while a profile still declares independent telemetry. No real profile is activated by T04.
2. Retain the additive tables, original inputs, current pointers, ACK identities, resource versions and alert facts. Do not use a down migration, delete/truncate data, drop FKs, disable immutability or copy new readings back into legacy telemetry.
3. Roll back compatible app/API code only after verifying the declared profile/reader path remains fail-closed. Do not replay physical commands in response to HTTP retry or SQL transaction failure; existing durable command identities and unknown-outcome lockout remain authoritative.
4. Apply a reviewed forward correction after isolated evidence. If a restore is separately authorized, uncertain physical feeds remain locked out until the existing maintenance/physical reconciliation process resolves them.
5. The shared project remains drifted and backup/restore readiness unverified per `BACKEND_RECOVERY.md`. No shared application, history repair, cloud deployment, provider send, hardware operation or destructive recovery is authorized here.

See `../tests/BACKEND_METRICS_TESTING.md` for focused checks, initial public-type artifact generation and the required strict regeneration comparison after parent-reviewed artifact integration. A passing simulator/mock test is not SQL, hardware or backup acceptance.
