# Backend recovery and restore acceptance

Use this runbook with [Backend migration operations](backend-migrations.md) and the [release alignment check](backend-release.md).

## Current recovery status

**Restore is unverified.** The owner-controlled encrypted backup set under the workspace's `supabase_backup` folder was observed on November 20, 2026. The database archive and archive listing were protected on November 14, 2026. The set contains `database.custom.dpapi`, `archive.toc.dpapi`, `counts-before.json.dpapi`, and `role-catalog.json.dpapi`. The protected role catalog is metadata for review. A complete executable role export was not verified.

The protection is tied to the owner's Windows DPAPI profile. The owner controls access to the files and qualified decryption from that profile. Historical evidence confirms that the archive listing includes required entries. A full isolated restore, compatible managed-role reconstruction, post-restore RLS and feed safety acceptance, and recovery from an off-machine copy are still open. Confirm that the backup date and scope meet the approved release's recovery needs. If recovery storage is inadequate, propose an encrypted off-site or managed backup option with the owner, including restore access and cost.

## Prove restore in an isolated target

1. Obtain the owner's approval for a fresh Supabase-compatible recovery target, the exact archive and operator, and protected handling of decrypted files. The approved Thesis project is the source. Use a separate restore target with no app/device/provider traffic, invokers, or path to physical hardware.
2. Before decrypting, verify source and target identities, PostgreSQL and extension compatibility (including Supabase Vault when required), managed Auth/Realtime prerequisites, roles and grants, archive integrity and coverage, and the discard/recovery boundary. Stop if the target or any prerequisite is uncertain. Keep unresolved backup-role issues explicit.
3. Restore the approved archive under fatal-on-error handling to that target. Capture only sanitized checks, versions, counts, and elapsed time. Record whether owners, ACLs, RLS policies, functions, and triggers were preserved. Keep protected artifacts in owner-controlled storage.
4. Validate installations and active/revoked access, durable feeding and command identities, configuration desired/applied revisions, observations, alert receipts, and failed/uncertain lockout. Compare counts and fingerprints against the backup's recorded scope. Use isolated synthetic operations for functional tests.
5. Record target identity, restore date, reviewed archive fingerprint and scope, operator, test results, and unresolved findings. Preserve the original archive and source database. Treat a missing compatible target or failed check as an open release blocker.

## Forward recovery after deployment

- Stop capability enrollment, disable the new path as approved, and drain the affected worker before changing it. Keep authorized reads and device safety in force.
- Revert app or Edge code only after verifying compatibility with persisted configurations, capability contracts, and current history. Use a reviewed forward database correction when needed.
- Preserve additive tables, telemetry, alert history, revision and ACK evidence, and feeding idempotency records. Keep retention and cleanup policies unchanged.
- After any restore, preserve every uncertain-feed lockout. Reconcile the restored record against the actual device journal and physical outcome before releasing it. A feed with an uncertain outcome never gets an automatic replay.
- Record discrepancy, disabled features, exact recovery changes, evidence, and who authorizes resumption. Separate recovery readiness from the decision to resume shared operations.
