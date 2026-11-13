# AquaFeed Pro — Agent Instructions

Applies to this directory and its descendants. Follow the user's current scope; documentation describing future execution does not by itself start that execution.

## Read first

- [AI_DEVELOPMENT_WORKFLOW.md](AI_DEVELOPMENT_WORKFLOW.md): roles, handoffs, ownership, review and integration.
- [DESIGN.md](DESIGN.md): approved visual and interaction requirements.
- [Notion master plan](https://app.notion.com/p/3ec224a56ef381019c30d3da4e54251e): architecture, backend, device protocol and phased backlog.
- The assigned task and relevant versioned contracts/migrations when those files exist.

Read only relevant sections after initial orientation. Do not assume planned files, commands or integrations are already implemented. Report material conflicts before changing dependent behavior.

## Roles and scope

- Use Pi for the orchestrator and workers, with Herdr Desktop for monitoring and messaging. The orchestrator assigns tasks, personally reviews exact diffs and verifies critical checks, gives PASS or CHANGES_REQUESTED itself (no delegated reviewer), requests corrections, and opens PRs only after review passes. Record the task's actual approved PR base; the premium task pack uses `feat/premium-01-design` with PR #66 as its route to `main`. Do not merge without separate authorization.
- Run interactive Pi workers through Herdr Desktop, each visible in the owner's Agents sidebar and a named tab/pane, with one distinct local Git worktree per implementation task. Read `hc --skill` and `herdr-app --skill` before dispatch; run Pi interactively, never in print mode. Confirm sidebar visibility, live terminal and task delivery, and record worker/session and parent terminal identities. Workers report completion/blockers to the orchestrator with `hc send <parent-terminal> "<status and report path>"` and remain available for corrections. Hidden built-in subagents do not satisfy this requirement. All new worktrees belong under `D:/thesis commision/Automated Fish Feeding System/`. Orca is not an execution prerequisite.
- At task selection and after completions, assess dependency readiness, file ownership and shared resources for possible parallel work. Dispatch independent ready tasks concurrently within available agent slots; serialize overlapping files, contracts, lockfiles, databases, ports and hardware. Respect task-specific prerequisite gates; the premium pack still requires the reviewed Task 02 pilot before up to two implementation workers run concurrently.
- After a PR is verified merged, assign a different Pi agent to clean up that task's local worktree and update the task tracker in the assigned Markdown plan/task file. Follow the post-merge safeguards in `AI_DEVELOPMENT_WORKFLOW.md`; never treat PR creation or closure as proof of merge.
- Follow [AI_DEVELOPMENT_WORKFLOW.md](AI_DEVELOPMENT_WORKFLOW.md) and [docs/PREMIUM_UI_UX_TASKS.md](docs/PREMIUM_UI_UX_TASKS.md) for this authorized task pack. Task 01 is complete; do not restart it. Historical Linear/model-specific workflows are not execution prerequisites.
- Apply the installed `ponytail:ponytail` skill at full intensity and the task's UI/UX skills to implementation and review. Reuse existing/platform solutions and avoid speculative abstractions or dependencies.
- Record actual worker/session/model settings rather than claiming historical model assignments. Stop after dispatch; review the completion report before advancing. Return fixes to the same worker/worktree.
- Start Task 02 alone; up to two parallel workers require its reviewed pilot and local integration, with disjoint file/resource ownership.
- Reading this file is not an instruction to spawn agents. Dispatch only for the current authorized implementation task.
- Stay within the assigned task. No unrelated features, scaffolding, dependencies or refactors.

## Source of truth

For the premium task pack, the completed Task 01 specification and current owner instructions govern visual/motion decisions; the local task pack and coordination checkpoint govern execution. Repository contracts and migrations own the implemented technical baseline; GitHub records actual code and checks. Historical Notion/Linear plans remain context, not dispatch prerequisites. A model's report does not replace evidence.

Preserve the existing four-page design and the selected React Native/Expo/TypeScript/Expo Router/Supabase architecture unless the task authorizes a change. Verify SDK/package compatibility before installation.

## Before editing code

Confirm repository root, worktree, branch, base commit, task scope and current changes. Read the affected flow and its callers. Reuse existing patterns and prefer the smallest complete root-cause change.

Each active coding task has one branch/worktree and one writer. Do not overwrite user changes or modify another worker's directory. Dependency changes are allowed only when included in the assignment.

Worktrees do not isolate databases, cloud services, ports or hardware. Serialize shared schema/contract/lockfile changes unless separate ownership has been established. Never let two workers control the physical feeder concurrently.

## Contract and device rules

- App, backend, simulator and firmware must use the same versioned protocol and fixtures.
- Validate network input at runtime; TypeScript alone is insufficient.
- Check active device access for every protected operation. Never ship project secrets/service-role keys to phones or feeders.
- Each feeder has two nozzles sharing one continuously weighed container. Never dispense in parallel; when both are selected or due together, nozzle 1 precedes nozzle 2.
- Manual feeding offers Nozzle 1, Nozzle 2, or Both, with a separate amount per selected nozzle and explicit confirmation bound to that device and those doses. Schedules target one nozzle each; same-time cross-nozzle schedules run sequentially.
- Protocol v1 lacks nozzle targeting. Update the versioned contract before enabling these controls; never assume an ignored optional field provides safe nozzle selection.
- Persist and deduplicate command/occurrence identities; do not automatically repeat an uncertain or expired feed.
- Keep requested configuration separate from device-applied configuration.
- Unknown, stale or invalid readings are not zero or healthy readings.
- Requested/estimated feed amount is not measured dispensing.
- A database/API success is not physical feeding completion.
- Simulator success is not hardware calibration, accuracy or safety evidence.
- Do not operate GPIO, replace calibration or edit a remote feeder unless the current task authorizes it.
- Verify actual hardware/runtime before using historical tracker claims. Preserve per-device calibration and safety limits.

## Checks and reporting

Run checks appropriate to the changed behavior and the task's acceptance criteria. Non-trivial behavior needs a meaningful executable check. Avoid redundant full builds; documentation-only work needs a consistency review, not app tests.

Complete one user-visible flow with its needed backend, simulator, UI, error states and focused checks in one delivery. Keep review/corrections in that delivery instead of closing it and creating a separate integration/testing task. Reuse passing evidence for the unchanged commit; rerun only affected checks after changes. Preserve authorization, duplicate-feed prevention, sequential execution, recovery and measurement checks. Both iOS and Android are premium-task targets. Report native observations separately from browser evidence; missing physical-device acceptance remains unverified.

Report the result commit/diff, changed files, behavior, checks actually run, checks not run and remaining uncertainty. Never claim a check, deployment or physical result that was not observed.

Workers submit for review; they do not self-approve or mark Done. The orchestrator inspects the exact diff and independently verifies critical criteria before opening a task PR targeting `feat/premium-01-design`. After two unsuccessful correction cycles, reassess or escalate instead of repeating the same instructions.

Do not begin dependent tasks merely because a worker says finished. Confirm required predecessor integration and applicable gates. Done requires reviewed integration and task-specific evidence; deployment and hardware acceptance remain separate when out of scope.

## Secrets and integration

Keep tokens, pairing secrets and private credentials out of code, prompts, logs, Notion and Linear. Use sanitized fixtures and isolated development resources.

Do not infer merge, public release, destructive migration or hardware-actuation authority from this file. Use the user's existing authorization without repeatedly asking for the same permission.

Preserve unmerged work and evidence. Archive worktrees only after their worker has stopped and required changes are safely retained.
