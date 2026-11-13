# Backend migration recovery gate

## Scope and current authorization

The owner has authorized the existing logged-in Supabase project as a shared development target and states the app is not live yet. That does **not** make its existing telemetry, feed journal, identities, credentials or configuration disposable. The orchestrator controls target verification, recovery verification, exact forward-migration review and execution authorization. T01 workers must not inspect cloud credentials, mutate the shared project, deploy, or run fixture/rollback/concurrency/deadlock tests there.

**Database-connection identity, backup availability and restore readiness: UNVERIFIED.** On 2026-11-13 the orchestrator reported a successful read-only project listing using the cached Supabase CLI **2.120.0**: `Thesis Project`, reference `giilhohmrytpgyeyysir`, `ACTIVE_HEALTHY`, PostgreSQL `17.11.0.003`; the original checkout's `supabase/.temp/project-ref` matched. This is attributed project-management discovery, not a worker database audit or proof that a future database connection targets that project. The CLI is cached outside PATH and does not provide a local SQL runtime. A historical tracker entry or project listing alone does not establish recoverability. This document records remaining gates, not recovery guarantees. T01 introduces **no migration to apply**; its test bootstrap and fixtures are disposable-test files, not release migrations.

## Before any shared-project change

The orchestrator must retain a sanitized, dated pre-change record:

1. **Verified target:** project identity/reference, environment purpose, database identity/version, organization/region where relevant, intended branch/head, exact migration list/checksums and current remote migration history. Confirm that CLI/dashboard/database target identities agree using separately authorized read-only inspection. Never include a connection URL, password, service key or device credential in the record.
2. **Existing evidence baseline:** counts and safe metadata for telemetry, device events, sequences, ordered steps, scheduled occurrences, unresolved reservations/lockouts, access records, configuration revisions and push queue state. Do not export sensitive payloads to public logs. Preserve the distinction between event time and receipt time, desired and applied configuration, requested and measured quantities.
3. **Protected recovery artifact:** identify a current database backup/snapshot or approved encrypted logical backup, its coverage/consistent point, retention, location, access owner and restore procedure. Verify encryption and access controls; store credentials separately. Do not assume PITR or a backup exists from plan/account history. Include Supabase Auth/private schemas, grants/RLS/functions/triggers, migration history and all feeding/idempotency evidence; inventory external configuration, Storage objects and secrets separately because a database export alone may not include them.
4. **Isolated restore proof:** restore the protected artifact into an authorized isolated target, never over the shared source as a test. Verify schema/migration history, representative protected reads, access denial, journal/occurrence identities, unresolved safety lockouts and requested/applied configuration. Record exact artifact/time, checks and limitations. A successful export without a demonstrated restore is not recovery readiness.
5. **Reviewed change/evidence:** exact immutable migration bytes, isolated migration and rollback-SQL results, compatibility/lock-time assessment, application/API rollback candidate and the execution owner's authorization. Stop for missing artifacts, target drift, unexpected existing data, failed tests or unverified restore coverage. No unreviewed migration follows simply because the shared project is called development.

No worker may install backup software, purchase/enable paid services, upload data off-site, create a cloud target or mutate scheduling/retention without separate authorization. Missing facilities are blockers to report, not permission to improvise.

## Forward-only, additive migration policy

- Prefer reviewed additive tables/columns/functions and backward-compatible readers/writers. Do not rewrite already-applied migrations or falsify remote migration history to hide drift. Resolve drift in a recorded, separately reviewed plan before applying dependent changes.
- Review each migration for data rewrites, table/row/advisory locks, trigger/function replacement, constraints, RLS/grants, publications and index-build transaction requirements. "Additive" alone does not mean nonblocking or reversible.
- Apply only the exact reviewed forward files in the approved order to the verified target. Record before/after history, execution timing and sanitized outcomes. Stop at the first unexpected failure; do not blindly repeat a partially applied migration or a physical feed command.
- Preserve all telemetry and feeding evidence. No retention deletion, table truncation, journal reset, fixture cleanup, identity regeneration, automatic uncertain-feed retry or destructive down migration is part of this policy.
- Verify post-change protected reads and compatibility before enabling new behavior. Database/API success is not device-applied configuration, physical feeding completion or measured dispensing.

## Per-migration impact and recovery record

Fill one record **before** execution, then append actual results. Do not mark unknown fields as passed.

| Field             | Required record                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Migration         | Exact filename, checksum, reviewed commit, predecessor/history state                                            |
| Authority/target  | Approver/executor, verified sanitized target identity, authorization scope/time                                 |
| Change/impact     | Objects/rows touched, locks/duration estimate and evidence, grants/RLS/publication effects                      |
| Compatibility     | Old/new app/API/device behavior; negotiated capability and desired/applied handling                             |
| Safety/data       | Access, identities/deduplication, uncertain lockout, sequential nozzles/exclusive shared weighing checks        |
| Recovery artifact | Protected backup reference/consistent time, owner/access, isolated restore evidence and gaps                    |
| Stop conditions   | Unexpected rows/history, failed assertion, long lock, incompatible caller or recovery gap                       |
| Recovery action   | Compatible app/API rollback, feature/enrollment pause, reviewed forward repair; limitations/data reconciliation |
| Actual execution  | Start/end, exact applied history, sanitized output, partial effects if failed                                   |
| Verification      | Exact checks/results, evidence location, unresolved gates, recovery decision owner                              |

**T01 record:** no production/shared migration; no cloud inspection or application; shared database-connection identity/backup/restore unverified; read-only project-management metadata above is attributed to the orchestrator. Local test service/bootstrap, CI and mocks do not establish any shared-project recovery fact.

## Rollback and incident limitations

A schema down migration can destroy rows, collapse distinctions, remove grants or invalidate old clients; do not treat it as a safe automatic undo. Reverting Git or rolling back app/API code does not revert database effects or device-applied configuration. A point-in-time restore can lose every accepted observation and command identity after its recovery point; it must not resurrect already-executed commands or remove uncertain-result lockouts. Any source restore requires a separate reviewed reconciliation/outage plan and explicit authority—not this document.

If a change fails or compatibility is uncertain:

1. Stop the rollout and **pause new installation/device enrollment or the affected new feature** through a reviewed application/API control. Do not broadly revoke existing access, erase pairing credentials, clear reservations or send feeder/motor commands. Hardware intervention requires its own authorization.
2. Keep protected read/monitoring and compatible clients operational where safe. Roll back only to an inspected compatible app/API version; retain additive database objects and durable identities. Disable a new path rather than replaying an uncertain physical operation.
3. Preserve existing journals, occurrences, commands, device/applied configuration and recovery evidence. Record partial migration effects and inflight operations without logging secrets. Never provision simulator fixtures or run deliberate failures against the shared project while investigating.
4. Prefer a separately reviewed forward repair. Rehearse it on the restored isolated database and rerun the affected safety/access checks before shared execution authorization. Escalate when a compatible rollback or evidence-preserving recovery is not established.

The operational owner must identify who can pause enrollment, choose a compatible app/API rollback and approve any eventual restore. Those controls and their supported-runtime behavior remain unverified until inspected and exercised within approved scope.
