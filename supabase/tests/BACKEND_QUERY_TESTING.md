# T06 query evidence — disposable policy A/B/A control

Phase A CI **43613272382** succeeded on `cb3077ede8662b3a1e800b44e9e0273736a6bbab` (base `b97472203af07404b523d40cfe3013f8b3205e3a`). Its 111-record baseline is retained separately outside Git. This delivery adds an approved **experiment, not a shipped optimization**: original policy A, scalar-SELECT candidate B, exact rollback A2, inside the disposable benchmark transaction. No forward `01200` migration, new index, schedule DROP, product rewrite or type change. Strict public generation remains 23 migrations / `01100`.

## Execution boundary

Only the parent may push the personally reviewed instrumentation commit and execute its hosted disposable CI. The worker does not run SQL locally or against Supabase. The existing PostgreSQL 17.6 CI service, loopback port 54322, database name, bootstrap database-OID provenance, migration-fixture flags, exact task push ref and explicit acknowledgment are all required. No installations, new job/dependency, credential fixtures/probes, shared SQL or hardware are needed.

`backend_query_access.sql` is the thirteenth rollback assertion suite. It exercises current active/unrelated/revoked/missing-subject/anonymous access for alerts and normalized observation/current/version tables, service-only read RPCs, inaccessible private T05 helpers, immutable facts and retained constraint-backed indexes/FKs. It does not claim that the later scalar-SELECT alert policy optimization is already installed. The predecessor access/safety suites remain registered unchanged.

## Synthetic workload

`backend_query_plans.sql` uses five fresh simulated device IDs, copying the canonical simulator profile without modifying its provisioning RPC's two-ID allowlist. Only two synthetic Auth subjects and two active memberships are added for the policy control: subjectA (`66000000-0000-4000-8000-000000000201`) → device 1; subjectB (`66000000-0000-4000-8000-000000000202`) → device 2. No credential/token/push fixtures or new device/history volume are added. Fixture writes take the existing D -> S prefix before sequence/step/alert work. All real triggers and constraints remain enabled; deferred constraints are forced immediate before measurement.

| Device |     DO |   Feed | Legacy combined | Feed sequences | Journal events |
| ------ | -----: | -----: | --------------: | -------------: | -------------: |
| 1      | 57,600 | 14,400 |          28,800 |          1,440 |          4,320 |
| 2      | 28,800 |  7,200 |          14,400 |            720 |          2,160 |
| 3      | 14,400 |  3,600 |           7,200 |            360 |          1,080 |
| 4      |  7,200 |  1,800 |           3,600 |            180 |            540 |
| 5      |  3,600 |    900 |           1,800 |             90 |            270 |

Totals: 139,500 new metric rows, 55,800 combined legacy rows, 251,100 normalized observations, 5,022 unknown-time observations and 1,395 captured-time observations. Rows span a deterministic 180-day construction relative to one recorded anchor, with tied timestamps, independent metric quality, reliable/uncertain/invalid/future source clocks, delayed receipts and unchanged source-qualified identities. Exact min/max times and actual counts are retained. This is synthetic skew/coverage, not a claim about production cadence, volume or measurement authenticity.

The 2,790 scheduled sequences transition queued -> completed only after target/step/journal insertion. Their unavailable final weighing produces **2,790 real `feeding_unmeasured` alerts** through the existing trigger, with no push tokens/deliveries/provider calls. Source clocks include 279 unknown and 279 completion-only chronologies. Neither requested grams nor status is presented as measured dispensing.

## What is measured

- One exact installed normalized-helper SELECT plan per device. Its SECURITY DEFINER / SET boundary filters only device; **do not attribute outer date/metric/cursor pushdown to these plans**.
- Busiest device: known/unknown readings, all/DO/feed, first/continuation pages; 1h/6h/24h graph; 7-day/180-day/completed feed pages and continuations; source running/completion/unknown chronology. Each of 24 queries has one unreported warmup and three measured repetitions. Cursor discovery performs additional read-only first-page queries.
- Smallest device: the same 24 correctness/result-fingerprint controls, without repeated plans. Independent fixture-key/time references verify exact reading C-order/page scope, graph bucket counts/last identities/unknown counts, and feed chronology order/totals.
- Three paired savepoint write probes, each inserting 1,000 new metric and 500 legacy rows per device (7,500 total), with distinct probe boot IDs. Real validation/FKs/triggers execute. EXPLAIN records buffers, WAL, trigger time and execution time; inserted counts and relation/index bytes are recorded, then inserts roll back.

The consumer SELECTs are extracted from exact installed T05 bodies with immutable-source MD5 expectations. Function/materialization boundaries, identity expressions and C collation are retained. Typed fixture parameter literals make EXPLAIN visible/reproducible; these are not observations of PostgreSQL's long-lived generic-plan cache. Legacy public feed history/detail RPCs reconcile state and are **not called as read-only benchmarks**.

All plans use ANALYZE/BUFFERS/WAL/SETTINGS/JSON; no forced seq-scan disabling, cache eviction or helper redefinition. The only candidate DDL is the rolled-back alert SELECT-policy expression below. Helper physical scans and consumer plans are separate evidence; nested counters must not be summed as distinct physical I/O. Warm caches, savepoint-aborted physical tuples/index pages and shared CI compute limit paired latency interpretation. No p95, production capacity or fabricated latency threshold is claimed.

## Observed Phase A evidence and limits

Actual installed reading/graph consumers retain a Function Scan on the SECURITY DEFINER / empty-search-path normalizer. Device 1 materializes **129,600** normalized rows (72,000 metric + 28,800 legacy rows expanded twice), before outer date/metric/cursor filters. Reading/graph captures take roughly 741–762 ms in this synthetic warm PostgreSQL 17.6 CI run. Each records 9,653 temp blocks read and written from the **function tuplestore**, approximately 75.41 MiB per direction at 8 KiB blocks; block size itself was not recorded. Every explicit Sort node was in memory (108 top-N heapsorts, 18 quicksorts), not an external sort spill.

Extracted helper plans use existing device-prefix PK index/bitmap paths for smaller devices and sequential scans for larger shares. Those helper plans do not establish predicate pushdown through the installed function. Additional outer date/metric/identity indexes are not currently justified, and the installed materialization bottleneck remains unresolved. Chronology probes use existing event PKs in under 0.1 ms; feed pages are roughly 22–50 ms. Identical schedule indexes own PRIMARY KEY/UNIQUE constraints and the duplicate unique index supports an FK: **drop neither**.

These are warm synthetic CI observations, not shared Supabase PG17.11, native/phone or production measurements. Owner-context plans bypass caller RLS and are **not authenticated alert-policy performance evidence**. Zero index candidates is an evidence-backed interim outcome, not self-approval of Task06 completion.

## Authenticated policy experiment

Only change `a.installation_id = auth.uid()` to `a.installation_id = (SELECT auth.uid())` in `alert_events_active_member_select`. Keep SELECT/authenticated/permissive, active membership, RLS, table/column/function ACLs, indexes, constraints, all installed function bodies and other policies identical. The pinned actual PG17 predecessor/candidate deparse is checked exactly; no broad SQL parser or helper redefinition is introduced.

The test-local coordinator and helpers are SECURITY INVOKER. It executes actual `SET LOCAL ROLE authenticated`, sets matching JWT `sub` and JSON-claims subject, and verifies current role, `auth.uid()`, both claim sources, row_security on/active, non-owner and no superuser/BYPASSRLS. Missing subject clears both sources; anon retains SELECT denial. Only temporary helper namespace/reference/clock SELECT permissions are added; no private production access grant.

For each A/B/A2 phase:

- Two authenticated queries, one warmup and three EXPLAIN repetitions each: device-1 latest alert page (50 event_id/raised_at rows), and full visible alert count as a policy-cost control, not an app count endpoint.
- Six access cases: activeA (1,440), activeB (720), unrelated device (0), revokedA (0 with prior device/cursor filters), missing subject (0), and anon (SQLSTATE42501, not a false zero-row read).
- Owner-independent expectations come from the fixed device-membership map and immutable owner-visible alert facts, not the RLS expression. Compare ordered **full visible-set and top-page fingerprints** to those expectations and across A/B/A2. Only hashes/counts are retained, not event sets. Revocation uses an exception subtransaction so the row and role/config changes roll back while the local result survives.
- Catalog/fixture fingerprints require exact state restoration, not row counts alone: policy qualifier, full policy attributes, schemas/table/column ACLs, RLS/index/FK/trigger definitions/dependencies, production function bodies/security/ACLs, roles/memberships and full fixture-row hashes. The candidate may differ only in the target qualifier. Savepoint rollback restores the exact original catalog before A2; final full rollback also removes the two Auth subjects/memberships.

Capture actual InitPlan/subplan loops, buffers and timing; **no particular InitPlan or speedup is assumed**. Compare B against **both A and A2**. If variation encompasses any timing change, report no demonstrated latency improvement. Even a direct-table RLS improvement would not establish a speedup for service-only SECURITY DEFINER app alert RPCs. Timing cannot excuse any access or restoration mismatch.

The six original baseline write captures are unchanged and **not repeated**: a SELECT-policy expression changes neither indexes nor the insert path. No candidate index exists, so there is no before/after index-write-overhead claim. No new write-benchmark framework, runtime extension, full consumer repeat or fixture-volume reduction.

## Bounds and artifacts

SQL workload deadline: 180 seconds, with 30-second fixture/setup statements and 12-second measured statements. Client deadline: 240 seconds; CI step: five minutes. Limits fail closed rather than silently extending the run. Each capture is capped at 256 KiB and the complete artifact at 16 MiB.

Only these reviewed files are uploaded as **`t06-query-phase-b`** (14 days), distinct from the saved Phase A artifact. Fixed matrix: **132 records = 101 plans + 31 facts** (original111 + 18 policy plans + 3 phase facts):

- `plans.json`: 5 helper plans, 72 consumer plans, 6 unchanged write plans, 18 authenticated policy plans;
- `facts.json`: settings, actual fixture counts/sizes, schedule index/dependency/constraint and baseline alert-policy catalogs, 24 smallest-device fingerprints, 3 policy-control phase facts (role/access/independent fingerprints/catalog/fixture checks), verified rollback marker;
- `manifest.json`: exact CI/checkout commit, 23 immutable migration SHA256s, instrumentation hashes, installed-body expectations and output hashes/sizes.

There are no raw readings, actual JWT claims, verifier/token values, SQL scripts, stderr, environment dumps or server logs in the upload list. Only the two fixed synthetic subject UUID literals are replaced with `subjectA`/`subjectB` in retained output, preserving plan structure/loops/buffers/timing and unrelated fixture IDs. These labels inside plan strings are descriptive, **not executable UUID SQL**. Inlined `auth.uid()` may display the exact quoted GUC names `'request.jwt.claim.sub'` / `'request.jwt.claims'`; validation permits only those fixed setting-name literals inside policy plans, not raw claim/context fields or extended names. Their retained plan text is unchanged. Manifest records the two-subject replacement; there is no general-purpose redactor. Output is accepted only after complete bounded records, matching repeated full-result fingerprints and final rollback proof. SQL/client failures expose only bounded SQLSTATE/fixed diagnostics. No artifact is uploaded on failure.

## Handoff gate

Offline runner tests prove registration, target guards, immutable-body extraction and bounded/redacted artifact handling; mocked transport plans are explicitly **not SQL evidence**. Parent must inspect the exact clean commit before CI. Phase A evidence above is observed, but the **new actual authenticated policy plans/access/restoration and runtime remain unverified** until parent runs and reviews the exact experiment commit in disposable CI. Mocked records prove transport/validation only. Parent supplies that artifact outside Git and decides whether any policy forward change or separate query-shape decision is justified. No automatic `01200` or 24-migration gate update.

Zero justified indexes and no schedule DROP are valid outcomes. The immutable chain currently defines only constraint-backed schedule indexes; historical shared advisor drift is not permission to remove a constraint. `20261114001200_backend_query_indexes.sql` remains reserved for a later evidence-backed forward change. Task 07 remains blocked.
