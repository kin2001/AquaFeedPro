# T05 history and time checks

Task base: `7c2ac7649a956aad142d064e25ff5f6911e6d5ac`. Forward migration: `20261114001100_backend_history_time.sql`, after immutable T04 `01000`. No historical migration rewrite, backfill, new index, retention, shared deployment or hardware operation.

## Supported reads

- `X-Contract-Version: 2.8.0` opts readings, DO graph and feed history/detail into the frozen negotiated DTOs. Old graph/history requests keep their RPCs and shapes. The existing Home graph reader explicitly negotiates the normalized graph for both legacy and independent devices; it never falls back on a transient failure.
- `backend_metric_history(uuid,uuid,date,text,timestamptz,text,text)` uses half-open Asia/Manila day bounds and at most 50 rows, ordered by source observation time and C-collated source-qualified identity. New and legacy immutable observations are UNION ALL reads; each legacy combined row can yield DO and feed separately without copying records. Original timestamps, nulls and qualities remain present.
- `time=unknown` requires no date. Its separate bounded search is the preceding **366 days of server receipt**, with at most 50 rows per page, ordered by receipt then identity. Receipt is only a search/pagination key, never an observation timestamp. Older unknown-time records remain stored; this endpoint is not an exhaustive retention export.
- Opaque reading cursors bind device/date/metric/mode. Known feed cursors additionally distinguish negotiated from legacy chronology. Pagination is not a frozen snapshot: refresh the first page after delayed inserts; an observation inserted above an existing cursor may not appear while continuing that cursor.
- `backend_metric_do_graph(uuid,uuid,uuid,text,integer)` uses the same normalized observations, existing 1h/6h/24h equal-width buckets and last point per bucket, including explicit error observations. Unknown-time arrivals in the window are counted separately. No min/max rollups, gap filling or invented zero readings.
- `backend_history_page(uuid,uuid,date,date,text,text,timestamptz,uuid)` and `backend_history_detail(uuid,uuid,uuid)` are read-only: no reconciliation, feed mutation or new lock graph. Every public read checks active access (including cursor pages and unknown mode) and is service-only; private helpers are not callable by phone/device/service roles.

## Feed chronology

The earliest trustworthy running event supplies execution start; without a start, trustworthy completion is labeled completion. Trust requires reliable original event time quality and nonfuture source time relative to its receipt, under the owner's accurate-source-timestamp assumption. Unknown/uncertain, queued, rejected, skipped and not-started facts do not become execution times. Schedule `due_at` and synthetic feed-step timeout timestamps are never substituted. Original `created_at`/event payloads are unchanged. `received_at` is first journal receipt (or original request creation when there is no journal event); unknown occurrence uses this explicitly labeled receipt fallback in date filtering and existing history UI. The existing detail view separately shows request, source occurrence and server receipt. All changed history/graph displays use Asia/Manila, while wire/storage instants remain UTC.

Capture-only trust/authenticity remains the explicit T04 unsupported/fail-closed limitation; no clock-quality feature or fabricated timestamp was introduced. Local DTO equality checks do not prove source-clock authenticity.

## Executable checks

No installation or database is required for these Node24 checks:

```text
node mobile/scripts/check-monitoring-time.mjs
node mobile/scripts/check-monitoring-history.mjs
node supabase/tests/backend_history_route_check.mjs
node supabase/tests/backend_metric_route_check.mjs
node --test supabase/tests/*.test.mjs
```

They execute actual helpers/readers/handlers with only external API/network boundaries substituted. They are not SQL, native, hardware or deployment evidence. Existing `check-manual-feed.mjs`, `check-art27-monitoring.mjs` and `check-art31-api-parser.mjs` also remain required with their existing installed test/compiler dependencies. Original additive-sync acceptance assertion is preserved.

The T05 baseline appended `backend_history_time.sql` after the previous eleven suites and all 23 migrations. The current T06 baseline applies **24 migrations through `20261114001200_backend_query_indexes.sql`** and retains this suite before the thirteenth `backend_query_access.sql`; see `BACKEND_QUERY_TESTING.md`. **Only parent-controlled disposable hosted CI may execute it for this task.** Its rollback assertions cover tied pagination, Philippine midnight, separate unknowns, normalization/identity separation, new-only graph, late feed chronology, read-only feed state and revoked reads. Worker did not execute SQL locally.

Strict generated types stay `--verify`. At T05 acquisition, initial stale committed types were expected to fail comparison with exact commit/23-migration provenance. Current final-schema provenance requires **24 hashes ending `01200`**, pinned native generator/temp-config identity and a complete structurally public-only artifact; historical23 provenance is insufficient. Only that complete artifact may be retained after failure. This does not turn that CI job green. Parent reviews the real artifact and all four new public RPC signatures, supplies the complete byte-exact file to the same worker, then strict CI must match. Never hand-edit generated types or substitute synthetic guard-test fixtures for a real generated artifact.

## Authorized inherited compatibility fix

The old schema-open additive sync fixture failed both before T04 and at T05 base; strict runtime `onlyKeys` originated in historical `185f8a14`. Parent authorized a route-local device-api projection, shared by validation and RPC input construction, to ignore only unknown additive facts. Known contradictory/control fields remain available for existing rejection, missing keys stay missing, and closed metric envelopes/observations/continuation evidence remain verbatim. Raw-byte caps, capability checks, whole-payload validation, telemetry-before-config-before-feed order, replay identity, nozzle/dose safety and no-retry behavior remain unchanged. No global validator or frozen contract was relaxed. Actual-handler clean/additive exact RPC-argument equivalence and malformed-known/closed-extra negatives corroborate the original unchanged parser assertion.

## Remaining gates

Canonical worktree lint/typecheck/format, real SQL/strict generated artifact, iOS and Android native observations, source hardware authenticity/calibration, representative query plans, restore readiness and deployment remain distinct evidence. Task06 owns measured indexing; this migration creates none. No new daily readings screen, settings activation, Broadcast, shared cleanup or hardware action is included.
