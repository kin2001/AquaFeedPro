# Approved expressive motion and floating shell revision

## Owner approval and precedence

Owner explicitly requested the prototype's display, graph, smooth expressive animation and replay on EVERY page switch, then instructed implementation and a PR into `feat/premium-01-design`, not `main`. The approved reference is `docs/design/expressive-motion/reference.html` and its two screenshots. Default Paper dock is the implementation choice (the reference's default/recommendation); Ink dock was an alternative, not a request for runtime theme settings.

This scoped revision supersedes the old premium spec's one-time entrances, no count-up, static tab bar/fixed title header and graph-fade-only choices. It does NOT reopen backend, command, authentication, pairing, measurement quality or device safety rules. Final native acceptance remains separate.

## Intent

Keep the premium UI's information/safety improvements but replace its overly static presentation with the approved reference's lively yet coordinated motion. Every route entry and return replays presentation without reloading data, resetting input/scroll, or re-dispatching mutations. The reference is fabricated/demo data; its values, times, statuses, sparkline geometry and mock actions must NEVER be shipped as real device data.

## Shell and layout

- Remove the separate fixed, bordered title strip on the four tabs. Feeder identity and actions live IN the scrollable page. Home opens with selected feeder name/location/model/simulator context and notification action, no redundant Home title or app-logo tile.
- Keep actual authenticated contact/freshness and sensor quality visible near the relevant data; never bury safety warnings to imitate a prettier screenshot. Longer identities wrap or truncate accessibly without forcing controls out.
- Use shared in-content feeder context with a working selection affordance, existing authorized devices/selection API and recoverable selection error. Empty/missing-selection context stays explicit. Retain page headings/action controls for Schedule, History and Settings in content, including filter/refresh/add actions. Preserve title/Back controls on pushed details/pairing; removal of the tab header must not remove navigation/accessible route identity.
- Additional owner reference confirmation: Schedule uses an in-content heading plus actual enabled-count / feeder-time-zone subtitle and an outlined circular Add button at right (minimum48px), opening the existing editor. History uses an in-content heading plus actual date-range / time-zone subtitle and outlined circular sliders Filter button at right, opening the existing complete filter Sheet. Refresh remains a separate reachable action. Prefer this Add over a redundant competing FAB; retain all existing forms, validation, pending/recovery and filter apply/reset behavior.
- Paper floating dock: white, inset16px horizontally, gap at least12px above bottom safe area, radius27px, padding7px, four icon+label tabs in existing order. Moving dark selection surface, rounded20px corners, white selected icon/text, subdued inactive icon/text. Minimum48px interactive targets. Subtle offset dock elevation is authorized by this visual revision, not a general shadow redesign.
- Keep content/FABs clear of dock using actual dock height plus safe-area inset. Last row remains scrollable/reachable, including landscape and enlarged text. Hide/move dock appropriately for keyboard rather than cover input. No new sidebar/theme/dependency feature.
- Keep Inter/Mono Ink tokens and existing card geometry. Reference emphasis: spacious oxygen card, large readable current value and smaller unit, clean thin line graph, compact metric tiles and deliberate primary action. Reuse route content/state architecture, no wholesale Home rewrite.

## Motion contract

These values mirror the approved HTML's intended rhythm; adapt via existing React Native Animated/react-native-svg for actual runtimes, do not transplant browser DOM into the app:

| Motion | Target |
| --- | --- |
| Page/tab entry + return | 460ms strong ease-out; opacity0.25→1, translateY18→0. REPLAY every focus, including Back/tab return. |
| Visible card group | 520ms strong ease-out; opacity0.35→1, translateY13→0, optional scale0.985→1;55ms sibling stagger capped165ms. Avoid applying a second large page slide to the same whole group. |
| Dock selection | 460ms smooth travel from CURRENT position, not reset/teleport; selected foreground transition around180ms. |
| Dashboard valid-number reveal | 740ms ease-out count-up on each navigation entry/return. Preserve decimal/integer formatting. Real source/accessible values remain immediate. |
| Feed-remaining meter | Up to800ms presentational fill reveal on entry/return for an eligible actual percentage; accessible percentage/low-feed state immediate. NOT command/dispensing progress. |
| Graph reveal | Up to900ms left-to-right reveal of REAL plotted paths/dots on navigation entry/return or explicit range change, not every poll. Geometry remains gap-aware/linear; no invented interpolation. |
| Sheet entry | Approximately420ms ease-out; exiting faster (~260ms). Scrim coordinates, controls stay functional, interrupted gestures retain current progress. |
| Press feedback | Immediate acknowledgement,100–150ms visual response; no business logic waits for animation completion. |

One lifecycle per focus/entry generation: blur/background/unmount/reduced-motion changes cancel work and settle; returning starts one new sequence. Fast consecutive navigation/presses reverse/cancel smoothly, never queue duplicate transitions or leave invisible mounted content. Animation setup/defaults must not flash/jump from fully visible to hidden after async preference resolution.

Native full-page pushes/pops are owned by native stack: tune its duration/easing as supported, do not stack a second whole-page fade/slide over native transition. Replaying card/graph/counters on return is still required. Web uses the shared page entrance for pushed routes. Sheets own one transition, never both stack slide and sheet slide.

## Truthful values and graph

- Only valid finite eligible fresh dashboard measurements count up; unknown/null/invalid/stale/read-error values show actual value with existing quality message immediately (missing is dash, NEVER zero). Eligibility/API names may stay compatible with current AnimatedNumber.
- Actual measurement lives in model/accessibility/limits/state; visual tween is presentational only. Screen readers get actual value, not frames. Safety notices, pending/unknown/terminal feed statuses and requested/measured result amounts do NOT count up, bounce, pulse or imply success.
- Do not restart count-up or graph reveal on routine telemetry refresh, rerender, pagination or filter updates while focused. When real target/eligibility changes during a tween, stop and show latest truthful value; no stale-frame overwrites or cross-device carry-over. A late first valid sample can reveal once within the current entry generation, without polling loops.
- Graph reference is a clean line with restrained grid/axes/time labels. Use actual shape/scale/limits/data and keep every existing gap, isolated dot, unavailable reading, time uncertainty, range choice and keyboard/touch inspection. No curve smoothing that fabricates peaks, no hiding limits/quality to copy the mock. Remove decorative hatch area if needed to match clean reference while retaining valid gap semantics.

## Accessibility/runtime boundaries

Respect OS/browser reduced motion with settled numbers/graph/page and readable immediate action feedback. Pause nonessential work offscreen/in background; restore correct state without animation-driven refetch. Focus must not get lost due to remounting whole route/component trees to replay. Verify supported Expo58/RN0.88/SVG APIs against installed packages/versioned docs; no new dependencies, lockfile/package changes, cloud builds, real backend writes, credential/pairing generation or hardware actions.

## Verification and review

Pin executable failing-before/fixed-after tests for replay focus lifecycle, interrupted/background/reduced transitions, eligible/ineligible/retargeted number output and actual accessibility values, graph replay vs polling/gaps/limits/inspection, dock reachability/safe areas and independent actions. Update old tests only for superseded policies; preserve safety assertions.

Use isolated localhost fixtures with external origins blocked. Compare actual RN-web implementation against the HTML reference at375/390px and landscape plus desktop; inspect animation FRAME SAMPLES/intermediate states and repeated switches, not just settled screenshots. Capture first entry, return, rapid switching, graph gaps/time errors, loading/empty/error/offline/pending/uncertain. Baseline/final lint/typecheck/motion/monitoring/feed-status/manual-feed/button-state/device-access/alerts/error-text/schedules must pass. Actual iOS/Android screenreader/gesture/safe-area/largest-text/release-like performance evidence must remain explicitly unverified if unavailable. Orchestrator personally reviews and issues PASS/CHANGES_REQUESTED before PR. No merge authorization.
