# ART-119 Home and DO graph

Reference: [ART-119](https://linear.app/artkin/issue/ART-119), [ART-117 revision 10](https://linear.app/artkin/issue/ART-117), and the unchanged archive in [ui4-native-foundation](ui4-native-foundation/README.md).

This delivery is stacked on ART-118 PR #62 at `d57cac1ff9c5bea08dea5ce10fd79e1c0c2cb491`. It reuses that branch's theme, dock, branding and motion preferences. The owner requested direct implementation in this chat without Orca.

## Route and state coverage

| Route/state | Presentation and preserved behavior | Evidence / remaining gate |
| --- | --- | --- |
| Home, populated | Brand icon/wordmark, named feeder link to existing Settings picker, contact and simulator labels; neutral card, marine/aqua SVG plot, actual inventory/capacity and next applied feeding; compact existing activity rows | Source review; physical Android both themes pending |
| Home, no paired device | Existing pair-a-feeder empty state and notifications | Source review; Android pending |
| Home, loading / partial failure | Existing skeletons, errors and retained prior data; configuration rejection remains visible even alongside a load error | Source review; Android pending |
| Home, stale / offline / invalid / uncalibrated | Existing quality/freshness messages and status logic; no count from zero for these values; unknown remains a dash or explicit explanation | Monitoring and numeric checks; Android pending |
| Home, valid numeric updates | One-second bounded count-up in isolated text components, from the prior visual frame; exact original final precision/units. Real values drive thresholds and accessibility | `check:motion` covers initial/update/decrease, no polling replay, context cancellation including late callbacks, invalid values, reduced motion/background cancellation and unmount |
| DO graph, 1h / 6h / 24h | Original samples, gaps, non-overshooting geometry, timestamps, scale, configured limits and previous/next point controls; SVG-only opacity reveal does not interpolate measurements | `check:monitoring`; native touch and screen-reader inspection pending |
| Feed now | Full-width charcoal button with white circular arrow; opens existing `/feed/confirm` with no direct command | Source review; Android confirmation navigation pending |
| History and Schedule links | Existing routes, real history outcomes and nozzle-specific upcoming doses retained | Source review; feed-status check |
| Small width / large text / dock | Feeder name wraps; tiles retain existing stacking at narrow width or larger font scale; Feed now is scroll content; existing tab scene reserves dock and safe-area space | Source review; physical phone portrait/landscape and largest text pending |

## Verification boundaries

No backend, monitoring parser, graph geometry, device-access contract, commands, schedules, simulator, SDK or dependency changes. Stat accepts presentation nodes and groups its supplied actual accessibility label, so numeric frames do not become semantic readings. Numeric animation uses a bounded `requestAnimationFrame` in the leaf text only; it does not rerender the Home data/graph on every frame. The existing motion provider settles it when the app backgrounds; leaving Home also bypasses animation.

Physical Android screenshots/recording are still required for populated/no-history/stale/invalid states, both themes, large text, reduced motion, background/resume, point interaction and dock clearance. No emulator, physical feeder actuation, iOS, merge or deployment evidence is claimed.
