# AquaFeedPro — Premium UI/UX Task Packets

Date: 2026-11-02

Status: planning only. These are local task labels, not Linear issues. This document does not authorize implementation, dispatch, merge, release, or hardware operation.

## Goal

Refine the current monochrome app through cleaner screens, shorter copy, stronger hierarchy, and responsive, connected motion. Keep the React Native/Expo architecture and existing functionality. Treat iOS and Android as equal product targets.

## Execution order

```text
01 — Approve the visual, copy, and motion specification
                         |
02 — Shared components and motion foundation + pilot
                         |
03 — Home + History      ||      04 — Schedule + Feed now
                         |
05 — Settings + Devices + Notifications
     Can start when either parallel slot becomes free
                         |
06 — Final consistency review and platform acceptance
```

Start with one implementation worker for Task 02. After its pilot passes, run up to two implementation workers concurrently, with separate worktrees and file ownership. Tasks 03–05 consume the same reviewed, integrated foundation. Task 05 need not wait for both page tasks if a slot becomes free.

## Instructions included with every task

### Required skills and context

- Read and apply `$ui-ux-pro-max` and `$ponytail:ponytail` at full intensity.
- Skill paths in this environment:
  - `C:/Users/user/.agents/skills/ui-ux-pro-max/SKILL.md`
  - `C:/Users/user/.codex/plugins/cache/ponytail/ponytail/5.3.3/skills/ponytail/SKILL.md`
- Read the applicable `AGENTS.md`, `AI_DEVELOPMENT_WORKFLOW.md`, `DESIGN.md`, `docs/MOTION_ANIMATION.md`, and the approved Task 01 specification.
- Keep the existing monochrome identity, Inter typography, and React Native/Expo architecture.
- The owner's current requirement targets both iOS and Android, superseding older documentation deferring iOS. This does not authorize unrelated platform setup or hardware work.
- Follow the repository's worker model and Orca requirements. Do not silently substitute another model or reasoning effort. Dispatch only when implementation is separately authorized.

### Implementation constraints

- Reuse existing components, tokens, and installed libraries. No new dependency, theme, feature, or broad refactor by default.
- Preserve device authorization, explicit confirmation, sequential nozzle execution, duplicate prevention, recovery, and requested-versus-measured semantics.
- Shorten explanations without hiding pending, failed, stale, unavailable, or uncertain states.
- Each worker edits only its assigned files. Request shared-component changes through the foundation owner; do not edit them independently.
- Include populated, loading, empty, error, offline, pending, and uncertain states where applicable.
- Keep browser results, automated checks, native builds, and physical-device observations distinct.
- Workers submit for independent review. They do not self-approve, merge, deploy, mark tracker issues Done, or operate hardware.
- Include meaningful checks for nontrivial behavior. Avoid tests that merely mirror styling and avoid redundant full builds.
- Do not add dark mode, tablet-specific redesigns, new branding, or unrelated features as part of this refinement.

### Starting snapshot and ownership

Before dispatch, preserve and review the current uncommitted work. At planning time this checkout has substantial WIP beyond HEAD `de8778a1e2844b2b98244fd07bfc229f5b0f6058`. Branching from HEAD alone would omit it.

The coordinator must establish an owner-reviewed starting snapshot without discarding or silently staging unrelated work. Record each worker's absolute worktree path, branch, base commit, assigned task, owned files, and shared-resource constraints. Refresh this information at dispatch; the planning-time commit is not automatically the execution base.

Worktrees do not isolate databases, ports, simulators, or devices. Serialize shared-resource tests and native profiling. Use isolated development resources and sanitized fixtures; never include credentials in handoffs or evidence.

### Verification and handoff

Unless a task says otherwise, run npm commands from `mobile/`. Existing scripts outside `package.json` must be invoked explicitly from the stated directory. A listed command is a required future check, not evidence that it has already passed.

Each worker submits:

- Exact result commit and changed files.
- Implemented acceptance criteria and before/after evidence.
- Commands actually run and their results.
- Tested platform, device, build type, and relevant configuration.
- Unresolved findings and unverified platform/device gates.

Keep corrections within the owning task. When a requested fix crosses file ownership, coordinate a serialized ownership transfer before editing.

## Task 01 — Define the cleaner premium experience

**Owner:** design/planning agent.

**Dependency:** none.

**Scope:** documentation and design proposals only.

### What to do

1. Inspect all routes and their actual state handling, including populated views using authorized development data or isolated fixtures.
2. Produce a screen-by-screen specification containing:
   - Primary information and action.
   - Revised hierarchy and grouping.
   - Exact proposed replacement copy.
   - Text to remove, shorten, or move, with its destination.
   - Populated, loading, empty, error, offline, pending, and uncertain states.
3. Define shared typography, spacing, control sizes, surfaces, and icon treatment using the existing visual system.
4. Define motion by interaction: first entry, returning, presses, selection, sheets, data updates, loading, and completion. Specify triggers, interruption behavior, and reduced motion.
5. Specify iOS/Android differences, including safe areas, touch targets, keyboard behavior, gestures, and accessibility.
6. Resolve the conflict between `DESIGN.md` and `docs/MOTION_ANIMATION.md`. Record proposed changes before treating them as approved.
7. Have the owner review the complete specification before implementation.

### Deliverable

One concise design specification with a route coverage table and exact copy table. The accepted specification becomes the common reference for every worker. Make visual comparisons only if the owner requests or accepts them; the owner previously declined browser mockups.

### Tools and skills

- `$brainstorming`, `$ui-ux-pro-max`, `$ponytail:ponytail` full.
- `rg`, Git, Playwright/browser inspection.
- UI/UX skill searches focused on React Native and the relevant interaction.
- Existing screenshots/reference assets; no product implementation.

### Done looks like

- Every route belongs to a later task.
- Important copy is explicit rather than “make this cleaner.”
- Motion triggers, interruption, return behavior, and reduced motion are specified.
- Implementation choices are distinguished from owner decisions.
- The owner approves the complete specification.

## Task 02 — Implement shared polish and prove the foundation

**Owner:** shared UI/motion agent.

**Dependency:** approved Task 01 and separate implementation authorization.

### Owned files

- `mobile/src/constants/theme.ts`
- `mobile/src/components/motion.tsx`
- `mobile/src/components/app-shell.tsx`
- `mobile/src/components/bento-kit.tsx`
- `mobile/src/components/date-field.tsx`
- `mobile/src/components/history-status-select.tsx`
- `mobile/src/app/_layout.tsx`
- `mobile/src/app/(tabs)/_layout.tsx`
- `mobile/src/app/dev/components.tsx`
- `mobile/scripts/check-motion.mjs`
- `mobile/scripts/check-button-state.mjs`

### What to do

1. Implement the approved shared hierarchy, spacing, controls, and feedback.
2. Make first entry and returning to a page behave intentionally.
3. Refine sheet dragging, settling, dismissal, keyboard interaction, and Back handling.
4. Keep refreshes and data presentation stable.
5. Preserve disabled states, touch targets, accessible names, and reduced motion.
6. Evaluate installed Reanimated/Gesture Handler only where they solve an observed interaction problem. Verify actual installed APIs and compatibility; avoid a wholesale animation rewrite.
7. Preserve public component interfaces where practical. Document necessary interface changes for page workers, including props, defaults, and consumer migration instructions.
8. Add or adapt focused executable checks for changed nontrivial interaction behavior, demonstrating the failure before the fix where applicable.

### Pilot

Demonstrate a representative page entrance/return, button, switch, sheet, long form, and loading/error state through the component preview.

### Tools and skills

- `$ui-ux-pro-max`, `$ponytail:ponytail` full.
- Expo, TypeScript, Playwright, existing motion checks.
- Native iOS and Android runtime inspection when available.

### Done looks like

- The pilot is independently reviewed against the approved specification.
- Rapid taps, interrupted transitions, repeated dismissal, canceled dragging, and reduced motion behave correctly.
- Animations neither dispatch business actions nor misrepresent data.
- `npm run lint`, `npm run typecheck`, `npm run check:motion`, and `npm run check:button-state` pass.
- Native observations and remaining device gaps are explicit. Any pilot gate used to unlock parallel work identifies its actual evidence and outstanding platform acceptance.
- The reviewed foundation commit is integrated into the working base consumed by Tasks 03–05.

## Task 03 — Refine Home and History

**Owner:** monitoring/history agent.

**Dependency:** Task 02 pilot passes and its reviewed foundation is integrated.

### Owned files

- `mobile/src/app/(tabs)/index.tsx`
- `mobile/src/app/(tabs)/history.tsx`
- `mobile/src/app/history/[runId].tsx`
- `mobile/scripts/check-art27-monitoring.mjs`
- `mobile/scripts/check-feed-status.mjs`

### What to do

1. Apply approved Home hierarchy to oxygen, remaining feed, next feeding, and the main action.
2. Shorten repeated graph/freshness explanations while keeping measurement quality clear.
3. Preserve graph gaps, bounds, inspection, and actual readings.
4. Make History summaries, rows, filters, and detail screens consistent and easy to scan.
5. Move secondary record information into the detail view without removing access to it.
6. Preserve scroll, filter state, record identity, device scope, and refresh behavior.
7. Remove unnecessary animation replay according to the approved specification.
8. Extend focused checks only where behavior changes require them.

### Tools and skills

- `$ui-ux-pro-max`, `$ponytail:ponytail` full.
- Playwright for populated/empty/error states and repeated navigation.
- Existing monitoring and feed-status checks; isolated development fixtures.
- Native platform checks for text scaling and interaction feel.

### Done looks like

- Home priorities are immediately identifiable.
- History is scannable without repeated explanatory paragraphs.
- Unknown/stale readings never become plausible measurements.
- Requested and measured amounts remain distinct.
- Filters, pagination, record details, device switching, and refreshes work.
- `npm run lint`, `npm run typecheck`, `npm run check:monitoring`, and `npm run check:feed-status` pass.
- Run shared motion checks if integration changes justify them. Report iOS/Android observations and gaps separately.

## Task 04 — Refine Schedule and the complete Feed now journey

**Owner:** scheduling/manual-feed agent.

**Dependency:** same reviewed, integrated foundation as Task 03.

**Parallel:** may run alongside Task 03.

### Owned files

- `mobile/src/app/(tabs)/schedule.tsx`
- `mobile/src/components/schedule-editor.tsx`
- `mobile/src/app/schedules/new.tsx`
- `mobile/src/app/schedules/[scheduleId].tsx`
- `mobile/src/app/feed/confirm.tsx`
- `mobile/scripts/check-schedules.mjs`
- `mobile/scripts/check-manual-feed.mjs`

### What to do

1. Make schedule time, nozzle, dose, repetition, enabled state, and device-save state easy to scan.
2. Consolidate related notices without merging distinct outcomes.
3. Simplify schedule creation/editing copy and field grouping.
4. Refine nozzle selection, dose entry, confirmation, pending execution, and per-nozzle results.
5. Keep the selected feeder and confirmed doses unambiguous.
6. Preserve form values after failure and provide clear recovery.
7. Keep switch, menu, and card actions independent.
8. Preserve confirmation binding, duplicate prevention, nozzle ordering, uncertain-result handling, and all existing validation. Add focused regressions for changed behavior.

### Tools and skills

- `$ui-ux-pro-max`, `$ponytail:ponytail` full.
- Existing schedule/manual-feed checks, Playwright, authorized simulator.
- iOS/Android checks for keyboard, dismissal, focus, and confirmation.

### Done looks like

- Create, edit, enable, pause, delete, and failed-save recovery remain functional.
- Requested schedules never appear feeder-applied before acknowledgment.
- Both-nozzle confirmation shows separate amounts and execution order.
- Repeated taps, dismissal, or reconnection cannot duplicate feeding.
- Uncertain outcomes preserve appropriate recovery without automatic retries.
- From `mobile/`: `npm run lint`, `npm run typecheck`, and `npm run check:manual-feed` pass.
- From the repository root: `node mobile/scripts/check-schedules.mjs` passes.
- Native platform observations and unverified cases are recorded.

## Task 05 — Refine Settings, Devices, and Notifications

**Owner:** device/settings agent.

**Dependency:** integrated Task 02 foundation and an available parallel slot.

### Owned files

- `mobile/src/app/(tabs)/device.tsx`
- `mobile/src/app/devices/add.tsx`
- `mobile/src/app/devices/[deviceId].tsx`
- `mobile/src/app/settings/[field].tsx`
- `mobile/src/app/notifications.tsx`
- `mobile/scripts/check-device-access.mjs`
- `mobile/scripts/check-alerts.mjs`
- `mobile/scripts/check-error-text.mjs`

### What to do

1. Make Settings a concise overview of groups and current values.
2. Move explanations into the relevant editor.
3. Refine pairing steps, device selection, naming, and removal.
4. Preserve copy/paste and existing pairing options.
5. Make notifications readable through concise titles, timestamps, and independent actions.
6. Keep device scope, requested/applied configuration, permissions, and destructive confirmation explicit.
7. Preserve recoverable input after errors.
8. Add focused checks for changed interaction or state behavior.

### Tools and skills

- `$ui-ux-pro-max`, `$ponytail:ponytail` full.
- Playwright, existing access/alert/error checks, native platform inspection.
- Read notification-controller behavior. Changes outside ownership require coordinator reassignment before editing.

### Done looks like

- Settings is scannable without opening every row.
- Pairing, selecting, renaming, editing settings, and removal retain existing behavior.
- No cross-device data or state leaks.
- Notification navigation/read/delete behavior remains correct.
- `npm run lint`, `npm run typecheck`, `npm run check:device-access`, `npm run check:alerts`, and `npm run check:error-text` pass.
- iOS/Android observations and acceptance gaps are separate and explicit.

## Task 06 — Consolidate, independently review, and verify both platforms

**Owner:** coordinator/reviewer.

**Dependency:** reviewed Tasks 02–05 integrated into one candidate.

This is the final combined acceptance gate. It does not replace each task's checks or create a separate implementation/testing backlog. Return corrections to their owning delivery.

### What to do

1. Review the combined result against Task 01, including consistency across page boundaries.
2. Inspect navigation loops, sheets, keyboard behavior, text scaling, reduced motion, narrow layouts, and landscape.
3. Exercise populated, empty, loading, offline, pending, failed, and uncertain states.
4. Check VoiceOver and TalkBack on available physical devices.
5. Assess native transition/gesture quality in an appropriate non-development performance build. Do not judge final smoothness from Metro compilation.
6. Return findings to the owning task for correction; verify corrected behavior and affected checks.
7. Reconcile design/motion documentation with the final result and current cross-platform scope without rewriting unrelated requirements.

### Tools and skills

- `$ui-ux-pro-max`, `$ponytail:ponytail` full, independent code review.
- Playwright screenshots and interaction captures.
- Physical iOS/Android devices and native profiling tools where available.
- Existing project checks on the combined candidate; reuse unchanged evidence and rerun affected checks after corrections.

### Done looks like

- No unresolved blocking visual, interaction, accessibility, or safety findings.
- Evidence identifies the exact candidate commit and tested platform/build.
- Both iOS and Android acceptance are recorded separately.
- Missing device access remains an explicit acceptance gap; do not claim overall native acceptance while it remains unverified.
- Documentation accurately describes implemented behavior and remaining limitations.
- No merge, release, or hardware operation is inferred from review completion.

## Current limitations

No implementation, task dispatch, or tracker updates are included in preparing this document. Native performance and populated-screen acceptance remain unverified. The principal execution risks are omitting the existing WIP from worker bases, overlapping shared-file ownership, and presenting browser-only evidence as iOS/Android acceptance.
