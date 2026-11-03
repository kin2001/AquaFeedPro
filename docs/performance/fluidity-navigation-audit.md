# Fluidity audit — navigation and retained rendering (Task 02)

## Scope and evidence

Source baseline: `6b3c58c72d7e21494d468a1caf550a753d1d3682`, branch `perf/fluidity-navigation-audit`, from `feat/make-it-faster-and-smoother`. Inspection date: 2026-11-03. Product code was read-only; this document is the only repository change. Future PR base is `feat/make-it-faster-and-smoother`, not the historical premium-task base or `main`.

**Conclusion:** there are plausible JS/render bursts at first preview, focus entry, and authorized-device refresh. None is a measured cause of native jank. Preserve the custom navigator, real route identities, retained scroll/filter/pagination state, freshness and approved motion. First obtain profiles; favor a local pure-derivation optimization over a navigation rewrite if a hotspot is demonstrated.

Read/applied Ponytail full (small independent changes, no speculative dependencies) and UI Styling (existing composition/tokens, accessibility, mobile behavior). Its web-specific shadcn/Tailwind setup is not appropriate to this React Native audit; no setup or styling change is proposed.

Evidence labels below:

- **Observed source:** control/data flow in the pinned revision, not a runtime observation.
- **Hypothesis:** potential cost, requiring execution/profiling to rank by duration.
- **Unverified:** runtime lifecycle, browser/native behavior, frame delivery and memory. No app was launched, no backend/authentication/hardware was used, and no FPS was measured.

### Source map

Paths below are relative to `mobile/`; line references describe the baseline.

| Area | Evidence anchors |
| --- | --- |
| Router/dock | `src/app/(tabs)/_layout.tsx`: `FloatingDock` (~115–239), `ScrubbableTabs` (~263–493), `RetainedTabs`/`TabLayout` (~495–528) |
| Real scene retention | `src/components/tab-presentation.tsx`: `declaredTabs`, `releaseTab`, `TabScene` (~119–178) |
| Page layout/readiness | `src/components/app-shell.tsx`: `AppPage` (~217–285) |
| Focus/viewport presentation | `src/components/motion.tsx`: `MotionScrollView` (~344–514), `MotionSection` (~523–604), `useEntranceMotion` |
| Home | `src/app/(tabs)/index.tsx`: scope/derivations (~213–343), focus reads/subscriptions (~345–522), graph render (~797–989) |
| Schedule | `src/app/(tabs)/schedule.tsx`: scope/read lifecycle (~70–232) |
| History | `src/app/(tabs)/history.tsx`: load/query lifecycle/grouping (~133–280) |
| Settings (route named device) | `src/app/(tabs)/device.tsx`: two focus effects (~63–123) |
| Shared access | `src/lib/device-access.tsx`: `refreshDevices` (~840 onward), lifecycle and memoized context (~1510–1600) |
| Change subscription | `src/lib/device-changes.ts`: 250 ms debounce, active guard, channel cleanup |
| Graph helper | `src/lib/monitoring.ts`: `graphForWindow`, `buildDoGraphShape` (~121–202) |
| Boot gating | `src/app/_layout.tsx`: bundled fonts, provider, installation phase, root stack |

## Tap and scrub trace

### Tap / keyboard / accessibility activation

1. `FloatingDock` renders declared destinations Home, Schedule, History, Settings. Each `MotionPressable` has tab role, name and committed selected state; visual foreground layers are hidden from accessibility. Keyboard Space handling is web-only. Keyboard listeners hide the dock when the keyboard appears.
2. Press start clears `draggedPress`; a pan sets it, suppressing the trailing press. `activate` emits preventable `tabPress`. A non-selected, non-prevented press calls `navigateToTab`, which resolves declared slot to route name and calls Router `actions.navigate`.
3. `declaredTabs` constructs presentation slots even when actual Router routes are sparse (e.g. direct Settings entry). Only `actualState.routes` are rendered; fallback declared keys are not substituted for real scene identity. Router state/descriptors/focus and global pathname update after navigation.
4. `TabLayout` increments a semantic tab-entry generation when a recognized tab pathname changes. `ScrubbableTabs` layout effect advances its epoch and settles position from its current value with `Motion.transition`/approved easing, or immediately for reduced motion. Route, pathname, device scope and window size participate in cancellation scope.
5. `TabScene` keys remain `route.key`; once focused or previewed a scene is retained. `descriptor.render()` remains in that retained wrapper. Presentation is a Reanimated horizontal transform and neighbor opacity, not a remount to replay. Focus changes pointer events and hides inactive descendants from accessibility.
6. `AppPage` signals scene-ready in a layout effect. That removes the scene cover after the page shell mounts, **not after data, graph or network readiness**. Existing in-content loading/error/empty states remain responsible for data readiness.
7. `AppPage` owns the previous pathname for hidden pages, preserving tab/header layout despite the global pathname changing. Its `MotionScrollView` stays mounted; dock clearance remains padding. Focus/entry controls presentation replay, not business actions.

### Held scrub / reversal / release

1. One-pointer pan activates after 6 logical units. Start cancels the current position animation, marks dragging, captures the current epoch, and uses `runOnJS` for press suppression and preview request.
2. `onUpdate` writes clamped fractional position from finger x minus dock padding and measured track width. Scene transform, dock selection and foreground opacity consume shared position via animated styles. **There is no explicit per-position React setState in this path.** This is the intended worklet/UI-runtime path on native; actual scheduling/frame delivery is unverified here.
3. `useAnimatedReaction` crosses to JS when the integer boundary changes, not every fractional position update. `requestPreview` requests both boundary neighbors. It deduplicates missing-route `PRELOAD` dispatches with `requestedPreviews`, then sets React `preview` state. Start and the first reaction can request the same boundary; deduplication bounds preload requests, and equal primitive state can bail out. Do not claim a precise render count without execution.
4. Router adds real preloaded routes; `TabScene` for the neighboring slots becomes retained and mounts its real content while still unfocused. A skeleton covers until `AppPage` mounts. Preview does not commit a navigation destination or grant interaction to the preview.
5. Finalize bridges to JS only if dragging and captured epoch still match. `finish` clears preview and `releaseTab` rounds/clamps once, emits preventable `tabPress` through `commit`, and navigates only when the destination differs. Cancel/prevention settles to the committed tab. A device/path/size change advances epoch, cancels dragging/animation and invalidates stale finalize work.
6. Warm scrubbing reuses those same retained scenes; crossing boundaries still changes preview context. All four tabs can eventually be mounted even if the user never commits some previews. Retention is intentional, but is not freezing.

## Cold versus warm work

“Cold scene” means first mount in this navigator lifetime, **not necessarily native lazy bundle loading**. `asyncRoutes` is not explicitly configured; SDK 58 docs distinguish web async routes from native defaults. “Cold application” additionally includes fonts, secure installation bootstrap and authorized-device loading, which gate `RootNavigator`; do not mix that startup latency into a warm-tab measurement.

| Scenario | Source-observed work | Consequence to investigate |
| --- | --- | --- |
| First tap to absent scene | Router route creation, screen hooks/render/layout, AppPage ready notification, removal of cover, focus presentation and screen-specific reads | JS mount/layout plus data arrival can overlap the 460 ms tab motion; no measured duration |
| First held preview | Preload and actual adjacent screen mounting, local derivations/layout, cover removal, unfocused effects allowed below | Mount burst can occur before release; preview is not a cheap image |
| Return to visited scene | Same route key and page/scroll instance; context/focus/path changes and presentation replay | No required cold mount, but render/effect work is still possible |
| Warm preview boundary | React preview update, scene neighbor calculations and navigator rendering | Shared per-frame position is separate from boundary-triggered React work |
| Device refresh / resume | Access context changes; retained consumers update, some scoped effects/read results update state | Hidden does not mean inert; runtime render breadth must be measured |

### Per-screen data/effect behavior

- **Home:** valid device/installation and focus start a 5 s freshness clock, an immediate five-way `Promise.allSettled` read (monitoring snapshot, selected-window DO graph, configuration, next occurrence, history), four-table Realtime channel with 250 ms debounce, 15 s foreground poll, and AppState resume refresh. One effect-local `loading` flag prevents overlapping loads in that effect. Scope/window/active guards reject obsolete results; cleanup clears clocks, debounce, listener and channel. Blur does not abort the underlying requests. Warm re-entry restarts this lifecycle while retaining prior scope-matching data. Preview mount alone does not run the focus callback. Dependency **`device` is an object**, so replacing authorized device records can restart the focused lifecycle even if ID/revision/window are unchanged.
- **Schedule:** a `useLayoutEffect` on scope/device ID clears device-scoped state before paint and starts configuration + next occurrence + pending-write read. **This runs on preview mount and scope changes even while unfocused.** It coalesces concurrent requests with queued refresh/generation handling. Separate focus effect subscribes to configuration changes and cleans up on blur. The focus callback itself does **not** invoke an unconditional read on every warm return; do not describe Schedule as identical to Home. Preserve this behavior during performance work; any freshness-policy change is a separate decision. Routine Realtime reads intentionally keep controls steady; explicit refresh/write paths can lock editing.
- **History:** `useEffect` loads on device/installation/query callback changes (including scope revision and applied filters), not on focus. Therefore cold preview can fetch history, and its guarded result may update a hidden retained scene. Warm Back/tab return intentionally keeps loaded pagination, rows and scroll, with explicit pull/keyboard/accessibility refresh available through AppPage. Filter drafts/applied filters are separate. `run` generation invalidates obsolete loads; `pageScope` prevents old-device presentation. Grouping is rebuilt in render from loaded rows and uses device timezone. Rows render inside the shared ScrollView, not a virtualized list; cost depends on actual loaded page count.
- **Settings:** first focus effect calls provider `refreshDevices`; a second reads selected-device configuration and guards results with active/scope-key handling. Warm returns repeat these reads. Unfocused preview mount does not run these focus callbacks, though the screen still renders available devices/configuration placeholders. Provider changes and local async configuration results can cause separate updates.

### Retained render propagation and viewport work

- `activityEnabled={false}` is explicit on `RetainedTabs`. Inactive scene opacity, pointer-events and accessibility hiding do not prevent React context updates/effects. SDK 58 Activity is experimental and cleans up effects when hiding: switching it on would interfere with visible scrub neighbors and is not a safe one-line performance fix.
- `DeviceAccessProvider` exposes one memoized value containing phase/errors/refreshing/devices/selection/actions. `setRefreshing(true/false)` changes that value; successful refresh parses fresh records and calls `setDevices(authorizedRecords)`, changing `selectedDevice` identity. All four screens and `ScrubbableTabs` consume this context (also shared feeder UI). Memoizing a consumer alone does not block a context update.
- Provider refresh occurs on activation, AppState active, token refresh, metadata changes, Settings focus and explicit actions. It checks installation/selection revision and latest run before committing. It is **latest-run-wins, not an in-flight promise deduplicator**. Multiple triggers can still start reads. Metadata events are refetched through authorized queries, not trusted directly.
- `ScrubbableTabs` recreates declared display state, dock descriptors, scene descriptor wrapper objects and `{position, preview}` provider value on render. This is a candidate source of unnecessary propagation, not proof that every descriptor's entire screen rerenders. React Compiler is enabled in `app.json`; without installed compiler/runtime output, source allocation alone cannot establish surviving allocations or expensive commits.
- `MotionScrollView` updates viewport refs and calls subscribed checks on layout, content-size and scroll (`scrollEventThrottle={16}`); it does not set page React state for every scroll event. Awaiting focused `MotionSection`s use native `measureLayout` callbacks and an epoch guard; revealed sections short-circuit, blur/reduced motion unsubscribes, re-entry intentionally resets reveal eligibility. Do not remove replay/measurement just to reduce counts. Hidden content is provided reduced-motion semantics, distinct from unmounting it.

### Home graph derivation

Every unoptimized invocation of Home computes valid values, axis max and `buildDoGraphShape(points, plotWidth, 117, axisMax)` before returning JSX, including freshness-clock and inspection-state updates. The helper constructs path/area strings and isolated dots; it bounds accepted input to 2–100 samples. SVG elements and axis/inspection text are then produced from this output. The bound makes catastrophic unbounded graph work unlikely; only a profile can establish material cost. Compiler caching may already avoid some pure derivation work.

**Specification conflict to resolve before dependent changes:** the approved expressive-motion spec says graph geometry remains “gap-aware/linear”; this baseline helper emits monotone cubic `C` segments and additionally computes `areas` although the Home line rendering uses paths/dots. The comment and implementation deliberately avoid overshoot and preserve gaps, but are not linear. This audit does not authorize changing graph appearance or deleting an exported return field; confirm owner intent and all helper callers first. Performance follow-ups should preserve exact baseline shape until this conflict is resolved.

## Ranked hypotheses and smallest independent follow-ups

Ranking reflects source confidence and investigation value, **not measured milliseconds or FPS**. No product implementation is authorized by this audit.

| Rank | Hypothesis and confirming observation needed | Smallest conditional follow-up / ownership | Required check and reason to reject |
| --- | --- | --- | --- |
| 1 | Home derivations repeat on clock/inspection/context renders. Confirm graph helper self-time/call count in the compiled app, especially with 100 samples and gaps. | Home-only: memoize pure graph values/axis/shape at their true inputs if compiler has not already done so. No freshness clock throttling or altered reveal keys. | Same shape output for new samples, width, limits and range; clock-only rerender need not rebuild shape. Freshness/limits/accessible values still update immediately. Reject if compiler already caches or savings are noise. |
| 2 | Authorized-device record replacement restarts focused Home fetch/channel lifecycle via `device` identity. Confirm request/subscription count on semantically equal and changed refresh results. | Provider-only structural reuse of validated unchanged records, or Home-only narrowing of effect inputs after auditing all captured fields. Choose one, not both initially. | Equal refresh does not restart Home; capability/contact/label changes remain observable; membership revocation and scope transitions still invalidate. Never skip validation or rely only on matching ID. Reject if no redundant restarts or changed semantics cannot be bounded. |
| 3 | Cold preview mounts Schedule/History and starts their mount-scoped reads while the UI is scrubbing. Confirm mount/commit/read timing relative to first boundary crossing and release. | First profile only. If render dominates, optimize one demonstrated subtree/derivation in that screen without replacing its route. Moving reads to focus would change preview readiness and needs explicit behavior approval. | Preloaded real neighbors remain visible, skeleton timing stays truthful, cancellation commits no route/mutation, state survives return. Reject eager mount-all, fake previews, arbitrary delays or blanket focus gating. |
| 4 | Navigator/provider object churn broadens warm boundary/context renders. Confirm which retained components actually render and their commit duration with React Compiler enabled. | Navigator-only stabilization of the smallest demonstrated context value/descriptor inputs, preserving preview/focus/scope updates and keys. | Same boundary neighbors and preload deduplication; fractional updates require no React position state; scope/resize interrupts still settle. Reject blanket memo wrappers/custom comparison layers or an Activity switch. |
| 5 | Large retained History pages repeat grouping and native ScrollView child work. Confirm actual loaded row counts, group derivation and layout time. | History-only memoized grouping if it is a hotspot; virtualization is a separate, larger flow change, not first choice. | Pagination append deduplicates sequence IDs, timezone/date boundaries and filters remain correct, scroll/detail Back retained. Reject if small fixture/data volumes show no cost. |

Do not reduce motion duration/easing, cap FPS, stop freshness updates, reset scene keys, defer safety state, merge unrelated screen changes or introduce a cache/query dependency. Shared provider/navigator files require serialized ownership; Home derivation and History grouping can be evaluated separately after orchestrator/owner approval. Animation execution findings belong to Task 01 and need correlation, not duplicated edits to `motion.tsx`.

## Available checks and tooling

Observed: Node `v24.15.0`, npm `11.12.1`, Android `adb` executable on PATH. No root or mobile `node_modules`; no `bun.lock` (npm lockfiles exist), no `xcrun` on PATH, no generated `mobile/android` or `mobile/ios` directory in the inspected listing. adb presence does not prove a device, runnable build, Android Studio profiler or authorization; no device was contacted.

| Command actually attempted | Result |
| --- | --- |
| `npm --prefix mobile run format:check` | Blocked: `prettier` not recognized |
| `npm --prefix mobile run lint` | Blocked: `expo` not recognized |
| `npm --prefix mobile run typecheck` | Blocked: `tsc` not recognized |
| `node mobile/scripts/check-tab-scrub.mjs` | Blocked: `ERR_MODULE_NOT_FOUND` for `typescript` |
| `npm --prefix mobile run check:motion` | Blocked: same missing `typescript` |

No installs, symlinks to another worktree's dependencies, live services or builds were attempted. These are tooling blockers, **not passing tests or demonstrated product failures**.

Source inspection of available checks:

- `check-tab-scrub.mjs` transpiles with TypeScript and mocks modules. It asserts sparse declared indices/real route keys+params, release clamp/rounding/one commit, prevention, fractional position and reversal. It explicitly does not establish real-scene rendering or native gesture lifecycle. There is no package script for it; invoke the file directly once dependencies are available.
- `check:motion` uses a mocked hook/animation runner covering focus replay, shell retained pathname, viewport behavior, truthful counters, sheets, scoped Schedule writes and filters. It does not run the actual custom navigator under native RNGH/Reanimated scheduling.
- Existing monitoring/device-access/manual-feed/feed-status/button-state/alerts/error-text scripts and `node mobile/scripts/check-schedules.mjs` are relevant regression gates after product changes. Not executed here because this is documentation-only and required local tooling is absent.
- `.github/workflows/ci.yml` runs mobile formatting, lint and typecheck, plus contract checks in another job; it does **not** run scrub/motion/performance tests. A green CI result would not fill those gaps.
- `eas.json`: development is explicitly a development client; preview is internal/development environment with Android APK; production auto-increments. No explicit profiling profile or native automated benchmark exists in the inspected configuration. Do not infer installed release binaries or iOS signing access from profile names.

### Behavioral regression matrix for any accepted optimization

1. Cold start at each declared route, including sparse direct Settings/History entry; inspect first preview neighbors. Stable real route keys, no blank/wrong scene, cover clears on shell readiness, data loading remains honest.
2. Warm visit all tabs; preserve scroll offsets, graph range/inspection, History filter drafts/applied filters and multi-page rows, and Schedule pending/recovery state. Back from pushed details retains the same scene. Presentation replays once per intended entry without data-reset remounts.
3. Continuous scrub across all boundaries and back; hold at fractions, reverse, release on half slots, cancel, multi-touch failure, prevented tabPress, rapid tap then scrub/tap, and trailing press suppression. Only one real destination commit, previews never dispatch mutations.
4. During a held gesture change selected device/revision, route, orientation/window size; stale finalize cannot commit. Background/resume and reduce-motion changes settle without stuck/hidden pages or queued replay. Existing scope omits AppState itself: verify gesture cancellation on background natively rather than assuming epoch covers it.
5. Offline, empty, invalid/stale telemetry, partial failures, delayed/out-of-order requests, access revocation, installation replacement and device A→B→A: no mixed-device data, no invalid-as-zero presentation; latest valid scoped result wins. No automatic feed retry, no animation-triggered business operation.
6. Home five-way reads preserve partial success and freshness aging; blur removes channels/clocks and stale results cannot apply. Settings/device refresh propagates real capability/metadata/access changes. Schedule focus listener and mount read stay distinct; History warm return must not reset pagination through a newly introduced focus refresh.
7. Graph geometry/gaps/isolated dots/limits, width/axis changes, actual accessible values and keyboard/touch inspection match the accepted baseline; routine data refresh does not replay entry graph/counters. Resolve cubic-versus-linear policy separately.
8. Android TalkBack/iOS VoiceOver see only committed tab content, correct selected tab and loading states; preview is noninteractive. Verify keyboard hiding/restoration, large text, landscape and last-row dock clearance. Browser checks are supplemental only.

## Android/iOS measurement procedure (not executed)

### Prerequisites and controlled inputs

Obtain separate owner authorization for dependency restoration, isolated fixture/runtime setup and local builds/device profiling. This task does not grant any of it. Use baseline above and one candidate optimization with recorded exact SHA/lockfile/toolchain. No production backend, real credentials, pairing or physical feeder; block external origins and use sanitized local responses/events. Existing script mocks are not a complete native fixture harness. Root bootstrap requires secure installation/auth verification: an isolated authorized session/fixture mechanism must exist before data-rich native flows can run. Do not bypass production authorization in product code for a benchmark. If unavailable, mark data-rich measurements blocked, not substitute empty unauthenticated screens.

Record phone model/SoC, OS, build identity/variant, Hermes/runtime version, refresh rate/adaptive settings, display/text scale, reduced-motion state, thermal/battery state and fixture sizes (0/typical/100 graph buckets with gaps; History one vs multiple pages; paired-device count). Keep OS settings, sample timestamps, response latency/event cadence and data identical across baseline/candidate; log freshness clock/poll crossings. Record app-cold startup separately from scene-cold and scene-warm transitions.

### Build and diagnostic separation

- After authorization, use the already selected npm toolchain and SDK-matching installed CLI, not a new global tool. Expo documentation specifies local release variants: from `mobile`, `npx expo run:android --variant release --device` and on a Mac `npx expo run:ios --configuration Release --device`. These are future procedure examples, **not commands run here**. CLI may generate native directories via prebuild; do that only in an authorized disposable profiling checkout. iOS needs Xcode/device signing as applicable. Confirm the installed app actually embeds the intended JS and runs without Metro/dev menu/Fast Refresh; keep generated artifacts out of this audit branch. Do not trigger cloud builds or production profile version changes.
- Use a separate debug/development build with existing `expo-dev-client` and React Native DevTools Components/Profiler/Network to attribute renders, dependencies, request counts, subscription starts/stops and JS call stacks. Confirm compiler behavior there. Expo currently documents its JS profiler as debug-only; **do not treat those timings or the dev FPS overlay as release frame evidence**. Diagnostic instrumentation, if needed later, must be separately owned and sanitized.
- Android release frame delivery: use Android Studio system tracing/Perfetto FrameTimeline for the app process, aligning input, UI/render-thread work and frame presentation deadlines. Capture missed frames, frame duration distribution and longest stalls for each scenario. Where supported, supplementary `adb shell dumpsys gfxinfo com.aquafeedpro.app reset` before a run and `adb shell dumpsys gfxinfo com.aquafeedpro.app framestats` after it can supply raw frame data; availability/coverage varies by OS/render path and must be checked. Do not silently equate gfxinfo summaries with end-to-end input latency.
- iOS release frame delivery: on macOS use Instruments Animation Hitches/Core Animation (available template depends on Xcode version) for presentation/hitch traces and Time Profiler for main-thread attribution in a separate capture if needed. Select the exact app process/device and preserve raw traces. If attaching to that release binary is prohibited by signing/entitlements, record the blocker and arrange an authorized profiling build with disclosed configuration differences; never relabel debug data as release.

### Repeatable interactions and analysis

1. Capture one process-cold launch separately. At a stable Home shell, perform the first never-mounted Schedule→History→Settings entries with fixed fixture latency, logging input time, first visible scene/skeleton, shell-ready and data-ready independently.
2. Visit all tabs, wait for reads/layout to settle, set retained scroll/filter/range/page states, then repeat Home→Schedule→History→Settings→Home at least 10 cycles. Capture an idle interval too, so the 5 s freshness clock/15 s poll is distinguishable from navigation.
3. On a fresh process capture cold dock scrubs; in the warmed process sweep left→right→left continuously, hold midway for 1 s, reverse, release, then rapid alternating taps about 100–150 ms apart for 5 s. Reproduce prevent/cancel/resize/device-scope/background cases independently, not all in one opaque trace.
4. Run normal and reduced-motion passes; include local delayed-response, stale/offline and metadata-refresh scenarios with exact event timing. No feed/schedule mutation is needed to measure tab fluidity; test mutation safety separately using local mocks.
5. Repeat the same suite on physical Android and iOS, at the actual configured refresh rates. Report per-scenario median/p95/p99 frame times, missed presentation deadlines/hitch count and longest stall, sample counts, cold mount/read counts, warm render/commit attribution (diagnostic build only), and memory before/after all scenes are retained. Use each display's observed deadline, not a universal FPS cap. Correlate first-input-to-visible response from native trace/video with shell/data readiness; video alone is not a JS/UI-thread profile.
6. Compare identical baseline/candidate traces; reject changes with no repeatable improvement or any behavior/motion/safety regression. Record owner's perceived responsiveness assessment separately from numerical evidence. Provide raw artifacts, build/commit metadata, run order and environmental outliers; no guaranteed FPS claim. Missing physical Android or iOS evidence leaves that platform unverified.

## Official documentation consulted

Fetched 2026-11-03; versioned SDK reference matches `expo ~58.0.17`, `expo-router ~58.0.25` declarations (RN 0.88.0, React 19.3.0, Reanimated 4.7.1). No installed package tree was available to verify resolved implementations. Current docs recommend a later Router patch; that is not authority to upgrade dependencies in this task.

- [SDK 58 index](https://docs.expo.dev/versions/v58.0.0/) and [SDK 58 Router API](https://docs.expo.dev/versions/v58.0.0/sdk/router/): stable custom navigator entry point, descriptor/render/actions, focus callback lifecycle and platform async-route defaults.
- [Expo documentation index](https://docs.expo.dev/llms.txt), followed to [custom navigators](https://docs.expo.dev/router/advanced/custom-navigators/): stable in SDK 58, `createProps`/PRELOAD and internal-state compatibility cautions. Guide is unversioned; API reference is the versioned anchor.
- [React Activity guide](https://docs.expo.dev/router/advanced/react-activity/): experimental SDK 58 feature, effects cleaned up while state retained, inactive tabs hidden; not assumed compatible with visible previews.
- [Debugging and profiling tools](https://docs.expo.dev/debugging/tools/): existing DevTools capabilities, debug-only JS profiling caveat and Android Studio/Xcode native tools.
- [Local app compilation](https://docs.expo.dev/guides/local-app-development/): debug versus release flags, native toolchain and prebuild behavior. An initial `/guides/profiling.md` lookup returned “Page not found”; used the index's real debugging/tools page instead.

**Remaining gate:** source review can justify a focused experiment, not a native-fluidity verdict. Dependency-backed executable checks, data-rich isolated runtime fixtures and both physical release-mode platform traces remain unavailable in this audit.
