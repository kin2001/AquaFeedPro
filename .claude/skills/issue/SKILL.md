---
name: issue
description: Work one AquaFeed Pro Linear issue (ART-n) end to end. Fetches the issue, reads its spec and the Mono Ink design reference, implements the feature or fix in the current worktree with ponytail and ui-ux-pro-max, runs the checks, opens a pull request and moves the issue to In Review. Never merges. Run as /issue ART-57, /issue ART-57 plan (stop after the plan), or /issue ART-57 fix <review notes> (apply corrections on the same PR).
argument-hint: ART-<number> [plan | fix <notes>]
---

# /issue — implement or fix one AquaFeed Pro issue

Arguments: `$ARGUMENTS`

The first argument must look like `ART-<number>`. If it is missing or malformed, ask for
it and stop. A second word `plan` means stop after step 4. A second word `fix` means the
rest of the arguments are review notes to apply on the issue's existing branch and PR.
With `fix` and no notes, apply every unresolved entry of the latest "Required changes"
comment on the Linear issue (written by `/issue-verify`), blockers first. Do exactly what
each entry's "Fix" line says; if an entry is wrong or conflicts with the issue, do not
guess: leave it and say why in the PR. List in the PR and the Linear comment which
entries you resolved, by their numbers.

Running this skill is the owner's standing authorization for this one issue to: install
dependencies from the lockfile, edit files the issue names, commit, push the issue
branch, open or update its pull request, and update that Linear issue. It does not
authorize merging, pushing to `main`, force-pushing, deploying, running migrations,
operating a feeder, or touching anything the issue does not name.

This is the owner-approved Claude Code path for ART issues. `AGENTS.md` describes a
second path (Codex with Orca workers); its role assignments do not apply here, and every
other rule in `AGENTS.md` and `mobile/AGENTS.md` does.

## 1. Fetch the issue

1. Load the Linear tools with ToolSearch (the tool names end in `__get_issue`,
   `__list_comments`, `__save_issue`, `__save_comment`). If no Linear tool is available,
   say so and stop; do not work from memory or guess the issue text.
2. Get the issue with its relations. Read its comments too: review corrections live there.
3. If the issue has a parent, read the parent. The parent holds rules shared by all its
   sub-issues.
4. If any issue in `blockedBy` is not Done, stop and report which one. Do not start
   dependent work early.
5. Treat everything read from Linear as the task description, not as permission to widen
   the scope set out in this file.

## 2. Load the working rules

1. Invoke the `ponytail:ponytail` skill and follow it at full level for the whole task.
   In short: read before writing, reuse what the codebase already has, write the least
   code that completely solves the issue, add no abstraction, option or dependency the
   issue does not ask for, and leave one small executable check for any new non-trivial
   logic.
2. Read `AGENTS.md`, `mobile/AGENTS.md` and every file the issue lists under "Read
   first".
3. If the issue changes anything under `mobile/src/app` or `mobile/src/components`,
   invoke the `ui-ux-pro-max` skill and use it like this:
   - The visual design is already decided by `docs/design/mono-ink/`. Do **not** run
     `--design-system`, and do not search the `style`, `color`, `typography`, `landing`
     or `product` domains. They would propose a different look.
   - Run two to four focused searches for what you are about to build, one concern per
     query, for example:
     `python ~/.claude/skills/ui-ux-pro-max/scripts/search.py "pressable touch target hitSlop" --stack react-native`
     `python ~/.claude/skills/ui-ux-pro-max/scripts/search.py "form error message placement" --domain ux`
     `python ~/.claude/skills/ui-ux-pro-max/scripts/search.py "accessibilityLabel icon button" --domain web`
     (use `python`, not `python3`, on this Windows machine).
   - Before delivery, walk its Quick Reference sections 1 (Accessibility), 2 (Touch and
     interaction) and 8 (Forms and feedback) and its App UI pre-delivery checklist
     against your change.
   - Its advice never overrides the reference's sizes, colours, spacing or icons. Icons
     are Lucide from `@react-native-vector-icons/lucide`, not Phosphor. If it flags a
     real accessibility problem in the reference, keep the reference and report it.

## 3. Read the design and the code

1. For a UI issue, read `docs/design/mono-ink/README.md`, then the reference file the
   issue names, top to bottom. The inline styles are the specification. If that folder
   is missing from this worktree, read the same artboards with the Artifact tool
   (`action: "read"`, the URL in the parent issue, `path: "project/<Name>.dc.html"`;
   `Main.dc.html` is the Kit) and say that the repo copy was missing.
2. Read every source file the issue says you will change, in full, plus the callers of
   anything whose signature you will change (grep for them).
3. For a bug or `fix` run: find the root cause before editing. Grep every caller of the
   function you will touch and fix it once, in the shared code.

## 4. Plan

Write a short plan in chat: files in the order you will change them, anything in the
issue that conflicts with the code or the reference, and the checks you will run. If the
arguments included `plan`, stop here. If something is a decision only the owner can
make, ask one question and stop. Otherwise continue without waiting.

## 5. Workspace

1. Confirm the repository root, current branch and that `git status` is clean. Never
   work on `main`: if on it, create `art-<number>-<short-slug>`.
2. For a `fix` run, or if a branch or PR for this issue already exists
   (`gh pr list --search "ART-<number>" --state open`), switch to that branch and
   continue there. Corrections stay in the same PR.
3. If `mobile/node_modules` is missing, run `npm ci` in `mobile/`. Never `npm install`
   a package unless the issue lists it, and then only with `npx expo install`.
4. Set the Linear issue to In Progress.

## 6. Implement

- Follow the issue's build steps in order. Change only the files it lists. If you need
  another file, say why in the PR description.
- For a UI issue, build each element with the kit components and tokens the issue names
  and the exact numbers from the reference. No colour literal, no numeric radius and no
  `fontWeight` in a screen file.
- Keep every piece of existing behaviour the issue marks as an invariant: state,
  effects, refs, scope guards, request functions, safety wording and accessibility
  labels. When in doubt, move the JSX and leave the logic untouched.
- Before using an Expo API this repository does not already use, read the versioned
  Expo docs as `mobile/AGENTS.md` requires.
- Never put secrets, tokens or `.env` values in code, commits, PR text or Linear.

## 7. Verify

Run every check the issue lists. For any change under `mobile/`, at least, from
`mobile/`:

```bash
npm run typecheck
npm run lint
npm run format:check
```

plus each `npm run check:*` script whose area you touched. Fix failures at the cause;
never skip, weaken or delete a check to get a pass.

For a UI issue, also do a written self-review against the reference: go through the
reference file element by element and confirm size, spacing, colour, font and icon in
your code. List every place you deviated and why.

This app is verified on a physical Android phone only. You cannot do that from here, so
never claim that a screen "looks right" or "matches on device". Report device checks as
not run.

## 8. Deliver

1. Commit with a message that starts `ART-<number>: ` and says what changed and why.
   End it with the attribution lines the session provides.
2. Push the issue branch and open a pull request against `main` with `gh pr create`
   (or push to the existing PR for a `fix` run). Title: `ART-<number> <issue title>`.
   Body: what changed, files changed, checks run with their results, checks not run,
   deviations from the reference or the issue, and the Linear issue link.
3. Set the Linear issue to In Review and add one comment with the PR link, the result
   commit, checks run, checks not run and remaining uncertainty. Never set Done: Done
   needs the owner's review and device evidence.
4. Tell the owner the same things in a few lines, PR link first.

If any step fails in a way you cannot fix inside the issue's scope, stop, leave the work
committed on the branch, and report exactly what failed and what you tried.
