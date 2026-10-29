## Goal
Implement the owner's approved **neutral interface with localized ocean accents**, floating rounded navigation, polished motion/count-up readings, modern grouped Settings, and supplied fish branding throughout the existing AquaFeedPro mobile app. All current functionality and safeguards remain. Every subpage and state must follow the same system, including screens not illustrated by the prototype.

This is the parent design contract and acceptance checklist. Execute its scoped child issues, not a second implementation from this parent.

## Exact design reference and precedence
**Authoritative reference:** revision **10**, `app-icon-v10.html` (neutral layout from revision 07, supplied mascot from revision 09, supplied app icon from revision 10). The reference archive attached to this issue is the durable source; extract it and open `reference.html` locally. It is self-contained, includes embedded assets, and its controls are for design exploration only.
- Live convenience preview: http://localhost:56491/?key=bf20338103565ca7ccb6d81136a595093ec20a6941338cd8dc796ae531f0e128 . This is a local, temporary server; implementers must not depend on it being reachable.
- Current local source: `C:/Users/user/.codex/visualizations/2026/10/29/01a187c5-59bc-7373-9b8b-6d36736cd986/.superpowers/brainstorm/1620-1793283447/content/app-icon-v10.html`.
- Approved mascot: `D:/thesis commision/Automated Fish Feeding System/assets/mascot-concept-v1/aquafeedpro-mascot.png`.
- Approved icon: `D:/thesis commision/Automated Fish Feeding System/assets/mascot-concept-v1/aquafeedpro-app-icon-v2-three-quarter.png`. Use v2, not the earlier v1.
- Layout inspiration only: attached travel-app reference (white/light-gray surfaces, dark inset rounded controls, color contained in focal content). It does not add travel features, photos, accounts, or destinations to AquaFeedPro.
- Background reading only: https://dribbble.com/stories/2019/02/15/what-defines-good-ui-design .

The final owner preference is **not the earlier full-screen navy/teal, cobalt/coral, or sand palette**. Use mostly neutral surfaces with ocean color restricted to graphs, inventory indication, and small semantic accents.
The repository's current `DESIGN.md` still describes Mono Ink. As part of the first child, reconcile its visual/motion requirements with this newer owner-approved direction and preserve behavior requirements. Do not restore the old Mono Ink appearance because an older document says approved. Existing integrated behavior/code wins over simplified prototype interactions and obsolete statements that nozzle support is unimplemented.

## Native stack — mandatory
Use the existing React Native / Expo / TypeScript / Expo Router app in `mobile/`, its Supabase integration, Reanimated, Worklets, Gesture Handler, React Native SVG, safe-area-context, Expo Image, bundled Inter, and the existing Lucide icon family.
Observed planning baseline: local `main` at `de8778a1e2844b2b98244fd07bfc229f5b0f6058`; Expo ~58.0.17, React Native 0.88.0, Reanimated 4.7.1, SVG 15.16.0. Verify the actual implementation base and matching Expo versioned docs when work starts.
**No HTML/CSS/DOM, WebView wrapper, framework migration, chart-engine replacement, new animation library, or SDK upgrade.** Existing SVG + Reanimated can render the proposed chart. Existing Supabase/backend/protocol is unchanged. No new dependency is approved by this issue.
Known uncommitted work at planning time: `mobile/package.json`, `mobile/package-lock.json`, `mobile/src/components/motion.tsx`, `mobile/src/lib/notification-controller.tsx`, plus untracked `debug.log`. Reconcile ownership and preserve it; this issue does not authorize resetting/staging unrelated WIP.

## Visual contract
### Light mode
- Page: `#F4F5F6`; cards/sheets: white; primary text: `#20272A`; supporting text: `#58646B`.
- Primary actions and floating tab dock: charcoal `#22292C`; white labels. Feed now has a trailing white circular arrow treatment.
- Graph: marine line `#126782`, aqua fill/details `#18B7B0`, pale localized plotting surface approximately `#F0F6F6`. Feed progress uses aqua.
- Use semantic status colors with labels/icons. Keep disabled/pending/stale/unknown states distinguishable; color is never the sole status indicator.
- Rounded cards, generous but compact spacing, clear large readings and smaller units; no full-screen color wash, gradients/glow, heavy border around every row, generic promotional text, or decorative stock imagery.
### Dark mode
Neutral charcoal `#161A1D` page / `#22282C` cards, `#F4F6F7` text, `#B6C0C5` supporting text. Apply the same restrained hierarchy and localized ocean graph accents. Re-measure composed contrast independently. The reference's dark treatment uses a light dock with a charcoal active pill; preserve readable selected/unselected icons.
### Layout and navigation
Four existing destinations: Home, Schedule, History, Settings (`/device` stays the existing route). The rounded rectangular dock floats with a visible gap on left/right/bottom and safe-area clearance. Active selection slides; icons/text respond without layout shifts. Never cover Feed now, form actions, final rows, or system gestures. Subpages keep proper back/close behavior and matching headers/sheets rather than acquiring arbitrary new tabs.
Use semantic tokens and shared components, 4/8 dp rhythm, about 16–20 dp gutters, 16–24 dp card/sheet radii, and existing Inter hierarchy. Preserve readable Dynamic Type layouts and 48 dp Android hit targets. Final native sizing follows device usability, not desktop browser scaling.
### Branding
Bundle the supplied source PNGs under the app's existing asset structure; never reference another checkout, absolute Windows path, generated-images directory, localhost, or base64 HTML at runtime. Show the app icon beside the wordmark in the header/appropriate Settings locations; use the full mascot in larger contextual brand placements. Preserve aspect ratios and original files. Do not add a giant mascot to telemetry or cover functional content. Configure the actual app/Android launcher icon using the existing Expo pipeline and verify adaptive masks; preserve package identity, permissions, notification configuration, EAS project, and device scheme. iOS remains deferred.
### Motion
Keep the approved card/text entrances, chart reveal on entry or deliberate range change, short press responses, sheet transitions, and sliding tab selection. Recommended tokens: presses 100–150 ms; small transitions 180–300 ms; one-time staggered entrances 250–450 ms; numeric count-up roughly 900–1100 ms with ease-out.
Counts are for **valid, known quantities** (DO, remaining percent/weight). Animate on initial valid presentation/device context change, and transition subsequent legitimate changes from the previous displayed value. Do not reset to zero on every poll/focus, invent intermediate measurements as real data, animate clock/date/nozzle identifiers, overshoot, or announce every frame to screen readers. Never show unknown/invalid/stale readings as a count-up from zero or trigger threshold/status logic from animated values. A real alert/fault bypasses animation delay. Cancel old device animations immediately.
Respect OS reduced motion and the local motion preference; render final content immediately, stop hidden/background loops, and never block input or change semantic values. No perpetual decorative pulsing or swimming mascot animation is required.
### Appearance preferences
Light / Dark / System and animation on/off are local UI preferences, persisted using an existing appropriate storage pattern. They must update every route/sheet and follow OS theme changes in System mode. They must not send feeder configuration writes, alter permissions, affect schedules, or weaken OS reduced motion.

## Behavioral invariants — apply to every child
- Preserve pairing/access control, selected-device identity, refresh/subscriptions, revoked access, offline/errors, and simulated-device labels.
- Preserve two-nozzle sequential execution, per-nozzle requested doses and results, shared-container inventory, capacity/dose constraints, and explicit device-bound manual-feed confirmation. A requested dose or API response is not measured dispensing.
- Preserve schedule creation/editing/deletion/toggling, duplicate checks, timezone/day/occurrence semantics, pending/applied/rejected/uncertain saves, and existing retry/recovery flow. A prettier switch must use the same verified handler and pending/disabled behavior.
- Preserve DO validity/freshness, configured applied limits, gaps, graph windows, timestamps/timezone, accessible point inspection, and non-overshooting interpolation.
- Preserve History filters/pagination/details and the distinction between completed/failed/partial/rejected/unknown; preserve all alert read states and notification deep links.
- Preserve field validation/errors, retained input, empty/loading/partial-failure states, keyboard behavior, destructive confirmations, and routes/back fallbacks. Redesign does not remove information to match a simplified screenshot.
- No Supabase migrations/RLS/RPC/Edge Function edits, firmware/simulator changes, calibration, credentials, hardware actuation, provider operations, deployment, or store release are in scope.

## Route coverage and child ownership
1. Shared design system/shell/branding/motion: `constants/theme.ts`, `components/app-shell.tsx`, `components/bento-kit.tsx`, `components/motion.tsx`, `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/dev/components.tsx`, approved assets and relevant Expo visual config.
2. Home/DO graph: `app/(tabs)/index.tsx`; retain monitoring data/geometry contracts.
3. Schedule and manual feeding: `app/(tabs)/schedule.tsx`, `app/schedules/new.tsx`, `app/schedules/[scheduleId].tsx`, `components/schedule-editor.tsx`, `app/feed/confirm.tsx`.
4. History/alerts: `app/(tabs)/history.tsx`, `app/history/[runId].tsx`, `app/notifications.tsx`, filter/status/date components.
5. Settings/devices/all corresponding subpages: `app/(tabs)/device.tsx`, `app/devices/add.tsx`, `app/devices/[deviceId].tsx`, `app/settings/[field].tsx` including timezone/oxygen/feed editors, device picker, pairing camera/manual paths, permissions and confirmation states.

This is the observed route inventory, not permission to omit new routes discovered at implementation time. Record a route/state coverage table and map all additional UI to the same shared tokens/components. For unpictured screens, extend the approved typography, neutral cards, grouped rows, controls, forms and sheets while retaining their complete existing content/behavior.

## What done looks like
- [ ] All scoped children are reviewed/integrated with exact commit/PR evidence and a completed route/state coverage matrix; no screen left on a conflicting old theme.
- [ ] The native app matches revision 10 in composition, hierarchy, branding, localized color, navigation and motion; it is not a web prototype embedded in the app.
- [ ] Every existing subpage/overlay/error/empty/loading/pending/recovery state is visually coherent and usable in both themes.
- [ ] Appearance/motion controls persist correctly and never write device config.
- [ ] No placeholder telemetry, fake command completion, lost handler, hidden safety message, changed dose/capacity logic, or background functional rewrite.
- [ ] On physical Android: evidence for Home/chart interaction and safe-area clearance, Schedule switch pending/error state and edit flow, manual confirmation, History/filter/detail, Settings appearance and feeder field sheets, devices/pairing permissions, and alerts/deep links. Use existing authorized simulator/test context; do not operate a physical feeder under this design task.
- [ ] Check small phone width (~360–375 logical pixels), large text, portrait and landscape layout where supported, OS reduced motion, background/resume and theme changes. Android is the acceptance platform; do not claim iOS or emulator verification.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm run check:motion`; affected existing checks include monitoring, device-access, manual-feed, button-state, feed-status, alerts, error-text. Choose affected checks per child; a final integrated run covers the cross-screen contract without needless reruns.
- [ ] Add only focused meaningful regression coverage for changed presentation behavior (theme persistence/fallback, reduced motion, cancellation/device changes, and safe numeric handling); keep existing behavior checks.
- [ ] Update DESIGN.md's visual requirements and committed reference links/assets in the implementation delivery. Report exact tested head, checks run/not run and native evidence; hardware accuracy, iOS, deployment and release remain separate.
- [ ] Closure requires independent review and observed evidence. If native runtime/SDK/WIP prevents checks, report the concrete gate and do not mark Done.

## Execution
Keep child issues Backlog until implementation ownership/base/access and any real blockers are reconciled. Shared foundation blocks dependent screen work. Execute serially by default because shared components overlap; no separate duplicate QA ticket is needed. Changes and corrections stay with the corresponding scoped delivery.

## Required workflow and scope
Read and apply **$ponytail:ponytail full** and **$ui-ux-pro-max** before implementation and during review.
- Ponytail: `C:/Users/user/.codex/plugins/cache/ponytail/ponytail/5.3.3/skills/ponytail/SKILL.md`.
- UI/UX: `C:/Users/user/.agents/skills/ui-ux-pro-max/SKILL.md`.
Use the existing shared kit, installed dependencies, and patterns; no parallel replacement design framework or speculative abstraction. Search UI/UX guidance for the detected React Native stack, verify recommendations against the actual installed SDK, and do not let generated palette suggestions override the approved reference.
Follow `AGENTS.md`, `mobile/AGENTS.md`, and `AI_DEVELOPMENT_WORKFLOW.md`. This issue creation does not dispatch implementation, authorize hardware operation, merge, or deploy.
**Design/presentation only.** Preserve all existing routes, backend calls, subscriptions, permissions, validation, device scope, configuration semantics, and action results. Only the agreed appearance/motion preferences add local presentation state. Never copy sample telemetry, sample schedules, simplified handlers, mock device capacities, or invented settings from the browser prototype into production.
