# Changelog

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
