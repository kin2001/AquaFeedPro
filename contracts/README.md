# AquaFeed Pro wire contract

**Version:** 2.0.0 (`protocol_major: 2`), a breaking change from v1.

**Status:** D1 defines the v2 wire contract, shared examples, validators, and Supabase schema. D2-D5 now provide the app/API and durable simulator runtime; see the [Android and hardware handoff](../docs/ANDROID-HARDWARE-HANDOFF.md) for implementation provenance and evidence. Firmware and physical hardware remain unverified.

## Source of truth

- [openapi.yaml](openapi.yaml) describes the nine v2 routes relative to Supabase `/functions/v1`.
- [schemas/v2.schema.json](schemas/v2.schema.json) contains canonical Draft 2020-12 DTOs.
- [fixtures/manifest.json](fixtures/manifest.json) is shared by TypeScript and Python validators.
- [CHANGELOG.md](CHANGELOG.md) records contract versions.
- The v1 schema, OpenAPI file, and manifest remain historical records; they are not v2 inputs.

Major 2 requires explicit nozzle targets. Major 1 is rejected with `PROTOCOL_UNSUPPORTED`; there is no default nozzle or ignored optional target.

## Two-nozzle sequence rules

A device's two nozzles share one continuously weighed container. A request selects nozzle 1, nozzle 2, or both; Both carries a separate dose per nozzle and targets must be ordered 1 then 2. The device-wide reservation lasts through the final stop and valid weighing settle interval. A second nozzle starts only after the first stops and the shared weight has a valid settled baseline.

Same-time due schedules admit as one ordered group under that reservation. The second leg's deadline begins at its settled baseline, so completion of nozzle 1 alone does not expire nozzle 2. Same-nozzle collisions remain invalid. A fault, uncertain stop, or invalid weighing halts remaining legs. Results preserve completed, failed, unknown, and not-started legs; interrupted work is never automatically resumed or replayed.

Manual-feed idempotency includes the ordered targets, each dose, and capability revision. `request_id` is correlation only. Reusing an idempotency key with changed targets or doses conflicts. Schedule occurrence identity is `(device_id, stable schedule_id, occurrence_local_date)`; editing dose, nozzle, or configuration does not create a second occurrence.

Requested dose, estimated amount, measured amount, and shared remaining inventory stay separate. Unknown readings remain unavailable. Desired and device-applied configuration revisions remain separate. Unknown nozzle results keep the safety lockout until a device-maintenance resolution; the result and any measurement remain unknown after the lockout is cleared.

## Check the contract

From the repository root:

```powershell
npm.cmd run validate --prefix contracts
py -3.14 contracts/scripts/validate.py
```

Both implementations consume the same manifest. Fixtures verify DTO shape and selected command, idempotency, schedule, and sequence rules. A passing fixture does not prove an API or physical feed exists.

## Data foundation

The migrations are under [supabase/migrations](../supabase/migrations/). They separate per-nozzle feed steps from shared device telemetry and feed inventory, scope installation reads to active device membership, keep device credentials in a private schema, and grant installation clients read access only. See [the access matrix and rollback SQL check](../supabase/README.md). The coordinator applied both migrations to the isolated AquaFeed development project; no production or hardware resources were changed.
