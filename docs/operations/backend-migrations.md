# Backend improvement — shared development database and migration recovery

## Authorization and current state

On 2026-11-13 the owner stated that the existing Supabase project is not yet live and authorized using it as the backend development target, requesting documented recovery for migrations. This permits preparation and reviewed development changes; it does not authorize data deletion, physical feeding, blind migration-history repair, or a claim of production acceptance.

Historical expected project reference: `giilhohmrytpgyeyysir`. Verify the current CLI account, project identity and remote state before any write. Login alone does not establish the target. Prior audits found telemetry and feeding records: a prelaunch project is not an empty or disposable database.

At creation of this document, no backend-improvement migration has been applied by this orchestrator. Backup availability and restoration have not been verified. A written rollback procedure is not proof of recoverability.

## Before each shared-project change

1. Record the reviewed Git SHA, migration filenames/checksums, intended target reference and independent review result. All task PRs target `feat/backend-improvement`; `main` remains unchanged until owner satisfaction.
2. Compare applied remote migration identifiers and function/schema definitions with local history using read-only inspection. Stop on unexplained drift. Do not edit applied migration files or repair history to force a match.
3. Verify an approved backup/export exists, its time, scope, protected location, owner and restore access. Keep credentials and sensitive database contents outside Git and public logs. Do not create an external upload or purchase service without authority.
4. Exercise restoration into an isolated target before claiming recovery is verified. Preserve source data and device identities. If no adequate recovery path exists, report the blocker before applying shared-schema changes.
5. Run migration and safety suites in a disposable isolated PostgreSQL/Supabase environment with required auth/service/private prerequisites. Existing rollback suites, intentional failures, deadlock reproduction and load fixtures must not use the shared project.
6. Inspect the actual pending migration set. Never blindly run `db push`: this repository has historical local/remote drift and potentially unrelated pending migrations. Any selected CLI deployment procedure must be based on its installed command help, explicit target and reviewed migration set.
7. Serialize all shared-project writers. The orchestrator controls shared-database changes; implementation workers remain local unless explicitly assigned a reviewed operation.

## Required documentation for every new backend migration

Each SQL file must begin with a short comment referring to this document and describing:

- purpose, dependencies and compatibility/capability gate;
- data and functions affected, including unchanged feeding protections;
- verification commands or test files and expected results;
- safe disable/recovery action and whether old app/API versions remain compatible;
- any irreversible effect or restore requirement (a blocker until separately approved).

The task report must include the exact migration SHA and isolated red/green evidence. Application, contract, database and simulator must agree before enabling a capability. Real hardware is not enrolled merely because a simulator passes.

## Recovery policy

Prefer a reviewed **forward correction** over a destructive down migration.

- Stop new capability enrollment and disable the new negotiated path if faulty.
- Revert compatible app/API code only after checking the existing data/configuration shapes. Do not let old clients strip newly stored fields or nozzle targets.
- Keep additive observation/history tables, durable command/occurrence identities, configuration ACKs and feeding evidence. Do not drop/truncate/delete records to make old code work.
- Restore prior function definitions through a new reviewed forward migration only when their callers and stored state remain compatible. Record the source SHA, dependencies, affected grants/triggers and validation.
- A full restore can lose post-backup facts and diverge from a device journal; it is not a casual undo command. Restore only through an approved recovery procedure, validate in isolation first, and preserve uncertain-feed lockout until physical reconciliation.
- DDL transaction rollback can undo an uncommitted transaction, but cannot reverse a committed deployment's external/device effects. Concurrent indexes and other nontransactional steps need their own inspected recovery instructions.

Do not enable physical feeding as a migration test. Database success is not physical completion.

## Application log

| Reviewed SHA / migration | Target verified | Backup / restore evidence | Applied result | Recovery / follow-up |
|---|---|---|---|---|
| None applied yet | Not verified for this execution | Unverified | No backend-improvement shared mutation performed | Complete prerequisites above |

Update this table with observed results only; do not record tokens, connection passwords or private readings. The later backend release/recovery runbooks should reuse and extend this record rather than contradict it. Development deployment, final `main` integration, phone delivery, restore acceptance and physical feeding acceptance are distinct states.
