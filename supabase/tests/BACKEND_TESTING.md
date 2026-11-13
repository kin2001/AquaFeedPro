# Isolated backend baseline checks (T01)

## Safety and current status

Use a **new disposable local PostgreSQL cluster**, never the linked/shared development project. The shared project is not an isolated test fixture even if the app is not live. Do not read credential-bearing env files, run remote migrations, or provision shared simulator profiles to make these tests pass.

The runner rejects absent URLs, non-loopback hosts, database names other than `aquafeed_backend_test`, URI query overrides and fragments. A loopback URL does not prove that a tunnel is safe: do not forward a shared database to that port. Bootstrap additionally refuses existing Auth/private schemas, app tables or Supabase roles. Use a dedicated cluster, not another database in a shared cluster (roles are cluster-wide).

**Worker evidence:** Node/Python checks were executed locally. Docker, `psql` and a PostgreSQL server runtime were not found; local SQL execution and real deliberate-assertion failure are BLOCKED. Supabase CLI was not on PATH, but the orchestrator subsequently located a cached **2.120.0** executable at `D:/DevCache/Shofiliate/npm-cache/_npx/0e23c24576954b26/node_modules/@supabase/cli-windows-x64/bin/supabase.exe`. CLI availability does not supply Docker, `psql` or a disposable local database. The SQL/bootstrap/service configuration is authored, not proven. CI is intentionally fail-closed, not a passing SQL claim.

Source inspection identified historical SQL prerequisites; the orchestrator authorized minimal current-schema test updates, not historical migration checkpoints:

- `art38_device_access.sql` expected freshly provisioned capability revision **4**, but the immutable ART98 migration changes provisioning to **5**. The assertion now requires **5**, retaining hopper/nozzle maxima and all credential/access/metadata assertions. This suite also calls the later ART102 metadata API, so a revision-4 checkpoint would not provide valid coverage.
- `art27_monitoring_settings.sql` expected revision **2** and a pre-existing idle applied configuration. It now requires **5** and establishes a valid nonempty Both schedule through `art33_write_configuration` and `art33_device_configuration_report` inside its existing rollback transaction. Pending/conflict/idempotency/ACK/revocation and full-schedule preservation assertions remain. No capability downgrade or production-function replacement is used.
- ART-33/settings expect provisioned 222/333 device verifiers; `backend-test-fixtures.sql` creates only these disposable test profiles with public synthetic verifier values and no access or applied configuration. The monitoring suite's setup rolls back, leaving ART-33's required clean revision-5 baseline unchanged.
- ART7 was inspected in full: it needs the immutable D1 seed device 111/its state, real deferred Auth FKs, actual app integrity triggers/constraints, client roles with `auth.uid()`, protected private tables and publication exclusion. It creates its own 222/access/config/sequence/step/occurrence fixtures inside rollback, before shared test-profile setup. D1 plus the test-only prerequisites provide this surface; no ART7 assertion or fixture data was rewritten. This is source review, **not an executed SQL result**.

All ten suites run against the final immutable schema. No historical-schema coverage is presented as current-schema coverage, and no immutable migration was modified. These SQL prerequisite corrections still need real disposable PostgreSQL execution and orchestrator review.

## Reproducible commands

From `mobile` (Node 24, lockfile-installed dependencies):

```powershell
npm.cmd ci --offline --ignore-scripts
npm.cmd run check:manual-feed
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
```

From the repository root (Python 3.14; an IANA timezone database must support America/New_York):

```powershell
python supabase/scripts/art31_simulator.py --self-test-art33
node --test supabase/tests/check-backend-baseline.test.mjs
```

The ART-33 self-test injects schedule instants **and a fixed test boot instant**. The repeated-hour case must choose the second/standard-time occurrence, actuate exactly once, keep exactly one occurrence, and retain the same unacknowledged outbox identities on another scheduler wake and after reopening the journal. ExitStack closes every test SQLite handle in a finally-equivalent exit before temporary directory cleanup. Production no-catch-up/clock-jump behavior is unchanged.

### Disposable SQL service

Prerequisites: an **already installed/authorized** Docker runtime and PostgreSQL 17-compatible `psql` client. Do not install system software on the worker host without approval. CI's client installation is confined to its temporary hosted runner. Commands below are instructions, not evidence they have run:

```powershell
# The password is deliberately public, local disposable test data, not a project credential.
docker run --name aquafeed-backend-t01 --rm -d -p 127.0.0.1:54322:5432 -e POSTGRES_DB=aquafeed_backend_test -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=isolated-ci-only postgres:17.6 postgres -c wal_level=logical
docker exec aquafeed-backend-t01 pg_isready -U postgres -d aquafeed_backend_test
# Wait for readiness before proceeding. Do not use a pre-existing container/database.
$env:LOCAL_TEST_DATABASE_URL = 'postgresql://postgres:isolated-ci-only@127.0.0.1:54322/aquafeed_backend_test'
# Optional: $env:PSQL_PATH = 'C:/path/to/psql.exe'
node --test supabase/tests/check-backend-baseline.test.mjs
node supabase/scripts/check-backend-baseline.mjs --database-url-env LOCAL_TEST_DATABASE_URL
# Stop only this task-created disposable container when evidence has been retained.
docker stop aquafeed-backend-t01
Remove-Item Env:LOCAL_TEST_DATABASE_URL
```

The test command, when the explicitly selected local URL is present, first proves a real successful SQL assertion and then checks that a deliberately broken assertion produces `psql` exit **3**. Without a URL, that one integration test is explicitly **SKIP**, not PASS. Other tests check connection rejection, first-failure propagation, libpq environment isolation, no URL/password in process arguments, suppressed child output and missing-client failure. Mock process results are not SQL execution evidence.

### Bootstrap boundaries

`backend-test-bootstrap.sql` supplies the Supabase prerequisites consumed by repository migrations/suites:

- NOLOGIN/NOINHERIT `anon` and `authenticated`, and a separate BYPASSRLS `service_role` (never grant client roles bypass privileges).
- A real `auth.users` FK parent with the Auth columns used by the suites, and `auth.uid()` with the JWT-subject setting/JSON-claims fallback semantics.
- Schema usage grants and `supabase_realtime` publication metadata. The first repository migration creates/protects `private` itself.

This is a **minimal test-only prerequisite surface**, not a fake always-authorized Auth implementation and not the complete Supabase stack. It does not validate GoTrue login, JWT verification, HTTP routing, Realtime delivery, RLS auto-enable event triggers, hosted defaults, push delivery or physical hardware. CI's bare PostgreSQL service does not supply these prerequisites by itself. Publication membership checks do not prove logical replication; the standalone command enables logical WAL, whereas CI checks publication metadata only.

The CLI applies every timestamped `.sql` migration in lexical order without rewriting it, then all ten existing plain SQL suites in an explicit list. Pairing runs before the disposable profile fixture because it expects fresh provisioning. Every file uses `psql -X --no-password -v ON_ERROR_STOP=1 -f ...`; rollback suites remain plain SQL, **not pgTAP**. The first failure stops the gate. Migrations and the small fixture setup persist only inside the disposable database; individual existing suites roll back their own transactions. Bootstrap is intentionally not rerunnable: discard/recreate only the dedicated test container for a fresh run.

`runSqlSuites({ databaseUrl, psqlPath, suites }): Promise<void>` is exported for scoped callers. It never discovers a linked project, reads dotenv files, defaults a database URL, or shells out a connection string. Libpq connection parameters are supplied through a fresh child environment with inherited `PG*` settings removed, including service/host overrides. Password-file lookup and interactive password prompts are disabled. Child stdout/stderr is suppressed because SQL/libpq errors can echo credentials/data; only trusted suite basename and exit status are reported. For detailed diagnostics, use separately reviewed sanitized local-only SQL/client logs; do not dump connection strings or full fixture payloads into reports.

## CI and remaining gates

`.github/workflows/ci.yml` preserves the all-base `pull_request` trigger and checks pushes to `main` and `feat/backend-improvement`. Stable job IDs/names are `mobile`, `contracts`, `backend-baseline` and `simulator`. Mobile retains formatting/lint/types and adds manual-feed behavior; contracts retain both existing validators. The separate offline simulator job runs ART31, ART33, telemetry and alerts self-tests without duplicating them in the database job. Backend runs runner tests including real intentional SQL failure and the isolated migrations/plain-SQL gate. Its PostgreSQL password is public disposable CI data. No repository/project secrets or Supabase links are used.

The compact `.github/pull_request_template.md` records acceptance, exact reviewed commit, compatibility, observed checks, migration/recovery impact and remaining gates. Backend task PRs target `feat/backend-improvement`. GitHub ruleset configuration belongs to the orchestrator; the worker does not configure rules, open PRs, push, merge or deploy.

A missing runtime, a skipped real-SQL test, an unexecuted workflow, or source-only SQL prerequisite review is not acceptance. Orchestrator review must verify the approved SQL prerequisite adjustments, run the full baseline and deliberate failure in the disposable service, and inspect the exact diff. Supported phones, actual Supabase services, cloud release, backups/restores and hardware acceptance are separate gates.
