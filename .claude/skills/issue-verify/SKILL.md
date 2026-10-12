---
name: issue-verify
description: Verify the pull request for one or more AquaFeed Pro Linear issues (ART-n) the way a senior QA reviewer would, without changing any code. Checks that the PR does what the issue says and nothing else, that protected logic is untouched, that the issue's checks really pass, that nothing around the change broke, and, for a Mono Ink design issue, that every element matches the reference file. Posts a verdict and a Required changes list to the PR and the Linear issue. Never fixes code. Works from a dirty checkout and on an already merged PR. Run as /issue-verify ART-60 to review only, /issue-verify ART-60 ART-61 for several, or /issue-verify ART-60 merge to also merge the PR and set the issue Done when the verdict is PASS.
argument-hint: ART-<number> [ART-<number> ...] [merge]
---

# /issue-verify — check an issue's pull request

Arguments: `$ARGUMENTS`

Every argument except the optional word `merge` must look like `ART-<number>` (commas
between them are fine). If none is given or one is malformed, ask and stop. The word
`merge` turns on section 11: merge the PR, but only when the verdict is PASS. Without
that word this skill never merges.

With several issues, do the whole run (sections 1 to 11) for one issue before starting
the next, in the order given. Each issue gets its own report, PR comment and Linear
comment. A verdict other than PASS on one issue does not stop the others. Finish with
one table: issue, PR, verdict, number of required changes, merged or not.

You are the senior QA reviewer, not the implementer. Your job is to decide whether this
PR can ship, and when it cannot, to hand back a list of required changes that someone
can act on without asking you anything. Run this in a different session from the one
that wrote the code. Rules for the whole run:

- **Read-only on code.** Do not edit, commit, push, rebase, approve or close anything.
  If you find a problem, report it; do not fix it. Merging happens only under section
  11.
- **Trust nothing you did not observe.** The PR description, commit messages and Linear
  comments are claims. Re-run the checks and read the code yourself.
- **"I could not find it" is a failure, not a pass.** Every pass needs evidence: a
  command result or a `file:line`.
- **Review the whole PR, not only the checklist.** The issue's lists say what to check
  first. A PR that ticks every line and breaks a caller still fails.
- Running this skill authorizes: installing dependencies from the lockfile, checking out
  the PR head in this checkout when it is clean, creating and removing one throwaway
  git worktree when it is not, posting one comment on the PR and one on the Linear
  issue. This file grants nothing beyond that. A merge under section 11 happens only
  because the owner typed `merge` for that run, and only if the session's own permission
  settings allow it.

## 1. Gather

1. Load the Linear tools with ToolSearch (names end in `__get_issue`, `__list_comments`,
   `__save_comment`). If none is available, say so and stop.
2. Get the issue with relations, its comments, and its parent issue. The issue text is
   the specification you verify against.
3. Find the pull request: `gh pr list --search "ART-<number>" --state all --json number,title,state,headRefName,baseRefName,url`.
   The search also returns PRs that only mention the issue; take the one whose title
   starts with this issue's id. No such PR, or only a closed unmerged one: report
   "nothing to verify" and stop. More than one open PR: list them and ask which.
4. Read `gh pr view <n> --json title,body,state,baseRefName,headRefName,headRefOid,mergeCommit,mergeable,commits,files,statusCheckRollup`.
   Note the base (must be `main`), whether it is mergeable, and the CI result.
5. If the PR state is `MERGED`, this run is a **post-merge audit**: do every review
   section the same way, publish as section 10 says for a merged PR, and skip section 11.

## 2. Get the PR's code

Never stash, commit or discard anything that is already in the checkout.

1. `git fetch origin main` and `git fetch origin pull/<n>/head`. This works for a merged
   PR whose branch was deleted.
2. Run `git status --porcelain`.
   - **Prints nothing:** `git switch --detach <headRefOid>` here. If `mobile/node_modules`
     is missing, run `npm ci` in `mobile/`.
   - **Prints anything:** leave this checkout exactly as it is. Create a throwaway
     worktree at a short path outside the repository (for example `D:\vf\art-<number>`;
     `node_modules` under a deep path can pass the Windows path limit):
     `git worktree add --detach <path> <headRefOid>`, then `npm ci` in its `mobile/`. If
     the path is left over from an interrupted run, `git worktree remove --force <path>`
     first. Run every later command from that worktree. Say in the report that the
     review ran in a separate worktree because the checkout had uncommitted work.
3. Set `<base>`: `origin/main` for an open PR; `<mergeCommit>^1` for a merged PR. The
   diff you review is `git diff <base>...HEAD`. Where an issue's own command names
   `main`, use `<base>` instead.

## 3. Scope: did it change only what it may?

1. List changed files: `git diff --name-status <base>...HEAD`.
2. Compare with the issue's "Files you may change" (or "File you may change"). Every
   changed file outside that list is a blocker unless the PR body explains it and the
   reason is sound.
3. For any Mono Ink issue except the launcher-icon one, this must print nothing:
   `git diff --stat <base>...HEAD -- mobile/src/lib supabase contracts mobile/app.json mobile/eas.json`
4. No dependency was added or removed in `mobile/package.json` unless the issue lists it.
5. Every commit in the PR belongs to this issue. A commit that carries another issue's
   work is a blocker.

## 4. Protected logic: is behaviour untouched?

Take every name in the issue's "What must not change" section.

1. Read `git diff <base>...HEAD -- <file>` hunk by hunk.
2. Classify each hunk as one of: imports, JSX, `StyleSheet`, an edit the issue lists
   under "Small edits" or "Small additions", or protected logic.
3. Any hunk that changes the body of a protected hook, effect, ref, handler or helper is
   a blocker. Quote the hunk.
4. Also confirm that each handler is still wired to a control: for every protected
   handler the issue mentions (for example `confirmFeed`, `updateSchedule`,
   `applyFilters`), find where the new JSX calls it. A handler that is no longer
   reachable is a blocker even though its body is unchanged.
5. Confirm safety wording the issue quotes "word for word" is still present verbatim
   (grep for a distinctive phrase from each sentence).

## 5. Run the issue's checks yourself

Run every command in the issue's "Checks to run", from the directory it names, and every
grep gate it lists. Record for each: the command, pass or fail, and for a failure the
relevant output lines. A grep gate passes only if its output is exactly what the issue
says it should be.

Then compare with the PR body: a check the PR claims passed but which fails for you is a
blocker. A claim that a screen was verified on a device or "looks right" is a blocker by
itself: nobody can check that from a coding session.

## 6. Acceptance: go through the issue line by line

For every item under "Done when" and every item under "Invariants", give one of:
**met** (with evidence), **not met** (with evidence), or **cannot verify here** (device
appearance, TalkBack, keyboard, camera, large text). Do not skip an item and do not
merge two items into one.

## 7. Design conformance (only when the issue names a reference file)

Skip this section if the issue has no `docs/design/mono-ink/...` reference.

1. Read `docs/design/mono-ink/README.md`, then the reference file, then the changed
   screen file. If the issue says "no artboard", verify against the issue's own spec and
   the Kit sections it names instead of a screen file.
2. **Forward pass.** Walk the reference top to bottom. For each element write one row:

   | Element | Reference says | Code has (`file:line`) | Result |
   | --- | --- | --- | --- |

   Compare, where the element has them: position in the order; width, height and
   minimum height; padding; margin and gap; radius; border width and colour; background;
   text size, line height, weight (as `fontFamily`), letter spacing and colour; icon
   name and size; and which kit component renders it. Translate CSS with the README's
   table. A colour passes only if the code uses the token the README maps that hex to.
   An element built by a kit component passes on that component's props; you do not
   re-verify the kit's internals in a screen issue.
3. **Reverse pass.** List everything the screen renders that is neither in the reference
   nor in the issue: leftover descriptions, old cards, extra buttons. Each is a finding.
4. **System rules.** At most one filled (`primary` or `inverse`) button visible at a
   time. Every status is an icon plus words. No colour literal, numeric `borderRadius`
   or `fontWeight` in the screen file. No hand-built chip, row, switch or banner.
5. **Allowed differences.** Anything listed under the issue's "Intentional differences
   from the artboard" is not a finding. Sample text in the reference (names, numbers,
   times) is illustrative and is never a finding.
6. **Accessibility.** Invoke the `ui-ux-pro-max` skill and walk its Quick Reference
   sections 1 (Accessibility), 2 (Touch and interaction) and 8 (Forms and feedback)
   against the changed screen. Do not run `--design-system` or search its style, colour
   or typography domains. Report only concrete failures: a missing label on an icon
   button, a touch target under 48, a field without a visible label, a status carried by
   shade alone.
7. State plainly that this is a comparison of code against the reference's numbers, not
   a look at the running screen.

## 8. Whole-PR review

Sections 3 to 7 check the PR against the issue's lists. This section checks what no list
names. Read every changed file in full at the PR head, not only its hunks.

1. **What else uses it.** For every exported component, prop, default value, token,
   style or helper the diff changes or removes, grep its uses across the repository and
   read each one. A caller that still compiles but now behaves or renders differently in
   a way the issue did not ask for is a finding. The issue's own "expected until later
   issues land" statements are not findings.
2. **Every state still exists.** For each screen or component the PR touches, compare
   base and head for the loading, empty, error, offline or stale, disabled, busy and
   long-text states. A state that disappeared, became unreachable, or lost its message
   is a blocker.
3. **Project safety rules** (AGENTS.md, "Contract and device rules"), wherever the diff
   touches them: an unknown, stale or invalid reading is never shown as zero or healthy;
   a requested amount is never presented as measured; a database or API success is never
   presented as a completed feed; nozzle 1 stays before nozzle 2 and nothing dispenses
   in parallel; a feed is never repeated automatically; device access is still checked.
4. **Leftovers.** Code the PR made dead (unused imports, styles, exports, helpers),
   debug logging, commented-out code, TODOs without an issue id, secrets or tokens.
5. **Checks for new logic.** New non-trivial logic has an executable check. Read the
   check: it must be able to fail if the logic were wrong.
6. **Claims.** Every statement in the PR body about what changed matches the diff. A
   listed deviation is acceptable only if its reason is sound; otherwise it is a finding.
7. **Simplicity.** Invoke the `ponytail:ponytail-review` skill on the PR diff. Carry
   over only findings that are real problems: a bug, code the issue did not ask for, an
   abstraction or option nobody needs. Do not carry over style preferences.

A problem that already existed at `<base>` and that the PR did not make worse is an N
finding at most, never B or S.

## 9. Verdict

Number every finding and give each a level:

- **B (blocker)** — breaks the issue's spec, an invariant, scope, a check, a caller, a
  project safety rule, or the reference in a way a user would see or that changes
  behaviour.
- **S (should fix)** — a real mismatch that is small (a spacing value off, a wrong
  token of the same colour, a missing hint, dead code the PR left behind).
- **N (note)** — worth knowing, no change required.

Each finding is one line in this form, so it can be acted on without reading anything
else:

`B1 · mobile/src/app/(tabs)/index.tsx:212 · Feed tile shows "Unknown" at reading size · issue ART-60 section 4 says an unknown reading shows "—" · change the value prop to "—"`

Overall verdict:

- **PASS** — no B and no S findings, every runnable check passes, every "Done when"
  item is met or is a device-only item.
- **CHANGES NEEDED** — at least one B or S finding.
- **CANNOT VERIFY** — no PR, or the checks cannot be run. Say what is missing. A dirty
  checkout is not a reason: section 2 handles it.

Under the verdict write an **Overall assessment** of two to four sentences in plain
words: whether you would ship this PR, the biggest risk in it, and what you could not
judge from code alone.

### Required changes

When the verdict is CHANGES NEEDED, turn every B and S finding into one entry of a
"Required changes" checklist. This list is what the implementer works from, so each
entry must be complete without the rest of the report:

```markdown
## Required changes

- [ ] **B1 · Feed tile shows "Unknown" at reading size**
  - Where: `mobile/src/app/(tabs)/index.tsx:212`
  - Problem: when the feed reading is invalid the tile prints "Unknown" in the 32px reading style.
  - Required by: ART-60, section 4 "Feed and Next tiles" ("An unknown reading shows `—`").
  - Fix: pass `value={feedValid ? String(sample.feed_percent) : "—"}` and drop the unit when invalid.
```

Rules for the list:

- Blockers first, then should-fix items, in the order they appear on the screen or in
  the file.
- "Required by" names the exact place: the issue section, an invariant, a "Done when"
  line, a check command, the reference file and the element in it, or for a section 8
  finding the caller or rule that broke (`file:line`, or the AGENTS.md rule).
- "Fix" says what to change, concretely enough to do without re-deriving it. Give the
  value, prop, token or line to restore. Never write "match the design" or "fix
  spacing". If the fix needs a file outside the issue's "Files you may change", say so
  in the entry.
- One problem per entry. Do not bundle.
- N findings do not go in this list. Put them under a separate heading "Notes (no change
  required)".

### Re-verifying after a fix

If the Linear issue already has a "Required changes" comment from an earlier run, start
by checking each of its entries against the new code and mark it **resolved** or **still
open** with evidence. Then do the full pass again from section 3: a fix can break
something that passed before. Entries still open keep their original numbers; new
findings continue the numbering.

## 10. Publish and clean up

1. Write the report in this order: verdict and overall assessment; "Required changes"
   (when there are any); "Notes (no change required)"; the tables from sections 3 to 7;
   "Not verified here" (the device-only items).
2. Post it on the PR with `gh pr comment <n> --body-file <file in the scratchpad>`. Use a
   comment, not an approval or a change request.
3. Update the Linear issue:
   - **CHANGES NEEDED:** post one comment containing the verdict and the full "Required
     changes" checklist, ending with "Run `/issue ART-<number> fix` to apply these."
     Then set the issue's status to In Progress, so the board shows it is not waiting on
     review any more.
   - **PASS:** post one comment saying it is verified against the issue (and the
     reference, when there is one), listing the device-only items that still need the
     owner. Leave the status at In Review.
   - **CANNOT VERIFY:** post one comment saying what is missing. Leave the status.
   - **Merged PR (post-merge audit):** post the same comment, headed "Post-merge audit".
     Never change the status. For CHANGES NEEDED, end with "This PR is already merged;
     these need a follow-up issue." instead of the `/issue ... fix` line, and do not
     create that issue yourself.
   - Do not set Done here. Only section 11 may.
4. Put things back: `git switch -` if you switched this checkout;
   `git worktree remove --force <path>` if you created a worktree. Confirm with
   `git status` that the owner's uncommitted work is exactly as it was.
5. Tell the owner the verdict in the first line, then the "Required changes" list (or
   the count of items if it is long) with the PR comment link, and what only they can
   do (device check, and the merge unless section 11 did it).

## 11. Merge (only when run with `merge`)

Skip this section entirely unless the arguments included the word `merge`. Skip it for a
PR that is already merged.

Merge only if **all** of these hold. Check each one now, not from memory:

1. The verdict is PASS: no B and no S finding, and no entry of an earlier "Required
   changes" comment is still open.
2. `gh pr view <n> --json state,baseRefName,mergeable,statusCheckRollup` shows the PR
   open, base `main`, mergeable, and every CI check completed successfully. A pending,
   failed or missing check means do not merge.
3. The PR head is still the commit you verified (`gh pr view <n> --json headRefOid`
   equals the commit you checked out in section 2). If someone pushed since, verify
   again instead.
4. Every issue in this issue's `blockedBy` is Done.

If any condition fails, do not merge. Say which one, post it in the Linear comment, and
stop.

If all hold:

1. Merge with `gh pr merge <n> --merge`. Use a normal merge commit, as the repository's
   history does. Never use `--admin`, never force, never bypass a branch rule. If the
   command is refused for any reason (a permission prompt that is declined, a branch
   protection rule), report the refusal exactly and stop. Do not try another way.
2. Confirm it merged: `gh pr view <n> --json state,mergeCommit`.
3. Set the Linear issue to Done and add one comment: the merge commit, "merged after
   automated verification", the checks that ran, and the device-only items that were
   **not** checked (appearance on a physical Android phone, TalkBack, large text,
   keyboard, camera). Done here means reviewed and merged; it never means checked on a
   device.
4. Tell the owner it is merged, and list the device-only items still open for that
   issue.

A merge on PASS is only as good as a comparison of code against the specification. For
the screen issues the owner's look at the phone is still the real visual check; this
option does not replace it.
