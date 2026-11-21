# Backend acceptance for five feeders

Task 11 combines isolated database workload evidence, mobile request budgets, and the focused checks already carried by the backend integration branch. The workload represents five synthetic feeders and test scenarios of 1, 5, and 20 simulated viewers. These are scenario sizes. Production viewer count and capacity remain undetermined.

The candidate starts from the verified Task 10 merge, a84c29a. [Release alignment](backend-release.md) and [recovery](backend-recovery.md) record the separate shared-project gates.

## Reproduce locally

Run from the repository root. For SQL, provision a fresh, isolated, loopback PostgreSQL service with the database name aquafeed_backend_test. Set LOCAL_TEST_DATABASE_URL for that fixture, then run the baseline before the workload. Protect the disposable database from any real device, app, scheduler, or push-provider traffic.

```text
node supabase/scripts/check-backend-baseline.mjs --database-url-env LOCAL_TEST_DATABASE_URL
node supabase/tests/backend_five_feeder_load.mjs --database-url-env LOCAL_TEST_DATABASE_URL
node mobile/scripts/check-backend-update-budget.mjs
```

The database gate can use the existing GitHub Actions PostgreSQL service and bootstrap. See [Backend testing](../../supabase/tests/BACKEND_TESTING.md). Mobile budget tests use a controlled host and fake time. Inspect counts, paths and outcomes alongside the assertions. PostgreSQL query timing and mobile request counters describe this fixture and execution host.

## Mobile request budget

The [budget harness](../../mobile/scripts/check-backend-update-budget.mjs) executes the production provider, private Broadcast adapter, and Home reader effects with a simulated React host, clock, SDK channel, and data readers. Viewers select the five feeder IDs round-robin. Counts are calls to the app read boundary. The legacy idle control is the arithmetic cost of five reads every 15 seconds for 60 seconds, excluding startup.

| Simulated viewers | Peak selected channels | Healthy idle reads in 60 s | Legacy idle control | Healthy reconciliation reads | Visible oxygen snapshot + graph | Follow-up snapshot + graph after 100 hints |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 0 | 20 | 1 | 1 + 1 | 1 + 1 |
| 5 | 5 | 0 | 100 | 5 | 5 + 5 | 5 + 5 |
| 20 | 20 | 0 | 400 | 20 | 20 + 20 | 20 + 20 |

The first oxygen read began after 250 ms of simulated time. Startup and rejoin each made six reads per viewer, including reconciliation. Oxygen and the burst caused zero configuration, next-feed or feeding-history reads. Hidden owners read zero. Relevant configuration and feeding hints each caused two reads per visible viewer. Degraded recovery contained one injected failure and three total reads per viewer. No retired feeder result was published, and cleanup left no scheduled work.

## Disposable PostgreSQL workload

The [workload harness](../../supabase/tests/backend_five_feeder_load.mjs) used actual RPCs, 20 distinct synthetic viewer installations, and a single sequential PostgreSQL 17.11 session. Each scenario distributes its viewers over the five feeders and runs one eager refresh wave before one targeted oxygen snapshot wave. The fixed order can favor a warm cache. Wall time includes the local client. This comparison measures RPC counts and reports incidental timings.

| Logical viewers | Selected feeders | Physical sessions | Eager RPCs | Targeted RPCs | Eager wall ms | Targeted wall ms | Unexpected errors |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 1 | 5 | 1 | 12.834 | 1.179 | 0 |
| 5 | 5 | 1 | 25 | 5 | 57.159 | 5.660 | 0 |
| 20 | 5 | 1 | 100 | 20 | 182.092 | 22.774 | 0 |

The fixture run recorded 2,011 observation rows, 2,511 checked ACK identities including 500 replay ACKs, and 37 private publisher fixture rows. A 100-row backlog produced one hint, and replay added no observations. The five feeders used different approved intervals. A stale settings edit was refused, and an invalid apply report rolled back with no writes. A successful write survived an injected publisher failure and the next snapshot recovered it. A removed viewer lost access while a still-paired viewer retained access. The workload rolled back all of its fixtures.

The snapshot RPC returned one row in 0.535 ms of PostgreSQL execution. The representative history query returned 50 rows in 0.147 ms using an index scan on `device_metric_observations_pkey` with Sort and Limit. The fixture recorded 4,574.126 ms maximum receipt-minus-observation time for live samples. The minimum backlog receipt-minus-observation lag was about 2.33 million seconds because the fixture deliberately uses old source times. The mobile 250 ms value measures virtual provider scheduling. Production latency and concurrent viewer capacity remain unverified.

## Reviewed decisions

| Decision | Evidence and disposition |
| --- | --- |
| D-01 · Plan and authorization | Review 02 and the [implementation plan](../superpowers/plans/2026-11-13-backend-improvement.md) capture the order and acceptance boundaries. Task 12 still needs explicit release authorization. |
| D-02 · Five feeders | This workload covers five synthetic devices and 1, 5, and 20 viewers. Native socket capacity and production traffic are unverified. |
| D-03 · Seven interval choices | The [reporting checks](../../mobile/scripts/check-reporting.mjs) and [configuration SQL](../../supabase/tests/backend_reporting_configuration.sql) cover 15, 30, 60, 3,600, 7,200, 14,400, and 28,800 seconds. |
| D-04 · Desired versus applied | The configuration SQL, reporting route check, and reporting simulator check cover outstanding revision, validated ACK, retries, and mismatch. |
| D-05 · Real accepted readings | [Observation SQL](../../supabase/tests/backend_metric_observations.sql) and the metric route and simulator checks cover acceptance, quality, and stored identity. Physical meter packet and timing behavior needs hardware evidence. |
| D-06 · Cloud arrival and recovery | The [device update harness](../../mobile/scripts/check-device-updates.mjs), [connectivity harness](../../mobile/scripts/check-review-connectivity.mjs), and Task 11 budget exercise target, ordering, coalescing, and recovery. Live signed-JWT delivery is open. |
| D-07 · Reading age versus contact | The reporting harness, [Home reader checks](../../mobile/scripts/check-t08-dashboard.mjs), and observation SQL cover independent age, the 45-second contact deadline, and unchanged stock safety with long oxygen reporting intervals. |
| D-08 · Measured shared stock | Observation and manual-feed SQL and the manual-feed checks cover measured stock and safe admission. Physical weight accuracy is open. |
| D-09 · Stock change and periodic checks | The metric simulator checks cover synthetic feed/refill/reconnect observations. The hardware owner still needs to verify physical thresholds and settling behavior. |
| D-10 · Future daily history | [History SQL](../../supabase/tests/backend_history_time.sql), [history route checks](../../supabase/tests/backend_history_route_check.mjs), and query access cover protected, paged readings. The daily sensor-history screen is deferred. |
| D-11 · Late history versus current | Observation SQL, the atomic sync suite, and the five-feeder workload cover late data and replay. |
| D-12 · Philippine dates and UTC instants | History SQL, the monitoring-time harness, and reporting checks cover Manila day bounds, time labels, and supported settings timezone. The atomic suite separately verifies non-UTC caller behavior. |
| D-13 · Paired settings with conflict checks | Reporting configuration SQL and the reporting/access harnesses cover current membership, revision conflict, and guarded writes. |
| D-14 · Background push | [Push readiness](push-readiness.md) and [sender checks](../../supabase/tests/art96_push_sender_check.mjs) cover token and worker behavior in test. External invocation and physical Android and iOS acceptance are open. |
| D-15 · Correctness and measured optimization | Lock-order, release alignment, query plan, and request-budget checks supply bounded evidence for the existing stack. |
| D-16 · Retention untouched | Task 11 adds verification, with fixture data confined to disposable PostgreSQL and no repository migration or retention change. |

## Audit findings

| Finding | Evidence and disposition |
| --- | --- |
| F-01 · Lock order | [Lock-order harness](../../supabase/tests/backend_lock_order.mjs) and [atomic sync contention](../../supabase/tests/backend_device_sync_concurrency.mjs) exercise real overlapping transactions and stable identities. |
| F-02 · Meaningful test gates | Existing route, simulator, motion, contract, and disposable SQL suites remain in CI. The two Task 11 gates extend its scope. |
| F-03 · Trusted event chronology | History SQL/route and feeding/mobile tests cover UTC evidence, Manila bounds, and labeled unknown occurrence time. |
| F-04 · Retention | Intentionally deferred by owner. Records, duplicate-prevention evidence, and existing retention remain intact. |
| F-05 · Targeted Realtime | Task 8 provider and Task 11 request budgets cover authorized reads and bounded recovery in isolation. Native socket delivery still requires live acceptance. |
| F-06 · Query-led indexes | [Query access](../../supabase/tests/backend_query_access.sql), [query benchmark](../../supabase/tests/backend_query_benchmark.mjs), and the local workload record access and query-plan evidence. Production execution/scale is open. |
| F-07 · Push queue and worker | [Push regression](../../supabase/tests/backend_push_regression.mjs) and the sender/controller checks exercise bounded retries, revocation, and ambiguous-send protections. Provider and phone delivery are open. |
| F-08 · Release alignment | The read-only checker on Thesis dev found drift. The release and recovery runbooks record the isolated restore and explicit rollout gates. |
| F-09 · Policy and index overhead | Query access and the historical disposable benchmark controls cover candidate policy/index behavior. Production plans and workload remain unverified. |

## Review 02 edge cases

| Case | Evidence or boundary |
| --- | --- |
| Duplicate or reordered uploads | Observation and atomic sync suites verify idempotency, revision ordering, and no repeat feed from an uncertain outcome. |
| Late data across midnight | History/time checks verify the Manila day boundary and distinct receipt time. |
| Meter has no timestamp or repeats a cached packet | Contract and simulator checks retain capture/receipt labels and replay identity. Real meter behavior remains a hardware gate. |
| Oxygen and stock arrive separately | Independent observation and display checks keep metric timestamps and quality separate. |
| Eight-hour interval on a connected feeder | Reporting and stock safety checks keep contact, reading age, and admission separate. |
| Disconnect or missed hint | Device updates, connectivity, and budget tests cover snapshot reconciliation and bounded fallback. |
| Two installations edit settings | Reporting and access tests exercise current membership and expected revision conflicts. |
| Revocation with an open channel | Disposable SQL covers policy/read denial and the mobile harness covers stale result retirement. Live signed-JWT socket behavior remains open. |
| Backlog or event burst | Atomic SQL checks combined hints and replay. Mobile tests cover coalescing, dirty follow-up, and relevant visible reads. |
| Refill, loss, drift, or invalid weighing | Checks preserve measured values and invalid quality labels. Real thresholds and settling remain hardware work. |
| Unknown or partial feeding outcome | Lock-order and manual-feed checks preserve safe retry rules, sequential nozzles, and requested/measured distinction. Physical reconciliation remains a separate gate. |
| Missing expected scheduled report | Existing alerts cover reported outcomes. An absence-of-report watchdog remains separate. |
| Permission denied or provider unavailable | Sender/controller tests cover denial and bounded queue/receipt recovery. Physical delivery and provider acceptance are open. |
| Backup unavailable or restore differs from device journal | Production gate. A protected archive exists, and isolated recovery and journal reconciliation remain unverified. |
| Retention cutoff, archival partitions or summaries | Deferred. Retention and durable evidence remain unchanged. |
| New daily-history screen | The protected query path is exercised. The screen remains deferred. |
| Other schedule timezones | Worldwide schedule support stays deferred. Preserve existing compatibility and historical timestamps. |
| Broker, sharding or high-fleet partitioning | Deferred. Report observed five-feeder workload and refrain from projecting a capacity limit. |
| Account roles, billing or automated oxygen actions | Outside scope. Existing paired access and human notifications remain in place. |

## Live acceptance still open

- Thesis dev has migration and deployed Edge source drift. Its compatible isolated restore and separate rollout approvals remain open.
- Actual signed-JWT private Broadcast delivery, live recovery, background notifications, and physical Android and iOS acceptance remain open. The current app registration path supports Android.
- Physical calibration, meter cadence, stock accuracy and feeding operation remain with the hardware owner. The workload collects synthetic observations, queue outcomes and request counts only.

## Task 12 checkpoint

On November 21, 2026, all four CI jobs passed on the [Task 11 merge commit](https://github.com/kin2001/AquaFeedPro/actions/runs/44862137443). The [Task 12 preflight decision record](backend-release.md#task-12-preflight-decision-record) pins the SQL and Edge source manifests and records the refreshed development catalog.

| Acceptance outcome | Observed |
| --- | --- |
| Reviewed integration code and isolated checks | Merged and CI verified at `72fc198`. |
| Live database and private Realtime | Read-only preflight found drift. The atomic sync RPC and Task 8 private update policy are absent. |
| Physical phone delivery | Unverified. The existing app path supports Android registration. |
| Isolated restore | Unverified. An approved compatible target and operator are still required. |
| Physical feeder operation | Unverified. Hardware enrollment and operation require separate approval. |
