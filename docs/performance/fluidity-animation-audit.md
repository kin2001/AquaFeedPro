# Fluidity audit — Task 01: animation execution

## Scope and conclusion

Source inspected at `6b3c58c72d7e21494d468a1caf550a753d1d3682`, on
`perf/fluidity-animation-audit`, based on `feat/make-it-faster-and-smoother`.
Audit date: 2026-11-03. This is discovery, not authorization to implement.
Only this audit is changed. Current owner instructions override historical
premium-task ordering and PR bases; any future reviewed PR targets
`feat/make-it-faster-and-smoother`, never `main`.

**Observed in source:** `useEntryProgress` uses React Native's JS-driven
`Animated.timing`, subscribes to every delivered value sample, and calls React
`setFrame` for each sample. Both width consumers turn that numeric state into a
new percentage width. Counters also render their text from that state. These
paths involve JS animation work and React updates, unlike the existing
native-driven opacity/translation effects and Reanimated dock/scene styles.

**Not established:** whether those updates cause the reported lack of fluidity,
how much time they consume, whether layout or navigation dominates, or whether
any candidate improves native frame delivery. There is no FPS/frame-time,
physical-device, browser, or native profiler measurement in this audit.

**Smallest follow-up to evaluate first:** remove the React sample round-trip
from graph clipping and meter fills, retaining their exact width geometry and
entry policy. A direct RN Animated width binding is the smallest first
experiment; an installed-Reanimated shared-value width binding is the bounded
UI-runtime alternative. Do not simultaneously redesign text counters, replace
navigation, convert all motion, or introduce transform-based masking. Select a
production change only after controlled baseline/candidate evidence and owner
review.

## Evidence anchors and complete caller inventory

Line numbers below refer to the inspected base.

| Source | Observed behavior |
| --- | --- |
| `mobile/src/components/motion.tsx:236–302` | `useEntryProgress(target, eligible, scope, duration, replayKey)`; initial frame, generation consumption, animation listener, cleanup, truth guards. |
| `mobile/src/components/motion.tsx:226–233,304–336` | Sole `useAnimatedNumber` caller is `AnimatedNumber`. Multiplies actual target by progress; finite/null handling and decimal formatting remain in the text layer. |
| `mobile/src/components/bento-kit.tsx:1221–1269` | `ProgressBar` directly calls `useEntryProgress(value, animated, scope, 800)`; fill width is `value * progress` percent. The fill is an RN `Animated.View`, but its width is a plain string, not an animated binding. |
| `mobile/src/app/(tabs)/index.tsx:176–197` | `GraphReveal` directly calls `useEntryProgress(1, true, scope, 900, range)`; normal `View` clipping width is `progress * 100` percent. |
| `mobile/src/app/(tabs)/index.tsx:766–779` | DO `AnimatedNumber`, one decimal; eligible only when fresh, quality valid, and no snapshot error. Actual surrounding accessible label remains immediate. |
| `mobile/src/app/(tabs)/index.tsx:1053–1088` | Feed `AnimatedNumber` and `ProgressBar`; fresh/no snapshot error gates. Both absent for unavailable feed percentage. `feedPercent` derives only from an available feed sensor, valid feed quality, and numeric percentage (`:659–664`). |
| `mobile/src/app/(tabs)/index.tsx:843–871` | Only `GraphReveal` render caller. Mounts only with graph samples and measured positive plot width. Wraps the real, fixed-dimension SVG paths and isolated dots, not axes/limit lines/inspection controls. |
| `mobile/src/app/(tabs)/history.tsx:62–139,375–403` | `HistorySummaryCard` contains one `AnimatedNumber(count)` and one `ProgressBar(share)`; two instances, Completed and Needs attention. Eligibility is `!activeError`; percentage is rounded count/total or zero for an actual zero total. Outer text/action labels announce actual counts. These are aggregate summaries, not animated command-result amounts. |
| `mobile/src/app/dev/components.tsx:397,414,419` | Three demonstration `ProgressBar` uses, values 72, 72, 15; default eligibility and `feed-meter` scope. Do not mistake these fixtures for real telemetry. |
| `mobile/src/components/app-shell.tsx:43` | Re-export of `ProgressBar`; not an additional animation implementation. |

Repository-wide searches found exactly three direct production hook call sites:
`useAnimatedNumber`, `ProgressBar`, and `GraphReveal`. There are no other direct
`useAnimatedNumber` callers, no direct counter usages on Schedule/Device, and no
command-progress callers of this hook. Tests call the hook separately.

With all eligible real data visible, Home can run four independent JS sample
streams (DO text, feed text, meter, graph); History can run four (two numbers,
two bars). This is a source-derived maximum for those components, **not** an
observed frame rate, callback count, or performance threshold. React batching
and actual callback cadence can change the number of commits.

### What a sample actually updates

1. RN `Animated.Value(1)` is allocated once; the layout effect stops old work,
   checks eligibility/focus/generation, resets to zero, then installs a listener.
2. `Animated.timing` uses `useNativeDriver: false`,
   `isInteraction: false`, and `Easing.bezier(0.16, 1, 0.3, 1)`.
3. Every delivered listener sample calls
   `setFrame({ target, scope, generation, progress })` with a new object.
4. The hook owner rerenders: `AnimatedNumber`, `ProgressBar`, or `GraphReveal`.
   Width owners produce new width strings; the number owner calls `toFixed`.
   This is not an imperative animated-style update.
5. Width changes are layout-affecting even for these clipped/absolute views.
   Amount of layout work and native commit cost are unmeasured. Removing React
   updates does not automatically remove layout cost.

**Important boundary:** this local state does not itself rerender `HomeScreen`
or `HistoryScreen`. Home computes `buildDoGraphShape(...)` in its own render
(`index.tsx:313`), outside `GraphReveal`; a clipping sample does not by itself
recompute shape or recreate parent-supplied SVG children. Do not justify a
whole-screen memoization rewrite by misattributing that work to this listener.
Normal parent data/layout/focus updates can still render those parents.

## Lifecycle and truth invariants to preserve

`MotionProvider` (`motion.tsx:53–92`) waits for the async OS preference before
mounting children. Unknown/error preference is conservative; a later preference
event wins over an older query. AppState null/undefined is initially permitted;
anything other than active disables motion. Preference and app-state listeners
are removed on unmount. `MotionScrollView` additionally reduces motion for
unfocused content.

`useMotionEntry` (`:123–161`) distinguishes route focus from semantic tab entry.
The tab layout supplies `TabEntryContext` generation on actual selected-tab
index changes (`(tabs)/_layout.tsx:499–512`). On a genuine entry, replay-key
change, or background-to-active return, focused generation advances. A temporary
cover/uncover with the same semantic generation is a pause, not another entry.
Without semantic context, route focus return is an entry.

| Event | Existing `useEntryProgress` policy |
| --- | --- |
| Eligible finite target at entry | Reveal once in generation: number 740ms, meter 800ms, graph 900ms; exact shared ease-out above. |
| Null, nonfinite, ineligible, unfocused or reduced | Return settled progress `1`; number layer maps null/nonfinite to unavailable, not zero. No new tween. |
| First valid sample arrives late, no previous reveal consumed | Can reveal once in current generation. |
| Target or scope changes during tween | Render guard immediately returns `1` for mismatched frame identity; effect cleanup removes listener/stops animation. Existing consumed generation prevents a second reveal. Latest actual number/width is immediate. |
| Same-value poll/rerender | Does not create a generation or new timing. Graph target is constant 1, so graph data refresh does not restart clip. |
| Range change | `range` is the graph replay key, not a React remount key; advances focused generation and replays clip. |
| Blur, background, unmount | Stop animation/remove listener in cleanup. Background also reduces motion. Cleanup marks listener not live before stopping, so stale callbacks cannot publish samples. |
| Reduced motion switched on | Immediate settled return; consumes focused generation. Switching it off alone cannot queue another reveal. |
| Foreground return | Active change produces one new focused generation and replay, not a queue. |

Identity guards in the *rendered result*, not just eventual cancellation, are
essential. A UI-runtime migration must preserve this against asynchronous JS/UI
handoffs; `cancelAnimation` alone is not an immediate truthful-value guarantee.
Scope currently suppresses cross-device carry-over but is not itself a replay
key after an entry has already been consumed. Duration/eligibility changes also
must not accidentally mint a generation.

**Policy discrepancy to surface, not fix here:** the 2026-11-02 expressive-motion
spec says replay on every route/Back return; this newer source and existing
checks explicitly suppress parent replay when a covering subpage closes under
unchanged semantic tab generation (`check-motion.mjs:299–353`). The current
fluidity assignment requires preserving existing replay/behavior. Keep that
baseline in an optimization; obtain an owner decision before changing coverage
return semantics. This audit does not claim the older wording is implemented.

### Accessibility, safety and graph integrity

- `AnimatedNumber` exposes actual finite value (or `Unavailable`) as its label,
  not the decorative count. Explicit parent labels also remain actual. Preserve
  nested text typography, decimal rules, text scaling, selection/reading order,
  and no transient editable/focusable counter control.
- `ProgressBar` always sets actual `aria-valuenow` and
  `accessibilityValue.now`, with immediate actual explanatory text. Its zero
  width reveal must never become zero telemetry or delayed low-feed feedback.
- DO freshness/quality/error gates and feed quality/freshness/error gates must
  remain on the existing model values. No arithmetic on a tween may drive
  status, thresholds, navigation, data reads, mutation, or dispensing outcomes.
- Graph reveal changes clipping, not samples: preserve the exact current plotted
  paths/geometry, gaps, isolated dots, configured limits, axis scale/time labels,
  and point inspection. `buildDoGraphShape` (`mobile/src/lib/monitoring.ts:156–173`)
  currently emits monotone cubic `C` segments, unlike the older expressive-motion
  spec's linear-path wording. This discrepancy does not authorize a geometry
  change; a fluidity optimization must preserve the current cubic baseline.
  SVG has fixed `plotWidth`/`plotHeight`; shrinking its container must not rescale
  the actual path. A scaleX on the SVG is therefore not an equivalent reveal.
- History aggregated outcome counts may animate today; individual pending,
  failed, unknown, terminal feed statuses and measured/requested result amounts
  must remain factual/static. No animated value authorizes feeding.

UI Styling applied here as accessibility-first, mobile-first, existing-token and
composition review, not a request to install its web stack. Tailwind/shadcn/DOM
or a new visual system would be inappropriate for this RN audit.

## Thread execution: verified APIs versus app evidence

Package manifest **and lockfile** resolve Expo 58.0.17, React 19.3.0, RN 0.88.0,
Reanimated 4.7.1, Worklets 0.13.0. No `node_modules` exists in this worktree;
these are pinned versions, not a claim that native binaries were inspected.
Official pages were fetched on 2026-11-03 using `curl -sSL`; no installs.

| Path | Source-supported execution |
| --- | --- |
| Entry progress | RN JS driver plus JS listener and React state/render; width updates additionally enter layout/rendering. No native-driver isolation from JS stalls. [R1–R2] |
| `useEntranceMotion` | Effect setup/cancellation is JS; opacity/translateY timing uses native driver on Android/iOS, JS driver on web. `AppPage` uses this for tabs/web pushed pages; native full-page pushes are deliberately not given a second whole-page slide. [R1–R2] |
| `useMotionValue`, press/selection effects, skeleton pulse | RN native-driven supported opacity/transform styles on native; setup/events and React pressed/selection state remain JS. Existing toggle and press consumers do not subscribe a React per-frame listener. [R1–R2] |
| Sheet | Timed scrim/visibility and spring translation use native driver on native. PanResponder event processing and `translateY.setValue` during drag are JS; native timing is not proof the entire gesture is UI-thread owned. |
| Dock and `TabScene` | Already use Reanimated shared values, `withTiming`, and `useAnimatedStyle` for selection/scene transforms. UI-runtime style updates on native do not require a React render per sample; route commit, preview state, and lifecycle orchestration still involve JS. [E2,A1–A4] |
| Web | There is no separate Reanimated UI thread; worklets become JS functions. Reducing React work can still help but cannot be described as native offload. [A5] |

Official matching documentation:

- **[E1]** [Expo 58 SDK reference](https://docs.expo.dev/versions/v58.0.0/):
  SDK 58 targets RN 0.88 and React 19.3.0. Also fetched
  [Expo's LLM index](https://docs.expo.dev/llms.txt).
- **[E2]** [Expo 58 Reanimated](https://docs.expo.dev/versions/v58.0.0/sdk/reanimated/):
  recommends **4.7.1**, includes a `useSharedValue`/`withTiming`/
  `useAnimatedStyle` width example, and says the Babel plugin is configured by
  `babel-preset-expo`. No config/package change is justified by this audit.
- **[R1]** [RN 0.88 Animated](https://reactnative.dev/docs/0.88/animated)
  redirects to `/docs/animated`; the returned page explicitly labels itself
  **0.88**. Native driver runs configured animation on UI without per-frame JS.
- **[R2]** [RN 0.88 animations](https://reactnative.dev/docs/0.88/animations)
  similarly redirects to current docs. Native driver supports non-layout styles,
  not general Flexbox/position animation. The exact
  [RN v0.88.0 Animated implementation](https://github.com/facebook/react-native/blob/v0.88.0/packages/react-native/Libraries/Animated/AnimatedImplementation.js)
  was fetched as a matching-version source cross-check. Do not simply flip
  `useNativeDriver` to true for the existing widths or text counters.
- **[A1]** [Reanimated 4.x withTiming](https://docs.swmansion.com/react-native-reanimated/docs/animations/withTiming/):
  duration, bezier easing, reduced-motion option; supports suffixed numbers but
  from/to categories must match (do not tween numeric px to percent).
- **[A2]** [4.x useSharedValue](https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/):
  value changes do not trigger typical React rerenders; reading UI shared values
  repeatedly from JS can block; avoid reads/writes during React render.
- **[A3]** [4.x useAnimatedStyle](https://docs.swmansion.com/react-native-reanimated/docs/core/useAnimatedStyle/):
  callback initially runs on JS and then UI, styles require Reanimated animated
  components, static/dynamic styles should be separated. This is not RN's
  identically named `Animated` import.
- **[A4]** [4.x cancelAnimation](https://docs.swmansion.com/react-native-reanimated/docs/core/cancelAnimation/):
  cancels a shared-value animation. Exact tagged source documents asynchronous
  cancellation; preserve independent immediate truth guards.
- **[A5]** [4.x worklets](https://docs.swmansion.com/react-native-reanimated/docs/guides/worklets/)
  and [web support](https://docs.swmansion.com/react-native-reanimated/docs/guides/web-support/):
  UI-runtime execution on native; single JS-thread web distinction and dependency
  array requirements without the Babel plugin.
- **[A6]** [4.x supported properties](https://docs.swmansion.com/react-native-reanimated/docs/guides/supported-properties/):
  width is supported on Android/iOS/web. [4.x performance](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/)
  explicitly warns that layout-affecting properties recalculate layout per frame,
  recommends non-layout properties when equivalent, and distinguishes debug from
  release. Its TextInput-counter recommendation is not proof a replacement is
  compatible with this app's nested Text/accessibility behavior.
- **[A7]** [4.x compatibility](https://docs.swmansion.com/react-native-reanimated/docs/guides/compatibility/):
  4.7.x supports RN 0.88 and Worklets 0.13.x; Reanimated 4 requires New
  Architecture. Installed/native compatibility remains untested here.

The Reanimated site is **4.x**, not patch-versioned. To avoid silently relying on
newer APIs, fetched official **4.7.1** tagged source for
[`timing.ts`](https://github.com/software-mansion/react-native-reanimated/blob/4.7.1/packages/react-native-reanimated/src/animation/timing.ts),
[`useSharedValue.ts`](https://github.com/software-mansion/react-native-reanimated/blob/4.7.1/packages/react-native-reanimated/src/hook/useSharedValue.ts),
[`useAnimatedStyle.ts`](https://github.com/software-mansion/react-native-reanimated/blob/4.7.1/packages/react-native-reanimated/src/hook/useAnimatedStyle.ts),
and [`animation/util.ts`](https://github.com/software-mansion/react-native-reanimated/blob/4.7.1/packages/react-native-reanimated/src/animation/util.ts).
These confirm timing duration/easing/reduceMotion, a mutable shared value,
style mapper setup/teardown, and `cancelAnimation`. This validates candidate API
availability, not runtime correctness or performance in this checkout.

## Ranked hypotheses and bounded experiments

| Rank | Hypothesis / experiment | What it proves or does not prove |
| --- | --- | --- |
| 1 | Listener-to-React round-trip adds avoidable work. First bind RN `Animated.Value` interpolation directly to percentage width in an RN `Animated.View` for **only** graph/meter, preserving the existing entry state machine and immediate truth fallback. Retain JS driver for width. | Smallest mechanism change; can eliminate React sample commits but does not move timing off JS or remove layout work. Verify supported percent interpolation in RN 0.88 and actual native visuals before adopting. |
| 2 | JS-driven width timing competes with navigation/data work. If evidence warrants it, give **only those two width consumers** a shared-value progress path via existing Reanimated; update width in `useAnimatedStyle`, keep all current percentages and fixed SVG dimensions. | Can remove JS sample scheduling and React frame updates on native; width still incurs layout. Requires lifecycle/identity parity tests and UI scheduling evidence. Not automatically superior to option 1. |
| 3 | Counter text rendering contributes materially. Profile the isolated counter components and actual text changes before proposing a separate change. | Existing 740ms semantics/formatting are required. Shared-value TextInput is not a drop-in nested Text replacement; no verified `Animated.Text` text-content API is established by the fetched docs. Do not migrate all counters speculatively. |
| 4 | UI/layout/rasterization or navigation/data processing dominates instead. Compare native frame trace with React/JS profile and the separate navigation audit. | If graph/meter cost is negligible, skip these implementation changes. More animation worklets or memoization cannot be assumed to fix a native bottleneck. |

For either width experiment, reuse `useMotionEntry` and existing policy rather
than create a general animation engine, global scheduler, FPS cap, or dependency.
The existing numeric hook must remain usable by counters; do not change its
return type and break text to accelerate widths. A narrowly scoped binding
variant should carry the same target/scope/generation/eligibility cancellation
rules, with no per-sample React listener for those two consumers. Exact API shape
belongs to an authorized implementation, not this audit.

A scale/translation clipping technique is a **later** experiment only if width
layout is measured as material. It must reveal a stationary graph left-to-right,
not squash it; preserve meter rounded geometry, RTL behavior and resizing.
Native flags/global architecture settings, cap changes, shortened durations,
and animation removal are out of scope.

## Existing checks and gaps

`mobile/scripts/check-motion.mjs` transpiles TS with `typescript`, evaluates it in
a VM, and substitutes React hooks, RN Animated values, and Reanimated functions.
Its manually delivered samples make useful policy assertions, **not** real
React scheduling, RN layout, native drivers, worklet execution or frame delivery.

Source-reviewed coverage includes:

- semantic tab replay versus subpage cover/uncover (`:299–353`);
- count timing, intermediate/settled values, retargets, polls, invalid/stale and
  scope truth (`:355–452`);
- cancelled stale sample, actual accessibility labels, reduced toggles,
  background/resume (`:453–523`);
- async reduced preference/AppState subscriptions and cleanup (`:524–555`);
- graph range/poll/blur/return/unavailable policy and clip source assertions
  (`:2222–2283`);
- meter actual accessibility and retarget/ineligible width (`:2285–2326`);
- sheet interruptions/background, press feedback and other safety semantics
  elsewhere in the same suite.

The standalone `check-tab-scrub.mjs` is another transpiled/pure policy check,
not a real device gesture or frame harness. It has no package-script alias;
run `node ./scripts/check-tab-scrub.mjs` from `mobile` when dependencies exist.
CI currently runs format/lint/typecheck for mobile; it does not run the motion
or tab-scrub scripts automatically (`.github/workflows/ci.yml`).

### Executable follow-up checks (proposed, not added/run)

1. Before changing product code, add a width-binding regression check that fails
   on baseline: advancing an isolated graph/meter reveal must update its bound
   animated width without invoking that owner's React state setter per sample.
   Exercise start, 0.45, finish and stop; assert initial/settled/intermediate
   visual widths, 800/900ms and exact easing. Do not use regex alone or a mock
   that merely assumes absence of React work. A real React profiling fixture
   should corroborate mount/setup/settle commits versus sample commits.
2. Run the existing lifecycle matrix against the new binding, not just against
   untouched `useEntryProgress`: target/scope change mid-frame, stale/null/
   nonfinite eligibility, late first valid sample, same-target poll, duration
   change, blur/return, semantic cover/uncover, range change, reduced-motion
   enable/disable, background/resume, unmount, obsolete callback after cancel.
   Assert settled actual width on the **first** retarget/scope render; for a
   Reanimated version additionally verify JS/UI handoff ordering on device.
3. Render actual graph/meter components in isolated RN-web fixtures; block
   external requests. Check 0/intermediate/1 clipping with real gap/dot data,
   fixed SVG shape, unchanged limit/inspection controls, immediate actual a11y
   values, no layout shift, narrow/landscape/large text and RTL. Confirm counters
   still produce exact decimals, unavailable dashes and actual labels. Browser
   evidence remains browser-only.
4. On an authorized implementation with dependencies available, run from mobile:
   `npm run check:motion`, `node ./scripts/check-tab-scrub.mjs`,
   `npm run format:check`, `npm run lint`, `npm run typecheck`, plus affected
   monitoring/feed-status/manual-feed/button-state/device-access/alerts/error-text
   and schedule checks required by the governing plan. Record baseline failures
   separately; do not weaken existing safety assertions for an optimization.

## Precise before/after measurement protocol

This procedure needs separately authorized fixture/runtime/build access. It was
**not executed**. Do not infer a runnable offline app or a supplied native
profiling fixture merely from these instructions.

1. Use base `6b3c58c72d7e21494d468a1caf550a753d1d3682` and one exact candidate
   commit with only the selected width experiment. Prepare identical sanitized
   local/offline data: fresh DO/feed, real-shaped graph with paths/gaps/isolated
   points, History totals, plus stale/unknown/error variants. Block live backend,
   auth, notifications and hardware actions. Fixture provisioning is a separate
   prerequisite; no new production bypass is proposed here.
2. Use the **same physical Android and same physical iOS device** for each
   baseline/candidate pair, identical release-mode build configuration, OS,
   orientation, font scaling, display refresh/adaptive settings and reduced-motion
   setting. Record model, OS, thermal/power state, build mode, JS engine,
   dependency versions, commit, fixture identity, and profiler versions. Do not
   compare debug baseline with release candidate. Existing EAS development /
   preview / production profiles are not measurements and do not establish an
   offline fixture build. No cloud build is authorized in this task.
3. Separately record cold process launch/first tab entry, then warm retained tab
   entries. For each warm trial: Home→Schedule→History→Device→Home, dwell at least
   2 seconds per destination so the 900ms reveal can finish; repeat 10 trials.
   Then perform 10 rapid forward/reverse tab cycles with approximately 100ms
   spacing, and 10 held dock scrubs with reversal/release. Record actual input
   timestamps rather than claiming precise manual tap timing.
4. During an active reveal, separately retarget fresh values, switch device
   scope, change graph range, cover/uncover a subpage, background/resume, and
   toggle reduced motion. Check no queued replay, visual jump/flash, invisible
   mounted content, stale width, lost inspection/input or state reset. Perform
   only navigation/presentation interactions; never confirm a feed action.
5. Capture Android System Trace/Perfetto frame timelines (JS/UI/render threads
   and jank classifications where supported), and iOS Instruments Animation
   Hitches/Core Animation plus Time Profiler as available. Save raw traces and
   capture boundaries. Use identical 5-second windows per transition/trial,
   retaining all trials; distinguish launch, steady animation and input latency.
   Report frame-time distribution (median/p95/p99), missed-frame/hitch counts
   relative to **actual device refresh budget**, trace duration and tool
   definitions. No universal 60/120 target or fabricated FPS number.
6. In a separate instrumented profiling run, count commits of `GraphReveal`,
   `ProgressBar`, `AnimatedNumber` and parent Home/History using React profiling
   tools where supported. Correlate timestamps/JS CPU samples with native
   hitches. Profiling instrumentation itself changes cost, so do not equate that
   run to uninstrumented release performance. Baseline/candidate screen captures
   at start/intermediate/settled states verify geometry, but video alone is not
   precise frame-time evidence.
7. Alternate baseline/candidate order across runs to reduce warm/thermal bias.
   Retain raw artifacts, exact build SHAs and device-specific results. Report
   each OS independently and include owner's feel assessment. Accept only
   lifecycle/safety/visual parity plus a reproducible improvement in the measured
   bottleneck without meaningful regressions. Otherwise revert/skip the
   experiment. A missing platform remains unverified, not passing.

## Commands actually run and limitations

- `pwd`, `git status --short`, `git branch --show-current`, `git rev-parse HEAD`,
  `git worktree list`, and `git rev-parse feat/make-it-faster-and-smoother`:
  correct worktree/branch/base; initial tree clean.
- `hc ls`, `hc get t34`, `herdr-app ls`: worker t34 live in named
  **Fluidity 01 - Animation audit** tab; task delivery and model settings visible.
- Repository searches and reads listed above; parsed package-lock with Python
  stdlib to confirm resolved versions. Node **v24.15.0**, npm **11.12.1**.
- `npm run check:motion --prefix mobile`: **blocked**, missing `typescript`
  (`ERR_MODULE_NOT_FOUND`) before assertions execute.
- `npm run lint --prefix mobile`: **blocked**, `expo` not found.
- `npm run typecheck --prefix mobile`: **blocked**, `tsc` not found.
- `npm run format:check --prefix mobile`: **blocked**, `prettier` not found.
- No installs, borrowed dependencies/symlinks, backend calls, authentication,
  cloud/local app builds, device commands, hardware, subagents, push, PR or merge.
  `adb` is on PATH; `xcrun` is not. No connected-device check or actuation was
  performed. Tool presence is not usable native evidence.
- Python `urllib` initially received HTTP 403 for Expo/Reanimated and a local
  certificate-verification error for RN. Normal TLS-verified `curl` succeeded
  with HTTP 200 for the cited official pages and tagged sources; RN documentation
  redirects are disclosed above. A temporary HTML extraction command initially
  hit Windows cp1252 decoding; rerun explicitly as UTF-8 succeeded. No insecure
  TLS override was used. Downloads remained in OS temp, not repository files.
- Documentation consistency/ownership and `git diff --check` are appropriate
  available checks for this deliverable; no passing app check is claimed.

Skipped product changes and speculative all-animation migration. Native frame
delivery, runtime lifecycle parity and every dependency-backed check remain
unverified; the bottleneck is still a hypothesis pending measured evidence.
