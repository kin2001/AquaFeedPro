# T04 independent metrics — validation boundary

Forward migration: `20261114001000_backend_metric_observations.sql`, **after** merged T09 `20261114000900`. The plan's former `00200` reservation is not used: renaming merged migrations would be wrong. The fresh runner now applies 22 migrations, retaining the pre-ART33 profiles, strict migration-fixture cleanup, all ten legacy SQL suites, T02 two-connection OLD/forward regression and separate T09 OLD/forward push gate. Three new child tables are explicitly enumerated in cleanup's existing locked **empty-only** loop; unknown dependencies and all existing negative controls still reject.

## Offline checks (no credentials, database, providers or hardware)

```sh
node --test supabase/tests/*.test.mjs
node supabase/functions/_shared/telemetry.test.ts
node supabase/tests/backend_metric_route_check.mjs
node supabase/tests/art95_api_route_check.mjs
node supabase/tests/art96_push_sender_check.mjs
python supabase/tests/backend_metric_simulator_check.py
python supabase/scripts/art31_simulator.py --self-test
python supabase/scripts/art31_simulator.py --self-test-art33
python supabase/scripts/art31_simulator.py --self-test-telemetry
python supabase/scripts/art31_simulator.py --self-test-alerts
python contracts/scripts/validate.py
node contracts/scripts/validate.ts
```

The route check executes the real handler, `readJson` byte bound and shared validators; only the Supabase network client is substituted. It checks verified profile capability/revision/capacity, invalid rest-of-sync rejection before any business RPC, mixed legacy/new rejection, live binding, count/byte bounds, error mapping, typed/sent/unique ACKs, no command retry and unchanged legacy response. It is **not SQL execution evidence**. Python metric checks use real temporary SQLite journals, not HTTP/database mocks: immutable source splitting, <=100 metric observations, qualified ACK validation, retain-until-both-ACK behavior and persisted counter/outbox across restart. The synthetic simulator splits paired legacy sensor acquisitions; it does not simulate independent physical acquisition or calibrate hardware. Opt-in `--metric-telemetry` never enrolls a profile: the server must already declare the capability. No metric bulk legacy backfill mode is enabled.

## Disposable SQL only

Do not run fixed-identity suites, migration bootstrap, deliberate failures or schema generation against the shared development project, including via a loopback tunnel. No worker local database/install is authorized. Parent-pushed hosted CI supplies the existing PostgreSQL17.6 disposable service.

`check-backend-baseline.mjs` stops immediately before the new migration and runs the exact rollback-only missing-installation control. Only psql exit3 with **one exact** `P0001: T04_CURRENT_METRICS_NOT_INSTALLED`, no stdout, and valid fresh-bootstrap provenance is accepted. This proves **installation absence**, not old business behavior. Arbitrary syntax/FK/permission errors are failures. It then applies the forward migration and runs `backend_metric_observations.sql` after the ten legacy suites. T02/T09 controls remain separate and unchanged.

The new suite uses rollback-only sanitized profiles/Auth/access/configuration/ACK/token fixtures. Cases cover immutable replay/changed-content conflict, metric current/live monotonicity across backlog and boot reset, one-invalid-item atomic rows/revisions/contact rollback, missing fields/types/count/byte/live bounds, omitted versus explicit error, original-versus-normalized overcapacity, fresh DO with stale stock denial, legacy pointer bypass denial, fresh stock despite stale DO admission and duplicate command prevention without stock subtraction, unknown/future/capture-only fail-closed behavior, actual-source threshold crossing/sustained/recovery/replay/backlog/error/other-metric isolation, strict alert chronology, existing push enqueue, source-qualified legacy/new alert uniqueness and FK, observation immutability, private RPC ACL, client SELECT-only grants and active/revoked RLS. No physical work is performed. Existing ART95's **catalog assertion only** now verifies the exact six ordered source-qualified columns and `indnullsnotdistinct`; its functional expected outcomes are unchanged.

## Source time and remaining scope exception

Device-supplied measurement timestamp accuracy is the owner's external hardware contract. T04 does not calibrate/synchronize clocks or shift UTC instants by eight hours. Philippine display/filtering remains `Asia/Manila` in the separately assigned consumers. Structural UTC validation, explicit quality, future checks and actual elapsed stock age <=30 seconds remain mandatory regardless of an eight-hour DO cadence.

Supported ingestion/current/manual-feed/alert flow uses genuine reliable source `measured_at`. First receipt preserves original measured/captured values and immutable input JSON; canonical time is assigned once. Uncertain/invalid source quality stays unknown. The existing one-quality wire can conservatively retain a nonfuture capture fallback when source quality is synced/RTC but measured time is future; **that does not make future-source inventory feed-admissible or authorize captured-as-measured alerts**. The canonical reader labels captured basis, but supported admission and alerts require measured basis. A clockless meter plus trustworthy Pi capture has no separate capture-trust fact in frozen2.8.0: capture-only remains unknown, no legacy fallback, no fake freshness or alert. This concrete capability case and the originally planned trustworthy-capture alert/admission acceptance remain incomplete pending an explicit contract/consumer decision. No new fields or alert DTO changes are introduced, and this is not blanket Task04 Done or real-device enrollment acceptance.

## Generated public types: parent-managed first artifact

`generate-backend-public-types.mjs` is **Linux GitHub CI only**, accepting the exact disposable service URL and checking fresh database-OID provenance plus installed RPC before acquisition. The parent independently verified official CLI2.120.0 archive URL/digest and upload-artifact v4.6.2 SHA. It downloads into `RUNNER_TEMP`, checks SHA256 with `sha256sum --check` **before** extraction, verifies binary version, and executes from an empty temporary cwd:

```sh
supabase gen types typescript --db-url "$LOCAL_TEST_DATABASE_URL" --schema public
```

No login/link/project-id/cloud credentials, private/auth schemas, repository package dependency, local/global install or shared query. Docker must actually work: official CLI uses a postgres-meta container on host networking for explicit db-url. The script records the **actual container-create image**, inspected image ID/RepoDigests and Docker/CLI versions, rather than inventing an image hash. Output is checked for expected public tables/RPC and forbidden nonpublic schemas/private credential records; public RPC verifier parameter names are legitimate. No raw CLI/Docker/SQL logs are uploaded. Only `database.types.ts`, sanitized `provenance.json` (commit, migration filenames/hashes, artifact hash, runtime provenance), and public `committed.diff` are uploaded for14days.

Initial generation intentionally reports a non-gating diff from stale committed public types. **Generation itself is fail-closed.** Parent must download/review the artifact, give this same worker the exact complete generated file, and then the worker replaces `supabase/database.types.ts` without inventing fields. Before final acceptance change the CI generation command to `node supabase/scripts/generate-backend-public-types.mjs --verify`; it requires byte equality to regenerated public types. Rerun affected public/mobile typechecks and retain matching provenance. Until actual generation, review, integration and strict comparison occur, public types acceptance is UNVERIFIED; the existing types file is intentionally not hand-edited.

Observed local results and exact head belong in the external Task04 report, not inferred from these authored commands. Missing `ajv` prevents the local Node contract validator without an install; the Python contract validator can run independently. Real SQL, DDL rewrite cost, generated types, native phones, cloud deployment and hardware remain distinct evidence gates.
