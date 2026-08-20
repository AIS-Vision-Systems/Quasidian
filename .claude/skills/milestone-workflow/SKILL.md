---
name: milestone-workflow
description: The end-to-end procedure for implementing one Quasidian milestone from docs/SPEC*.md — branch, implement, test, review, commit, PR, merge, clean up. Use whenever asked to "implement milestone N", "start the next milestone", or to work on anything the specs define as a milestone.
---

# Implementing a milestone

One milestone per PR, in spec order. Never start milestone N+1 features while implementing N.

## 1. Understand the milestone

Ask the `spec-navigator` agent for the milestone. Do **not** read the six spec files yourself — they are long and in Catalan. You want: goal, requirements with exact file and key names, required tests, acceptance criteria, and constraints carried over from earlier phases.

If you don't know where the affected code lives, ask `code-locator` rather than exploring by hand.

Milestone 41 is the exception to one-PR-per-milestone: the spec splits it into PR A (decoupling) and PR B (packaging).

## 2. Branch

```sh
git switch -c feat/m<NN>-<short-slug>   # fix/… for bug-fix milestones
```

`main` accepts no direct pushes, not even from the maintainer. Never commit on `main`.

## 3. Implement

Order the work so the pure layer comes first — it is the part with tests:

1. Pure logic into `src/lib/` (no Tauri, no DOM) with its sibling `.test.ts`.
2. Parser or decoration changes in `src/markdown/` / `src/editor/` — see `/markdown-editor`; these always ship dual-mode tests.
3. A Rust command in `src-tauri/src/lib.rs` only if the frontend genuinely cannot do it (binary files, OS integration), plus its permission in `src-tauri/capabilities/default.json` and a wrapper in `src/ipc/`.
4. UI wiring in `src/ui/`.
5. Every user-facing string through `t(key)` in all three locales — see `/i18n-text`. New settings — see `/settings-option`.
6. User-visible behavior changes update the bundled guide and the READMEs — see `/docs-sync`.

Reuse what exists before writing anything new: the fuzzy modal, the context-menu component, `renameLinks`, `folderTree`, the reading-mode render pipeline. Adding a second way to do something already done is a review finding.

## 4. Verify

```sh
npm run typecheck   # must pass before any commit
npm test            # must pass before pushing
```

Then run the `invariant-reviewer` agent on the diff and fix what it reports.

Anything touching Rust, paths, the watcher, printing or the CSP must be tried on **Windows and Ubuntu** — if you can only test one, say so explicitly in the PR instead of implying both.

For behavior you cannot unit-test (rendering, resize, menus), run `npm run tauri dev` and check it by hand; state in the PR what you exercised.

## 5. Ship

Commit and open the PR following `/commit-pr`. Then:

```sh
gh pr checks --watch          # the required check is named `test`
```

Stop there and hand the PR to the maintainer. **Merging is never autonomous** — ask, wait for the go-ahead, and only then:

```sh
gh pr merge --merge --delete-branch    # merge commits, not squash — match the history
git switch main && git pull && git branch -d feat/m<NN>-<slug>
```

Merging needs a code-owner review and the CLA checkbox ticked in the PR body.

## 6. Report back

Close the loop with: what the milestone required, what you changed (files), which tests were added and what they cover, what you verified by hand and on which platform, and anything the spec asked for that you deliberately deferred with the reason.
