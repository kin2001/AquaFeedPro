# Changelog

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
