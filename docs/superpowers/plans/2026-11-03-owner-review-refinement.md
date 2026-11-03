# Owner Review Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Repository/owner workflow overrides default subagent review: SAME visible t1v implements; ONLY t7 personally reviews; no nested agents.

**Goal:** Implement the owner's screenshot review, continuous draggable dock, correct subpage return motion and missed-schedule notifications without weakening device/saving semantics.

**Architecture:** Keep current Expo Router route identities and existing page/card/count/graph motion. A shared tab-presentation lifecycle distinguishes committed tab entry from temporary overlay/stack focus loss; gesture previews are presentation only. Simplify existing components and reuse row markup; extend the existing durable ART100→ART96 alert/push flow for scheduled rejected/expired outcomes, not client-generated alerts.

**Tech Stack:** Existing Expo58/React Native0.88/React19.3/TypeScript, installed Gesture Handler3.3/Reanimated4.7/Worklets0.13, existing RN Animated where appropriate; Supabase PostgreSQL migrations and existing Edge Functions/push delivery. No dependency/lockfile changes.

**Spec:** docs/superpowers/specs/2026-11-03-owner-review-refinement-design.md (owner approved).

## Global Constraints

- Exact implementation start cb8ddcb21b5f94d96d18109805fbb47c1b8e9d48, feat/premium-expressive-motion, existing isolated worktree; PR72 remains to feat/premium-01-design, never main. No merge/deploy/hardware/feed actions.
- One writer t1v; no subagents, no worker push/PR. T7 personal PASS required before updating remote candidate/manual actual-config preview.
- Preserve current page-entry animation timings/easing/stagger/count/graph on real tab entries. No replay on returning from covering subpages. Retain scroll/filters/drafts/route identity.
- Drag continuously previews real rendered page content; commit destination only on release, tap still works, cancellation restores committed tab. Animation frames never issue business operations.
- Actual applied/requested and confirmed/uncertain/failed states remain distinct. User-approved compact recovery preserves Check original save / Retry SAME original request.
- Keep truthful unknown/stale/simulator/contact/measurement facts, two-nozzle sequential ordering, confirmation and duplicate-submit protection.
- No new notification subsystem, backfill, cloud operations, secrets or global configuration changes. SQL changes are new versioned migrations, not rewriting already-applied history.
- Read matching Expo58 docs and actual installed API/types before Expo/RN gesture/navigation changes; follow related skill docs. Existing UI framework stays.
- Source freeze for orchestrator measurement; serialize Chrome/Metro. Owner reference55975 stays running. Actual-config preview must not show in-progress source as reviewed.

## Review Focus

1. A canceled drag after crossing several tabs must not leave hidden tabs focus-entered, changed filters, duplicate route events or partial visual positions (Tasks1–2).
2. Scope/data/reduced-motion/foreground changes during a covered parent must reveal latest actual values without replaying on sheet close or displaying obsolete device data (Tasks1,7).
3. Pending schedule added/deleted elsewhere, failed/uncertain write and target-device changes must not be hidden by cosmetic busy toggles or enable repeat writes (Task4).
4. Pull-to-refresh with filters/pagination plus empty/error/offline results must not lose rows/scope or get permanently stuck; keyboard/AT users need refresh without drag (Task5).
5. Rejected/expired scheduled outcomes, duplicate final reports, manual refusals and revoked installations must produce exactly the intended durable events/push eligibility, with honest missed wording and no retrospective spam (Task6).

## File map / ownership

- Shared presentation: mobile/src/components/motion.tsx, app-shell.tsx, bento-kit.tsx; mobile/src/app/(tabs)/_layout.tsx and mobile/src/app/_layout.tsx.
- Optional small shared presentation-only module mobile/src/components/tab-presentation.tsx if required by real Router scene composition. Do not introduce global business-state store or cloned/screenshot pages.
- Page cleanup: mobile/src/app/(tabs)/index.tsx, schedule.tsx, history.tsx, device.tsx; mobile/src/app/history/[runId].tsx; mobile/src/app/devices/[deviceId].tsx.
- Shared compact history row: prefer existing bento-kit ListRow; add mobile/src/components/feeding-row.tsx ONLY if it eliminates actual duplication between Home/History without importing route code into another route.
- Nontrivial regressions: mobile/scripts/check-motion.mjs, check-feed-status.mjs, check-manual-feed.mjs, check-device-access.mjs, check-alerts.mjs, check-schedules.mjs as actually affected. New focused executable helper/tests allowed; no fake source-string proof of rendered drag or SQL behavior.
- Backend: new supabase/migrations/20261103000000_scheduled_missed_alerts.sql; new supabase/tests/scheduled_missed_alerts.sql. Relevant existing ART95/96 tests and push sender/API parsers/copy may be changed only as required by compatible alert policy. Read actual schema/contracts first.
- Notification callers permitted if needed: mobile/src/lib/alerts.ts, mobile/src/lib/notification-controller.tsx, mobile/src/lib/push-payload.ts; supabase/functions/_shared/push-sender.ts and supabase/functions/app-api/index.ts; contracts/README.md, CHANGELOG.md and alert schemas/fixtures if actual wire shape/kind requires. No unrelated notification loading/controller redesign.
- Docs: this plan/spec, docs/MOTION_ANIMATION.md, docs/PREMIUM_UI_UX_ACCEPTANCE.md. External logs/helpers/reports in .premium-ui-coordination, not product screenshots/log dumps.

### Task1: Correct semantic entry lifecycle / subpage smoothness

**Interfaces:** Existing useEntranceMotion(trigger?, enabled?, distance?, delay?, duration?) and useEntryProgress(target,eligible,scope,duration,replayKey?) retain callers. Shared entry source identifies committed tab index/entry generation independently from root focus; both page/card and count/graph consume the same reason-aware policy. Do not add special-case pathname checks to each page.

- [ ] Read root stack/sheet/motion callers and Expo58 routing docs in full where affected; reproduce current Feed now→close parent replay with actual computed/text frames, retain RED evidence.
- [ ] Add failing executable tests for genuine Home→Schedule→Home replay, Home→Feed now→close NO page/card/count/graph replay, History→details→Back NO replay, Settings→device details→Back NO replay; foreground return still replays once and ordinary polls do not.
- [ ] Run targeted tests before implementation; record expected failing assertions, not a test harness exception.
- [ ] Implement smallest shared semantic-entry policy; preserve native stack as full-page transition owner and sheet as transparent-modal owner. Profile open/close/cancel/reopen to locate duplicated transition or avoidable frame churn before adjusting implementation. Preserve original page animation constants.
- [ ] Add scope change while covered, updated live data, reduced-motion toggle, interrupted close/reopen and actual retained scroll assertions. Run npm run check:motion and relevant source checks; browser runtime evidence follows Task7.
- [ ] Commit scoped lifecycle correction.

### Task2: Continuous dock scrub with real scene movement

**Interfaces:** Dock still receives current Expo Tabs state/descriptors/emitter/navigateToTab; commit respects tabPress preventDefault. Shared presentation state exposes fractional tab position and gesture-active flag to real route-scene composition, separate from committed route. No pushState/navigateToTab per frame, no fake screenshot/copy of page.

- [ ] Inspect installed Expo58 Tabs scene composition/keep-mounted capabilities and matching docs. If impossible without a new navigator/dependency, stop and report concrete constraint rather than replace architecture silently. Existing installed libraries are allowed.
- [ ] Add failing gesture-state tests: tap selects once; drag0→3 releases Settings; drag3→1 releases Schedule; canceled0→3 restores0; clamp bounds; fast reverse/interruption; prevented commit restores prior route. Test actual route-event counts, not just arithmetic.
- [ ] Implement installed UI-thread gesture motion where supported and real mounted page translations from fractional position. Snap to tab at release; smooth dock icon/selection state. Keep existing page/card animations on final semantic entry without replaying each intermediate preview. Preserve layout/dock clearance and keyboard behavior.
- [ ] Add mouse/touch/keyboard alternative and reduced-motion assertions; no active business effects/fetch-on-frame or route remount. Test existing retained History offset and schedule/editor drafts after scrubbing.
- [ ] Run npm run check:motion/typecheck/lint; actual intermediate live-content and tap-after-drag browser tests required Task7.
- [ ] Commit gesture delivery separately so t7 can review lifecycle vs gesture behavior independently.

### Task3: Home simplification and shared compact feeding rows

**Files:** Home, bento-kit/shared feeding row, History callers; monitoring primitives untouched.

- [ ] Add failing assertions for no visible High/Low text but retained limit lines/accessibility; centered metric layouts; fresh/unknown/stale/simulator/two-target Home fixtures with concise remaining-feed text; same compact row Home/History.
- [ ] Remove only visible threshold text labels, retain actual graph limits/axes/range/inspection/gaps. Center percent/time value regions and avoid duplicate percent/overlong mass prose; preserve necessary stale/last measured and next date/nozzle/dose facts.
- [ ] Implement common compact outcome-icon/title/time/chevron row using real metadata, accessible outcome and navigation to same read-only details; remove visible repeated dose/status paragraphs from these list rows only.
- [ ] Run check:monitoring, check:feed-status, check:manual-feed, check:motion. Verify compact does not turn unknown into0 or stale into fresh.
- [ ] Commit scoped Home/row changes.

### Task4: Quiet schedule states, fully retained recovery

**Files:** Schedule, shared Toggle/busy primitive only as needed, relevant schedule/manual-feed/motion tests.

- [ ] Add failing tests for removing redundant feeder/count summary and badges; pending same-row grey/wave cue; applied vs target distinct; actual existing original-request check/retry remains functional for uncertain result.
- [ ] Remove repeated normal pending/success and duplicate requested-list UI; preserve a compact truthful summary for pending add/delete/unmapped rows. Wavy busy is presentation-only, reduced-motion static; do not suppress rejected/uncertain/error or reuse pending style as success.
- [ ] Replace large uncertain/rejected banner with compact labeled opener/recovery area. Same Check original save and Retry SAME save actions, same durable request identity, locking and cross-device/auth late-completion behavior.
- [ ] Retain timezone calculation/accessibility and meaningful mismatch/error info; remove redundant Enabled/Paused labels and normal count/timezone block. Scoped target still explicit in editors/confirmations.
- [ ] Run node scripts/check-schedules.mjs, check:manual-feed, check:button-state, check:motion. Add pending across device change, duplicate press, rejected→recovery and reduced-motion cue tests; demonstrate no write from busy animation.
- [ ] Commit schedule simplification.

### Task5: Pull refresh / readable details and Settings

**Files:** History, app-shell/motion shared scroll refresh props, detail routes, Settings and device-access tests.

- [ ] Add failing tests for removed nonHome feeder strips, visible History heading/Filters only, real pull refresh and non-gesture accessible refresh action. Pin filters, pagination/scroll, no duplicate fetch and error/outdated outcomes.
- [ ] Wire actual refresh lifecycle to existing data refresh callback using supported platform ScrollView behavior; implement web pointer/keyboard alternative if native RefreshControl alone doesn't cover it. Reuse existing control behavior, no invented refresh timer.
- [ ] Center History summary counts. Reorganize read-only feeding details into outcome/reason, timing and nozzle actual result groups; raw IDs/codes in Technical details, no lost requested/measured distinction or simulator/unknown facts.
- [ ] Reorganize device details into editing, short factual overview, technical disclosure, distinct removal area; preserve input validation/retention, authorized saves and existing confirmation/removal scope. Remove redundant Settings selected-feeder header only.
- [ ] Run check:device-access, check:feed-status, check:manual-feed, check:motion and lint/typecheck; actual responsive/layout/refresh tests Task7.
- [ ] Commit scoped detail/refresh/Settings changes.

### Task6: Missed scheduled executions → existing alerts/push

**Interfaces:** Existing private.art100_feeding_alert_kind(uuid,uuid,text), private.art100_raise_feeding_alert(), existing one-event identity and ART96 queue/sender/auth remain source of truth. Read schema source/terminal semantics and wire contracts before choosing compatible event kind/copy. No client-generated notification on History open.

- [ ] Trace actual source enum, sequence creation/finalization and ART100 trigger, ART95 event parser, ART96 enqueue/sender and app push tap path. Record exact current exclusion of rejected/expired and safe proposed extension.
- [ ] Add new executable local SQL tests proving scheduled rejected/expired create appropriate durable missed event and delivery eligibility; duplicate status update does not duplicate; manual rejected/expired unaffected; failed/partial/unknown/unmeasured existing cases unchanged; revoked access/token still suppressed. Failing tests must run against actual local DB if available; otherwise report execution blocker, never claim SQL PASS from regex.
- [ ] Add new versioned migration extending existing trigger and classification to scheduled rejected/expired only, preserving current lock/order/event identity. Reuse compatible alert kind if truthful and contract-safe; if a new kind is actually needed, update ALL strict parsers/schema/fixtures/title/body mappings and focused tests in same commit. No edits of applied old migrations or historical backfill.
- [ ] Ensure visible copy is accurate for missed/not-started outcomes and real reason remains accessible. Update push sender/mobile copy together if changing kind semantics. Do not invent measured dispensed quantities or classify unknown as definitely failed.
- [ ] Run local SQL suite when available, existing supabase/tests/art96_push_sender_check.mjs and art95_api_route_check.mjs as affected; mobile check:alerts and contract validation commands from contracts/package.json. Document unavailable DB/physical phone/config/deployment gates explicitly.
- [ ] Commit migration/callers/tests/docs together; NO remote migration/deploy/push sender invocation/actual notification or hardware operations.

### Task7: Bounded runtime evidence and exact handoff

- [ ] Run final lint, typecheck, motion, monitoring, feed-status, manual-feed, button-state, device-access, alerts, error-text and schedules suites; diff-check. Record exact command/exit and code SHA, not just earlier results.
- [ ] Ask t7 for serialized Chrome/Metro slot. Own one dummy no-dotenv localhost fixture utility18088, external origins/writes blocked; never use actual .env.local or manual preview environment for automated scenarios. Reference stays running. Test navigation, parent-close vs true tab entries, fractional drag real pages, icon/selection frames, cancellation/prevented navigation, subpage progression, rapid interaction, 375/390/desktop/landscape, reduced motion.
- [ ] Capture screenshot pairs for requested cleanup, actual intermediate rAF/style/text samples and max/p95 gaps. No p95-only smoothness guarantee: report outliers including pre-transition pauses. Compare existing animation shape/timing to approved reference without hiding truthful extra states.
- [ ] Runtime checks include pending/uncertain/rejected schedule recovery (same original request), unknown/stale/simulator/two-nozzle, filter/scroll retention, pull refresh + keyboard alternative, compact rows and details, validation/input retention on device page. Block real backend/feed writes; generated expected fixture mutations only.
- [ ] Update motion/acceptance docs and this plan with observed evidence and explicit unavailable native/SQL/push gates. Save external owner-refinement-report.md with exact finalSHA/changed files, RED→GREEN, resource ownership and scope deviations. READY_FOR_REVIEW only, not PASS.
- [ ] Stop worker Chrome; freeze source; keep dummy server ONLY if t7 requests final recheck, otherwise stop own utility. hc send t7 report path and exactSHA. No worker push/PR/merge. T7 personally reviews/rechecks; corrections stay same t1v/session/worktree.

## Plan self-review / execution method

Checked all screenshot requests and navigation clarification against approved spec: Tasks1–5 own UI/motion, Task6 owns authorized alert scope, Task7 owns evidence. Each Review Focus is pinned above. Existing one-worker execution/direct coordinator review supplied by owner and repo remains; no new approval cycle for implementation mechanics or delegated-review options. These are owner corrections to open PR72, not a new independent worker task. Backend work is serialized in same delivery; if execution constraints make actual push unverifiable, report that gate rather than claim complete.
