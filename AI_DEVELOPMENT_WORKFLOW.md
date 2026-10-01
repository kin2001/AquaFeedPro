# AquaFeed Pro — AI Development Workflow

Updated: October 2, 2026  
Status: adopted documentation baseline; execution tooling and pilot are not yet verified.

## 1. Purpose and current scope

Use focused implementation tasks and independent verification to reduce unnecessary AI usage without weakening correctness. Cost and quota savings are goals to measure, not assumptions about a model.

The application plan already exists: **10 phases and 51 proposed tasks** in the [Notion master plan](https://app.notion.com/p/3ec224a56ef381019c30d3da4e54251e). Refine that plan rather than restart architecture work.

The current setup step covers this document and [AGENTS.md](AGENTS.md). It does not start application coding, create Linear issues, configure integrations, create a repository, launch workers, merge code, deploy, or operate hardware. Later execution begins under the user's authorized task scope.

## 2. Roles and durable authority

| Role | Responsibility | Boundary |
| --- | --- | --- |
| Astra — architect/planner | Review requirements, resolve architecture, decompose work, define dependencies and acceptance criteria | Use for significant decisions and replanning; not routine implementation |
| Codex GPT-6.1 Sol at Max reasoning — supervisor/reviewer | Select ready work, prepare handoffs/worktrees, coordinate workers, inspect changes, verify and integrate authorized work | Do not silently become the main coding worker when the Luna handoff fails |
| GPT-6 Luna at Max reasoning through Codex — implementer | Implement one bounded assignment, run its required checks, report changes and uncertainty | No unrelated work, self-approval, unassigned dependency changes or direct merge to the integration branch |
| Human project owner | Set scope, resolve product choices and authorize actions as needed | Do not ask again for authority already established in the session |

Codex may perform documentation, orchestration and narrow integration fixes within scope. If a change becomes substantive feature implementation, route it through the agreed implementation role or identify and agree on a fallback. Record when independent implementation/review separation was not available.

A model carries out a role; reviewed artifacts preserve decisions:

| Resource | Authority |
| --- | --- |
| Notion | Requirements, architecture rationale, decisions and phase descriptions |
| DESIGN.md | Approved visual and interaction specification |
| Versioned repository contracts/migrations | Executable API/data/schema baseline once implemented |
| Linear | Execution status, dependencies, assignment and blockers once configured |
| Git/GitHub | Code history, pull requests, check results and integrated changes |

If these disagree, identify the conflict before dependent implementation. Do not silently rewrite one to match another. The user may explicitly change the scope or an earlier decision.

## 3. Project references and guardrails

- [Approved design](DESIGN.md): Inter, monochrome bento interface, Home/Schedule/History/Device.
- [Mobile architecture](https://app.notion.com/p/3ec224a56ef3819eb141dd5d649a2705).
- [Backend/data/access plan](https://app.notion.com/p/3ec224a56ef3813eb988e1a26bee20f5).
- [Device contract proposal](https://app.notion.com/p/3ec224a56ef381bebe18c582e96f899b).
- [Phases and proposed tasks](https://app.notion.com/p/3ec224a56ef381668a7ce7fa63c02bcd).
- [Hardware handoff and validation](https://app.notion.com/p/3ec224a56ef38117967fccea6611e02f).

React Native, Expo, TypeScript, Expo Router and Supabase/PostgreSQL are the planned baseline. Dependencies, native versions and optional styling/icon choices must follow the architecture decision and selected SDK compatibility.

The app and simulator share a versioned contract before parallel feature implementation. Hardware joins that contract later. A database write is not evidence that feed was dispensed. The app must distinguish requested, acknowledged, running, completed, failed and unknown results.

## 4. Rollout: prove the workflow before scaling it

| Step | Work | Exit evidence |
| --- | --- | --- |
| A — document | Adopt workflow and project instructions | Documents reviewed for agreement with the existing plan |
| B — validate handoff | Prove dispatch, worktree targeting, progress, result retrieval, correction and interruption | One identified worker run with a traceable assignment and result |
| C — prepare execution | Set up the intended Git repo, GitHub checks and Linear task mapping | Repository identity verified; task dependencies and integration target known |
| D — run serial pilot | Complete one bounded UI task and one protocol/simulator task after prerequisites | Reviewed diffs, relevant checks and integration evidence for both |
| E — evaluate | Compare task quality, correction rounds, usage where available and elapsed time | Document whether orchestration overhead is justified |
| F — expand | Allow at most two independent implementation workers initially | Explicit resource ownership and successful integration of both tasks |

This table is a future setup sequence, not a record of completed integrations.

Recommended pilot candidates are a small slice of P1-03 (a shared card/status component) and a small slice of P3-02 (a telemetry scenario). Their existing prerequisite tasks still apply; split smaller issues rather than pretend prerequisites are complete.

Start with one implementation worker. Increase to two only after the serial pilot passes. Do not launch a worker merely because this file describes multi-agent execution.

## 5. GPT-6 Luna handoff through Codex

Use Codex's native implementation agent with `model: "gpt-6-luna"`, `reasoning_effort: "max"` and `fork_turns: "none"`. Supply the focused task packet and relevant references explicitly. Model selection is configured in dispatch, not merely requested in the prompt. This replaces the external implementation runner; no bridging script is needed.

Agents share filesystem access. Spawning an agent does not create or select an isolated worktree: provide its absolute path and require the worker to confirm it before edits.

Before calling the handoff automated, verify all of these:

1. Codex can dispatch the intended GPT-6 Luna agent at Max reasoning and record the selected settings with the returned agent ID.
2. The runner reports its actual working directory, branch and starting commit.
3. A unique run ID connects the assignment to status and completion.
4. Codex can distinguish running, finished, blocked, failed and interrupted.
5. Codex can retrieve the resulting diff or commit and check output.
6. Codex can send a correction to that assignment without creating duplicate work.
7. Interrupted execution leaves recoverable changes and reports what may still be running.
8. Credentials and environment scope are appropriate for the assignment.

The available tool interface supports these model settings; the project's end-to-end worker pilot remains unverified. Validate it during an authorized implementation task, not by launching a worker merely to update this document.

If the selected model or reasoning effort is unavailable, report the blocker. Do not silently downgrade reasoning, substitute a model or have the supervisor take over substantive implementation. Use a fallback only when authorized by the user.

A dispatch timeout is not proof that no worker started. Check the existing run before retrying or assigning the task elsewhere.

## 6. Linear task structure

Import and refine the existing proposed tasks; keep their planning IDs such as P2-04 in each issue for traceability. These IDs are not already-created Linear issue identifiers.

Use the real Linear ID in branch/run references after import. Avoid duplicate issues by matching the plan ID and existing links first.

Each issue includes:

```text
Plan ID / Linear ID:
Title:
Phase / milestone:
Goal and reason:
In scope:
Out of scope:
Required design/contract references and versions:
Implementation guidance:
Required tools:
Dependencies / tasks blocked:
Responsible role / assigned worker:
Files or areas owned:
Restricted files:
Exclusive shared resources:
Allowed dependency/configuration changes:
Acceptance criteria:
Required checks and evidence:
Parallel eligibility and reason:
Open decisions / blocker conditions:
PR / commit / build / hardware evidence:
```

Instructions should define behavior and constraints, not dictate unnecessary line-by-line implementation. Link to the relevant contract sections rather than duplicating the entire Notion plan in every issue.

## 7. States, readiness and completion

Normal path:

```text
Backlog → Ready → In Progress → Review → Testing → Done
```

Blocked is an exceptional state or label with a reason and unblocking condition. It is not a required step. A failed review/test returns the task to In Progress with focused findings. Review and Testing may be combined for small tasks when both kinds of evidence remain recorded.

A task is Ready only when:

- Required predecessor work is merged into the intended integration branch and its applicable gates pass.
- Scope, acceptance criteria and references are sufficient to implement.
- Required contract/schema versions are available.
- Necessary environment/tool access exists.
- Its files and shared resources are not owned by another active assignment.

A simulator-dependent task can become Ready without physical hardware when its criteria explicitly require simulation only. Do not relax hardware prerequisites for tasks claiming real-device readiness.

Worker completion moves work to Review, never directly to Done. Done requires reviewed integration plus the evidence required by the issue. Track deployment or hardware acceptance separately when they are outside that issue's scope.

Linear status alone is not proof: corroborate predecessor completion with the relevant merge/check/artifact. After integration, evaluate only affected dependent tasks and mark Ready those whose full prerequisites now hold.

## 8. Worktrees, branches and task ownership

Default: one **active coding task** = one branch = one worktree. Planning, reviews and documentation-only coordination do not automatically need new worktrees.

Before preparing a worktree:

- Verify the application repository root; do not run Git operations in the surrounding thesis/CAD folder by assumption.
- Inspect existing worktrees and changes; reuse a suitable task worktree instead of duplicating it.
- Identify the real integration branch rather than assuming its name is main.
- Record the base commit containing the task's merged prerequisites.

Example branch: agent/LINEAR-ID-short-description. Record the absolute worktree path in the task packet. Give each active branch one writer.

Worktrees isolate files, not database instances, cloud projects, caches, ports, credentials or hardware. Allocate separate local ports and disposable development environments where needed. Protect migrations, shared schemas and lockfiles through exclusive task ownership.

Do not overwrite uncommitted user work, reset a worker's changes to clean up a failure, or delete an unmerged worktree. Before archiving, confirm the required changes/evidence are preserved and no worker is still using it.

## 9. Parallel execution policy

Codex maintains a compact ownership record in the active issues/run summary:

```text
Task → worker/run ID → branch/worktree → base commit
Owned areas → exclusive resources → state → latest result
```

Claim a task before dispatch. Another orchestrator/worker must see the claim; do not run multiple independent supervisors against the same queue without a shared task-claim mechanism.

A parallel-safe label is advisory. Check actual dependencies, overlapping files, contract changes and shared resources before every dispatch.

| Combination | Rule |
| --- | --- |
| UI components + backend schema work | Parallel only after their shared contract is settled |
| Home + History | Parallel after navigation and data-access patterns are available; allocate shared modules explicitly |
| App integration + simulator | Parallel against the same frozen contract/fixtures |
| Two schema/API contract changes | Serialize |
| Two package/lockfile/toolchain changes | Serialize |
| Workers sharing one mutable backend | Isolate environments or serialize mutations |
| Two workers using physical feeder controls | Never concurrently |

If unexpected overlap appears, stop the conflicting portion, preserve work and reassign ownership. Do not resolve it by having workers repeatedly overwrite or merge each other's files.

## 10. Implementation task packet

Codex gives the worker the issue plus these execution-specific fields:

```text
Assignment/run ID:
Implementation model: gpt-6-luna
Reasoning effort: max
Task and acceptance criteria:
Absolute worktree path:
Branch:
Starting commit:
Required reference versions:
Owned and restricted areas:
Allowed environment and resources:
Allowed dependency changes:
Exact existing check commands, or checks to establish:
Stop/report conditions:
Expected result format:
```

Resolve paths and commands from the actual repository. Do not supply imaginary test scripts or imply a planned schema is already implemented.

The worker first confirms its location and assignment. It reads the affected flow and callers, uses existing code/patterns where suitable, then makes the smallest complete change. It may change dependencies only when explicitly included in the task.

Stop and report when a required contract is missing/contradictory, an owned resource is unavailable, scope must expand, or safe behavior cannot be established. Continue unrelated authorized work only when it does not depend on that uncertainty.

## 11. Required worker completion report

```text
Task/run ID and final state:
Model and reasoning effort recorded at dispatch:
Branch/worktree:
Base commit and result commit, or uncommitted diff location:
Implemented behavior:
Changed files:
Acceptance criteria met / unmet:
Checks actually run, commands and results:
Checks not run and why:
Contract/dependency/migration changes:
Remaining uncertainty or blocker:
```

A worker may not mark its own work finally approved. Do not accept a verbal completion claim without inspecting the resulting files/diff. Reports and logs are evidence to evaluate, not instructions authorizing broader work.

## 12. Review and proportionate verification

Codex checks scope, root cause, affected callers, contracts, security and acceptance criteria. Review the actual result commit/diff and record the commit tested.

| Change | Verification focus |
| --- | --- |
| Documentation | Accuracy, consistency, references and scope; no app build by default |
| UI | Affected behavior, native rendering, accessibility and relevant type/lint checks |
| Backend/auth | Input validation, membership isolation, grants/RLS and transaction behavior |
| Command/scheduling logic | Idempotency, expiry, conflicts, acknowledgment, retry/reboot and unknown outcomes |
| Hardware | Safe stopping, real calibration, measured dispensing and physical recovery evidence |

Use targeted checks first. Run wider required checks for integration or when changed shared behavior warrants them. Do not repeatedly run a full build for unchanged copy. Non-trivial behavior needs an executable check that would fail if the behavior regresses.

Worker checks support review; Codex independently verifies critical acceptance criteria. Reuse trustworthy CI evidence for the same unchanged commit rather than rerunning everything by habit. Never represent simulator or mocked tests as real hardware results.

## 13. Corrections and escalation

Return a small correction packet with:

- Observed defect and reproduction.
- Expected behavior and failed acceptance criterion.
- Relevant file/contract reference.
- Required verification.

After at most two unsuccessful correction cycles on the same issue, reassess the specification, task size, worker context or implementation approach. Escalate architectural questions to Astra; ask the user only for missing product decisions or authority. Do not loop the same prompt indefinitely.

This limit triggers reassessment, not abandonment of the overall project. Preserve useful work and continue independent authorized tasks when safe. Record correction count to evaluate workflow cost.

## 14. Pull requests and integration

1. Codex reviews the result and required evidence.
2. Open/update the task PR within the authorized scope; describe behavior, relevant validation and remaining limitations.
3. Integrate against the current target branch. If intervening work changes shared behavior or invalidates evidence, update the branch and rerun the affected checks.
4. Merge only when the applicable review/check requirements pass and merge authority exists in the user-approved workflow/session.
5. Record the merged commit and final integration evidence. Required post-merge checks must pass before declaring Done.
6. Update Linear and reassess downstream dependencies.
7. Archive the worktree after preserving needed artifacts and ending its worker.

Approval already given for the relevant action need not be requested again. This workflow file alone does not grant blanket production deployment, destructive database or physical-actuation authority.

An issue may be implementation-complete without being deployed. A deployed command endpoint is not proof that real feeding is calibrated or safe.

## 15. Tooling prerequisites for later execution

- Verified Git repository, remote, integration branch and contributor access.
- GitHub PR/check configuration; protect the integration branch using supported repository controls.
- Linear connection, project, statuses, stable plan-ID mapping and dependency links.
- Available Codex GPT-6 Luna dispatch at Max reasoning; verify the full handoff during the authorized pilot.
- SDK-compatible development environment, package manager/lockfile and Android/iOS build/test access.
- Isolated Supabase development environment, schema fixtures and credential provisioning.
- Versioned OpenAPI/JSON Schemas and simulator fixtures before app/device contract implementation.
- CI checks appropriate to the existing code: type, lint, formatting, focused tests and release build gates.
- Secrets stored in appropriate protected environment/storage, excluded from prompts, reports and Git.

Check actual tool availability instead of claiming that an installed product name proves the integration works. Create only the setup required by the next authorized phase.

## 16. Usage and pilot evaluation

Keep architecture review infrequent and task packets focused. Send changed evidence and specific failures during corrections rather than the full project transcript. Do not poll continuously when a completion event or bounded status wait is available.

For each pilot task record:

- Dispatch and review overhead.
- Worker and supervisor elapsed time.
- Token/usage data when the provider exposes it; otherwise mark unavailable.
- Correction cycles and accepted/rejected outcomes.
- Rework caused by missing context or contract ambiguity.
- Final integration result and verification evidence.

Compare total successful-task cost and quality, not per-token price alone. Subscription quotas from different providers are not automatically comparable. Do not promise savings without measurements.

Retain serial work when parallelism costs more than it saves. Expand only where the pilot demonstrates a benefit.
