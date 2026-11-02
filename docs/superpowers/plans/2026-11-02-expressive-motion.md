# Expressive Motion and Floating Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Single assigned visible Herdr worker; do NOT spawn subagents/reviewers. Orchestrator personally reviews.

**Goal:** Implement the owner-approved visual prototype accurately: in-content context instead of fixed headers, Paper floating dock, expressive replay on every navigation, count-ups and a clean animated real-data graph.

**Architecture:** Refine existing React Native Animated, shared shell and react-native-svg rather than replacing routes/services or adding a web-only implementation. One focus/entry lifecycle drives presentational replay; all business state, identities, input and data remain independent. Native stack owns full-page push/pop, sheets own overlays, web uses shared page motion.

**Tech Stack:** Existing Expo58 / RN0.88 / React19 / Expo Router / RN Animated / react-native-svg / TypeScript; no dependency or lockfile changes.

**Spec:** `docs/superpowers/specs/2026-11-02-expressive-motion-design.md` (owner-approved reference in `docs/design/expressive-motion/reference.html`).

## Execution checkpoint — source candidate, browser held

- [x] Verified assigned worktree/branch clean at exact `b82b55a116bb04eaf1e533d81f8a901ff2528781`; read reference HTML/screenshots, affected flows, SDK58 router docs/installed types and origin/main motion (read-only).
- [x] Existing-lock `npm ci --prefer-offline --no-audit`; full assigned baseline checks exit0.
- [x] Task1 source: every-focus/foreground replay, latest-target/scope/quality cancellation, decorative eligible numbers, actual semantics; executable RED→GREEN and intermediate frames.
- [x] Task2 source: Paper moving dock, measured safe-area/last-row clearance, keyboard hiding, in-content identity/actions, authorized selector and late-session guard, faster sheet exit. Owner's additional Schedule circular Add + enabled/timezone subtitle and History circular Filters + date/timezone subtitle are implemented; refresh remains separate, no competing Schedule FAB.
- [x] Task3 source: clean clipped real-data graph sweep, original gaps/limits/inspection preserved, valid feed-meter reveal; no `lib/monitoring.ts` or fabricated telemetry changes.
- [x] Full assigned final source suite exits0; evidence `expressive-final-source.log` outside repository. Docs explicitly supersede historical static motion only.
- [ ] Actual browser layout/frame/reference batch and bounded correction/confirmation. **WAITING on owner permission: no Expo/Metro started, no browser comparison claimed.**
- [ ] t7's personal exact-diff/check/rendered-motion review and verdict. No worker self-approval, push/PR/merge.

Ruling: keep the implementation as one cohesive candidate commit while rendered acceptance
is held, rather than separate partially dependent Task1/2/3 commits. These are the
approved expressive plan's internal steps, not a restart of premium Tasks02–06.
External `expressive-progress.md` / `expressive-report.md` retain RED→GREEN log
paths and the exact candidate commit. Native evidence and the two existing held
policy/API gaps remain open; source checks do not close them.

## Global Constraints

- PR base `feat/premium-01-design`, not main; no worker push/PR/merge/release.
- Exact starting base `cb581fea85f6d43e56a17ac923701d62665ddb27` plus coordinator reference/spec/plan commit. Compare `origin/main` motion as evidence, not wholesale rollback.
- New motion contract supersedes only historical static/one-shot/no-count-up/fixed-shell assertions. Preserve all safety/auth/configuration/race checks.
- All animation remains presentational: no action/refetch/rekeyed route on animation completion or replay; no fake data, unsafe requests, cross-device stale frames.
- Paper dock default only; no theme option or new dependency, backend/controller/API refactor.
- No production/cloud/hardware operation; browser fixtures intercepted and external origins blocked.
- Missing native evidence remains explicit, never claim web/Metro means native acceptance.

## Review Focus

- Rapid A→B→A plus background/reduced preference changes: cancel obsolete work and settle correctly, no overlay or blank route.
- Number target/quality/device changes mid-tween: old frames cannot overwrite newest actual value; null/stale remain truthful and AT uses actual values.
- Floating dock with keyboard/landscape/largest text: no hidden last row/FAB/footer, preserved scroll/input; every tab has48px target.
- Graph sample gaps/isolated points/limit crossings/invalid clock: no fabricated line through gaps or lost inspection labels while revealing; polls do not restart.
- Feeder switch failure/access/session change: new visual context must not leak old data, lose notification/filter/refresh/add/back controls or reset saved state.

---

### Task1: Focus replay and presentational numeric motion

**Files:** `mobile/src/components/motion.tsx`, `mobile/scripts/check-motion.mjs`.

**Interfaces:** Preserve existing `Motion`, `useEntranceMotion(trigger?, enabled?, distance?, delay?, duration?)`, `useAnimatedNumber(target, eligible, scope)`, `AnimatedNumber`, `MotionSection`, `MotionScrollView`, `MotionPressable` consumers. If one small entry-generation helper/context is needed, define/export it HERE and reuse it rather than adding independent timers in every route.

- [ ] Verify clean base/owned paths; install from existing lock and run baseline source checks listed in Task4 before edits. Read installed/versioned APIs and original main implementation.
- [ ] Extend executable motion tests BEFORE product changes: focus→blur→focus produces second entrance; three rapid switches leave current content visible; background/reduced settles/no outstanding loop; eligible count produces intermediate then correct final; target/scope/quality/null changes cancel old frame; actual accessibility label stays final. Record RED evidence.
- [ ] Implement spec460ms page/520ms cards/55ms capped165 stagger/740ms numeric defaults with existing Animated. Avoid async-preference-induced flash and focus-driven route remount. Counters run only for eligible numeric displays on entry, not every poll; preserve correct decimal formatting via actual caller use.
- [ ] Make viewport sections replay once per entry and only when relevant/visible, not every scroll or data update. Preserve scroll container/layout and focus semantics. Keep press feedback immediate and independent.
- [ ] Run `npm run check:motion`, lint/typecheck; commit owned changes. Old tests tied to superseded policy must be explicitly replaced by stronger replay/cancellation tests, not simply removed.

### Task2: Header-free content and moving floating dock

**Files:** `mobile/src/components/app-shell.tsx`, `mobile/src/components/bento-kit.tsx`, `mobile/src/app/(tabs)/_layout.tsx`, `mobile/src/app/_layout.tsx`, four tab routes `(tabs)/index.tsx`, `schedule.tsx`, `history.tsx`, `device.tsx`; optionally ONE focused `mobile/src/components/feeder-context.tsx` if embedding it in app-shell would hurt separation. Tests: `check-motion.mjs`, affected actual-route tests in check-device-access/check-feed-status/check-manual-feed as needed.

**Interfaces:** Keep `AppPage`/`ScreenHeader` working for pushed routes and no-device/error startup. Shared context consumes existing `useDeviceAccess` devices/selectDevice/current selection; existing Sheet/ListRow/IconButton and router APIs. No new service API. Floating dock uses existing tab navigation with moving selection visual from measured layout.

- [ ] Add failing shell assertions: no fixed tab title strip, all original filter/refresh/add/bell/back actions remain; last content/FAB clears dock; changed tab selection does not reset scroll/route state. Pin48px targets and safe-area-aware inset. Regression for failed/late feeder selection leaves truthful context/error.
- [ ] Match Paper dock reference radius27, inset16, padding7, >=12px bottom-safe-area gap, selected dark rounded20 surface and label/icon contrast. Animate selection from current position; verify supported navigation API instead of guessing. Reserve actual bar height in content; handle keyboard/landscape/text enlargement.
- [ ] Move tab identity/actions into scroll content; Home starts with feeder context rather than Home+logo. Keep authenticated contact/quality visible and page headings for other tabs. Preserve empty/loading/error/device scope and underlying data-fetch hooks; don't remount stateful routes for visual replay. Pushed routes retain accessible title/Back.
- [ ] Tune shared sheet/native stack durations per spec without double transition; preserve all existing sheet interrupt/drag/focus/Back safety behavior.
- [ ] Run lint/typecheck/motion and affected route checks; commit coherent shell delivery.

### Task3: Accurate clean graph and dashboard presentation

**Files:** `mobile/src/app/(tabs)/index.tsx`, motion helpers if needed, `mobile/scripts/check-art27-monitoring.mjs`, `mobile/scripts/check-motion.mjs`. `buildDoGraphShape` in `mobile/src/lib/monitoring.ts` is READ-ONLY unless coordinator authorizes a demonstrated geometry defect; no graph fake-data rewrite.

**Interfaces:** Existing actual graph shape paths/dots/samples/limit lines, actual eligible `AnimatedNumber` and current request/measurement state. Graph reveal runs per entry/range identity only, latest data geometry is always model truth.

- [ ] Add executable failing tests for reveal on return, no replay on poll, null/stale counts and geometry retaining gaps/isolated dots/limits/invalid-time text. Preserve existing keyboard point inspection assertions.
- [ ] Match reference card spacing/large DO+small units, clean thin graph with restrained grid and real time labels, metric tiles and primary Feed now. Replay valid feed-remaining meter presentation (up to800ms) with actual percentage/low-feed accessibility immediate, never animate command progress. Remove decorative hatch if necessary; do not remove actual scale/limit/freshness controls or safety notices.
- [ ] Implement left-to-right reveal of actual gap-aware paths/dots (up to900ms), using supported SVG/Animated clip/stroke technique. Do not scale/morph geometry through invented readings or animate inspection cursor falsely. Parent animation and graph reveal coordinate, cancel safely and respect reduced motion.
- [ ] Run monitoring/motion/typecheck/lint, commit. Capture measured intermediate graph and count-up frames, not just a settled screenshot.

### Task4: Full reference comparison and safe final delivery

**Files:** owned docs `docs/MOTION_ANIMATION.md`, `docs/PREMIUM_UI_UX_ACCEPTANCE.md`, old spec motion section cross-reference, current new spec/plan progress; external evidence ONLY `.premium-ui-coordination/expressive-*`.

- [ ] Run exact final mobile commands: lint, typecheck, check:motion, check:monitoring, check:feed-status, check:manual-feed, check:button-state, check:device-access, check:alerts, check:error-text and `node scripts/check-schedules.mjs`; git diff --check.
- [ ] One visible own Metro on18088 with safe no-dotenv localhost dummy config; serialize heavyweight browser work. Prepared reference companion55975 stays independent; owner old Expo18086 should be paused by coordinator before worker browser use. No touching other workers/server ports/accounts/global heaps.
- [ ] Compare actual RN-web against approved reference at375/390 phone, desktop and812x375 landscape, normal/reduced motion. Verify ALL page entries/returns, rapid nav, count/graph intermediate frames, dock travel/accessibility/keyboard scrolling, original filter/refresh/add/selection/bell/sheets/back interactions and live-state fixtures (empty/error/offline/pending/uncertain). Existing check scripts may need selectors adapted only for approved layout changes. Zero unexpected external requests/actions.
- [ ] Inspect screenshot batch, correct all material mismatches in one bounded pass, confirm once; don't call settled screenshot proof of smoothness. Record runtime frame evidence and limitations; no performance/native claim from dev headless runs.
- [ ] Reconcile old motion/acceptance docs so original one-shot/no-count-up assertions are clearly historical/superseded. Report existing notification transport/offline-policy gaps unchanged. Keep final native matrix unverified where unavailable.
- [ ] Stop own server; commit only allowed product/doc/test/reference changes; write `expressive-report.md` with exact SHA, changed files, before/after regressions, commands, frame/layout/reference comparison, platform gaps. `hc send t7 READY_FOR_REVIEW ...` then hold same candidate/session for corrections. Coordinator personally reviews and opens PR only after PASS.
