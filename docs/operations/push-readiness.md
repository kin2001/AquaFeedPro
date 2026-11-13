# Push readiness — T09

This is source readiness, **not permission to deploy, schedule, send a test push, or operate a feeder**. No provider send, hosted mutation, build submission or phone test was performed for T09. Physical **Android and iOS acceptance are both UNVERIFIED**; this app currently supports registration only on physical Android development/internal builds. Expo capability is not app support.

This runbook supersedes the older ART96 guide's five-minute invocation suggestion and ambiguous-resend expectations. Its deployment commands are not an instruction to apply an unverified migration chain. Migration-history/recovery drift on the linked development project must be resolved separately before release.

## Implemented path and safety boundaries

- Immutable server alert -> existing private `alert_push_deliveries` queue, unique `(event_id, installation_id)` -> authenticated `POST /functions/v1/push-sender` with `x-push-worker-secret` -> Expo ticket -> separate receipt polling. No new queue or foreground local notification.
- Mobile registers through app-api `/v2/push-token`; permission denial revokes registration, regrant is rechecked on resume, native token-refresh callbacks re-register. A reinstall/replacement installation must pair again; the registration RPC transfers a globally reused Expo token and cancels the old generation's unsent work. Local phone identity is not a server credential.
- Notifications carry only `event_id`, `device_id`, and the allowlisted `route_hint`. Taps require the authorized detail lookup, refreshed membership and current installation/lifecycle fences before selection/pinning/navigation. Same-device-ID profile refresh does not invalidate a valid tap. Removal, installation change and unmount still invalidate it. Already accepted system notifications cannot be recalled by access revocation; a stale tap must not disclose details.
- Worker status/claim failures remain unavailable; an `ok` claim with `project_id:null,deliveries:[]` is normal idle state and still polls due receipts. Invalid receipt project/lease/ticket shapes are excluded before provider polling.
- One send batch is at most 100 notifications from one EAS project, final access/token-generation/lease validation immediately before HTTP. Receipt claim is at most 100, grouped by validated project. Worker header authentication is mandatory even though function JWT verification is disabled. Tokens/provider bodies/secrets never appear in worker responses or routine logs.

### Delivery state after the T09 forward migration

| Evidence | Behavior |
| --- | --- |
| Expired `leased`, begin not acquired | Safe bounded reclaim; no send attempt counted before begin |
| `sending` lease expires, including lost accepted-ticket persistence | Terminal `failed/transport_retry`; do not automatically resend |
| Timeout, malformed batch response, HTTP 5xx | Record ambiguous -> terminal failed; HTTP failure does not prove no enqueue |
| Historical `retry/transport_retry` | Terminalize on next claim before eligibility; earlier versions did not distinguish uncertain acceptance |
| Explicit HTTP 429 / ticket MessageRateExceeded | Existing bounded rate-limit retry, maximum five attempts / one-hour send expiry |
| Accepted ticket, no receipt yet / receipt timeout | Keep ticket, poll it; never resend solely because receipt is missing |
| Receipt MessageRateExceeded | Explicit negative provider receipt may enter bounded retry, not an absent-receipt retry |
| DeviceNotRegistered | Clear only matching token generation and cancel its unsent work; an old receipt cannot erase a refreshed token |
| Invalid credentials or payload | Fail closed / paused for owner action; no automatic unpause |

Initial receipt polling is delayed 15 minutes; retries are five minutes apart with at most three receipt leases and the existing receipt expiry behavior. `sent` means provider tickets accepted, not persisted ticket success, receipt success or phone display. Missing ticket persistence can lose notification delivery evidence; do not invent a ticket or replay the send. Tags/collapse IDs do not establish provider idempotency or exactly-once display. Conservative terminalization may lose a notification; authorized server history remains authoritative.

## Invoker inventory — inspect before proposing another scheduler

Local inspection found only the Edge Function handler, `supabase/config.toml` JWT setting, mocked tests and historical setup documentation. `.github/workflows/ci.yml` runs checks, not this worker. No checked-in Cron/pg_net job or external invoker definition was found. **Hosted Cron, dashboards, external scheduler configuration and secret existence remain UNKNOWN**. Do not interpret absence from Git as absence in the cloud, and do not create a second invoker.

If a hosted catalog read is needed, obtain parent review for these exact read-only queries first (none was executed during T09):

```sql
select extname from pg_catalog.pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault');
select pg_catalog.to_regclass('cron.job') is not null as has_cron_catalog;
```

Only if the catalog exists, propose this separate sanitized inventory query:

```sql
select jobid, jobname, schedule, active,
       position('push-sender' in command) > 0 as mentions_push_sender
from cron.job order by jobid;
```

Do not select/log `command`, HTTP headers, request bodies, Vault decrypted secrets or secret values: historical jobs may embed credentials. Owners must also inspect non-Cron schedulers privately; a catalog match alone does not prove successful invocation. Record sanitized scheduler identity, cadence, active state and last execution status, not credentials.

If no invoker exists, propose a **disabled, owner-reviewed** managed job named `aquafeed-push-sender-minute`, Cron `* * * * *`, using pg_net POST to the verified project's push-sender endpoint. Resolve `PUSH_WORKER_SECRET` from Vault at execution, provide it as `x-push-worker-secret`, never as a SQL/runbook literal or mobile value. Keep any required Expo access token only in protected Edge Function secrets; FCM/APNs credentials belong in EAS. Check extensions, permissions, project identity, function deployment and secret rotation privately before activation. No runnable scheduling statement is included and no job is enabled by this delivery.

One-minute invocation is a proposed engineering cadence, **not an approved latency target or SLA**. Owner must review event-to-phone delay requirements and observations separately. Backlog, provider queues, receipt delay, OS/background restrictions and credentials prevent inferring a display guarantee from invocation frequency.

## Reviewable rollout and recovery

1. Verify exact migration history/content and deployed shared-function versions against the approved candidate; stop if drift/recovery readiness is unresolved. Use separately approved backup/isolated-restore procedure. Do not run `db push` against the currently drifted shared project based on this document.
2. Stop/pause the existing invoker and confirm all in-flight workers have drained, including maximum lease and function runtime. Do not infer drainage from a guessed delay. Record sanitized counts of queued/leased/sending/retry/accepted states and failures. No token, payload, ticket body or secret dumps.
3. Review `20261114000900_backend_push_uncertain_no_resend.sql` and isolated OLD RED / forward GREEN results. It only replaces two bodies; signatures, ACLs/security/search_path and ART102 names remain. Applying it performs **no table data rewrite**. Later claims terminalize expired sending and historical transport-retry rows before claiming sends. No T03 telemetry/contracts or T02 lock-prefix functions are changed.
4. The conservative historical cleanup proposal is separate coordination evidence for parent review, not an executable release step here. The new claim already fails closed without optional cleanup. Existing sending/transport-retry notifications may be lost rather than repeated; preserve immutable alert history, attempts and any tickets for investigation. Do not relabel them delivered, reset attempts, erase receipts or re-enqueue historical alerts.
5. Deploy the matching worker mapping HTTP 5xx to ambiguous. Mixed old/new worker rollout is not an acceptance claim; stop/drain remains required. The old worker maps 5xx to retry/transport_retry, which the new claim terminalizes, but races and unknown deployed definitions require review, not confidence from source alone.
6. Independently verify final generation/access checks, duplicate suppression, permission/tap scenarios, receipt-only idle invocation and bounded retry behavior in isolated tests. Only an owner-authorized release may resume the existing invoker. Never activate a new scheduler as part of coding/tests.
7. Recovery is a reviewed forward repair while invoker remains disabled. Do not restore the old automatic ambiguous-resend behavior or replay failed/uncertain work. A database restore can lose post-backup facts and must not drive any physical feed retry. This push migration never changes feeding admissions, dosing, calibration or hardware.

Lock graph stays T02 credential/access -> devices -> device_state -> sequences/steps; alert/revoke paths acquire the existing push advisory lock before push-owned rows. Claims acquire only delivery rows and never later acquire that advisory lock or business-row locks. The new terminal updates stay delivery-only. Existing DeviceNotRegistered handling keeps its advisory-before-row order.

## Verification and native acceptance ledger

Local commands (Node 24; normal mobile commands require an already installed dependency tree):

```text
node supabase/tests/art96_push_sender_check.mjs
node supabase/tests/art95_api_route_check.mjs
cd mobile
node scripts/check-notification-controller.mjs
npm run check:alerts
npm run format:check
npm run lint
npm run typecheck
```

`supabase/tests/art96_push_delivery.sql` must run only through parent-managed disposable PostgreSQL CI, with the prerequisite migration chain and rollback fixtures. CI explicitly runs the controller and alerts checks after mobile `npm ci`, and the sender and route mocks in the backend job. After the unchanged full baseline and T02 lock harness, `node supabase/tests/backend_push_regression.mjs --database-url-env LOCAL_TEST_DATABASE_URL` requires verified OLD bodies to fail at the exact lost-ticket assertion inside an uncommitted transaction, verifies rollback/restored forward definitions and fixtures, then requires the same suite GREEN. Its guards also run in the backend unit-test step. This wiring is not observed SQL runtime success: hosted OLD RED / forward GREEN remains UNVERIFIED until CI executes it. Do not install a local DB, run rollback fixtures on the linked project, or treat Node transport mocks as SQL execution. No dependency, package or global baseline-runner change is needed.

| Gate | Physical Android | Physical iOS |
| --- | --- | --- |
| Platform/source path | Android-only controller/app-api/SQL/contract registration exists | **Unsupported by current app path**: guard excludes iOS; API/SQL/contract accept android only |
| Build identity/config | `com.aquafeedpro.app`, development/internal profile and notifications plugin present | iOS icon/plugin/profile present, but no `ios.bundleIdentifier` configured |
| Signing/provider credentials | FCM/EAS configuration and current signed build UNVERIFIED | APNs/Apple signing/entitlements/EAS identity and signed build UNVERIFIED |
| Permission denied -> settings grant; later revoke | Mocked lifecycle only; physical UNVERIFIED | UNVERIFIED; requires supported app path and iOS permission interpretation (including provisional status) |
| Foreground/background/terminated display, sound/channel expectations | UNVERIFIED; Expo ticket is not display evidence | UNVERIFIED; Expo/APNs support is not app acceptance |
| Token refresh/reinstall, replacement installation, global token transfer | Mock/SQL cases; physical UNVERIFIED | UNVERIFIED, blocked by current registration path |
| Revocation before send/tap; cold tap -> correct authorized device/event once | Mock/SQL cases; physical UNVERIFIED | UNVERIFIED, blocked by app support |
| Timeout/429/5xx, lost persistence, receipt delay/no resend | Synthetic checks; isolated SQL/native evidence separate | Same unresolved native gate; do not silently remove platform |

For each platform, authorized physical acceptance must record build SHA/ID, OS/app version, isolated project identity, permission transitions, timestamped event/provider/phone observations, background/terminated state, authorized tap results and sanitized failure evidence. No feeder actuation is needed: use synthetic development alerts only, and only after explicit test-push authorization. No physical phones or provider test sends are authorized for this task.

Expo SDK 58 documentation (`https://docs.expo.dev/versions/v58.0.0/sdk/notifications/`, read during T09) supports Android and iOS/APNs, including some emulator/simulator configurations; Android Expo Go remote push is unavailable. Our guard is narrower: physical Android, not Expo Go. Neither an emulator/simulator nor Expo Go proves physical acceptance. iOS must not be spoofed as android. Completing iOS requires separately serialized ownership of controller permission/platform logic, app-api, platform check/registration migration, contract/OpenAPI/fixtures, iOS build identity and both-platform tests; it is not authorized by this T09 migration exception.
