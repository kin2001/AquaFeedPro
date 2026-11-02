# AquaFeed Pro — Local Worker and Review Workflow

Updated 2026-11-02 at the owner's request. This replaces the previous Orca/Linear/model-specific execution workflow for this repository. Do not restart Task 01 or historical setup.

## Roles and tools

- The current Pi assistant is the orchestrator: select ready tasks, create local Git worktrees, dispatch workers, independently review results, request corrections, and open PRs only after review passes.
- One local worker owns each implementation task and its own branch/worktree. Reuse that worker/session and worktree for corrections. Workers implement, validate, commit, and report; they do not self-approve, open PRs, merge, deploy, or operate hardware.
- Use local Pi execution and Git, not Orca. Linear, Notion synchronization, fixed historical model assignments, and Orca runtime provenance are not prerequisites for these local task packets. Record the actual worker model and reasoning setting; never claim an unavailable model was used.
- All new worktrees and coordination artifacts stay under `D:/thesis commision/Automated Fish Feeding System/`. Do not change global agent settings, remove historical worktrees, or modify other checkouts to enforce this workflow.
- Read and apply the task's available UI/UX and Ponytail full skills. Prefer existing components and the simplest complete change.

## Current scope and source of truth

`docs/PREMIUM_UI_UX_TASKS.md` defines task acceptance and file ownership. Task 01 is complete per the owner's current instruction; `docs/superpowers/specs/2026-11-02-premium-ui-ux-design.md` is the implementation reference. Its approved premium motion rules supersede conflicting older design/motion rules for this task pack. Both iOS and Android are targets; missing native evidence remains an explicit gap.

The current owner instruction overrides the task pack's historical planning-only wording. It authorizes local dispatch, review/correction, and opening reviewed PRs targeting `main`. It does not authorize merging those PRs, production release, destructive operations, or physical feeding.

## Dispatch and stop loop

1. Inspect branch, base commit, dirty files, existing worktrees, and dependency readiness. Preserve WIP; never blindly stage, reset, or discard it. Record the exact task, worker/session, absolute worktree, branch, base, owned files, and shared-resource constraints in a local checkpoint.
2. Start Task 02 alone in its own worktree. Dispatch only its task packet and necessary context. After assigning ready work, stop implementing and return control to the owner; do not silently perform the worker's task yourself.
3. The worker writes a completion or blocked report in the shared local coordination directory, including exact commit, changed files, acceptance evidence, commands/results, API changes, and unverified gates. A process exit is not proof of successful implementation.
4. On completion, independently inspect the exact diff and verify critical acceptance. Findings go back to the same worker/session/worktree with concrete expected behavior. After two unsuccessful correction rounds, reassess or escalate rather than repeating the same request.
5. After review passes, push the reviewed branch and open one PR targeting `main`. Record the PR URL, reviewed SHA, evidence, and limitations. If the head changes, review affected changes again. PR creation is not a merge or final native acceptance.
6. Only a reviewed local foundation may unlock Tasks 03–05. Integrate accepted task commits into a local candidate branch, without merging `main` or remote PRs. Descendant workers must use that exact candidate base. Keep cumulative prerequisite commits explicit in PR descriptions when targeting `main`.
7. After Task 02's pilot passes, use up to two workers concurrently for genuinely disjoint Tasks 03–05. Each task gets a different worktree. Serialize shared components, lockfiles, backend resources, ports, native profiling, and hardware. Task 06 is the coordinator's independent combined review after Tasks 02–05 are locally integrated; return fixes to their owning workers.

## Reporting and notifications

Use a shared local coordination directory outside product commits for prompts, sessions, logs, completion reports, and review findings. Workers must report `READY_FOR_REVIEW` or `BLOCKED`; only the orchestrator records `REVIEW_PASS` or `CHANGES_REQUESTED`.

Pi CLI workers can run separately and persist reports. Unless an actual callback/wake-up integration is installed, they cannot automatically restart a stopped orchestrator turn. State this limitation plainly; resume on the next owner message and read the report. Do not claim a file report is a live notification.

## Verification and safety

Run task-specific checks on the exact candidate and independently verify critical behavior. Distinguish source checks, browser evidence, native builds, physical-device observations, and hardware acceptance. Report unavailable checks rather than inventing success. Documentation-only changes require consistency/diff review, not an app build.

Preserve device access checks, explicit confirmation bound to target and doses, durable duplicate prevention, uncertain-result recovery, requested/applied configuration, and requested/measured distinctions. Two nozzles share one container and execute sequentially, nozzle 1 first. Unknown or stale readings are not zero/healthy readings. Animation never dispatches business actions or proves physical completion.

Keep secrets out of prompts, reports, commits, and logs. Do not access production resources or actuate hardware. No dependency additions, unrelated features/refactors, or ownership expansion without coordination. Retain worker worktrees and unmerged evidence until safely preserved and cleanup is authorized.
