# AquaFeed Pro wire contract

**Version:** frozen `1.0.0` (`protocol_major: 1`)

**Status:** schemas, route descriptions, fixtures, and validator policy only. No backend function, app transport, simulator, firmware, or hardware behavior is implemented by this directory.

## Source of truth

- [`openapi.yaml`](openapi.yaml) describes the nine planned routes relative to Supabase `/functions/v1`.
- [`schemas/v1.schema.json`](schemas/v1.schema.json) is the canonical Draft 2020-12 DTO and enum baseline. OpenAPI schema components are references to these definitions.
- [`fixtures/manifest.json`](fixtures/manifest.json) names the shared valid/invalid DTO examples and policy examples. TypeScript and Python consume the same schema fixtures.
- [`CHANGELOG.md`](CHANGELOG.md) records the frozen version.

## Compatible change policy

Within a protocol major, only additive optional JSON properties that preserve existing meanings are compatible. Closed protocol, command, dose, event, and status discriminators stay closed; adding a required field, changing requiredness/nullability, units/formats, identity semantics, state transitions, or caller authorization is breaking and requires a new protocol major. Every approved contract change updates OpenAPI, the canonical schema, named valid/invalid and behavior fixtures, both validator results, and the changelog together.

JSON uses UTF-8 and `snake_case`. Entity IDs use UUID strings. Valid wall timestamps are calendar-checked UTC timestamps ending in `Z`; timestamp fields are null when time is invalid or unknown. Schedule time zones are validated against each validator runtime's IANA database, matched case-insensitively, and resolved for runtime use; aliases are accepted, while plain numeric UTC offsets are rejected. Configuration equality case-folds the submitted identifier, so casing changes alone are equal and distinct alias spellings remain distinct. Weekdays use ISO numbering, Monday `1` through Sunday `7`. DO is mg/L, feed weight is grams, percent is 0–100, and durations are milliseconds. Numbers must be finite. Missing, invalid, unsupported, or uncalibrated readings are null with explicit quality; they are never healthy zeroes. An unsupported major, command type, or dose mode is rejected. Optional additive fields are tolerated.

## Run the checks

Run these commands from `contracts/` in PowerShell. They need Node.js 24 or later and Python 3.14; the recorded run used Node `v24.15.0`, Python `3.14.5`, Ajv `8.20.0`, `ajv-formats` `3.0.1`, `yaml` `2.9.1`, `jsonschema` `4.26.0`, PyYAML `6.0.3`, and tzdata `2026.4`.

```powershell
npm ci
npm run validate
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts\validate.py
```

The TypeScript check runs with Node's built-in type stripping; there is no `tsx` runner. Both validators load the same manifest, validate every schema fixture with a JSON Schema implementation and format checking, resolve the OpenAPI references, and run the shared command, idempotency, sync-acknowledgment, schedule-ledger, timezone, and DST policy examples. These policy checks are executable examples of the frozen rules, not app/backend/firmware implementations.

The schema validates DTO shape, required fields, enums, discriminators, numeric bounds, formats, and reading/time-quality coupling. Services and firmware still have to enforce membership, device identity, database uniqueness/transactions, ordering, lockouts, request byte limits, scheduler persistence, actuation deadlines, and physical safety. A valid DTO does not prove a physical feed occurred.

## Identity, authentication, and commands

App routes require a bearer token for an authenticated anonymous Supabase installation session, then check active membership for the selected device on every protected operation. Device routes require the revocable device credential that resolves machine identity. The phone never receives a reusable device credential; neither phone nor feeder receives a user/project service-role credential.

Manual feeding requires explicit confirmation for the selected device and dose. Persist one idempotency key at confirmation. The unique scope is `(device_id, installation_id, idempotency_key)`. With the same key, semantic equality is based on the dose discriminator and its selected value (`amount_g` or `fixed_portion_id`) plus `capabilities_revision`; JSON property order, numeric spellings such as `50` and `50.0`, optional additive fields, and `request_id` do not change equality. An equal request returns the original command's current state, while changed semantic fields conflict. `request_id` is correlation only: it is not the idempotency key and cannot authorize deduplication by itself. If the response is lost, query with the original key; never create a fresh feeding identity for recovery. The feed route returns `202` only for a newly recorded queued command and `200 CommandStatusResponse` when the key already identifies a command, including completed or unknown outcomes.

Commands move only through the planned transitions:

```text
queued   -> accepted | rejected | expired
accepted -> running | rejected | expired | unknown
running  -> completed | failed | unknown
unknown  -> completed | failed   (reliable device evidence only)
```

`rejected` means actuation never started; `failed` means it started but did not complete. Expiry limits starting and cannot replace a possible movement outcome: if movement may have begun, retain `unknown` and lock out feeding. After reboot, an unfinished operation becomes unknown and remains locked. Only a device-authenticated physical maintenance event can clear that lockout; it keeps the outcome unknown and measured amount null. The app has no unlock mutation. Stable run/event sequence prevents stale status regression; terminal results do not regress on replay, while reliable late evidence may resolve unknown.

Manual and scheduled feeding share one actuator lock. Persist command identity and intent before movement; recheck the start deadline and lock immediately before actuation, and stop with an independent runtime watchdog. Do not retry feeds or automatically catch up missed schedule occurrences. API acceptance and simulator output do not establish physical completion.

## Configuration, telemetry, and schedules

Configuration writes contain a complete snapshot and compare-and-swap base revision. An identical `request_id`, base revision, and semantic snapshot returns the same revision; a changed payload conflicts. Snapshot equality compares the case-folded submitted timezone identifier, monitoring limits, low-feed threshold, and each schedule's ID, local time, ISO weekdays, enabled state, and dose; JSON object order, schedule order, weekday order, and optional additive fields do not change equality. Different IANA aliases remain distinct even when their current offsets match. Reject a second edit while a revision is pending. The response separates an immutable `receipt` from a fresh `current_state`, so a replay after application does not claim the revision is still pending. Apply a valid full snapshot atomically between operations; a rejected snapshot leaves the previous applied revision in effect. Desired and applied revisions remain distinct, and the next feed uses the device's applied revision.

Allow one outstanding sync per device. Compare current live boot/sequence separately from historical sample boot/sequence and run/event sequence. A fresh authenticated contact updates contact time even when a sensor is absent; uploading an old sample does not make it fresh. Reject the whole sync request on any invalid record or over-limit payload; never partially accept or silently drop records. The UTF-8 body limit is 262,144 bytes, with at most 100 sample records total (the live sample counts, leaving at most 99 backlog samples) and at most 100 events. Explicitly acknowledge stable `(boot_id, sequence)` sample and `(run_id, event_sequence)` event identities. Duplicate valid records are acknowledged without repeated effects; retain outbox records until their ACK.

An occurrence is keyed by `(device_id, stable schedule_id, local_date)`. The schedule time zone determines the local date, but timezone and configuration revision are not added to the identity. Never reuse removed schedule IDs. A repeated daylight-saving wall time executes once; a nonexistent wall time is recorded as skipped. Reboot, forward clock correction, and overdue execution skip missed work; backward correction cannot bypass the occurrence ledger. Invalid/untrusted time pauses schedules. Schedule skips use `RunEvent` outcome `skipped`, not a command state. Manual/scheduled collisions resolve as `DEVICE_BUSY`; they are not silently queued.

## Values reserved for hardware evidence

Capability fields stay explicit and per device. Unsupported or unknown limits are null/unavailable, never zero or inferred from simulator behavior. Fixed portions expose supported IDs and never invent gram values. The fixture values `5–100 g`, `1 g` step, `8` schedules, `15,000 ms` maximum actuation, and `30 seconds` scheduler grace are simulation-only.

Real dose bounds, increment and accuracy; portion settings; sensor support and calibration; measured-dispense support; schedule capacity; clock source/uncertainty; actuator maximum runtime, stop path and cooldown; pairing trigger/presentation, challenge limits and credential recovery; and sustained telemetry capacity remain hardware/security profile decisions requiring evidence. No hardware was operated or calibrated for this contract.
