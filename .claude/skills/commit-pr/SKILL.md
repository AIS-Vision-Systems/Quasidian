---
name: commit-pr
description: Writing Quasidian commit messages, pull requests and the report that closes a piece of work — conventional commits, the PR template checklist, the CLA box, and what to tell the user when it is done. Use when committing, opening a PR, or summarizing finished work.
---

# Commits, PRs and reporting

## Commits

Conventional Commits, in **English**, regardless of the language of the conversation:

`feat:` · `fix:` · `refactor:` · `chore:` · `docs:` · `ci:`

```
feat: add source mode toggle to the view menu
fix: keep the editor measured after a window resize
chore(claude): add project skills and agents
```

- Subject in the imperative, lower case, no trailing period, under ~72 characters.
- A body when the *why* isn't obvious from the subject — trade-offs, a workaround, a spec reference. Skip it for small obvious changes.
- Reference the milestone in the body when the commit implements one (`Milestone 38 (SPEC6).`), not in the subject.
- Before committing: `npm run typecheck` passes. Never `--no-verify`. Never commit on `main` — everything goes through a PR.
- One logical change per commit; tooling and documentation changes stay separate from feature work.

## Pull requests

One feature or fix per PR, one milestone per PR. Branch names: `feat/m<NN>-<slug>`, `fix/<slug>`, `chore/<slug>`.

The body follows `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Summary

<what changed and why; link the issue if there is one>

## Checklist

- [x] `npm run typecheck` passes
- [x] `npm test` passes (new/changed logic has unit tests)
- [x] Any new user-facing text uses `t(key)` with entries in `ca`, `es` and `en`
- [x] Any new colors use the Obsidian-style CSS variables (no hardcoded colors)
- [x] **I have read and accept the [Contributor License Agreement](../CLA.md)**
```

Only tick a box that is actually true — the CLA one is a legal statement and a PR cannot merge without it. If an item doesn't apply, tick it and say why in the summary rather than leaving it ambiguous.

Write the summary for a reviewer who hasn't read the spec: what the user can now do, how it was done in one or two sentences, what you verified by hand and on which platform (Windows, Ubuntu or both), and anything deliberately left out.

```sh
gh pr create --fill-first    # then edit the body to the template
gh pr checks --watch         # required check: `test`
gh pr merge --merge --delete-branch
git switch main && git pull && git branch -d <branch>
```

**`--merge`, not `--squash`** — every PR in this repo's history is a merge commit, and the individual commits of a milestone are worth keeping. Don't collapse them.

Merging also needs a code-owner review, and the maintainer cannot approve their own PR: a solo PR lands with `--admin`, which the `main` ruleset allows. Delete the branch locally and on the remote once merged.

## Reporting back to the user

When work is finished, say plainly:

- **What was asked** and what was delivered, in one line.
- **Files changed**, grouped by layer (pure modules / markdown / editor / UI / Rust / i18n / docs), not a raw list.
- **Tests** added or changed and what they actually cover.
- **Verification**: the exact commands run and their result, plus what was checked by hand and where. If something wasn't tested — the other platform, a manual path — say so explicitly instead of implying it was.
- **Left out**: anything deferred, with the reason.

Report failures with the output that shows them. Don't hedge on work that is genuinely done and verified.
