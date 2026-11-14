# T06 query baseline — Phase A only

Base: `b97472203af07404b523d40cfe3013f8b3205e3a`. This delivery is instrumentation, **not measured index selection**. No `01200` migration, new index, schedule DROP, policy rewrite or type change exists yet. Strict public generation remains 23 migrations / `01100`.

## Execution boundary

Only the parent may push the personally reviewed instrumentation commit and execute its hosted disposable CI. The worker does not run SQL locally or against Supabase. The existing PostgreSQL 17.6 CI service, loopback port 54322, database name, bootstrap database-OID provenance, migration-fixture flags, exact task push ref and explicit acknowledgment are all required. No installations, new job/dependency, credential fixtures/probes, shared SQL or hardware are needed.

`backend_query_access.sql` is the thirteenth rollback assertion suite. It exercises current active/unrelated/revoked/missing-subject/anonymous access for alerts and normalized observation/current/version tables, service-only read RPCs, inaccessible private T05 helpers, immutable facts and retained constraint-backed indexes/FKs. It does not claim that the later scalar-SELECT alert policy optimization is already installed. The predecessor access/safety suites remain registered unchanged.

## Synthetic workload

`backend_query_plans.sql` uses five fresh simulated device IDs, copying the canonical simulator profile without modifying its provisioning RPC's two-ID allowlist. No credential or Auth rows are needed for the benchmark. Fixture writes take the existing D -> S prefix before sequence/step/alert work. All real triggers and constraints remain enabled; deferred constraints are forced immediate before measurement.

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

All plans use ANALYZE/BUFFERS/WAL/SETTINGS/JSON; no forced seq-scan disabling, cache eviction, helper redefinition or candidate DDL. Helper physical scans and consumer plans are separate evidence; nested counters must not be summed as distinct physical I/O. Warm caches, savepoint-aborted physical tuples/index pages and shared CI compute limit paired latency interpretation. No p95, production capacity or fabricated latency threshold is claimed.

## Bounds and artifacts

SQL workload deadline: 180 seconds, with 30-second fixture/setup statements and 12-second measured statements. Client deadline: 240 seconds; CI step: five minutes. Limits fail closed rather than silently extending the run. Each capture is capped at 256 KiB and the complete artifact at 16 MiB.

Only these reviewed files are uploaded as `t06-query-baseline` (14 days):

- `plans.json`: 5 helper plans, 72 consumer plans, 6 write plans;
- `facts.json`: settings, actual fixture counts/sizes, schedule index/dependency/constraint and alert-policy catalogs, 24 smallest-device fingerprints, verified rollback marker;
- `manifest.json`: exact CI/checkout commit, 23 immutable migration SHA256s, instrumentation hashes, installed-body expectations and output hashes/sizes.

There are no raw readings, Auth subjects, verifier/token values, SQL scripts, stderr, environment dumps or server logs in the upload list. Output is accepted only after complete bounded records, matching repeated full-result fingerprints and final rollback proof. SQL/client failures expose only bounded SQLSTATE/fixed diagnostics. No artifact is uploaded on failure.

## Handoff gate

Offline runner tests prove registration, target guards, immutable-body extraction and bounded/redacted artifact handling; mocked transport plans are explicitly **not SQL evidence**. Parent must inspect the exact clean commit before CI. Actual plans/access/count/write results remain unverified until that run is reviewed. Parent then supplies the artifact outside Git; only observed plans may inform a separately approved candidate experiment or query-shape decision.

Zero justified indexes and no schedule DROP are valid outcomes. The immutable chain currently defines only constraint-backed schedule indexes; historical shared advisor drift is not permission to remove a constraint. `20261114001200_backend_query_indexes.sql` remains reserved for a later evidence-backed forward change. Task 07 remains blocked.
