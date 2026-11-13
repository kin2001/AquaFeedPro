# Backend Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Repository execution instructions and the owner's chosen method take precedence; this header does not authorize dispatch.

**Goal:** Prepare AquaFeedPro's app and Supabase for honest, configurable monitoring of five feeders, reliable change delivery and background alerts, and future Philippine-day history, while preserving feeding safety and existing data.

**Architecture:** Keep existing app/API/database layers. Add capability-gated independent metric observations and current pointers alongside legacy telemetry, evolve configuration with explicit acknowledgment, and use private resource-change hints followed by authorized reads. Keep event time, capture time, receipt time and device contact distinct; retain all historical and feeding evidence.

**Tech Stack:** Existing Expo SDK 58, React Native, TypeScript, Expo Router, Supabase JS, PostgreSQL 17, Deno Edge Functions, Python simulator, existing Node/SQL checks and GitHub Actions. Do not add a broker or app dependency by default.

**Spec:** [Approved backend improvement design](../specs/2026-11-13-backend-improvement-design.md). Read both documents and the approved Review 02 before implementation.

## Execution authorization and tracker

The owner subsequently authorized local implementation in the orchestrator conversation on 2026-11-13. This supersedes the historical planning-only statements below for local implementation only; release, deployment, hardware operations and merges remain separately authorized.

- Subsequent owner instruction permits the existing logged-in Supabase project as a prelaunch development target with migration recovery documentation. This is not permission to run destructive/rollback/concurrency suites there. Before shared writes, verify target, exact reviewed migration set, drift and backup/recovery prerequisites. See [migration safety and recovery](../../operations/backend-migrations.md). No backend-improvement shared mutation has been performed at this update.
- Integration branch / task PR base: `feat/backend-improvement`, based on `main` at `47388fcf741d492bde8ba49ffc15d65c8b5040cb`.
- Integration worktree: `D:/thesis commision/Automated Fish Feeding System/AquaFeedPro-backend-improvement`.
- Parent integration PR [#79](https://github.com/kin2001/AquaFeedPro/pull/79) is OPEN as DRAFT from `feat/backend-improvement` to `main`; keep it draft and do not merge.
- Task branches/worktrees are separate sibling checkouts; all task PRs target `feat/backend-improvement`, never `main`. A final PR to `main` waits for completion and owner satisfaction.
- Orchestrator personally reviews exact diffs and critical checks. Interactive Pi workers must be visible in Herdr's Agents section and named tabs, with one writer per task worktree.
- Complex work uses the orchestrator's actual model (`openai/gpt-6.1-sol` at setup); lighter work uses Luna with max thinking (available catalog: `openai/gpt-6-luna`, thinking `max`). Record actual settings at dispatch; do not silently substitute unavailable models.
- Run independent ready tasks concurrently only after prerequisite review/integration and explicit disjoint ownership. Initially only T01 is ready; T09 may run alongside T03 after T02 with shared files/resources split.
- Coordination/session/evidence records: sibling directory `backend-improvement-coordination/`, outside product commits. Task checkboxes change only with reviewed evidence; merge, cleanup and physical acceptance are separate states.
- Subsequent owner validation revision: use the existing Supabase development project for approved shared-safe read-only verification; do not run fresh-cluster bootstrap or fixed-identity rollback suites against shared data. T01 PR #78's disposable CI applied all 19 immutable migrations and passed all 10 existing plain-SQL suites. T02 PR #80's disposable CI applied 20 migrations, passed all 10 SQL suites, observed the old 40P01 deadlock and verified forward concurrency, safety and transaction cleanup. This does not establish shared-project drift/recovery or native/hardware acceptance. Any later shared mutation/test requires a reviewed explicit resource/data-safety packet. This revises environment selection, not recovery or feeding safety guarantees.
- Fresh CLI observations: explicit target `giilhohmrytpgyeyysir` accepts Management API SQL reads; PostgreSQL 17.11, 18 applied migrations through `20261016140000`, two historical timestamp differences, local November 3 migration absent. Backup API returned no entries and PITR false; other backup/restore availability remains unverified. No application schema/data writes performed.
- Owner approved stronger CI/PR gates. T01 includes stable `mobile`, `contracts`, `backend-baseline`, `simulator` jobs, PR triggers and pushes to `feat/backend-improvement`, disposable DB testing and a PR evidence template. Later tasks add their relevant regression checks. Exact diff review by the orchestrator precedes PR creation; passing remote checks precede merge eligibility, not merge authorization.
- GitHub ruleset [Backend improvement PR quality gate](https://github.com/kin2001/AquaFeedPro/rules/27189036) was created and read back as active on 2026-11-13 for exactly `refs/heads/feat/backend-improvement`: PR-only updates, resolved conversations, no force-push/deletion or configured bypass actors, and the four required GitHub Actions checks with strict up-to-date policy. No GitHub approval count is required (same-account workflow); orchestrator review remains documented separately. Initial branch creation is exempt from required checks only to bootstrap the integration branch. T01 PR #78's four required jobs passed on reviewed head `eff07da9815d6efdec01de98bec8690ff860acde` and updated head `ed14b800fd556963f771f892c8b360d7a56b8df2`; future PRs still require their own successful checks.

| Task | Status | PR / reviewed commit / merge | Remaining gates |
|---|---|---|---|
| T01 | MERGED — code baseline accepted; cleanup BLOCKED only on removing the empty target root (Git registration absent; contents removed, parent confirms root remains locked) | [PR #78](https://github.com/kin2001/AquaFeedPro/pull/78); reviewed `eff07da9815d6efdec01de98bec8690ff860acde`; merge `30bb2061b014aca095a6bdaa832b207dd745f5d5` on 2026-11-13 | CI runs `43410377668` (reviewed head) and `43411607788` (updated PR head), all four jobs PASS. Shared migration drift/recovery and native/hardware acceptance remain unverified |
| T02 | MERGED — code baseline accepted; exact T02 worktree removed and registration absent | [PR #80](https://github.com/kin2001/AquaFeedPro/pull/80); reviewed `60f89379316a2bf513f80b776a52b8ebfe409f1d`; merge `28a6610d66213d70d4e6bfeb65da34d5e6114b94` on 2026-11-13 | CI run `43420772983`: all four jobs PASS; 20 migrations, 10 SQL suites, observed OLD `40P01` and forward concurrency/safety/no-open-transaction checks PASS. Shared migration drift/recovery, privileged direct-DML ordering boundary, and native/hardware acceptance remain separate gaps |
| T03 | In progress — live worker `t10n`, branch `feat/backend-t03-contracts`, base `28a6610d66213d70d4e6bfeb65da34d5e6114b94`; no completion report | — | Implementation/review pending; contract compatibility |
| T04 | Waiting for T03 integration | — | Metric safety/access/replay |
| T05 | Waiting for T04 | — | Chronology and graph/history |
| T06 | Waiting for T05 | — | Measured plans/access |
| T07 | Waiting for T06 | — | Settings ACK and independent display |
| T08 | Waiting for T07 | — | Realtime lifecycle/revocation |
| T09 | In progress — live worker `t10p`, branch `feat/backend-t09-push`, base `28a6610d66213d70d4e6bfeb65da34d5e6114b94`; no completion report | — | Implementation/review pending; push checks; physical Android/iOS remain separate |
| T10 | Waiting for predecessors | — | Read-only drift/recovery readiness |
| T11 | Waiting for predecessors | — | Combined acceptance |
| T12 | Not authorized | — | Explicit release authorization and recovery proof |

## Global Constraints

- Planning approval only. Do not execute these checkboxes until separately authorized. Do not merge, deploy, actuate, modify calibration, upgrade plans or delete data from this approval.
- Five feeders; viewer count remains unspecified. Test multiple stated viewer scenarios, not an invented customer count.
- Interval allowlist is exactly `[15,30,60,3600,7200,14400,28800]` seconds.
- Philippine display/schedules/date filters: `Asia/Manila`; database/network timestamps: UTC instants with explicit offsets.
- Retention is unchanged. No automatic deletion, 30-day cutoff, rollup replacement, partition expiration or removal of idempotency/feeding evidence.
- Hardware developer owns acquisition, physical intervals and sensor noise/settling. Simulator/contract work here supplies a handoff, not a real Pi driver.
- Preserve active access, two sequential nozzles, exclusive shared inventory, measured/requested separation, idempotency and unknown-result lockout.
- Keep desired configuration separate from device-applied configuration. No capability flag is enabled for real hardware without verified support.
- No new daily-history browser UI, global timezone feature, account roles, automatic oxygen intervention, broker or sharding.
- Test data only in an isolated database; no rollback suites or intentional deadlocks on the live linked project.
- Respect current AGENTS.md and workflow at execution time. Premium task-pack branch rules are not automatically this backend project's target: record the chosen integration branch before code starts. Existing Herdr/one-writer requirements apply where instructed; do not dispatch from historical premium authorization.

## Review Focus

1. An update arriving between subscription establishment and initial fetch must not be lost — Task 8 tests dirty-follow-up and revision ordering.
2. An 8-hour oxygen interval must not bypass fresh-stock requirements for manual feeding — Tasks 4 and 7 test separate metric ages and unchanged feed admission.
3. A revoked installation must not retain protected data through an existing socket — Task 8 tests minimal hints, read denial, revocation cleanup and cached-state removal.
4. A delayed run with uncertain clock must not gain a fictional execution time — Task 5 tests null chronology and labeled receipt fallback.
5. New configuration fields must not make an old Pi silently ignore reporting or schedule targets — Tasks 3 and 7 test strict negotiation, unsupported capability and old-format fixtures.

## Baseline, file map and execution rules

Baseline inspected: repository root `D:/thesis commision/Automated Fish Feeding System/AquaFeedPro`, clean `main` at `f213e49`. Recheck at execution; preserve unrelated changes. The CLI audit snapshot is in the parent workspace `.lavish/live-*-evidence.json`; it contains observations, not reusable credentials. No new live reads are needed merely to execute local coding tasks; refresh exact drift immediately before release.

| Area | Existing owners | Planned additions |
|---|---|---|
| Wire contracts | `contracts/schemas/v2.schema.json`, `openapi.yaml`, fixtures/manifest, CHANGELOG | 2.8.0 fixtures and negotiated DTOs; preserve v1 and legacy v2 fixtures |
| Device validation | `supabase/functions/device-api/index.ts`, `_shared/telemetry.ts`, `_shared/device-access.ts` | negotiated independent-observation branch |
| Database | immutable `supabase/migrations/` | new `backend_*` forward migrations; never edit applied migration bodies |
| Database tests | `supabase/tests/*.sql` | concurrency harness, independent telemetry/history/realtime checks |
| Mobile data | `mobile/src/lib/monitoring.ts`, `schedules.ts`, `manual-feed.ts`, `device-changes.ts`, `device-access.tsx`, `feeder-settings.tsx` | `monitoring-time.ts`, `device-update-state.ts` when used by multiple callers |
| UI | Home/Device/History tabs, `settings/[field].tsx`, `history/[runId].tsx` | interval setting within existing settings flow; no fifth tab |
| Push | `_shared/push-sender.ts`, `push-sender/index.ts`, notification-controller, alerts | operations runbook; reuse queue |
| Simulator/handoff | `supabase/scripts/art31_simulator.py`, hardware-handoff docs | synthetic negotiated timestamps/ack fixtures, no GPIO |
| Verification | `.github/workflows/ci.yml`, existing Node/Python validators | isolated SQL runner and request-budget scenarios |

All paths below are repository-relative. Planned files are **not yet present**. New migration timestamps below reserve a proposed order; rebase them above the actual execution head before merging. Every task ends in a focused commit after its checks; stage only that task's files. No commit is made merely by writing this plan.

### Technical decisions for implementers (proposed by this plan)

These resolve engineering details left open in Review 02; they are not claims about current behavior.

**Compatibility:** keep protocol major 2 and record contract release 2.8.0. Use `X-Contract-Version: 2.8.0` on new app requests; absent header selects existing response shapes. New device support requires profile capability `independent_telemetry_v1: true`. Use optional sync envelope `metric_telemetry` only on that capability; reject it for older profiles. Do not mix the new envelope with non-null legacy `latest_sample` or nonempty legacy `backlog_samples`. Older devices continue legacy sync unchanged. New settings are disabled for incapable devices. Old app writes to a configuration already containing new fields return an explicit upgrade-required conflict; they cannot overwrite or strip fields. The user must never lose existing schedule targets through down-conversion.

**Independent data:** add `device_metric_observations` alongside `device_telemetry`; do not copy/backfill or delete historical rows. Primary key `(device_id, metric, boot_id, sample_sequence)`; metric is `do` or `feed`. Fields: `measured_at`, `captured_at`, `observed_at`, `time_basis`, `time_quality`, `quality`, `do_mg_l`, `feed_remaining_g`, `feed_percent`, `calibration_revision`, `received_at`. DO and stock values are mutually exclusive by metric; quality/null/capacity checks retain current semantics. Canonical observed_at/time_basis are assigned once using the Time rule below. New records use source-qualified identity `metric:{metric}:{boot_id}:{sequence}`; legacy compatibility identities use `legacy:{metric}:{boot_id}:{sequence}`. Original stock inputs remain immutable for replay checks. Add `device_metric_current` with `(device_id,metric)` key and a constrained observation pointer plus monotonic `live_sequence`. Legacy and negotiated current data are never compared merely by client wall-clock time.

**Wire observation:** `MetricObservation = {metric, boot_id, sequence, measured_at, captured_at, time_quality, quality, do_mg_l, feed_remaining_g, feed_percent, calibration_revision}`. All keys required, inapplicable values null. `metric_telemetry = {live:{do: MetricObservation|null, feed: MetricObservation|null}, backlog: MetricObservation[]}`; total observations <=100, within existing 262144-byte sync limit. A live observation's sequence equals enclosing persistent `live_sequence`; live boot equals enclosing boot. Backlog entries never advance a current pointer. Error/unavailable observations advance their metric's current state honestly; an omitted metric leaves its pointer alone. Same identity/different content conflicts; replaying a historical identity as live does not promote it.

**Reads:** new opt-in `/devices/{id}/monitoring/metrics` returns `MetricSnapshot {request_id,device_id,server_time,contact,configuration,resources:{do,feed},revisions}`. Each resource independently returns nullable latest observation, `time_basis: measured|captured|unknown`, actual age and quality. Old `/monitoring` response remains legacy-shaped for old clients; do not combine independently aged values under its shared timestamp. New app falls back to the legacy endpoint only for devices without the capability, not on arbitrary errors.

**Time:** `observed_at = measured_at` only for reliable nonfuture source time; otherwise use trustworthy `captured_at`, labeled captured; otherwise null. Preserve originals. Unknown clock time cannot admit manual feed as fresh inventory. The old <=30-second stock safety requirement remains unchanged. For DO, show age and `received_at` separately; neither elapsed reporting period nor Pi contact changes measurement age. `report_overdue = now > last_received_live_do_at + applied_interval + max(30s,10% of interval)`. This is a proposed grace policy for reports, not meter freshness or a safety guarantee; test it and surface for owner review in Task 7.

**Realtime:** private topic `device:{uuid}:updates`; compact payload `{device_id, resources:[do|feed|history|configuration|feeding|contact|alerts], revisions:{...}}`, no readings, tokens or user identifiers. Add `device_resource_versions(device_id uuid primary key, revisions jsonb not null)` with allowlisted bigint counters, paired-device SELECT-only RLS and service-only mutations. Persistent per-device resource revisions increment in the same transaction as accepted changes. Actual selected-device reads remain protected. A private-channel join cache is not immediate revocation: use minimal hints, deny revoked reads, and explicit revocation cleanup; no measurement payload on the socket. Coalesce one hint for a sync batch, not one per backlog row; do not emit history changes for pure replay or all-dashboard hints on every contact.

**Client cadence:** one selected-device subscription owned by shared provider, no polling based on reporting interval. Coalesce hints for 250ms; exactly one request/resource in flight with dirty-after-fetch flag. Healthy active-screen reconciliation every 300s with +/-10% jitter. Reconnect retry delays 1,2,4,8,16,30s with jitter; degraded read fallback 30,60,120,300s. Resume/selection/rejoin triggers snapshot. No background JS socket guarantee; background alerts use push. Values are engineering defaults, tested with fake clocks, not a user latency promise.

**Settings:** `oxygen_report_interval_seconds` is nullable until explicitly configured and capability supported; never fabricate a device-applied default. New selection initially suggests 30s, but does not write on mount. Edits reuse expected configuration revision and preserve unrelated schedules/limits. Timeout means pending, not rollback or a second desired revision. Pi acknowledgment must echo the revision and exact supported value.

**Graph:** negotiated `/devices/{id}/monitoring/do` reads the same normalized DO observations as daily history, retains the existing 1h/6h/24h windows and last-point-per-bucket semantics, and returns capability-appropriate source/time labels. Old requests retain the legacy query/shape. Do not leave the existing Home graph reading only the old table once new metric ingestion is enabled. This work does not introduce min/max rollups.

**History:** a negotiated reading API `/devices/{id}/monitoring/readings?date=YYYY-MM-DD&metric=all|do|feed&cursor=...` returns <=50 observations and opaque next cursor, ordered by `(observed_at DESC, stable_identity DESC)` within Philippine-day UTC bounds. Include legacy rows through a compatibility read; legacy combined samples can yield two metric observations without changing originals, using deterministic source-qualified identities. Time-unknown records use explicit `time=unknown` query instead of a fabricated date. Stored timestamps alone do not establish measurement authenticity. Feed history adds `occurred_at`, `time_basis`, `received_at`; never rewrite `created_at` or invent completed times for queued/rejected/unknown feeds.

## Dependency graph and task packets

`T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T07 -> T08 -> T09 -> T10 -> T11 -> T12` is the safe integration order. Each task is independently reviewable. T09 push work may proceed after T02 on a separate writer only if shared-file ownership is explicitly split; do not parallelize schema/contract edits. T12 is a separately authorized release gate, not automatic execution.

### Task 1: Make the existing checks reliable and reproducible (F-02)

**Files:** modify `mobile/scripts/check-manual-feed.mjs`, `supabase/scripts/art31_simulator.py`, `.github/workflows/ci.yml`; create `supabase/scripts/check-backend-baseline.mjs` and `supabase/tests/BACKEND_TESTING.md`.

**Interfaces:** runner `runSqlSuites({databaseUrl,psqlPath,suites}): Promise<void>` accepts only explicitly isolated connection, exits nonzero on first SQL failure and never logs credentials. No default cloud link. Existing rollback SQL remains plain psql, not silently converted to pgTAP.

- [x] Add `manual_feed_mock_supports_schedule_editor_theme`: assert Colors.light is present; retain subsequent confirmation/recovery assertions.
- [x] Reproduce `--self-test-art33` and instrument only sanitized simulated clock/occurrence facts. Add `repeated_hour_executes_once` with injected fixed clock and assert one actuation, one scheduled occurrence, retained outbox identities. Determine root cause before changing production logic; close SQLite handles in finally so cleanup does not hide the first failure.
- [x] Run the failing checks, observe the expected specific failures, then fix the mock and evidenced simulator cause without skipping assertions.
- [x] Add isolated SQL runner, temporary PostgreSQL/Supabase test service setup and CI step for migrations+existing suites, including service/private/auth schema prerequisites. Do not assume a bare postgres container supplies Supabase roles/functions.
- [x] Verify from `mobile`: `npm.cmd run check:manual-feed`; from repo: `python supabase/scripts/art31_simulator.py --self-test-art33` and `node supabase/scripts/check-backend-baseline.mjs --database-url-env LOCAL_TEST_DATABASE_URL`. Expected: all suites pass; a deliberately broken isolated assertion makes runner fail. Then commit scoped files.

### Task 2: Enforce consistent device row-lock order (F-01)

**Files:** create `supabase/migrations/20261114000100_backend_lock_order.sql`, `supabase/tests/backend_lock_order.mjs`; inspect all functions/triggers touching devices/state/sequences/access/credentials, including deployed alert triggers; extend baseline runner.

**Interfaces:** preserve existing RPC signatures; lock order is credentials/access verification followed by `devices`, `device_state`, sequences/steps in stable order. Where existing callers hold access locks first, reconcile the complete graph rather than inserting an incompatible order. Parent must review the final lock graph.

- [x] Add a two-connection test that overlaps telemetry's former state-first path with manual admission/reconciliation, using barriers and per-connection lock/statement timeouts. Assert both complete or return documented business rejection, not 40P01; retries do not insert duplicate sequences.
- [x] Demonstrate failure on the old function definitions in isolation; never synthesize a live feed.
- [x] Implement forward function replacements with consistent order across nested callees/trigger paths; preserve transaction/idempotency/access checks. Do not add advisory locks merely to mask the graph.
- [x] Run `node supabase/tests/backend_lock_order.mjs` with explicit disposable database URL plus existing art31/art33/art95 suites; hosted CI run `43420772983` passed the lock-order regression and acceptance checks without leaked transactions, duplicate commands or safety-state regression. Commit.

### Task 3: Freeze the independent-monitoring contract and compatibility (D-03–D-11)

**Files:** modify `contracts/schemas/v2.schema.json`, `contracts/openapi.yaml`, `contracts/fixtures/manifest.json`, `contracts/CHANGELOG.md`; create fixtures under `contracts/fixtures/examples/v2/`; modify shared validators and simulator only for negotiated fixtures at this step.

**Interfaces:** define the exact 2.8.0 observation/envelope/read/settings DTOs in Technical decisions; capability `independent_telemetry_v1`; header `X-Contract-Version`. Add `validMetricObservation(value: unknown): boolean` in `_shared/telemetry.ts` and `validOxygenReportInterval(value: unknown): boolean` (reuse it server-side; mobile mirror has identical fixtures).

- [ ] Fixtures assert all seven interval values accepted and 0,14,31,negative,string,NaN rejected; missing keys, swapped metric/value, cached-time relabeling, >100 observations and mixed legacy/new payload rejected.
- [ ] Add valid unchanged-value/new-identity and explicit present-error observations; same numeric value is not deduplicated by value.
- [ ] Verify new fixtures fail old validators, then implement schema/runtime branches without altering the immutable v1 or existing v2 fixture meaning.
- [ ] Document old/new client-device matrix: old devices unchanged; incapable device interval edit denied; strict old apps cannot strip a new snapshot; new apps preserve old safety fields.
- [ ] Run from `contracts`: `npm.cmd run validate`, `python scripts/validate.py`; run focused shared-validator checks. Expected same acceptance in Python/TypeScript/runtime. Commit.

### Task 4: Persist independent observations and current state (F-01; D-05–D-09)

**Files:** create migration `20261114000200_backend_metric_observations.sql`, `supabase/tests/backend_metric_observations.sql`; modify `device-api/index.ts`, `_shared/telemetry.ts`, `supabase/database.types.ts`, simulator and baseline runner.

**Interfaces:** service-only `backend_sync_metrics(p_device_id uuid,p_device_verifier_hex text,p_boot_id uuid,p_live_sequence bigint,p_metric_telemetry jsonb) returns jsonb` returns immutable ACK identities plus resource revisions. Schema/current pointers as defined above. Route validation occurs before RPC; RPC repeats trust-boundary checks.

- [ ] SQL assertions: replay adds no rows/revisions; content change conflicts; backlog after live does not regress; boot counter reset does not promote; one invalid batch rolls back; omitted metric leaves pointer; explicit error clears valid display for that metric; overcapacity stock is error with original inputs retained.
- [ ] Add test for fresh oxygen plus stale stock: manual admission denied. Feed admission must use the correct authoritative current stock for the capable device, preserving <=30-second safety independently of reporting interval. Define `private.backend_current_metric(p_device_id uuid,p_metric text) returns jsonb` as the canonical capability-aware current read shared by new snapshots, feed admission and alerts; do not leave those callers on the legacy stock pointer.
- [ ] Run red tests, implement tables/FKs/RLS/client SELECT-only grants and service-only RPC with Task 2 lock order, then route the capability-gated branch. Update server threshold-alert evaluation to consume actual new metric pointers, evaluate each metric only when it advances with trustworthy fresh observations, preserve crossing deduplication and existing push enqueue triggers, and avoid rereading stale cached DO on a stock-only event. Add alert SQL tests for new-format crossing, sustained outside, recovery, backlog, error quality and replay. Keep device contact and telemetry atomic within this RPC; whole HTTP sync remains multi-RPC and replay-safe.
- [ ] Legacy data stays untouched and old device ingestion remains supported. New current stock is authoritative after capability switch; old legacy pointer cannot bypass an unavailable new stock reading.
- [ ] Run `psql "$env:LOCAL_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/backend_metric_observations.sql`, legacy art27/art31/art33 tests and simulator telemetry self-checks. Expected rollback suites leave no rows. Generate public types from isolated schema, never hand-invent private credentials. Commit.

### Task 5: Add Philippine-day readings and correct feed chronology (F-03)

**Files:** create `20261114000300_backend_history_time.sql`, `supabase/tests/backend_history_time.sql`; modify `app-api/index.ts`, `mobile/src/lib/manual-feed.ts`, `mobile/src/app/(tabs)/history.tsx`, `mobile/src/app/history/[runId].tsx`; create `mobile/src/lib/monitoring-time.ts` and `mobile/scripts/check-monitoring-time.mjs`.

**Interfaces:** `philippineDayBounds(date: string): {startUtc:string,endUtc:string}` rejects invalid dates; `formatPhilippineTime(instant:string): string` fixes zone. Service-only `backend_metric_history(p_device_id,p_installation_id,p_date,p_metric,p_cursor_time,p_cursor_identity,p_time_mode)`; `readMetricHistory(installationId,deviceId,filters): Promise<MetricHistoryPage>` in monitoring.ts. Feed DTO adds occurred_at/time_basis/received_at in negotiated responses; old endpoint response unchanged.

- [ ] Assert day `2026-11-13` => start `2026-11-12T16:00:00Z`, end `2026-11-13T16:00:00Z`; exclusive end; leap-day and invalid-calendar cases; phone timezone does not affect output.
- [ ] Test 2 PM event received 2:07 belongs to 2 PM; previous-day late upload remains previous day; uncertain execution has null occurred_at, visible receipt fallback; scheduled due_at is never substituted as actual execution.
- [ ] Specify/feed test canonical time: earliest trustworthy running event is execution start; trustworthy completed-only event is labeled completion; queued/rejected/not-started has no execution time. Date-mode receipt fallback is explicit and labeled. Store original facts, not rewritten event payloads.
- [ ] Test 51 tied-time records => first 50 plus stable next cursor; unrelated/revoked device denied; cursor bound to device/date/metric/mode; invalid cursor rejected; delayed inserts require refresh, not guaranteed frozen pagination snapshot.
- [ ] Implement the negotiated graph over the same normalized observations and verify a new-format-only DO reading appears in Home graph data. Implement compatible normalized read over legacy and new records; source-qualified identity prevents duplicate/colliding cursors. Unknown-time query is separate; bound count and range, preserve unknowns.
- [ ] Run new SQL and Node time checks, existing history API mocks and manual parser checks. No new daily-browser screen. Commit.

### Task 6: Add only justified indexes and repair policy overhead (F-06/F-09)

**Files:** create `20261114000400_backend_query_indexes.sql`, `supabase/tests/backend_query_access.sql`; create `supabase/tests/backend_query_plans.sql`; update isolated runner.

**Interfaces:** no API changes. Candidate indexes: metric observations `(device_id,metric,observed_at DESC,stable identity)` via materialized canonical timestamp or matching query expression; feed history index matches Task 5 canonical chronology; legacy received-at `(device_id,received_at)` only if plan benefits; active credential verifier lookup only if measured. Task 4 defines stored observed_at; Task 5 defines the normalized source-qualified identity and legacy query used here. Index expressions must match that query, rather than reference a nonexistent stable_identity column.

- [ ] Capture representative EXPLAIN (ANALYZE,BUFFERS) on isolated five-device dataset with accumulated histories; never call mutating history/reconciliation functions for a supposedly read-only benchmark.
- [ ] Add assertions that unique/FK constraints survive cleanup, active member still reads, unrelated/revoked/anon cannot, and alert policy has unchanged semantics.
- [ ] Implement measured indexes, wrap auth.uid() in scalar SELECT in alert policy, and remove only the redundant non-constraint-owned schedule index after dependency inspection. Concurrent builds, if selected for release, use a separately documented nontransactional step and invalid-index recovery; not ordinary transactional SQL.
- [ ] Rerun access suites, compare query work and insertion overhead; record results rather than a hard fabricated latency threshold. Commit.

### Task 7: Deliver capability-gated reporting settings and independent display (D-03/D-04/D-07/D-12/D-13)

**Files:** create `20261114000500_backend_reporting_configuration.sql`, `supabase/tests/backend_reporting_configuration.sql`; modify app-api/device-api, contracts fixtures as required, `mobile/src/lib/{schedules,monitoring,feeder-settings,device-access}.tsx/ts` at their actual extensions (`schedules.ts`, `monitoring.ts`, `feeder-settings.tsx`, `device-access.tsx`), Home/Device tabs and `settings/[field].tsx`; extend monitoring/settings checks and simulator acknowledgment fixtures.

**Interfaces:** `ConfigurationValues.oxygen_report_interval_seconds: number|null` on negotiated variant; config update uses existing expected revision. Add settings field route value `reporting`. `readMetricSnapshot(...)` returns Task 3 shape. `metricReportState(now,lastReceivedAt,intervalSeconds)` returns `waiting|on_schedule|overdue|unknown`; stock safety remains independent.

- [ ] Tests cover all seven choices, no write on mount, offline pending, exact revision/value ACK, rejected value, same request replay, stale-edit conflict, unsupported capability and switching devices mid-request.
- [ ] Assert changing interval preserves schedule IDs/targets, timezone and oxygen/feed limits; older client cannot strip new fields; no invented applied value before ACK.
- [ ] Test long interval does not alter command/result sync advice or heartbeat; current unavailable stock blocks manual feeding even with recent DO.
- [ ] Implement existing settings controls and per-metric labels; provide last observed/captured and received time, configured cadence and independent contact. Keep low/high labels off stale/uncertain readings; never mark three-hour-old data fresh.
- [ ] Philippine schedule policy: new edits use Asia/Manila. Existing non-PH configs are not silently rewritten or reinterpreted as already applied; show actual applied zone and explicit migration-required state until an authorized PH config is acknowledged. Preserve actual instants in history. Test a non-PH existing configuration so the UI does not lie during transition.
- [ ] Run focused checks, `npm.cmd run format:check`, `npm.cmd run lint`, `npm.cmd run typecheck` from mobile. Fetch matching installed Expo docs before implementation touches an API. Commit.

### Task 8: Implement private change hints and targeted app recovery (F-05)

**Files:** create `20261114000600_backend_resource_updates.sql`, `supabase/tests/backend_realtime_access.sql`, `mobile/src/lib/device-update-state.ts`, `mobile/scripts/check-device-updates.mjs`; modify device-changes/provider, Home/settings/history/alerts data owners and isolated sender mocks.

**Interfaces:** `DeviceResource` union and payload from Technical decisions; `subscribeDeviceUpdates(name,deviceId,onHint,onReconnect): ()=>void`; pure reducer `reduceResourceUpdate(state,event)` preserves highest revision and dirty flags; consumers call existing authorized readers per affected resource. Do not use one channel/component.

- [ ] Red tests: change during first fetch => follow-up read; duplicated/lower revision ignored; error leaves invalidation dirty; device switch cancels old result; 100-row backlog => bounded coalesced hints/reads; heartbeat => no graph/config/history reload.
- [ ] Persist resource revisions, emit only after accepted state change and authorize `realtime.messages` topic membership. Use database Broadcast without a custom broker. Finalize a sync batch by publishing one combined hint from its accepted RPC; other accepted resource writes use their existing transaction boundary. Catch only Broadcast delivery errors in a nested exception block after persisting resource revisions, record a sanitized failure code/count, and let authoritative business validation errors still abort normally. A transient publish error must not invent successful app synchronization or corrupt committed feed evidence: exercise failure in isolation and verify snapshot/reconciliation recovers. No new outbox is needed for disposable UI hints; preserve the existing durable alert push queue.
- [ ] Test revoked channel explicitly. Broadcast only minimal hints; read denies current revoked membership; client clears cache/unsubscribes on revoke; rejoin authorization rejects; hints cannot include protected values. Do not claim join-time policy revokes an already-open socket automatically.
- [ ] Implement coalescing, dirty-follow-up, 300s +/-10% reconciliation, bounded reconnect/fallback schedules and active-screen lifecycle. Remove unconditional Home five-resource 15s polling only once equivalent recovery checks pass.
- [ ] Update visible graphs/history lazily; new history UI stays deferred. Avoid repeated background JS reconnect attempts; push is the background path.
- [ ] Run Node lifecycle tests and isolated RLS/authorization suite. Log only counts/revisions, no tokens or readings in public logs. Commit.

### Task 9: Complete token/worker readiness and phone acceptance (F-07)

**Files:** modify `mobile/src/lib/notification-controller.tsx`, `alerts.ts`, existing notification hooks/routes as needed, `supabase/functions/_shared/push-sender.ts`, `push-sender/index.ts`; extend `art96_push_sender_check.mjs`, `art96_push_delivery.sql`; create `docs/operations/push-readiness.md`.

**Interfaces:** reuse art96 registration/revocation/lease RPCs, current worker header `x-push-worker-secret`, event-ID notification payload and authorized tap lookup. No new delivery queue.

- [ ] Tests: denied/granted permission, token refresh/reinstall, revoked membership before send/tap, DeviceNotRegistered cleanup, timeout/429/5xx, lost persistence/ambiguous send, no duplicate resend after ticket receipt delay.
- [ ] Implement only demonstrated registration/lifecycle gaps; preserve existing lease bounds and final generation/access checks. Use focused existing mocked worker tests, not real sends during automated checks.
- [ ] Write operator procedure: inspect external invoker first; if absent, propose named once-per-minute Cron/pg_net call with secret in Vault; no secret literal in migration/runbook. No scheduler enabled during coding. Review target notification delay with owner before claiming an SLA.
- [ ] Document/test supported physical Android and iOS builds separately; credentials/build access and actual permission/display are acceptance gates. A simulator/mock or Expo ticket is insufficient. Unsupported platform remains explicitly unaccepted, not silently removed from scope.
- [ ] Run `node supabase/tests/art96_push_sender_check.mjs`, app route mocks and isolated delivery SQL; record outstanding phone tests. Commit.

### Task 10: Prepare verified release alignment and recovery (F-08/F-04)

**Files:** create `docs/operations/backend-release.md`, `docs/operations/backend-recovery.md`, `supabase/scripts/check-backend-release.mjs`; retain existing November 3 migration unchanged.

**Interfaces:** read-only release checker accepts explicit `--project-ref` and expected versions, reports PASS/DRIFT/UNVERIFIED without applying anything. Allowlist `giilhohmrytpgyeyysir` only when this project is the authorized release target; never infer another project/profile from defaults.

- [ ] Test mismatched migration IDs versus names, missing new migration, deployed shared-file drift, wrong project ref and unavailable permissions; checker must not repair history or invoke push/deploy.
- [ ] Document exact observed initial timestamp differences and compare historical SQL contents before any repair proposal. Keep history changes separately reviewed; do not blindly align names or run db push.
- [ ] Specify forward release sequence: tested DB capability support first, API compatibility, new app, simulator/verified real capability enrollment last. Defer real enrollment until hardware developer demonstrates ACK/schema support.
- [ ] Recovery runbook identifies actual existing backup location/ownership/access without exposing secrets. If absent, record blocking recovery gap and proposed encrypted off-site/managed option; no external upload or paid upgrade implied. Exercise restore only to isolated target, preserving source.
- [ ] Define rollback as stop enrollment/disable new path, keep additive tables and evidence, revert compatible app/API only; no down migration deleting observations. Uncertain feeds remain locked out after restore until physical reconciliation.
- [ ] Verify no task grants DELETE/TRUNCATE to clients or creates retention/cleanup jobs. Commit runbooks/checker; production acceptance remains blocked until real recoverability is observed.

### Task 11: Combine the five-feeder acceptance evidence

**Files:** create `supabase/tests/backend_five_feeder_load.mjs`, `mobile/scripts/check-backend-update-budget.mjs`, `docs/operations/backend-acceptance.md`; update baseline/CI runner with applicable local tests.

**Interfaces:** explicit local synthetic database only; viewer scenarios `1,5,20` are test inputs, not user estimates. Use fixture upload intervals, late batches, faults, reconnects and settings edits; no GPIO/network pushes.

- [ ] Assert unchanged healthy client does no five-resource 15s poll; one oxygen event causes <=1 initial in-flight snapshot fetch plus at most one dirty follow-up, without settings/history fetch unless invalidated and visible.
- [ ] Verify database counts/ACKs for all simulated devices and no cross-device cache leakage. Generate enough history for query plans; keep test setup isolated and disposable.
- [ ] Collect calls, query plans, DB execution, Broadcast message counts, connection count, lag and errors for stated viewer scenarios; compare baseline. No claim of production p95 from local mocks or a universal safe fleet size.
- [ ] Run all affected baseline suites plus app lint/type/format and both contract validators. Record exact commit, commands, failures and unverified gates. An existing unrelated failure is reported, not hidden by a green summary.
- [ ] Produce coverage matrix for D-01–D-16, F-01–F-09 and every edge case; mark F-04 intentionally deferred, history screen deferred and physical acceptance outstanding. Commit evidence documentation without tokens/sensitive readings.

### Task 12: Separately authorized release and observation gate

**Files:** update release/acceptance runbooks with actual evidence only. No release command is preapproved by this task list.

**Interfaces:** consumes reviewed exact head, immutable migration list, successful isolated checks, recovery proof and explicit owner release authorization.

- [ ] Present concrete release candidate, compatibility matrix, backup/restore evidence and remaining hardware/platform gaps for the owner's decision. Worktree/PR target is verified against current instructions; no automatic premium-branch merge.
- [ ] Once authorized, refresh project identity/schema/function versions and back up through approved procedure; stop if drift or restoration prerequisites fail.
- [ ] Apply reviewed forward migrations/deploy only to named target; verify classifier/trigger, effective grants, private topics, token registration and desired/applied behavior. Do not enable real actuator tests without separate authority.
- [ ] Enable verified compatible devices gradually; watch error/deadlock/queue/realtime/storage metrics and request budget. If degraded, stop enrollment and use nondestructive rollback, preserving new records.
- [ ] Record independently: code shipped, live database acceptance, phone delivery, restore acceptance and physical feeding acceptance. Do not collapse these into one production-ready claim.

## Coverage and task-splitting contract

| Requirement | Owning tasks | Evidence |
|---|---|---|
| All seven intervals, shared edits, requested/applied | 3,7 | fixture matrix, capability/conflict/ACK tests, settings flow |
| Independent metric time/quality and measured stock | 3,4,7 | replay/time/capacity/null tests and unchanged admission safety |
| Database-arrival updates and recovery | 8,11 | revisions, subscribe/fetch race, burst budget, revoke and reconnect |
| Philippine time and future daily data access | 5,7 | midnight/unknown-time/cursor and schedule-transition tests |
| F-01/F-02 | 1,2 | reproducible checks, real isolated concurrency |
| F-03/F-06/F-09 | 5,6 | chronology, EXPLAIN/access and constraint tests |
| F-04 retention unchanged | 4,10,11 | existing records retained; no deletion grants/jobs |
| F-05/F-07 | 8,9,11 | targeted reads, token/queue tests, actual phone gate |
| F-08 and recoverability | 10,12 | read-only drift report, authorized deployment and isolated restore |
| Hardware developer boundary | 3,4,7,12 | simulator fixtures and written handoff; real capability stays gated |
| Scope exclusions | All | no raw-packet mandate, summaries, new history screen, deletion, broker or role system |

Each later small task packet must carry: task ID, exact base/head and worktree, approved spec link, dependencies and interfaces above, owned files, red/green commands, acceptance assertions, rollback implications and explicit no-cloud/no-hardware boundary where applicable. Do not split off the tests/docs/error states required to make its own deliverable complete. A completed packet is reviewed before a dependent packet starts.

## Self-review and current status

This document specifies proposed engineering interfaces to make implementation reviewable; they are not existing exports or deployed tables. Paths/commands were checked against baseline where existing. New file names and RPCs are intentional planned additions. The implementation author must revisit line numbers after rebasing, not copy old offsets.

- Coverage: all D/F/edge requirements mapped; retention deferral and future UI stay explicit.
- Types: one allowlist, one negotiated observation shape, one event/time vocabulary; no mixed event time and receipt time.
- Review Focus cases each have an owning test task.
- Sequencing: incompatible wire/DB changes precede app activation; hardware enrollment and release remain separate.
- Plan checks performed now are document consistency checks only. None of the future tests, migrations, phone checks or release gates has been executed by writing this plan.

**Handoff:** owner reviews this detailed plan before implementation and before creating execution packets. No implementation has been authorized. Preserve existing repository execution constraints; choose/confirm the backend work's actual execution method and integration target at that handoff.
