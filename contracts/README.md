# AquaFeed Pro wire contract

**Version:** 2.2.0 (`protocol_major: 2`), an additive update to the breaking v1 change.

**Status:** D1 defines the v2 wire contract, shared examples, validators, and Supabase schema. D2-D5 now provide the app/API and durable simulator runtime; see the [Android and hardware handoff](../docs/ANDROID-HARDWARE-HANDOFF.md) for implementation provenance and evidence. Firmware and physical hardware remain unverified.

## Source of truth

- [openapi.yaml](openapi.yaml) describes the eighteen v2 routes relative to Supabase `/functions/v1`.
- [schemas/v2.schema.json](schemas/v2.schema.json) contains canonical Draft 2020-12 DTOs.
- [fixtures/manifest.json](fixtures/manifest.json) is shared by TypeScript and Python validators.
- [CHANGELOG.md](CHANGELOG.md) records contract versions.
- The v1 schema, OpenAPI file, and manifest remain historical records; they are not v2 inputs.

Major 2 requires explicit nozzle targets. Major 1 is rejected with `PROTOCOL_UNSUPPORTED`; there is no default nozzle or ignored optional target.

## Two-nozzle sequence rules

A device's two nozzles share one continuously weighed container. A request selects nozzle 1, nozzle 2, or both; Both carries a separate dose per nozzle and targets must be ordered 1 then 2. The device-wide reservation lasts through the final stop and valid weighing settle interval. A second nozzle starts only after the first stops and the shared weight has a valid settled baseline.

Same-time due schedules admit as one ordered group under that reservation. The second leg's deadline begins at its settled baseline, so completion of nozzle 1 alone does not expire nozzle 2. Same-nozzle collisions remain invalid. A fault, uncertain stop, or invalid weighing halts remaining legs. Results preserve completed, failed, unknown, and not-started legs; interrupted work is never automatically resumed or replayed.

Manual-feed idempotency includes the ordered targets, each dose, and capability revision. `request_id` is correlation only. Reusing an idempotency key with changed targets or doses conflicts. Schedule occurrence identity is `(device_id, stable schedule_id, occurrence_local_date)`; editing dose, nozzle, or configuration does not create a second occurrence.

## Device connection loop

For the simulator and future firmware:

1. Keep one HTTPS connection open for `sync` and a second for `wait`; reconnect on any error.
2. Run `wait` continuously in its own task with the last `work_token`; when `changed: true`, call `sync` immediately.
3. Also sync on the server's `next_sync_after_ms`, and within 250 ms after recording a new local event.
4. Work comes only from `sync`; a wake-up never starts a feed. A `wait` round-trip is not a clock sample.
5. If `wait` returns `404`, the server is older; keep the timed sync only.

Requested dose, estimated amount, measured amount, and shared remaining inventory stay separate. Unknown readings remain unavailable. Desired and device-applied configuration revisions remain separate. Unknown nozzle results keep the safety lockout until a device-maintenance resolution; the result and any measurement remain unknown after the lockout is cleared.

## Alert history

The three installation routes added in 2.2.0 are `GET /app-api/v2/devices/{id}/notifications`, `PATCH /app-api/v2/devices/{id}/notifications/{eventId}`, and `POST /app-api/v2/devices/{id}/notifications/actions`. Each requires the authenticated installation JWT, `X-Protocol-Major: 2`, `X-Request-Id`, and active membership for the path device; action bodies repeat the same request ID and cannot provide an installation ID.

The list returns at most 50 immutable shared alert facts in descending `(raised_at,event_id)` order. Its optional opaque cursor is device-bound and continues strictly below that tuple. `do_low`, `do_high`, and `feed_low` events include the applied revision, finite value and limit, trusted sample identity and measured time, raised time, and the trusted simulator marker.

Read and dismiss state belongs to one paired installation. `read` and `dismiss` update one event; dismissal also marks it read. The bulk action accepts `mark_read` or `dismiss` through a caller-captured event cutoff. Events raised after that tuple remain unchanged, and a reinstall has a new installation identity that must pair again.

## Check the contract

From the repository root:

```powershell
npm.cmd run validate --prefix contracts
py -3.14 contracts/scripts/validate.py
```

Both implementations consume the same manifest. Fixtures verify DTO shape and selected command, idempotency, schedule, and sequence rules. A passing fixture does not prove an API or physical feed exists.

## Data foundation

The migrations are under [supabase/migrations](../supabase/migrations/). They separate per-nozzle feed steps from shared device telemetry and feed inventory, scope installation reads to active device membership, keep device credentials in a private schema, and grant installation clients read access only. See [the access matrix and rollback SQL check](../supabase/README.md). The coordinator applied both migrations to the isolated AquaFeed development project; no production or hardware resources were changed.
