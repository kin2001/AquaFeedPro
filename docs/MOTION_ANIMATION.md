# Motion integration

## Current authority: approved expressive revision (2026-11-02)

The [expressive specification](superpowers/specs/2026-11-02-expressive-motion-design.md),
[execution plan](superpowers/plans/2026-11-02-expressive-motion.md) and committed
[Paper dock reference](design/expressive-motion/reference.html) supersede **all
historical motion/layout policies below**, including the original premium
one-time entrance / no-count-up / fixed tab header and footer policies. Other
Mono Ink tokens and all business/safety requirements remain unchanged.

Current scoped implementation from assigned base `b82b55a`:

- Tab context and actions scroll with content. Home starts with the authorized
  feeder selector and outlined circular notification action, without Home/logo
  strip. Other tabs retain in-content headings; Schedule has enabled-count /
  feeder-time subtitle and circular Add, History has date-range / time-zone
  subtitle and circular Filters. History refresh remains a separate action.
  Pushed screens retain title/Back. Selection failures remain recoverable and
  late previous-session selection cannot dismiss the new session's selector.
- Paper dock uses inset16, radius27, padding7, minimum48px targets, a moving dark
  radius20 selection and180ms selected-foreground fade. Its measured height,
  bottom safe area and12px gap are reserved by scroll content/FABs. Keyboard
  visibility hides the dock. There is no Ink theme setting or new sidebar.
- Page focus/return:460ms,18px, opacity0.25→1; visible card groups:520ms,13px,
  opacity0.35→1,55ms stagger capped165ms. Strong ease-out matches the approved
  cubic-bezier(0.16,1,0.3,1). Native full-page pushes/pops remain stack-owned;
  shared whole-page entrance applies only to tabs and web pushed pages.
- Eligible fresh Home numbers reveal over740ms; feed meter over800ms; actual
  gap-aware linear SVG paths/dots reveal through a left-to-right clip over900ms.
  Decorative hatch is removed; geometry builder, scale, configured limits,
  gaps, isolated dots, time uncertainty, range choices and inspection stay intact.
  Graph replays on focus/return and explicit range change, not routine polling.
- Counters/meter/graph share `useEntryProgress` in the existing motion module.
  Blur/background/unmount cancel work. Foreground/focus return creates one new
  sequence; reduced motion settles instead. Target/scope/eligibility changes
  stop old numeric frames and show latest actual values immediately, with no
  poll-driven restart. A late first eligible sample can reveal once per entry.
  Accessibility always receives actual numbers, not count-up frames. Unknown
  remains dash; stale/error/invalid readings, command statuses and recorded
  result amounts do not count up. Provider resolves initial motion preference
  before mounting the animated subtree to avoid preference-resolution flashing.
- Sheets retain their existing focus/Back/keyboard/drag and single-callback
  protections:420ms entry,260ms exit, no stack-owned second sheet slide. Press
  acknowledgment stays120ms and never delays a business action.

### Evidence status for this revision

All assigned source checks pass in `expressive-final-source.log` outside the
repository: lint/typecheck/motion/monitoring/feed-status/manual-feed/button-state/
device-access/alerts/error-text/schedules. Executable motion checks include
intermediate numeric/graph frames, focus/foreground replay, interrupted targets,
quality/scope/null/reduced cancellation, actual accessibility, dock safe-area
measurement/travel/keyboard/actions and scoped selection. Historical assertions
were changed only where the approved policy or action location supersedes them;
safety, race, recovery and data-state checks remain.

Owner subsequently authorized finishing rendered verification before manual review.
The isolated dummy-fixture preview runs only for automated comparison; it is not
the owner's actual-config manual preview. Worker rendered confirmation now passes
at375/390 portrait,1440 desktop and812×375 landscape, normal/reduced motion, with
external `expressive-browser-results.json` and same-viewport normalized reference
pairs in `expressive-confirm-side-by-side.html`. Feed now clears the dock at rest
in comparable single-next-nozzle/no-time-error fixtures (375:647–695,390:635–683;
dock begins759), while both-nozzle/invalid-time cases retain warnings and the
button scrolls fully above the dock. Graph gap inspection, selector/bell, Add/editor,
filters/apply/clear/refresh, empty/error/offline/unknown/pending and retained History
pagination/scroll were exercised with external origins/writes blocked.

The first Settings feeder group now replays as one measured group, with55/110ms
stagger on later groups. A rendered History scroll regression (101→29 on return)
was fixed at its shared-shell cause: hidden tabs retain their own pathname/layout
rather than removing context when the global path changes. Watched failing
executable regressions cover both corrections. The full assigned source suite
passes again (`expressive-correction-final-source.log`). t7's final personal
exact-candidate motion-timeline review remains required; this is no worker PASS. Source/hook tests are
not rendered-motion or native evidence. Additional owner feedback uses the real
saved device name/model at20px and compacts Home toward the reference:117px real
graph, short time axes with full accessible timestamps, calibrated kg captions,
and explicit Inspect readings disclosure preserving all existing point/gap
controls. Freshness, limits and invalid-time safety text stay visible.
Native iOS/Android safe areas, keyboard/Back, VoiceOver/TalkBack, largest text,
gestures and release-like performance are unverified. Only t7 gives the review
verdict. No push/PR/merge/release or hardware operation is part of this worker's
scope. Existing notification transport and offline schedule-policy gaps remain
held, not solved or waived.

---

## Historical delivery record (not current policy or current runtime evidence)

This is a motion-only extension of the current Mono Ink app. The starting tree is
`de8778a1e2844b2b98244fd07bfc229f5b0f6058` on `feat/motion-animation`.
The live remote main read returned `4171f222d316dfe13d7dd8ca574fc7762df1a192`,
which is already an ancestor of this checkout. Work was implemented directly in
this checkout at the owner's request, one task at a time. No merge or deployment
is part of this delivery. The earlier redesign and PR #62 are untouched.

## Motion specification

The revision-10 concept supplies the motion reference only: short page entrances,
section fades with small vertical movement, animated numeric readings, graph
reveal, switch feedback and bottom-up sheets. Its colors, layout, dock, settings,
branding and example readings are excluded. This document carries the applicable
specification without depending on the prototype's machine-specific location.

- Shared press/toggle timing: 150 ms. Page/section/sheet timing: 350 ms.
  Numeric and graph reveal: 800 ms. Page and section offset: 12 dp. Optional
  stagger: 50 ms, capped at 150 ms. Easing is cubic out, without overshoot.
- Tab content fades and slides up on every focus; the existing icon well fades when selected.
  All tab positions, labels, colors, hit areas and bar dimensions stay the same.
- Full subpages use the existing native stack's directional forward/back
  transition. Android controls native-stack transition duration; the configured
  `animationDuration` applies on supported platforms, not as a guarantee of an
  exact Android duration. Web full pages use the shared fade and slide entrance.
- Initially visible full-page and sheet sections stay static while the owning
  stack/sheet moves. Offscreen sections reveal once when entering the viewport.
  Previously revealed tab sections replay on returning to their page, as requested
  by the owner. Page and section movement combine to at most 24 dp on tabs.
- Section layout space and accessibility content remain present throughout.
  Revealed records keep their identity across refreshes, filters and pagination.
  There is no continuous scroll motion, list remount for animation, scroll reset,
  or replacement of the app's existing pagination/container behavior.
- Sheets own their opening and closing animation; their navigator remains
  `transparentModal` with `animation: none`. Controlled local sheets stay mounted
  until exit finishes. Route removal is replayed once after exit, including
  Back and existing close/save paths. Drag cancellation returns the sheet to its
  resting position. Sheets do not remain over a newly focused route.
- OS reduced motion, app backgrounding and offscreen route focus settle shared
  motion. Unmount cancels callbacks/listeners. An unknown initial OS preference
  keeps content visible; initial `AppState` null is treated as foreground once
  that preference is known. There was no existing local motion setting in this
  baseline, and none was introduced.
- Only fresh, valid Home oxygen and feed-percentage values interpolate. Frames
  are presentation only: labels, status decisions, progress semantics, requests,
  limits and captions use actual values. Stale/invalid/unknown/error states settle
  immediately; unknown never counts as zero. A feeder/session change invalidates
  prior frames. Returning to the page restarts eligible counts from zero;
  repeated identical poll targets do not. Feed mass captions retain actual text.
  History summary counts use the same presentation-only interpolation; saved
  record details remain actual values.
- The existing SVG graph fades in per device/range mount and on returning to Home
  when data and plot width are ready. Polling does not restart its reveal. Geometry, hatch, bounds,
  gaps, axes, limits and inspection controls remain unchanged.
- The newly approved initial/live numeric interpolation is the narrow exception
  to DESIGN.md's older restriction on decorative live readings. DESIGN.md and
  its static visual requirements remain unchanged. No saved record value, dose,
  configuration input, timestamp or ID counts up.

Opacity/transforms use the native driver. Text frames and percentage width use
the existing Animated API on the JS thread. Animations never call saves, feed
requests, filter queries or status checks. Existing native press/ripple feedback,
validation, device binding and persistence behavior are retained.

## Coverage and verification matrix

Owner for all rows: this inline motion delivery. `check:motion` covers shared
behavior with executable hook/component checks, not a physical rendering engine.
Every row still needs physical Android observation at the final candidate.

| Task / route or control                         | Motion                                                                                                               | Reduced-motion result                                 | Observed source evidence                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 01: shared AppPage / navigation                 | Tab fade/slide on each return, web page fade/slide, directional native full-page open/back, section replay on return | Immediate existing layout; native transition disabled | lint, typecheck, motion                                                                                 |
| 01: shared Sheet / all local overlays           | Bottom-up entry, scrim fade, reverse exit; controlled exit retention and single route removal                        | Immediate open/close                                  | motion: repeated Back, canceled/unmounted exit, reduced-motion close, rapid reopen                      |
| 01: Button / icon / row / chip controls         | Existing press/ripple feedback retained; selected tab fade                                                           | Existing static pressed/disabled semantics            | button-state, motion                                                                                    |
| 01: Toggle / SwitchRow / ProgressBar            | Controlled thumb/track transition, percentage fill interpolation                                                     | Actual switch position/fill immediately               | motion: controlled revert and no mutation callback from animation                                       |
| 01: `/dev/components`                           | Native page transition, viewport row reveals; interactive local controls and Sheet preview                           | Static gallery                                        | motion, types, lint; no phone capture                                                                   |
| 02: `/` Home                                    | Reading/percentage interpolation, graph fade, reading/activity section reveal                                        | Actual values and complete graph immediately          | motion, monitoring, feed-status, device-access, manual-feed, button-state                               |
| 02: Home graph range overlay                    | Shared local sheet, existing range selection and inspection                                                          | Immediate existing controls                           | monitoring, motion                                                                                      |
| 03: `/schedule`                                 | Tab fade, stable device/schedule card reveals, applied-state switch animation                                        | Applied switch state, original cards                  | motion: pending/repeated input, failed save, request/applied acknowledgement, refresh and feeder switch |
| 03: `/schedules/new`, `/schedules/[scheduleId]` | Shared route sheet on open/close/save/Back                                                                           | Immediate existing editor                             | motion, types, manual-feed, device-access, error-text                                                   |
| 03: `/feed/confirm`                             | Shared route sheet; current validation/pending/result notices retained                                               | Immediate existing confirmation/results               | manual-feed, feed-status, motion, device-access                                                         |
| 04: `/history`                                  | Tab fade/slide, summary count-ups, totals section and stable run-row reveals; shared filter sheet                    | Actual records and filter controls immediately        | motion: apply/cancel/reset/date/status; manual-feed: history filters                                    |
| 04: `/history/[runId]`                          | Native forward/back; offscreen summary/nozzle-card reveals                                                           | Actual saved results immediately                      | feed-status, manual-feed, motion                                                                        |
| 04: `/notifications`                            | Shared route sheet; stable installation/device/alert-row reveals                                                     | Actual notification text/read state immediately       | alerts, motion: timestamps and independent delete action                                                |
| 05: `/device` Settings                          | Tab fade, device-row reveals, current settings/About sections                                                        | Original settings and statuses immediately            | device-access, monitoring, motion, alerts                                                               |
| 05: `/settings/[field]`                         | Shared route sheet; once-only timezone rows                                                                          | Actual settings/inputs immediately                    | monitoring, error-text, motion, device-access                                                           |
| 05: `/devices/add`                              | Native open/back; form section viewport reveal                                                                       | Original pairing stages/inputs immediately            | device-access, types, lint                                                                              |
| 05: `/devices/[deviceId]`                       | Native open/back; name/about/remove sections reveal when scrolled into view                                          | Original fields/status/actions immediately            | device-access, types, lint                                                                              |
| All loading / empty / error / pending states    | Existing skeleton pulse and notice behavior retained; shared page/sheet transition                                   | Static skeleton; immediate actual messages            | motion, error-text, button-state; warnings/errors do not get a separate reveal delay                    |

## Evidence and remaining acceptance

Each task's listed checks passed before beginning the next task. The motion suite
was extended with failing-then-passing cases for startup null AppState, scoped
numeric interpolation, persistent reveal identities and consumer integration.
Existing checks also cover request recovery, active device isolation, actual
applied configuration, historical measurement semantics and feed statuses.

Final working-tree verification passed: `npm run lint`, `npm run typecheck`,
`check:motion`, `check:button-state`, `check:error-text`, `check:manual-feed`,
`check:device-access`, `check:monitoring`, `check:feed-status` and `check:alerts`.
Prettier passed on all changed files, and `git diff --check` passed.
The final Android export bundled 1,597 modules and generated Hermes bytecode
`entry-953467f46c1903b57817f2624f26fcee.hbc` successfully. The first sandboxed
attempt failed to launch Hermes with `spawn EPERM`; the permitted export outside
the sandbox passed. This is bundle evidence, not an APK install or phone run.

The final self-review corrected a repeated-Back edge case during a controlled
local sheet exit, with a failing-then-passing regression check. Further checks
cover canceled drags, reduced motion enabled during exit, focus loss, actual
accessible numeric labels, and immediate stale progress. No commit, push or PR
was created; the reviewed result is the local working-tree diff from the base
above.

A source comparison against the starting commit confirmed every existing
`StyleSheet.create` definition in the changed UI modules is unchanged. During the
initial SDK 57 motion implementation, the theme, package manifest, lockfile and
DESIGN.md were byte-identical to the starting tree. The subsequent SDK 58 upgrade
changes dependencies separately from that motion implementation. This supports
the static-design boundary; it is not screenshot equivalence.

No phone was attached in `adb devices`. Static baseline screenshots, visible
motion recordings, keyboard/focus return, TalkBack, small/large screens, largest
text, supported orientation, native gestures and background/foreground behavior
have not been physically observed. Source checks and an Android bundle cannot
close those acceptance criteria. iOS is deferred; no emulator, feeder actuation,
backend migration, deployment, CI or independent external review was performed.

For phone acceptance, compare the same screens at rest to the starting revision,
then record motion on and OS reduced motion, rapid tab/Back/close/reopen, interrupted
sheet drags, background/resume, fresh/decreasing/stale/unknown readings, a long
history list with refresh/filter/load-more, schedule save failure/pending/apply,
and pairing/settings permission, error, save and cancel flows. Use synthetic
resources where needed; do not dispense feed to demonstrate decoration.

## SDK 58 phone-test compatibility

The owner authorized upgrading this checkout because the phone's Expo Go uses
SDK 58. The dependency graph now uses Expo 58.0.17, Expo Router 58.0.25, React
19.3.0 and React Native 0.88.0. It reuses the compatible SDK 58 graph and verified
archives already present locally; no forced peer resolution was needed.
The sheet removal guard uses Expo Router's SDK 58 `repeat` callback after
disabling prevention. Native view refs and the animated content-style prop use
the platform's current types. Existing static styles remain unchanged.

Verification on 2026-11-02 passed:

- A clean `npm ci --offline --no-audit` using the local cache, followed by
  `npm ls --all` with no dependency problems.
- Expo's offline dependency check and Expo Doctor's 20 checks. Doctor ran with
  `EXPO_OFFLINE=1`; this does not establish fresh remote metadata availability.
- Lint, TypeScript, all eight project check scripts, changed-file formatting and
  `git diff --check`. TypeScript and the motion check passed again after adapting
  the native view types.
- Android export: 1,659 modules, producing Hermes bundle
  `entry-d07ee1d0d96c8e23d62aebca5a333f66.hbc`. The subsequent native-ref and style
  annotation correction changes types only.
- Metro's LAN manifest reports SDK `58.0.0` and runtime `exposdk:58.0.0` in
  Expo Go mode. Its Android development bundle was also served successfully
  (1,730 modules). The simulator process remains running.

Phone launch, visible animation and physical accessibility acceptance still
require observation on the owner's Android phone. Dependency audit remediation
remains separate; `--no-audit` does not mean the dependency graph has no findings.

The first owner phone attempt exposed a startup crash in `expo-notifications`:
`ExpoTopicSubscriptionModule` is absent from Expo Go. The controller's deprecated
`appOwnership` check allowed the native notification import when ownership was
null. It now uses Expo's `isRunningInExpoGo()` to skip native push setup in Expo
Go while preserving the physical Android development-build path. A regression
case with null ownership failed before this correction and passed afterward,
along with development-build, emulator, iOS and web guard cases. Alert and motion
checks, TypeScript and lint passed. Metro was restarted with its cache cleared;
the owner must retry the phone launch to confirm runtime recovery.

## Stronger motion and navigation replay (2026-11-02)

The owner requested more noticeable motion on every page switch. The shared
entrance now lasts 350 ms with 12 dp movement; numeric/graph reveals last 800 ms.
Returning to a tab replays entered sections and eligible numeric readings. Home's
graph also replays on focus. Identical polling values do not reset the animation.
History's two summary counts reuse AnimatedNumber; individual historical records,
doses, timestamps and configuration inputs retain their actual text.

Verification for this revision:

- Motion regressions cover count-up and section replay on return, unchanged poll
  targets, unknown/stale readings and reduced-motion focus changes. All eight
  project check scripts, lint, TypeScript and changed-file formatting passed.
- Playwright sampled actual browser frames on all four tabs and repeated visits:
  13-22 intermediate frames per recorded entrance, with a 12 px page offset.
  The full pairing page also showed intermediate frames on open and Back.
  OS reduced-motion emulation settled every tab at opacity 1 / translation 0.
  No browser runtime errors were observed. This isolated browser had no paired
  feeder; live numeric replay is covered by hook tests, not a paired-browser capture.
- Browser measurements are retained outside the repository at
  `D:\DevCache\Shofiliate\temp\aquafeed-motion-browser-check\strong-motion-results.json`.
- Android production export passed (1,659 modules), producing
  `entry-83e24c60e21df90f516e622a8587daf8.hbc` in the temporary export directory.
- Existing StyleSheet declarations across all 18 changed source files match HEAD;
  DESIGN.md and design tokens are unchanged. No dependency was added for this revision.

Physical Android rendering, performance and accessibility acceptance remain
unobserved for this revision. Metro and the existing simulator remain available
for the owner's phone test.
