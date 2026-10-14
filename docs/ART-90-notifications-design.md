# ART-90 — Closed-app Android notifications: design and delivery plan

Status: concrete design for owner review; no notification implementation, migration, deployment, Firebase resource or build has been created. Prepared October 14, 2026 (Asia/Manila) against main `6695aac000b552363e04a30bcd78084af994b4f7`.

Source scope: [ART-90](https://linear.app/artkin/issue/ART-90). Related work: [ART-91](https://linear.app/artkin/issue/ART-91) and its separate RT children. The owner has authorized progressing this design. Closed-app thesis acceptance, the move to an Android development build, and Firebase/FCM credential custody remain the concrete owner decisions before push implementation.

Notion review copy: [private ART-90 design draft](https://app.notion.com/p/3f9224a56ef381de87ade593f64def3b). The proposed implementation deliveries remain gated on the decisions above.

## Implemented baseline

- `mobile/src/lib/alerts.ts` supplies `detectAlerts`, titles and row text. The list and crossing state currently use phone-local storage.
- `mobile/src/app/(tabs)/_layout.tsx` checks the selected feeder every 30 seconds only while active, using `readMonitoringSnapshot` and `readConfiguration`. It gates each metric by its own quality/freshness and uses the applied snapshot.
- The Home bell and `mobile/src/app/notifications.tsx` already provide unread count, mark read/all read, remove and clear. Keep those components and layout.
- `art27_sync_telemetry` authenticates, deduplicates immutable samples and atomically promotes a new live sample into `device_state`. Historical backlog is not a current reading.
- Anonymous installation sessions and `device_access` already scope every protected operation. Use the same app API authorization boundary.
- Expo SDK 57, `expo-notifications ~57.0.22`, `expo-device`, `expo-constants` and `expo-dev-client` are already declared. The Android package is `com.aquafeedpro.app`; EAS already has an internal development-client profile. FCM credential availability and the account's build readiness have not been verified.

The Notion master plan's October 3 execution snapshot is historical. Current Git, current Linear and the Mono Ink round 2/3 overrides control this delivery.

## Alert semantics

Use exactly the current crossing rules, with server-side runtime validation:

| Kind | Fresh valid value compared with the applied limit | Equality |
| --- | --- | --- |
| `do_low` | dissolved oxygen below `do_low_mg_l` | inside the limit |
| `do_high` | dissolved oxygen above `do_high_mg_l` | inside the limit |
| `feed_low` | shared-container percentage below `low_feed_threshold_pct` | inside the limit |

A null configured limit disables that rule and sets its crossing state to false, as `detectAlerts` does. For an enabled rule, unavailable, invalid, uncalibrated, stale or untrusted-time telemetry neither raises nor clears it. Validate each metric independently; valid oxygen does not make an invalid feed value usable. Use the existing 30-second metric freshness policy at evaluation time, not a new biological threshold. A future, missing or untrusted timestamp is unusable.

Raise once when a fresh valid reading changes a rule from false/unknown to true. Continued outside readings create no repeated event. A fresh valid inside reading clears the rule without a new alert; a later crossing creates one new event. A first fresh outside reading after rollout raises once. Desired/rejected configuration never becomes an applied limit. An applied limit change takes effect at the next new live sample; it cannot turn an old sample into fresh evidence.

Evaluate after `device_state` promotes a different `latest_telemetry_boot_id/latest_telemetry_sequence`, inside the same transaction, through a new narrow trigger/function in an additive migration. Do not evaluate every INSERT into telemetry: backlog arrives there too. Routine contact updates, a duplicate sync and stale sample replay produce no event. Serialize crossing state per device so concurrent requests cannot raise twice. Read the matching applied revision and current metric once in that transaction; store their identities on the event.

This delivery only observes telemetry. An alert never submits, repeats, stops or starts a feed, changes a limit or touches GPIO. Simulated alerts remain explicitly marked Simulator.

## Tables and access

Names below are proposed and become final with the contract delivery. Avoid a second generic notification framework.

| Table | Minimum fields and constraints | Access |
| --- | --- | --- |
| `public.alert_events` | `event_id` UUID; `device_id`; kind enum; finite value/limit; `applied_revision`; telemetry boot/sequence; measured/raised UTC times; `is_simulated`. Unique `(device_id, boot_id, sample_sequence, kind)`; index `(device_id, raised_at DESC, event_id)`. Immutable event facts. | SELECT only for installations with active access to that device, through existing membership semantics; no client INSERT/UPDATE/DELETE. Publish only this public table for optional Realtime read hints. |
| `private.device_alert_state` | One row per `(device_id, kind)`; boolean outside; last evaluated sample identity. Row lock while computing crossings. | Service/trigger only; not in Realtime or Data API. |
| `private.installation_alert_state` | `(installation_id, event_id)`; `read_at`, `dismissed_at`; plus an installation cutoff for clear-all/mark-all if that makes the existing actions smaller. | Service-only RPCs verify the installation and active event device access. No cross-installation read-state edits. |
| `private.installation_push_tokens` | One current Android Expo token per installation/EAS project; token fingerprint UNIQUE; raw token; updated/revoked times. Replace atomically on rotation and remove an old holder when the same physical token is registered again. | Service-only; never returned in history, Realtime or logs. Registration requires at least one active feeder membership. |
| `private.alert_push_deliveries` | `(event_id, installation_id)` UNIQUE; token registration generation; state; attempt count; next attempt; lease; Expo ticket/receipt ID; sanitized reason. | Service-only outbox. No private table in Realtime. |

All new exposed tables have RLS before grants. Every service-only public RPC revokes EXECUTE from PUBLIC, anon and authenticated, sets an empty search path, and validates installation/device access in the function; private helpers stay in private. Do not widen existing policies or change historical migrations.

The history is device-wide, so two actively paired phones see the same event facts. Read/dismiss preferences belong to each anonymous installation. Clear/remove hide events for that installation and never delete the shared event. On reinstall, a new anonymous identity must pair again; the server events are recovered after pairing, while old anonymous read/dismiss state cannot be identified automatically. State this boundary rather than promising identity recovery.

Query the latest 50 visible events using stable `raised_at,event_id` ordering and bounded pagination when requested. No retention deletion job is authorized; retain event facts until the owner chooses a retention policy.

## Additive routes and contract

Keep protocol major 2. Reserve the next additive minor after RT-01's 2.1.0 (proposed 2.2.0; recheck the merged contract before coding). Existing device sync DTOs, schedule/command behavior and nozzle semantics are unchanged.

- `POST /app-api/v2/push-token`: authenticated installation derived from JWT; strict request with protocol major, request UUID, platform Android, EAS project ID and bounded Expo token. Register/replace idempotently. Response is an acknowledgment without the token.
- `DELETE /app-api/v2/push-token`: revoke the current installation's token and cancel unsent deliveries; no token required in URL, query string or response.
- `GET /app-api/v2/notifications`: current installation's actively authorized visible event page and unread count. Return existing AlertEntry facts plus stable event/sample/revision identities; use the active installation's current device alias in presentation.
- `PATCH /app-api/v2/notifications/{event_id}`: explicit read or dismiss action after checking active access. The installation identity cannot be supplied in the body.
- One bounded bulk route for mark-all-read or dismiss-all matching the existing controls; restrict it to active feeder events and a captured cutoff so a concurrent newer alert is not lost.

Use existing InstallationJwt security, request/protocol headers, body limits, API errors and rate limiting. Add strict JSON schemas (`additionalProperties: false`), OpenAPI responses, changelog and shared TS/Python fixtures for registration, history, actions, malformed tokens, wrong major, unauthorized device and invalid timestamps. Token fixtures are obviously synthetic; never use a real token.

Push data contains only `event_id`, `device_id` and a fixed allowlisted route hint. Treat it as an untrusted navigation hint: validate, restore current authorization and re-read the server event before selecting a feeder/showing details. A push payload is never authoritative status or a command.

## Token lifecycle and revocation

Create the existing `feeder-alerts` Android channel before requesting notification permission. Register on a physical Android development build after session restore/pairing and permission grant; check/re-register on app resume and token rotation. Expo Go, web, denied permission and transient registration failure retain usable server history and never block feeding/settings.

Revoking one feeder membership atomically cancels that feeder's unsent deliveries and removes its eligibility. If the installation has other active feeders, its installation token may serve those; if the last access is revoked, delete/revoke the token. Perform this inside the existing revocation transaction via a narrow new trigger/helper so all access-removal paths are covered. Registration is no longer allowed with no active membership. Remove tokens on explicit permission denial, known invalid-token receipt and installation deletion.

Before claiming and immediately before sending a delivery, verify active access, current token generation and permission registration. A token changed since claim invalidates that claim. A push already accepted by Expo cannot be recalled; history/deep-link reads still deny access after revocation. Test this race explicitly and do not claim impossible transport cancellation.

## Push sender, retries and receipts

Use one development-scoped Supabase Edge Function and a durable database outbox, with platform-native scheduled invocation for retries/receipt polling. No separate broker, server or production resource. Whether Supabase Cron/pg_net is already enabled has not been verified; enabling a development invocation and its secret is an explicit owner setup step, not a source-readiness claim.

Enqueue one delivery per crossing and eligible installation in the same transaction as the alert. Sending happens after commit and never delays or reverses telemetry ingestion because Expo is down. A small service-only claim RPC uses leases and SKIP LOCKED; interrupted claims become retryable after their lease. Batch within Expo limits and never concatenate different EAS projects.

- Retry transport failures, HTTP 429/5xx and MessageRateExceeded with bounded exponential backoff and jitter; cap attempts and delivery age. Proposed development defaults: 5 attempts, maximum age 1 hour; document them as transport policy, not a feed safety limit.
- Store Expo's ticket ID and poll receipts later. A ticket means queued at Expo; an OK receipt means accepted by FCM, not observed by the owner.
- DeviceNotRegistered revokes that registration and cancels queued attempts. InvalidCredentials and malformed/oversized payloads pause/fail the affected delivery with sanitized diagnostics for owner action; do not loop blindly.
- Deduplicate server enqueue/claims by event and installation. Use a stable event identifier/tag on Android where supported and suppress duplicate foreground presentation by event ID. A timeout after Expo accepted a send can still duplicate a remote display; delivery is best-effort, not exactly once.
- An alert that has since cleared remains history. Old alerts past the transport age limit are not sent as if current.

Use existing Supabase secret management for the worker invocation credential and optional Expo push security token. The phone/feeder never receives service-role, FCM or worker credentials. Keep Firebase service-account keys and all real push tokens out of repository files, prompts, Linear, Notion and logs. Logs contain only non-secret event/delivery IDs, timing and sanitized status categories.

## App changes and visual boundary

Reuse the existing bell, unread indicator, sheet, title/row rendering and controls. Replace local event discovery/history with authorized server reads and server-backed read/dismiss actions. Subscribe while active and keep a focus/resume refresh fallback; scope every completion to current installation/access, remove channels on cleanup and purge inaccessible cached rows.

Remove the old phone-local AlertWatcher as an event source in the same delivery that activates server history, so it cannot create a second alert for the same crossing. Remote push presents alerts while backgrounded; foreground reads update the list without a second local system notification. Do not add a new page, onboarding flow or unrelated layout.

The existing sentence “This removes every notification from this phone.” becomes misleading when preferences are server-backed. The accepted app delivery must explicitly replace only that sentence with an accurate installation-scoped description; record it as an authorized wording change. Keep the rest of the layout and strings unless an acceptance decision requires a precise change.

## Delivery breakdown and ownership

The implementation proposals are [ART-95 — server alert crossings and history](https://linear.app/artkin/issue/ART-95) and [ART-96 — Android push delivery](https://linear.app/artkin/issue/ART-96), both in Backlog. Dispatch them only after the owner accepts the design/build direction; the proposed split is not pre-approved coding work.

1. **Server crossings, history and contract (ready without FCM after design approval).** One writer/worktree owns the new migration, rollback test, new history/app routes, database types, shared schema/OpenAPI/fixtures and simulator crossing scenarios. Complete the crossing/history/access flow, with synthetic telemetry proving alerts when no phone runs. No external push send. Requires ART-92 merged before touching the shared contract/backend; serialize with RT integration.
2. **Android push end-to-end (depends on delivery 1; external setup only blocks live checks/build).** One writer/worktree owns token/revocation and delivery migration/RPCs, sender/outbox tests, app token lifecycle/server list wiring, Android notification config and build handoff. Reuse declared Expo dependencies; only add a package/config change if the accepted delivery needs it. Includes the narrow confirmation wording correction above. All source/mocked transport checks can run with synthetic credentials; actual build and closed-app receipt require owner-managed FCM/EAS setup.

The split is by two complete observable outcomes, not coding/testing/integration tickets. Fixes and review stay in each delivery. Do not change ART-71, ART-77, ART-84 or ART-76 or reopen their completed visual work. No notification implementation is concurrent with RT writers on shared backend/contracts or mobile resources; this design file alone is disjoint from ART-92/93/94.

## Focused verification and owner acceptance

Source checks:
- Match current detectAlerts for below/above/equality, continuous outside, inside/re-cross, disabled limits and first outside sample.
- Mixed metric quality, stale/future/untrusted time, absent applied configuration, pending/rejected desired limits, historical backlog and duplicate live sample never invent current evidence or a second event.
- Two concurrent crossings produce one event/delivery; two installations share facts but cannot modify each other's preferences/tokens. Revocation before claim/send/history denies access; shared token remains valid for another active feeder only.
- Token rotation, denied permission, no active membership, uninstallation/invalid token, repeated route request, claim lease expiry, 429/5xx, receipt failures and ambiguous send are covered with a mocked Expo service.
- Both contract validators; relevant mobile lint/types/format and existing alert, monitoring, device-access, feed and schedule checks when affected. No emulator or real secrets.
- Simulator scenarios use the same authenticated telemetry and applied configuration; one crossing, invalid/stale sample, clear/re-cross and offline backlog. They never touch hardware.

Owner development steps, currently **not run**:
1. Accept closed-app Android push for the thesis, development-build installation and the proposed two deliveries; name the Firebase/FCM credential custodian.
2. Verify the existing EAS project/build account and development Supabase link; create or select a Firebase project and register the existing Android package. Keep FCM v1 service-account credentials in EAS/owner secret management and the Android Firebase configuration private/ignored as appropriate.
3. Apply only reviewed development migrations/functions and configure the guarded platform retry invocation. Produce/install an internal Android development build, never a public release.
4. Pair a physical Android phone, grant permission, close/background the app, upload a fresh valid simulator crossing and observe one OS notification and the matching server-history row. Repeat clear/re-cross, network outage/restoration, permission denial, access removal, token invalidation and two-phone history.
5. Test notification tap after access removal, re-pair after reinstall, and foreground deduplication. Record exact commit/build identity and observed timings. Android force-stop and platform delivery restrictions require separate observation; do not promise receipt after force-stop.

A passing mock or Expo ticket is not phone acceptance. None of these checks proves biological limits, physical dispensing or feeder hardware readiness.

## Official references checked

- [Expo SDK 57 notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) — installed-version API and Android development-build boundary.
- [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) — EAS project binding and Android FCM credentials.
- [Expo sending and receipts](https://docs.expo.dev/push-notifications/sending-notifications/) — retry classes, receipts and invalid-token handling.
- [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) — public publication and access checks.
- [Supabase changelog](https://supabase.com/changelog) — current platform changes reviewed; no change to the RT or push design's existing authorization boundary is required.
