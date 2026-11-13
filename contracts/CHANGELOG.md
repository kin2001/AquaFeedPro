# Changelog

## 2.8.0 — 2026-11-13 (contract freeze; activation is separate)

- Protocol major stays 2. App requests explicitly opt in with `X-Contract-Version: 2.8.0`; absent header keeps existing responses, unknown versions fail rather than silently downgrading. OpenAPI `x-contract-version-2.8.0` gives negotiated DTO overrides; two new monitoring routes are marked contract-only. This release does not activate endpoints, storage, mobile controls or real-device profiles.
- `independent_telemetry_v1: true` is verified device-profile support, not a client assertion. Absent/false profiles refuse `metric_telemetry`. New envelope has required `live.do`, `live.feed` (nullable) and `backlog`; <=100 observations total and the existing 262144-byte sync limit. Legacy `latest_sample` must be null and `backlog_samples` empty when the envelope is present. Live metric/boot/sequence bind to the enclosing sync; duplicate identities within a batch are rejected.
- `MetricObservation` requires every key, with null inapplicable values. DO and shared stock have independent original measurement/capture times and quality. Equal value/new identity remains a new observation. A present error/unavailable observation updates that metric honestly; a null live slot leaves it alone. Backlog never promotes current state. ACKs are metric-qualified durable identities, not evidence of freshness or physical feeding.
- Read DTO consistency: non-null resource summary quality equals the nested observation quality, and summary time basis equals its canonical latest basis; unknown basis requires null age. Null-latest remains unavailable/unknown/null-age. Canonical measured/captured basis needs its corresponding original timestamp (measured also needs synced/RTC time quality). Shared runtime and Node/Python conformance supplements compare canonical observed instant and source-qualified identity to nested originals, preserving fractional precision. These within-DTO equalities do not establish clock trust, freshness or cross-request provenance.
- Canonical `observed_at` is assigned once from reliable nonfuture measured time, otherwise trustworthy capture time, otherwise null (`time_basis=unknown`). Preserve original timestamps and `received_at`. Cross-request changed-content replay, cached-timestamp relabeling and historical-to-live promotion require immutable persistence in T04: **a DTO cannot prove timestamp provenance**. The conformance suite rejects changed timestamps on duplicate identities inside one batch; it does not claim to identify a dishonest new identity.
- Freeze `MetricSnapshot`, normalized history (`MetricHistoryPage`, <=50, opaque cursor, descending observed time/source-qualified identity), and normalized last-observation-per-bucket DO graph (1h/6h/24h). Include legacy data with `legacy:{metric}:{boot}:{sequence}` versus `metric:{metric}:{boot}:{sequence}`; never rewrite originals. Day queries use Asia/Manila half-open UTC bounds, or explicit `time=unknown` without a fabricated date. Feed history adds nullable `occurred_at`, `time_basis`, `received_at` without changing `created_at` or inventing completion.
- Configuration variants preserve every existing limit and ordered schedule target. `oxygen_report_interval_seconds` is required but nullable on negotiated snapshots: exactly 15, 30, 60, 3600, 7200, 14400 or 28800 seconds when configured. Null means unconfigured; never claim an applied default. Suggest 30 seconds only for an explicit edit, never write on mount. Desired and applied snapshots remain distinct; CAS, pending/replay semantics remain mandatory and semantic equality includes the interval. ACK must echo the persisted revision and its exact value. Timeout stays pending, not rollback or another desired revision.
- Add HTTP 409 `CONFIG_UPGRADE_REQUIRED`: an old app write against a stored snapshot with the new key cannot strip it (including a null key). Incapable profiles cannot set or clear a configured interval. Runtime helpers here validate telemetry/negotiation boundaries only; callers must still authenticate, validate full snapshots and profile capacity, compare revisions, persist immutably and enforce exact ACK equality in the later implementation tasks.
- Contact/receipt/report cadence never resets measurement age. Fresh stock for feed admission remains <=30 seconds even with an 8-hour oxygen report interval; unknown-clock stock is not fresh. Proposed report-overdue policy is `now > last_received_live_do_at + applied_interval + max(30s, 10% interval)`; this is report scheduling, not meter freshness or a hardware guarantee.

### Compatibility matrix

| App / profile | Read and write behavior |
| --- | --- |
| Old app / old device | Legacy DTOs/sync unchanged; no interval control. |
| New app / old device | Fall back to legacy monitoring only for explicit lack of capability, never arbitrary errors. Negotiated config may expose interval=null; non-null interval edit denied. Preserve all legacy safety fields and Both schedule targets. |
| Old app / capable device | Keep legacy response shape; never combine independent observations under one legacy timestamp. A legacy full-snapshot write is HTTP 409 CONFIG_UPGRADE_REQUIRED once the stored snapshot contains the new key; no down-conversion. |
| New app / capable device | Explicit 2.8.0 app header; independent reads and complete negotiated config. Exact supported value/revision ACK before applied. |
| Any device / missing or false capability | New envelope refused even if protocol major is 2 or a client sends an opt-in header. Legacy sync remains available. |

V1, existing v2 fixtures and their expected outcomes are retained. Real enrollment, database persistence, live route integration and hardware/phone acceptance are not established by this contract freeze.

## 2.7.0 — 2026-10-16

- Breaking for label consumers: the feeder name and location are shared by every authorized installation. New `DeviceMetadata` (`alias`, `location`, `metadata_revision`, `metadata_conflict`) is returned by pairing (`PairResponse.metadata`) and by `PATCH /devices/{id}/alias`.
- `AliasUpdateRequest` replaces the whole shared record and requires `expected_revision`, `alias` and `location`; a stale revision is rejected with the new `METADATA_CONFLICT` error and changes nothing. Strict 2.6.0 clients and legacy writes without a revision are rejected.
- `DeviceAccess` no longer carries `alias`/`location`: access is membership only.
- Legacy per-installation labels are kept as originals. Where active installations disagreed, the shared value starts empty with `metadata_conflict: true` until any authorized installation saves one.

## 2.6.0 — 2026-10-16

- `AlertEventDTO` gains `sequence_id` and four feeding kinds: `feeding_failed`, `feeding_partial`, `feeding_unknown`, `feeding_unmeasured`. A feeding event references its feed sequence and has null reading facts; a reading crossing keeps every reading fact and a null `sequence_id`. Strict 2.5.0 clients reject the new key and kinds.
- The push payload is unchanged: taps still fetch the authorized event by `event_id`.

## 2.5.0 — 2026-10-16

- Breaking for schedule consumers: `Schedule` replaces scalar `nozzle_number`/`dose` with ordered `targets` (one nozzle, or Both as nozzle 1 then nozzle 2 with separate doses). A closed legacy parser rejects the whole snapshot instead of running one target of Both.
- Add required `scheduled_both` capability. Servers reject Both schedules with `CAPABILITY_MISMATCH` unless it is true; simulator profile revision 5 enables it, real-device profiles stay false.
- Add optional `RunEvent.continuation_evidence` (`safe_stop`, `device_fault`, `baseline_ready_at`). Only a step-1 `failed` event with a valid settled weighing and trusted time may carry it. With it, the already-authorized nozzle 2 may run once; without it nozzle 2 is not started. Nozzle 1 is never retried.
- `partial` also covers nozzle 1 failed plus nozzle 2 completed; it always has exactly one completed nozzle.

## 2.4.0 — 2026-10-15

- Add an explicit nullable shared-container capacity in grams, separate from each nozzle's dose bounds.
- Permit a failed feed event to retain a valid measured dispense amount; unavailable and unknown measurements remain null.
- Update the synthetic simulator profile to 20,000 g capacity and capability revision 3.
- Controlled simulator profile revision 4: per-nozzle `max_dose_g` 20,000 g (5 g minimum, 1 g step); real-device profiles unchanged.
- Add `INVENTORY_UNAVAILABLE` and `INSUFFICIENT_INVENTORY` error codes: manual feed admission needs a fresh, valid measured shared-stock reading that covers the combined gram doses.
- Add `POST /app-api/v2/devices/{id}/feed-recovery/no-admission` with `ManualFeedRecoveryResponse`: it closes a saved manual-feed key with a terminal no-feed receipt, or returns the existing command, and never starts a feed.

## 2.3.0 — 2026-10-14

- Add strict Android Expo token registration and revocation, plus an authorized event read for push tap verification.
- Define private per-installation token storage, transactionally enqueued alert delivery, bounded send and receipt leases, generation checks, and access-revocation cleanup.
- Add push payload DTOs and fixtures. The sender stays disabled until the owner configures its invocation secret; deployment and physical Android acceptance remain separate.

## 2.2.0 — 2026-10-14

- Add installation-authorized alert history, per-installation read/dismiss actions, and captured-cutoff bulk actions.
- Define strict DTOs and stable descending (raised_at,event_id) pagination for the three notification routes.
- Preserve immutable shared alert facts separately from installation-local preferences; push delivery and mobile wiring are not part of this contract delivery.

## 2.1.0 — 2026-10-14

- Add the `/device-api/v2/wait` wake-up route as an additive protocol-major-2 change; no existing route or DTO changed.

## 2.0.0 — 2026-10-03

- Break protocol major 1 compatibility; require explicit nozzle targets and reject unsupported majors.
- Define ordered two-nozzle commands, per-nozzle requested and measured results, partial/unknown outcomes, shared-weight settling, and grouped same-time schedule admission.
- Add shared v2 fixtures and matching TypeScript/Python validation.
- Keep simulator examples explicit and unverified as hardware limits.
- Add authorized desired/applied configuration reads and the next-applied-occurrence query as part of the unreleased v2 implementation.

## 1.0.0 — 2026-10-02 (historical)

- Freeze the single-target protocol major 1 routes, DTOs, and fixtures.
- Preserve this version as an archived baseline; it cannot safely target the two-nozzle device.
