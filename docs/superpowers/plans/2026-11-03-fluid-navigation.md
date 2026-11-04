# Fluid Navigation Implementation Plan

> **For agentic workers:** Use executing-plans for an assigned implementation task only. The current session is the orchestrator and personally reviews results. No recursive delegation.

**Goal:** Improve perceived fluidity on Android and iOS without changing the approved premium motion, timings, easing, replay, or app behavior.

**Architecture:** Establish evidence before selecting optimizations. Preserve Expo Router, retained scene identities, Reanimated, and the existing native-driven effects. Separate animation execution from navigation/render investigation so independent discovery can run in parallel; serialize changes to shared files.

**Tech Stack:** Expo 58, React Native 0.88, React 19.3, Reanimated 4.7.1, TypeScript.

**Spec:** User-approved fluidity plan in this session; existing visual requirements in `docs/superpowers/specs/2026-11-02-expressive-motion-design.md` remain authoritative for appearance.

## Global Constraints

- Every task has a fresh visible interactive Pi session and its own sibling worktree branched from `feat/make-it-faster-and-smoother`, never `main`.
- Every worker reads Ponytail full and UI Styling skills. Current user instructions override historical premium-task PR bases and dispatch order.
- Orchestrator reviews exact changes and checks; workers never approve themselves, open PRs, merge, or deploy.
- All passing task PRs target `feat/make-it-faster-and-smoother`. No merges without authorization.
- No animation removal, shortened durations, redesign, new dependencies, backend writes, hardware actions, or global configuration changes.
- No arbitrary FPS cap or guaranteed FPS claim. Release-mode physical Android/iOS evidence is required to claim verified native fluidity.
- Use sanitized/local fixtures; do not copy credentials or invoke authentication links from conversation.

## Review Focus

- Rapid interruption: transitions cancel cleanly without flashes, jumps, queued replay, or lost input.
- Truthful values: counters preserve actual accessibility values; stale/invalid readings never count up as valid measurements.
- Retained state: scroll, pagination, filter selection, and scene identity survive tab switches.
- Lifecycle: reduced motion, blur, background/resume, and device-scope changes settle correctly.
- Cross-platform evidence: web/source checks are not proof of Android/iOS frame delivery.

## Task 01: Animation execution investigation

**Ownership:** Read-only product inspection. Write only `docs/performance/fluidity-animation-audit.md` and a completion report outside the repository.
**Inputs:** `mobile/src/components/motion.tsx`, `mobile/src/components/bento-kit.tsx`, Home graph reveal, existing motion checks, version-matching official docs.
**Deliverable:** Trace per-frame React updates and layout animation callers; explain what runs on JS/UI/native threads with citations; propose the smallest compatible change and executable checks. Identify what needs runtime evidence. Do not assume JS-driven animation is the measured cause.

- [ ] Read agent instructions and required skills.
- [ ] Inspect all affected callers and lifecycle/safety requirements.
- [ ] Inspect available local tooling without installing dependencies or using live services.
- [ ] Document findings, bounded candidate changes, and precise before/after measurement procedure; distinguish observations from hypotheses.
- [ ] Commit only the owned audit, report SHA/files/checks/limitations, notify orchestrator, and stop.

## Task 02: Navigation/render investigation

**Ownership:** Read-only product inspection. Write only `docs/performance/fluidity-navigation-audit.md` and a completion report outside the repository.
**Inputs:** Tab layout/presentation, AppPage/MotionSection, four tab screens, device-access state propagation, existing tab-scrub checks and build profiles.
**Deliverable:** Trace cold versus warm tab changes, retained scene rerender triggers, graph calculation, focus refreshes, and preview mounting. Propose only evidence-backed bounded changes preserving freshness and state. Provide Android/iOS baseline procedure using existing tooling.

- [ ] Read agent instructions and required skills.
- [ ] Trace tap and scrub paths through render, focus, subscriptions, and async result updates.
- [ ] Check available tests/profiling configuration without installs, cloud builds, or live backend access.
- [ ] Record ranked hypotheses and independently testable candidate changes; explicitly state unavailable native evidence.
- [ ] Commit only the owned audit, report SHA/files/checks/limitations, notify orchestrator, and stop.

## Subsequent implementation gates

- [ ] Orchestrator reads both reports and exact diffs, independently checks critical claims, and requests corrections from the same worker if needed.
- [ ] Review detailed candidate changes with owner before product implementation; dispatch bounded follow-up tasks to fresh sessions/worktrees on this branch. Do not infer that discovery authorizes speculative fixes.
- [ ] For each implementation task: failing behavioral check first, minimal change, focused check passing, `npm run format:check`, `npm run lint`, `npm run typecheck`, relevant motion/tab/safety checks. Capture existing baseline failures separately.
- [ ] Return corrections to the same task owner; after two unsuccessful cycles reassess instead of repeating.
- [ ] Orchestrator opens passing task PRs with explicit evidence gaps, targeting this branch; does not merge them.
- [ ] Combined validation uses an explicitly authorized candidate containing accepted changes; serialize overlapping code and native profiling.
- [ ] Measure identical first/warm/rapid tab and dock flows on physical Android/iOS release-mode builds. Record device, OS, refresh settings, frame-time evidence, and owner's feel assessment. Missing devices/build permissions remain blockers, not passing gates.
