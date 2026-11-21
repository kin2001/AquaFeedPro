# Backend improvement design — approved direction

Approved by the owner through 17 Lavish responses on 2026-11-13. This authorizes a detailed implementation plan, not execution, migration, deployment, hardware operation, cleanup or paid services.

## Source and evidence

- Approved Review 02: `http://127.0.0.1:4387/session/dfb278a49b14c9d8`.
- Portable review source: sibling workspace `.lavish/backend-improvement-review-2026-11-13.html`.
- Feedback receipt: sibling workspace `.lavish/review02-feedback-received.txt`, entries UID 1–17. UID 16 requests a complete plan suitable for splitting into small tasks. UID 17 explicitly requests Superpowers writing-plans and records `implementation_authorized: false`.
- Source baseline: `main`, `f213e49`. Live CLI audit near 13:00 Asia/Manila on 2026-11-13 is historical evidence, not a current-state guarantee.
- Live snapshot: 3 simulator-marked profiles, 191,712 telemetry rows, 63 feed sequences; gaps in monitoring; 18 applied migrations through 20261016140000; missing local November 3 alert migration; zero push tokens/deliveries; PITR false and no returned backup entries. External scheduling and off-site backups unknown.

## Approved product requirements

1. Plan for five feeders; viewer count remains unspecified. Preserve Expo/React Native/TypeScript/Expo Router/Supabase and the existing four-page product.
2. Interval choices are exactly `[15,30,60,3600,7200,14400,28800]` seconds. Show desired and device-applied values separately; reject stale edits and unsupported device capability. Shared actively paired installations can edit; do not add user-role/account systems.
3. Hardware developer owns commercial Bluetooth DO meter acquisition and Pi timing/uploads. Backend/app show accepted stored observations; there is no requirement to capture every packet, produce min/max summaries or infer unseen spikes.
4. Live updates follow database arrival, not the upload timer: authorized private Broadcast hints, resource-specific reads, revision ordering, coalescing and reconnect/resume recovery. Keep a lightweight reconciliation fallback.
5. Independent oxygen and shared-container stock observation times/quality. Device contact is separate. Old measurements are not fresh merely because the interval is long. Delayed historical observations never replace newer eligible current state.
6. Stock is measured, not computed by subtracting requested doses. Support hardware-reported stock changes after feed/refill/loss/reconnect and periodic checks without mandating physical sampling thresholds here.
7. Prepare protected Philippine-day sensor-history queries and pagination. The new day-browser UI is deferred. Keep the existing feeding-history model but correct event-date semantics.
8. All app displays, schedule presentation and date filters use Asia/Manila. Store/transmit UTC instants. Trust meter time only when available/reliable; otherwise label Pi capture time or uncertain time. Preserve server receipt time separately.
9. Background push registration, worker invocation and delivery verification are in scope. Realtime foreground delivery is not background push. Physical-device and supported-platform checks remain separate gates.
10. Resolve lock order, failing tests, timestamp correctness and release drift first; then unnecessary requests, measured indexes and policy/index overhead.
11. Retention is unchanged. No automatic deletion, 30-day cutoff, rollup replacement, partition expiration or removal of idempotency/feeding evidence.
12. Preserve two sequential nozzles, exclusive shared weighing, dose validation, active access, durable identities, uncertain-result lockout, requested/measured distinction and maintenance recovery.

## All nine findings

| Finding | Approved direction |
|---|---|
| F-01 | Consistent row-lock ordering; real two-connection regression; no physical retry from transaction retry. |
| F-02 | Repair client mock, investigate schedule failure, run existing SQL suites in isolation and gate meaningful checks in CI. |
| F-03 | Trusted occurrence/execution time distinct from receipt; Philippine dates; no fabricated historical execution time. |
| F-04 | Deferred by owner: retain all existing records and do not create cleanup policy. Observe growth only. |
| F-05 | Private Broadcast + targeted reads, revisions and reconciliation; avoid full-dashboard reload per heartbeat or backlog row. |
| F-06 | Query-led indexes after canonical time/cursor design; verify plans; preserve constraints and choose safe index deployment. |
| F-07 | Reuse current push queue/worker; verify existing invoker before adding managed scheduling; test token/access/provider recovery. |
| F-08 | Reconcile local/remote migration history and deploy tested forward changes only after separate release authorization. |
| F-09 | Inspect duplicate-index dependencies; optimize alert auth policy without changing membership meaning. |

## Proposed engineering defaults, not promises

The plan may fix these as reviewable engineering choices: 30-second initial interval when a new capable device explicitly applies it; five-minute healthy Realtime reconciliation; bounded failure backoff/jitter; one-minute push-worker invocation. None proves device measurement cadence, safe oxygen thresholds, exact notification latency or maximum concurrent viewers.

Do not silently change existing device schedules/timezones or fabricate an applied interval on upgrade. Provide explicit migration/unsupported behavior. New storage, wire and revocation details must be specified by the plan and tested, not treated as already implemented.

## Scope and acceptance

No retention change; no new daily-history screen; no Pi driver/calibration/motor change; no new broker, sharding, billing, owner/operator role hierarchy or automatic oxygen intervention. Backup/isolated restore readiness is a production gate. Expected-occurrence watchdogs for never-reported feeds are separate scope; reported rejected/expired alerts do not prove universal missed-feed detection.

Acceptance requires isolated access/concurrency/time/replay tests, capability-gated compatibility, device-scoped UI lifecycle tests, representative five-feeder/viewer workloads, actual supported phone push checks and an isolated restore exercise. A simulator result is not physical safety acceptance.
