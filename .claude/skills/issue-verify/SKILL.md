---
name: issue-verify
description: Verify the pull request for one AquaFeed Pro Linear issue (ART-n) without changing any code. Checks that the PR does what the issue says and nothing else, that protected logic is untouched, that the issue's checks really pass, and, for a Mono Ink design issue, that every element matches the reference file. Posts a verdict with numbered findings to the PR and the Linear issue. Never fixes, approves, merges or sets Done. Run as /issue-verify ART-60.
argument-hint: ART-<number>
---

# /issue-verify — check one issue's pull request

Arguments: `$ARGUMENTS`

The first argument must look like `ART-<number>`. If it is missing or malformed, ask for
it and stop.

You are the reviewer, not the implementer. Run this in a different session from the one
that wrote the code. Rules for the whole run:

- **Read-only on code.** Do not edit, commit, push, rebase, approve, merge or close
  anything. If you find a problem, report it; do not fix it.
- **Trust nothing you did not observe.** The PR description, commit messages and Linear
  comments are claims. Re-run the checks and read the code yourself.
- **"I could not find it" is a failure, not a pass.** Every pass needs evidence: a
  command result or a `file:line`.
- Running this skill authorizes: installing dependencies from the lockfile, checking out
  the PR head in this worktree, posting one comment on the PR and one on the Linear
  issue. Nothing else.

## 1. Gather

1. Load the Linear tools with ToolSearch (names end in `__get_issue`, `__list_comments`,
   `__save_comment`). If none is available, say so and stop.
2. Get the issue with relations, its comments, and its parent issue. The issue text is
   the specification you verify against.
3. Find the pull request: `gh pr list --search "ART-<number>" --state all --json number,title,state,headRefName,baseRefName,url`.
   No PR: report "nothing to verify" and stop. More than one open PR: list them and ask
   which.
4. Read `gh pr view <n> --json title,body,state,baseRefName,headRefName,mergeable,files,statusCheckRollup`.
   Note the base (must be `main`), whether it is mergeable, and the CI result.

## 2. Check out the PR head

1. `git status` must be clean. If it is not, stop and say so; do not stash.
2. `git fetch origin main` then `gh pr checkout <n> --detach`.
3. If `mobile/node_modules` is missing, run `npm ci` in `mobile/`.
4. The diff you review is `git diff origin/main...HEAD`.

## 3. Scope: did it change only what it may?

1. List changed files: `git diff --name-status origin/main...HEAD`.
2. Compare with the issue's "Files you may change" (or "File you may change"). Every
   changed file outside that list is a blocker unless the PR body explains it and the
   reason is sound.
3. For any Mono Ink issue except the launcher-icon one, this must print nothing:
   `git diff --stat origin/main...HEAD -- mobile/src/lib supabase contracts mobile/app.json mobile/eas.json`
4. No dependency was added or removed in `mobile/package.json` unless the issue lists it.

## 4. Protected logic: is behaviour untouched?

Take every name in the issue's "What must not change" section.

1. Read `git diff origin/main...HEAD -- <file>` hunk by hunk.
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

## 8. Code quality

Invoke the `ponytail:ponytail-review` skill on the PR diff. Carry over only findings
that are real problems: a bug, code the issue did not ask for, an abstraction or option
nobody needs, a missing check for new non-trivial logic. Do not carry over style
preferences.

## 9. Verdict

Number every finding and give each a level:

- **B (blocker)** — breaks the issue's spec, an invariant, scope, a check, or the
  reference in a way a user would see or that changes behaviour.
- **S (should fix)** — a real mismatch that is small (a spacing value off, a wrong
  token of the same colour, a missing hint).
- **N (note)** — worth knowing, no change required.

Each finding is one line in this form, so it can be acted on without reading anything
else:

`B1 · mobile/src/app/(tabs)/index.tsx:212 · Feed tile shows "Unknown" at reading size · issue ART-60 section 4 says an unknown reading shows "—" · change the value prop to "—"`

Overall verdict:

- **PASS** — no B and no S findings, every runnable check passes, every "Done when"
  item is met or is a device-only item.
- **CHANGES NEEDED** — at least one B or S finding.
- **CANNOT VERIFY** — no PR, a dirty worktree, or the checks cannot be run. Say what is
  missing.

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
  line, a check command, or the reference file and the element in it.
- "Fix" says what to change, concretely enough to do without re-deriving it. Give the
  value, prop, token or line to restore. Never write "match the design" or "fix
  spacing".
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

1. Write the report in this order: verdict; "Required changes" (when there are any);
   "Notes (no change required)"; the tables from sections 3 to 7; "Not verified here"
   (the device-only items).
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
   - Never set Done.
4. Return the worktree to where it was: `git switch -`.
5. Tell the owner the verdict in the first line, then the "Required changes" list (or
   the count of items if it is long) with the PR comment link, and what only they can
   do (device check, merge).
