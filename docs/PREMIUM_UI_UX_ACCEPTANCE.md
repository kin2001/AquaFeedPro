# Premium UI/UX combined review — 2026-11-02

## Expressive revision overlay — implementation candidate, not reviewed

The owner-approved [expressive motion / Paper dock revision](superpowers/specs/2026-11-02-expressive-motion-design.md)
supersedes the historical one-time/no-count-up/fixed-tab-shell policy only.
The historical PASS below applies to its named older commit, **not** this new
candidate from `b82b55a`. Only t7 personally reviews the expressive candidate.

Source implementation now includes in-scroll feeder selection/notifications,
header-free tab shell, measured safe-area-aware floating dock and travelling
selection, every-focus presentation replay, eligible decorative counters/meter,
and clean real-data graph sweep. The owner's additional Schedule/History
reference is implemented as heading/subtitle plus outlined circular48px Add /
Filters respectively; Add opens the existing schedule editor, Filters opens the
existing full filter Sheet, and refresh remains separately reachable. Existing
input, scroll/data identities, schedule validation/recovery, requested/applied
state, confirmation guards and actual measurement semantics are preserved.

Assigned source checks all exit0 (external `expressive-final-source.log`), with
RED→GREEN lifecycle/graph/sheet/session regressions and actual-value accessibility
assertions. **Rendered reference comparison and intermediate browser frames are
WAITING: owner explicitly forbids starting Expo until t7 authorizes it.** No
browser/native acceptance or worker PASS/READY is claimed. The external
`expressive-report.md` tracks the exact candidate commit and pending evidence.

The two existing notification transport/API and offline schedule-edit policy
gaps below remain held. All native iOS/Android gates remain unverified. No cloud,
backend/contract/package changes, production actions, hardware, push, PR or merge
are authorized by this overlay.

---

## Historical Task06 review (unchanged evidence for its exact candidate)

## Verdict and exact candidate

**Local source/browser gate: PASS. Overall cross-platform acceptance: incomplete.**

Coordinator personally inspected deliveries and reran checks; no delegated review verdict. Task02 foundation, Task03 Home/History, Task04 Schedule/Feed now and Task05 Settings/devices/notifications are included. Exact tested implementation: `900a4a0d9e545217ca0cb31c096820354158de27`. Owner-merged Task01 head `2ef238b1715b098cb000f0d9ba27931ca12e9d70` has an identical file tree (`git diff --exit-code` passed). Task06 documentation does not change that implementation. PRs #67–70 were merged into `feat/premium-01-design` outside the coordinator's merge actions. Task01 PR #66 remains the route to `main`; no release/main merge is inferred here.

Owner finished interim manual testing and deferred final judgement until combined work. Expo's Android bundling log is not evidence of device acceptance. No native or final owner verdict is claimed by this document.

## Implemented behavior reviewed

- Shared monochrome/Inter shell, controlled motion, immediate changing readings, sheet scroll/footer and keyboard-focus semantics. Canceled sheet drag does not trigger Close, repeated dismissal/reopen leaves no overlay, semantic Close remains usable.
- Home retains explicit authenticated contact/measurement quality and in-flow Feed now. History preserves pagination/scroll on tab return, explicit refresh, per-device scope and retained same-device data on read failure. Requested amounts and actual/simulated measurement quality remain distinct. Technical disclosure exposes actual DOM expanded state.
- Schedule separates applied schedules from requested revisions: only applied cards say Saved to feeder. Pending/rejected/uncertain recovery and previous applied values remain explicit. Editor/confirmation use synchronous duplicate-admission guards. Saved-command recovery precedes new confirmation, stale callbacks cannot admit a second request, terminal results do not present a new editable confirmation. Two-nozzle doses/order and fresh authenticated contact gate remain intact.
- Settings presents current applied values, pending/rejected qualifiers and read failure instead of false Off/zero; old-device responses are ignored. Pairing preserves manual/QR options and input with supported progress semantics. Naming drafts survive failure. Device removal confirmation names the exact feeder and warns applied schedules may continue. Notification read/delete actions are independent; history navigation rejects late focus/installation changes and reports retryable navigation failure.

These are scoped refinements, not a change to backend/protocol, credentials, dependencies or hardware capability policy.

## Checks personally executed on the combined candidate

From `mobile`:

```sh
npm run lint
npm run typecheck
npm run check:device-access
npm run check:alerts
npm run check:error-text
npm run check:motion
npm run check:monitoring
npm run check:feed-status
npm run check:manual-feed
npm run check:button-state
node scripts/check-schedules.mjs
```

All exited zero. Candidate working tree was clean; task-only diff checks passed. Tests include existing authorization/session/storage/configuration/recovery behavior and executable actual-route harness regressions. Hook harnesses substitute external boundaries and are not native rendering engines.

## Personally executed browser review

Platform: installed Chrome through external Playwright, development RN-web/Metro, Windows. One visible server on localhost18087, stopped after review. Dotenv disabled; dummy localhost Supabase configuration, intercepted fabricated data, external origins blocked. No production/hardware/feed action. One fabricated schedule configuration write and notification read/dismiss fixture actions only.

| Area | Observed result |
| --- | --- |
| Foundation pilot, normal + reduced motion | Rapid buttons/switch, stable visible keyboard focus, disabled/loading states, local retry, long-form validation/scroll/footer, browser focus trap, Escape/opener focus, canceled short drag, full drag/scrim/Close/reopen, push/Back state retention, landscape footer passed |
| Home/History | Populated readings/contact, graph gap, next feed and in-flow confirmation navigation/back; pagination/scroll retained on tab return; detail/filter apply/clear; same-device read error retains data with outdated notice; empty/offline/unknown states passed |
| Disclosure | Actual DOM `false → true → false`, keyboard Enter collapse, 48px target, no page errors |
| Schedule/Feed now | Applied and requested groups distinct after one fixture write; Both25g/15g exact summary and sequential message; stale contact blocks confirmation; empty/rejected/read-failure views passed; no feed submitted |
| Settings/devices/notifications | Applied/pending/rejected/error/offline/empty overview; exact-feeder removal warning and Cancel; failed-name draft retention; manual validation and progress value2; independent rendered read then dismiss passed |
| Responsive | Home320px with no page horizontal overflow;375x812 phone and812x375 landscape interactions/layouts; representative screenshots inspected |

Each domain batch reported `errors: []`. Local evidence is retained outside the product repository under the sibling `.premium-ui-coordination` directory: `task-06-02/03/04/05-browser.mjs`, corresponding results JSON/screenshots, `task-06-a11y.mjs`, and personal task review reports. Original per-task evidence remains separate. Shared foundation normal/reduced runs both passed; latest same-named foundation screenshots/results represent the reduced-motion rerun. These browser results do not prove native performance or every platform-only interaction.

## Open acceptance items — do not silently waive

1. **Offline schedule-edit policy needs owner decision.** Older DESIGN guidance disables undeliverable changes; the premium spec preserves requested/applied revisions but does not clearly override that rule. Existing server-reachable/feeder-offline configuration semantics were preserved, without introducing a new block. Decide whether to block edits or accept explicitly labelled waiting requests, then scope implementation/tests if required. Fresh-contact gating of manual feed is implemented/tested and is a separate rule.
2. **Existing notification transport/loading API gap.** `alerts.ts` swallows transport failures and does not expose loading/error state to the route. Independent actions preserve server-confirmed cache behavior, but empty cache is not proof of a successful empty server response. Task05 navigation-error UI does not fix transport errors. Truthful notification loading/read/action-error UI needs an explicitly scoped controller/API delivery and regressions; not accepted as implemented here.
3. **No physical iOS/Android or release-like performance validation was available to the coordinator.** Record the platforms separately below. Browser reduced-motion emulation is not OS reduced-motion acceptance. Source/native API inspection and successful Metro bundling are not runtime observations.

| Native gate | iOS | Android |
| --- | --- | --- |
| Runtime route loops/sheets/gestures/Back and keyboard/footer | Unverified | Unverified |
| VoiceOver / TalkBack focus, naming and independent actions | Unverified | Unverified |
| Safe areas, largest text and landscape | Unverified | Unverified |
| Camera permission/scan and pairing success/recovery | Unverified | Unverified |
| OS reduced motion, background/resume, session restoration | Unverified | Unverified |
| Non-development transition/gesture and physical performance | Unverified | Unverified |

Final owner judgement, these policy/API decisions and native evidence remain open. The local review is finished within its stated scope; **Task06 overall acceptance is not complete while these gates remain unverified/unresolved**. No merge, release, provisioning, credential rotation or physical feeding authorization follows from a passing test or this document.
