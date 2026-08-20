---
name: docs-sync
description: Keeping Quasidian's documentation in step with the code — the in-app user guide in three languages, the three READMEs, and the core package docs. Use whenever a change adds, removes or alters user-visible behavior, a shortcut, a setting or a public API.
---

# Keeping the docs honest

For anything beyond a one-line touch-up, delegate to the `doc-writer` agent: it verifies every claim against the code and reports what it could not confirm. This skill is the map of what needs updating; the agent does the writing.

## What is documentation here

| Audience | Files | Update when |
|---|---|---|
| Users, inside the app | `src/help/guide.ca.md`, `guide.es.md`, `guide.en.md` (~58 lines each, kept in lockstep) | behavior, a shortcut or a setting the user can see changes |
| Users, on GitHub | `README.md` + `README.ca.md` + `README.es.md` (~99 lines each) | the feature list, download, build or release story changes |
| Consumers of the package | `packages/core/README.md` and its public API docs (milestone 41 onward) | the exported surface changes |
| Contributors | `CLAUDE.md`, `CONTRIBUTING.md` | a rule or a convention changes — not for features |

**`docs/SPEC*.md` are never touched.** They record what was decided at the time; the README is the public source of truth for what the app does today. If a spec turned out wrong, the code and the README say so — the spec stays as written.

## The in-app guide

It is markdown bundled with the app and rendered by the *same* reading pipeline as any note — the app documents itself in its own format. It is never written into a user's note folder.

Sections today: Folders and files · Editing and reading modes · Links and transclusions · Properties · Formatting · Tabs · Export to PDF · Main shortcuts.

- All three languages change in the same commit, with the same structure and the same headings in the same order. A section that exists in `en` and not in `ca` is a bug.
- Catalan is the author's language — write it first, then translate.
- Use only markdown the app itself renders, so the guide doubles as a live demonstration.
- Any new keyboard shortcut goes in *Main shortcuts*.

## The READMEs

Three languages, same structure: Features · Download · License · Building from source · Development · Roadmap · Publishing a release (maintainers) · Credits.

- *Features* is a user-facing summary, not a milestone list. Add a bullet when a milestone delivers something a user would notice; don't mention milestone numbers.
- *Roadmap* is where "coming next" lives; move an item out of it when it ships.
- No personal data, no internal notes, no local paths — the repo is public.
- Licensing lines stay consistent with `LICENSE.md`: dual PolyForm Noncommercial 1.0.0 + commercial, source-available, explicitly not OSI open source, contributions under the CLA.

## The core package (milestone 41)

`packages/core` is a published npm package with its own README and its own copy of the dual licence. Document the **public surface** and nothing else: the editor factory, the reading render, the injected wikilink resolver, the injected icon provider and strings, and the exported stylesheet. State the peer dependencies (`@codemirror/*`, `@lezer/*`) and why they are peers — two CodeMirror copies on one page break the editor. Never document app internals; the package must not even import from the app.

## Verify

Read the changed guide sections in the app (help "?" button in the bottom bar) so you see them through the real renderer, and diff the three language files against each other to confirm they still line up section by section.
