# AquaFeedPro Premium UI/UX Design

Date: 2026-11-02
Status: Task 01 complete per the owner's 2026-11-02 instruction; accepted reference for the authorized premium task pack. Local implementation/review and post-review PR creation follow AI_DEVELOPMENT_WORKFLOW.md; no merge, release, or hardware authorization is implied.

## Scoped expressive-motion supersession

The subsequently owner-approved [expressive motion and floating shell specification](2026-11-02-expressive-motion-design.md)
and its committed Paper dock reference supersede this document's one-time/no-count-up,
fixed tab title/footer and graph-fade-only policies. Replay on every entry/return,
decorative eligible Home counters, moving inset Paper dock and its subtle offset
shadow are explicitly authorized. Schedule/History headings and circular Add/Filter
remain in scroll content. This cross-reference changes no business, safety, data,
backend, capability or native-evidence requirements below.

## Intent and decision

Make AquaFeedPro feel clear, composed, and responsive on both iOS and Android by shortening repeated copy, giving each screen one obvious reading order, and using brief motion only to explain navigation or a direct user action.

Recommended direction: keep the Mono Ink palette, Inter, current routes, current capabilities, and existing shared components. Use stronger type and whitespace hierarchy, fewer nested card boundaries, concise labels, and short one-time motion. Do not add a theme, gradient, shadow treatment, dependency, route, backend behavior, or hardware operation.

Owner checkpoint: the owner states Task 01 is done and requests execution of the remaining tasks. Use this complete route, copy, and motion specification as the shared reference for Tasks 02–05. Its timing and count-up policy supersedes the conflicting older design/motion rules for this task pack; retain native evidence gaps below.

## Evidence and limits

Reviewed current route source, shared UI tokens/components, DESIGN.md, docs/MOTION_ANIMATION.md, and the existing browser captures at audit-home, audit-schedule, audit-history, audit-settings, and audit-add. Those captures show unpaired/empty views only. Populated native rendering, iOS/Android interaction feel, and native performance were not observed. Populated behavior below is based on the current route source and must be checked on both platforms during implementation acceptance.

## Route ownership

| Task | Routes and files |
| --- | --- |
| 02 — shared foundation | App shell, tab layout, root layout, shared typography/spacing/control tokens, Sheet, Button, Toggle, SwitchRow, and motion components. Applies to every route below. |
| 03 — Home and History | Home /; History /history; feeding detail /history/[runId]. |
| 04 — Schedule and Feed now | Schedule /schedule; create /schedules/new; edit /schedules/[scheduleId]; confirmation and result recovery /feed/confirm. |
| 05 — Settings, Devices, Notifications | Settings and paired device list /device; pairing /devices/add; device details /devices/[deviceId]; field editor /settings/[field]; notifications /notifications. |

The component preview route is for Task 02 validation, not a product destination. Do not add or rename routes.

## Shared visual rules

- Keep the existing Mono Ink colors, Inter font families, Lucide outline icons, card/control radii, and 4/8-point spacing rhythm. Do not add decorative shadows or new color roles.
- Use the existing typography tokens by role: pageTitle for screen headings; display only for the primary oxygen reading; reading for secondary metrics; title/cardTitle for schedule times and section/card headings; body/listTitle for content; label for persistent form labels; supporting for brief explanations; metadata only for timestamps, IDs, and technical detail.
- Use page gutters and card padding already defined in the theme. Give page title, primary content, and the next section a clear 24/16/8 spacing progression. Prefer a single bordered surface for a related group; use whitespace or dividers between rows instead of nested cards.
- Keep one filled ink action as the primary action on a screen. Use the existing Button, Fab, ListRow, Notice, EmptyState, ErrorState, and Sheet patterns. Do not create a new component API for this refinement.
- Preserve visible status text next to status icons. Color and animation never carry status alone. Keep one consistent Lucide stroke and hide decorative icons from accessibility traversal.
- Cards and forms grow with content. Let long labels wrap. Keep current selected-device scope and put the device name near the title when more than one feeder is paired.
- On Home, make “Feed now” a visible, labeled primary button in the content flow, using the existing Button and same route/action. This replaces the icon-only floating presentation; it does not change confirmation, device binding, or feed behavior.

## Route hierarchy

| Route | Proposed reading order and grouping |
| --- | --- |
| Home / | Page title and selected-feeder context; contact/freshness state; oxygen reading, limits status, graph and range; Feed remaining and Next feeding metrics; visible Feed now action; latest three feeding records. Put an error or rejected-settings notice before the affected content. Keep oxygen visually first. |
| Schedule /schedule | Title, selected feeder, Add action; time-zone and save-state notices; requested configuration, if present, in a visually separate “Waiting for the feeder” group; active schedules sorted by time and nozzle 1 before nozzle 2 on ties. Keep enabled state, dose, recurrence, and row actions visible together. |
| History /history | Title and filter action; selected date range and two summary counts; date-grouped rows with source, time, status, and concise requested/measured summary; Load more last. |
| Feeding detail /history/[runId] | Source and outcome first; request time, time zone, reason, and any lockout/recovery notice next; one clearly labeled result group per nozzle with requested, measured, and estimated amounts on separate lines. Keep the read-only “opening this link never starts a feed” note at the end. |
| Schedule create/edit | Sheet title and save footer; time and feeder time zone; repeat days; nozzle choice; a separate dose field for each selected nozzle; enabled switch on edit only; pending, rejection, uncertainty, or validation message beside the affected form. Keep Nozzle 1 then Nozzle 2 in the form and result order. |
| Feed now /feed/confirm | Target feeder and live-contact eligibility; nozzle choice and separate dose for each selected nozzle; sequential order note when Both is selected; compact review of the exact target and doses; confirmation footer. In recovery, lead with the saved command state and its check/resolve actions; do not invite a new feed. |
| Settings and devices /device | Paired feeder list and connection/selected status; settings overview for the selected feeder with current values; About last. Show the selected feeder name in the settings group when useful. |
| Pairing /devices/add | One step at a time: choose QR/manual method, verify pairing, name/location, success. Keep the progress indicator and form errors adjacent to their step. On success, show the paired feeder and the existing dashboard/list destinations. |
| Device details /devices/[deviceId] | Feeder identity and selected-device action; name/location edit; device metadata and last contact; refresh action; Remove access last, with its existing warning that schedules may continue on the feeder. |
| Field editor /settings/[field] | Sheet title; applied/requested/pending or unverified state; only the selected field controls; concise search/field hint; Save footer. Keep errors beside the affected field and retain input after failure. |
| Notifications /notifications | Chronological rows with concise title, time, unread state, and independent delete action. Mark all as read and Delete all stay separate footer actions. |

## Exact copy proposal

Only the listed visible strings change. Other route text, field labels, status labels, accessible names, validation details, and raw server error text remain in place. No explanatory paragraph moves to another route; field-specific hints stay with their editor and measurement-quality copy stays with its reading. Home also renders its existing contact-status accessibility text beside the header icon, with the same wording. “Feed now” becomes visible in the Home content flow but keeps its destination.

| Route | Current | Proposed | Placement |
| --- | --- | --- | --- |
| Home | Status is icon-only; accessible text is “Online”, “Offline · last contact {age}”, “Contact status unavailable”, “Contact not recorded”, or “Contact time unknown”. | Show the same current status text beside the icon. | Home header below the title; no status wording or meaning changes. |
| Home | “Pair a feeder to get started” | “Connect a feeder” | Home empty-state heading |
| Home | “Add a feeder to connect it to this app.” | “Pair a feeder to see its status here.” | Home empty-state description |
| Home | Default action “Add device” | “Pair feeder” | Same empty state; still opens /devices/add |
| Home | “Feed” | “Feed remaining” | Metric label |
| Home | “Next” | “Next feeding” | Metric label |
| Home | “Recent activity” | “Recent feedings” | Section heading |
| Home | “Recent activity unavailable.” | “Recent feedings unavailable.” | Recent-feedings read error |
| Home | “The feeder rejected the last settings change. The previous settings are still active.” | “Settings update rejected. Previous settings remain active.” | Home notice |
| Home | “{count} sample(s) with invalid or uncertain device time were counted separately.” | “Time is invalid or uncertain for {count} samples.” | Beneath the graph |
| Schedule | “No feeder selected” | “Select a feeder” | Empty-state heading |
| Schedule | “Pair and select a feeder to manage its schedules.” | “Pair then select a feeder to view its schedules.” | Empty-state description |
| Schedule | “Pair a feeder” | “Pair feeder” | Empty-state action; same pairing route |
| Schedule | “Local schedules unavailable” | “Scheduling unavailable” | Unsupported-capability heading |
| Schedule | “This feeder has no validated local schedule capability.” | “This feeder has no validated local scheduling capability.” | Unsupported-capability description |
| Schedule | “No feeding schedules” | “No schedules yet” | Empty-list heading |
| Schedule | “No schedules yet.” | “No schedules yet” | Empty list while a save locks edits. |
| Schedule | “Tap + to add a feeding time.” | “Use + to add a time.” | Empty-list description |
| History | “No feeder selected” | “Select a feeder” | Empty-state heading |
| History | “Pair a feeder, then select it to view its history.” | “Pair then select a feeder to view history.” | Empty-state description |
| History | “Pair a device” | “Pair feeder” | Empty-state action; same pairing route |
| History | “Unsuccessful feedings” | “Needs attention” | Summary label |
| History | No supporting definition | “Includes failed and unknown outcomes.” | Under “Needs attention”; preserves its meaning |
| History | “No feeding history yet” | “No feeding records yet” | Empty-list text |
| Settings/devices | “Add a feeder to connect it to this app.” | “Pair a feeder to manage it here.” | No-device description |
| Settings/devices | “Add a feeder” | “Pair feeder” | No-device action; same pairing route |
| Pairing | “Pair a device” | “Pair a feeder” | Route heading |
| Pairing | “Enter details manually” | “Enter pairing details” | Method row title |
| Pairing | “Type the device ID, challenge ID and pairing secret.” | “Use one active pairing window’s ID, challenge ID, and secret.” | Method row description |
| Pairing | “Use the details from one active pairing window.” | “Use the same active pairing window for all three values.” | Manual-entry form description |
| Settings field | “Select a feeder in Settings first.” | “Choose a feeder in Settings first.” | Missing-selection notice |
| Notifications | “No notifications yet.” | “You’re all caught up.” | Empty state |

Keep “Runs after Nozzle 1”, all applied/pending/rejected/uncertain wording, and feed recovery copy unless a later copy review proves the replacement preserves the same state and action. In particular, do not shorten away “authenticated”, “unknown”, “outdated”, “requested”, “measured”, “simulator”, or the fact that previous applied settings remain active.

## State and message priority

| State | Presentation rule |
| --- | --- |
| Loading | Show a calm skeleton only in the section being read. Do not replace valid cached readings or records while refreshing. Do not show a successful empty state until loading has resolved. |
| Empty | Use a short heading, one sentence, and at most one next action. Empty means a successful read with no items, not a failed or unavailable read. |
| Offline / stale | Place contact and freshness beside the affected feeder data. Keep a known last reading labeled outdated with its actual time; show unavailable/unknown when there is no valid value. Never display zero or “healthy” for unknown data. Disable a new feed without recent authenticated contact. |
| Read error | Keep the error beside the failed area and retain any available prior data with an outdated note. Offer retry only for the read that failed. A full-page error replaces content only when the route cannot safely render any content. |
| Pending configuration | Label the requested revision separately from the active applied configuration. Keep existing active schedules/settings identifiable until the feeder confirms. |
| Rejected configuration | State that the prior applied configuration remains active; do not style requested values as current. |
| Uncertain save or feed | Put the unresolved outcome first, retain the exact original target/input, and provide only the current safe status-resolution actions. Never create a new command/revision automatically. Do not duplicate the same underlying warning in a second banner. |
| Feed result | For every nozzle, show status, requested dose, and measured amount separately. “Not measured” stays distinct from estimated or synthetic simulator values. A terminal/result status is driven by saved state, never animation. |

Within a route, order actionable safety/uncertainty notices first, then the connection or measurement quality that qualifies the data, then read errors at their affected section, then content. Keep notices separate when they describe separate causes or actions. Announce only meaningful state changes; do not announce animation frames or routine telemetry polls.

## Motion proposal

These are proposed shared limits for natural motion. Current code and docs use 350 ms page/section transitions, 800 ms numeric/graph reveals, and replay on tab return; DESIGN.md instead specifies 150–200 ms and no decorative motion in live readings. After approval, use this table as the motion contract for Tasks 02–05 and reconcile the older docs during Task 06.

| Trigger | Properties and timing | First entry vs return / exit |
| --- | --- | --- |
| Tab first focus | Content opacity 0→1 and translateY 6 dp→0; 200 ms ease-out cubic, no overshoot. | Run once on the first focus in the app session. On tab return, render settled content immediately and restore scroll position. No tab-content exit animation. |
| Native route push/pop | Keep the existing Expo Router/native-stack directional transition; do not add a second page fade/slide over it. | The stack owns entry and reverse exit. Back gesture/Back button interruption settles to the route the navigator actually selected. |
| Offscreen section first enters view | Opacity 0→1 and translateY 4 dp→0; 160 ms ease-out cubic; optional 24 ms stagger capped at 72 ms for the initial above-fold group only. | A stable section/row identity reveals once. Do not replay on tab return, refresh, pagination of existing rows, filter changes, or telemetry polling. |
| Press feedback | Existing platform ripple/pressed overlay only; 100–120 ms opacity/color settle. | Immediate semantic response; no scale, bounce, or delayed action. Disabled/loading behavior stays as implemented. |
| Toggle/selection | Controlled thumb/selection settles in 140–160 ms with ease-out; label and selected/accessibility state update immediately. | Animation never invokes a save, toggle callback, route change, or command by itself. A rejected save visibly returns to the actual applied state. |
| Sheet open/close | Scrim 160 ms; sheet 220 ms ease-out from/to below the viewport, reverse on close. | Drag follows the finger. Settle with a critically damped, no-bounce spring that reaches the chosen open/closed position within about 250 ms. Keep the sheet mounted through exit and remove its route exactly once. |
| Graph becomes ready after range selection | Opacity only, 160 ms; no line drawing, scaling, or movement. | Show actual graph geometry immediately on return/refresh. Never bridge data gaps or replay on polling. |
| Reading, status, progress | Render actual new value/status immediately. No number count-up from zero, percent interpolation, status pulse, or result celebration. | No value-animation replay on first entry, return, device switch, refresh, or data update. Accessibility receives the actual value, not a visual frame. |
| Loading skeleton | Existing low-amplitude opacity pulse at 900 ms per cycle only while that section is genuinely waiting. | Stop when data arrives; static skeleton under reduced motion. Never pulse a stale value or status. |
| Keyboard, native picker, validation | No custom entrance. Use the platform keyboard/picker; place validation beside the field without shifting focus away. | CTA and focused field stay reachable; dismissal/back follows the platform rules below. |

Interruption rules: rapid input may stop or reverse a visual transition from its current position, but business actions stay single-shot and independent of animation completion. On route unmount or app background, cancel motion and settle to actual state. Reduced Motion skips opacity/translation/pulse and settles directly to final state; navigation, dismissal, data, and action behavior remain usable.

## iOS and Android behavior

| iOS | Android |
| --- | --- |
| Respect top, bottom, and home-indicator safe areas for headers, bottom navigation, in-flow actions, and sheets. Keep native push/pop and interactive back-swipe behavior. | Respect status/navigation/gesture insets and edge-to-edge system bars. Preserve native Back/predictive-back ownership; do not install a full-screen gesture that competes with system back. |
| Visible controls have at least 44 × 44 pt targets. Keep standard visible buttons/fields at the existing 48 logical-unit height where space permits. | Interactive targets are at least 48 × 48 dp. Keep standard visible buttons/fields at the existing 48 logical-unit height. |
| Use the existing native time picker and keyboard. A keyboard-open sheet can scroll its focused field and footer into view; tapping the scrim dismisses the keyboard before dismissing the sheet. | Use the existing native time picker and keyboard resize behavior. Back hides the keyboard first, then dismisses the sheet, then pops the route. Keep system navigation gestures clear. |
| VoiceOver follows the visible top-to-bottom order; modal dismissal returns focus to its opener. | TalkBack follows the visible top-to-bottom order; modal dismissal returns focus to its opener. |
| Support system text size without clipping, fixed-height cards, or lost actions. | Support system font scaling without clipping, fixed-height cards, or lost actions. |

Both platforms: keep fields labeled above controls; use multiline wrapping rather than truncation for meaningful names/status; keep keyboard actions and form errors reachable; expose selected, disabled, expanded, loading, and status states to assistive technology; provide a non-drag path for every drag action; preserve Android ripple and iOS pressed feedback where already present; color is never the only status cue.

## Acceptance coverage for Tasks 02–06

| Coverage | Required observable result on iOS and Android |
| --- | --- |
| First entry and return | Visit every tab and representative pushed route; verify one initial reveal, no replay on return, preserved scroll/filter/input state, and no double transition. |
| Home data quality | Exercise fresh, stale, unknown, offline, graph-empty, graph-error, and rejected-settings views. Actual values and freshness labels appear immediately; missing values never become zero. |
| Schedules and settings | Exercise initial load, read failure, empty list, pending, rejected, and uncertain save. Active/applied and requested state remain distinct; rapid toggles do not duplicate writes. |
| Feed now | Exercise one nozzle, each nozzle, Both, offline block, changed target, pending, terminal result, and uncertain saved request. Device/doses remain bound, nozzle 1 precedes nozzle 2, measured/requested stay distinct, and rapid taps never send twice. |
| Sheets and forms | Drag, cancel, settle, dismiss by close and Back, reopen quickly, edit long forms with keyboard open, and inspect field errors/focus restoration. No lost values or stuck overlays. |
| Accessibility and layout | VoiceOver and TalkBack; OS reduced motion; largest supported text scale; narrow phone, landscape, and a larger device. No clipped controls, hidden footer, or status communicated only by color. |
| Performance | Inspect both platforms on physical devices using an appropriate non-development build. Browser captures and Metro/dev-build behavior do not establish native smoothness or final acceptance. |

Source checks and browser captures can confirm route structure, exact copy, and deterministic state presentation only. Record iOS and Android native observations separately; do not treat source, Playwright, or browser success as native acceptance.
