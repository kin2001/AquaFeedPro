# Backend release alignment

Task 10 checks whether the reviewed backend candidate and the authorized Thesis development target agree. Use the result to prepare a separate release decision. The checker has no deployment or migration-repair operation.

## Run the checker

Run from the reviewed candidate checkout with Node 24 and an authenticated Supabase CLI. Use a reviewed expectation for each function version. The example uses the versions observed in the development inventory on November 20, 2026.

```powershell
node supabase/scripts/check-backend-release.mjs `
  --project-ref giilhohmrytpgyeyysir `
  --app-api-version 11 `
  --device-api-version 8 `
  --push-sender-version 2
```

Use `--supabase-cli` with the explicit path if the executable is outside PATH. CLI 2.120.0 was used for the development inventory. The command reads migration identifiers and names, the three function versions and JWT settings, and each function's deployed source closure in temporary storage. It compares source bytes by SHA-256, including the shared files as packaged with each function. It reports file-level findings without printing deployed source or raw CLI errors.

| Result | Meaning |
| --- | --- |
| `PASS` (0) | Observed migration records, function metadata, and source closures match the candidate and supplied versions |
| `DRIFT` (1) | The comparison found a mismatch |
| `UNVERIFIED` (2) | The checker could not collect or validate required evidence, or the invocation was invalid |

A confirmed mismatch yields `DRIFT` even when another check is unverified. Review the individual results for missing evidence. A release review also needs a verified recovery path, functional acceptance, and separate authorization. Run the offline checker tests with `node --test supabase/tests/check-backend-release.test.mjs`.

## Thesis development observations

Inventory captured on November 20, 2026 against the backend candidate at `ea111b9ed19e5722695a48a51441b022ec180381`.

- The repository has 27 versioned migrations. Thesis dev has 23 history entries. The pending forward files are `20261114001200_backend_query_indexes.sql`, `20261114001300_backend_reporting_configuration.sql`, `20261114001400_backend_resource_updates.sql`, and `20261114001500_backend_device_sync.sql`.
- These historical rows use different version IDs and the same name. Each remote row has one stored statement. Removing carriage returns and trimming surrounding spaces, tabs, and newlines produces identical local and remote content fingerprints. This is evidence about the recorded SQL text. Check effective schema and grants separately.

| Migration name | Repository ID | Thesis dev ID | Normalized MD5 |
| --- | --- | --- | --- |
| `art7_two_nozzle_v2_secure_data_foundation` | `20261002194139` | `20261002204906` | `8c2ca9db2c94bc49617f345c357d76b4` |
| `revoke_public_rls_auto_enable_client_execution` | `20261002205502` | `20261002210131` | `ad8a6f5fec6c512832547080fe424ad9` |

- A previously reviewed dry run using only temporary copies under the two observed historical IDs, with the SQL bytes unchanged, listed exactly `01200` through `01500` in order. Remote history repair requires its own review and authorization. Keep the November 3 migration byte-identical.
- At the observed versions, all three functions were active with the expected JWT settings. The deployed app and device handlers differed from the candidate. The deployed `_shared/device-access.ts` differed in all three bundles. These differences persist after line-ending normalization. The push sender entry point and its sender helper matched.

| Function | Version | Verify JWT | Bundle drift from reviewed tree |
| --- | --- | --- | --- |
| `app-api` | 11 | true | `app-api/index.ts`, `_shared/device-access.ts` |
| `device-api` | 8 | false | `device-api/index.ts`, `_shared/device-access.ts` |
| `push-sender` | 2 | false | `_shared/device-access.ts` |

Retain the reviewed Git SHA, local file hashes, verified project reference, authenticated operator identity, and sanitized check results with the release evidence. Keep any temporary downloaded source outside Git.

## Forward release order

1. Obtain approval for the exact target, migration manifest, function bundles, and recovery procedure. Recheck the catalog, protected backup, isolated restore evidence, and test results. Resolve unexplained drift before any shared change.
2. Apply the approved database capability changes in order. Verify history, function signatures and grants, and existing device compatibility. Preserve all observations, configuration evidence, alert history, and feeding identities.
3. Release the compatible API and Edge bundles. Check the actual deployed source, JWT metadata, existing authentication boundaries, app contract versions, and push worker drain and safety procedures. See [Push readiness](push-readiness.md).
4. Release the matching app and exercise the approved devices and app versions. Verify scoped Realtime recovery, stale data behavior, contract negotiation, and safe legacy access. See [Backend recovery](backend-recovery.md).
5. Enroll only approved isolated simulators first and collect state and delivery evidence. Enroll real hardware last after the hardware owner verifies schema, capability negotiation, revision ACKs, and feeding safety on the target. Hardware operation requires its own authorization.

Throughout release, keep client DELETE and TRUNCATE access at the reviewed baseline. Use read-only growth observations. Keep retention, partition expiry, and cleanup schedules outside this release.

## Task 12 preflight decision record

**Hold shared rollout.** On November 21, 2026, the reviewed candidate was `72fc1982f5b3ee93ed56dca694f28378053e1a0e` on `feat/backend-improvement`, incorporating [PR #90](https://github.com/kin2001/AquaFeedPro/pull/90). The candidate tree matches the reviewed Task 11 head. All four [merge-commit CI jobs](https://github.com/kin2001/AquaFeedPro/actions/runs/44862137443) passed, including the isolated 27-migration baseline and five-feeder acceptance gates.

The only named preflight target is Thesis dev, project `giilhohmrytpgyeyysir`. The merged checker returned `DRIFT` with 23 remote migration records, both historical ID pairs listed above, four missing forward migrations, and the same deployed Edge source differences. PostgreSQL reports 17.11. The exact `public.backend_sync_device(uuid,text,jsonb)` RPC and `realtime.messages.backend_device_updates_select` policy were absent. Vault was present. The Cron catalog and `pg_net` were absent, and external push invocation remains unverified.

### Candidate manifest

The complete 27-file SQL manifest has SHA-256 `876a18c27caa4602a0a0915942de399329e8a129bdf99fa511a6eb771c8bb426`. Its input is one line per versioned file with the lowercase SHA-256 of exact file bytes, two spaces, and the filename. Sort by filename and terminate each line with LF. A historical dry run using temporary filename aliases listed these four pending files in order. Match the approved manifest and repeat preflight before any shared write.

| Pending file | SHA-256 |
| --- | --- |
| `20261114001200_backend_query_indexes.sql` | `4175d24588d41d6eea404ed2e94c27444f45e7d4aeb07a0507192a7b178b1f91` |
| `20261114001300_backend_reporting_configuration.sql` | `6e4dc4549d168722794882d43c12980889f762698f3cfc9cf91b959c1998bbf9` |
| `20261114001400_backend_resource_updates.sql` | `4aefcddf41735f69270f7c39f0c6d08099d4bee3d927824d619dc58fdcfdd4b8` |
| `20261114001500_backend_device_sync.sql` | `d0050c54512c8d4feeda21fe610a58f8244a422ee799da54f80caea8a42b7e89` |

Use the same line format for the closure paths relative to `supabase/functions`, in lexical order. The observed versions identify the deployed functions. Record the new deployed versions after an approved release.

| Edge bundle | Observed version and gateway JWT | Reviewed closure SHA-256 |
| --- | --- | --- |
| `app-api` | 11, true | `56222612bccce39e998ceb34076bff89cd9bbe6accffb8dd01cf4e6f41b9a88a` |
| `device-api` | 8, false | `8c3b2ea5e222432748922ed2ae9259550044f4107670a3ab02d53e4394f78af5` |
| `push-sender` | 2, false | `c847bedd7d620f078209474393e2dca6d8cb7bdea0345ee4dc537701ee291d3c` |

### Compatibility and acceptance

| Path | Isolated evidence | Live gate |
| --- | --- | --- |
| Legacy v2 device sync | The 27-migration baseline and route fixtures exercise the legacy envelope, durable identity and atomic adapter. | Apply and verify database prerequisites before releasing the Edge handler. Verify approved legacy device behavior on dev. |
| Capability-gated v2.8.0 reporting | Contract, SQL, simulator and app mocks cover exact ACKs, conflict handling and separate desired/applied state. | Verify the matching Edge and app on dev. Enable devices only with observed capability and schema/ACK support. |
| Mobile foreground updates | Task 8 and Task 11 exercise resource budgets, revocation-driven cleanup and reconnect. | Verify signed-JWT join, minimal private delivery, denied access and rejoin, and missed-hint recovery on the target. |
| Mobile background push | Sender and token tests pass with simulated provider behavior. | Confirm the existing invoker and test Android on a physical supported build. The current iOS registration path remains unsupported. |
| Recovery and hardware | The owner-protected archive exists. Local SQL rollback and synthetic lockout checks pass. | Verify isolated restore and reconcile uncertain work against device journals. The hardware owner retains physical acceptance and enrollment authority. |

### Owner decision and next evidence

Identify an approved isolated Supabase-compatible restore target and an authorized operator. The November 14 owner-protected archive still exists, and its age and role coverage need review before use. After a successful restore rehearsal, bring the exact Thesis dev rollout manifest and recovery results back for separate approval.

During an approved staged rollout, collect post-step evidence for schema and ACLs, classifier and trigger behavior, signed-JWT private topics, token registration, and requested/applied revisions. Capture error and deadlock counts, queue state, authorized Realtime activity, storage growth, and mobile request counts at the reviewed cadence. Record scope and observation interval. Stop expansion on failures and use the nondestructive [recovery procedure](backend-recovery.md).

The candidate code is merged and CI verified. Shared rollout, live database and Realtime validation, phone delivery, isolated restore, and physical feeding remain open.
