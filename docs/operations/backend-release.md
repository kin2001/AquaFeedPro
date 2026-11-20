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
