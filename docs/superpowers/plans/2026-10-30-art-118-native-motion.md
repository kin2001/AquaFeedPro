# ART-118 native motion follow-up

## Goal

Make the approved, restrained native motion visible on phones while preserving the real reading, chart, sheet, tab, and accessibility state.

## Definition of done

- An initially unknown React Native `AppState` does not suppress motion, while background, OS reduced-motion, and the local motion-off preference still settle presentation immediately.
- Home branding, the fresh valid DO presentation, feed tile, and chart reveal once per device/range trigger. Stale, invalid, offline, error, and outside-limit states render immediately; polling and tab focus do not replay a completed entrance.
- The DO graph reveals its actual SVG geometry after layout and retains gaps. The feed progress fill can animate while accessibility exposes the actual percentage and freshness text.
- Existing sheet/tab/press behavior remains in place. Physical Android testing remains an owner acceptance gate.

## Requirement map

| Requirement                                                                      | Current evidence                                                                                                                        | Change                                                                                                                         | Proof                                                                             |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Motion must be visible after startup and obey reduced motion/background          | `MotionProvider` initialized `active` to false for `AppState.currentState === null`; `useEntranceMotion` replayed when its gate changed | Treat null initial state as active, wait for system preference readiness, and consume each trigger only once                   | `check:motion` covers null startup, pending readiness, reduced motion, and resume |
| Home entrances and DO chart reveal follow reference without stale/invalid motion | `HomeScreen` only faded the graph, before plot measurement; DO/feed cards had no stagger                                                | Add short scoped brand/card/reading/feed entrances and a measured left-to-right SVG clip, enabled only for safe fresh readings | Focused motion check, lint/typecheck, source/diff review                          |
| Feed progress animation keeps real semantic value                                | `ProgressBar` rendered the same static number visually and accessibly                                                                   | Pass the existing safe reading frame to the fill; keep actual value/text on the accessible track                               | `check:motion` asserts visual and accessibility values differ as intended         |

## Scope and execution

1. Add focused regression checks in `mobile/scripts/check-motion.mjs`.
2. Fix the shared AppState and OS motion-readiness gates in `mobile/src/lib/ui-preferences.ts` and `mobile/src/components/motion.tsx`.
3. Add Home entrances, chart clipping, and safe progress framing in `mobile/src/app/(tabs)/index.tsx` and `mobile/src/components/bento-kit.tsx`; reuse the existing Animated and SVG stack.
4. Run the focused ART-118/ART-119 checks plus mobile lint/typecheck, inspect the final diff, and update existing draft PR #62.

## Constraints

Expo SDK 58; no new dependency, route/feed behavior change, fake value, gap bridging, or motion replay on poll/focus/resume. No merge or deploy. Physical Android acceptance requires an attached device and remains unverified in this environment.
