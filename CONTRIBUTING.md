# Contributing to Quasidian

Thanks for taking the time to contribute! This document explains how the project accepts changes.

## Contributor License Agreement

Quasidian is dual-licensed (noncommercial + commercial, see [`LICENSE.md`](LICENSE.md)). To keep both licensing paths viable, **all contributions require accepting the Contributor License Agreement in [`CLA.md`](CLA.md)**. By opening a pull request you confirm that you have read and accept the CLA; the pull request template includes an explicit checkbox for this. Pull requests whose authors do not accept the CLA cannot be merged.

## How changes land

- **Everything goes through a pull request** — the `main` branch does not accept direct pushes, and merging requires a review from a code owner.
- Open an issue first for anything non-trivial, so the approach can be discussed before you invest time in it.
- Keep pull requests focused: one feature or fix per PR.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) in English (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `ci:`).

## Development setup

See the [README](README.md) for prerequisites and how to run the app (`npm run tauri dev`).

## Quality bar

Before pushing:

```sh
npm run typecheck  # tsc --noEmit — must pass
npm test           # Vitest unit tests — must pass
```

Architecture and style rules (the full set lives in [`CLAUDE.md`](CLAUDE.md)):

- **No second markdown parser.** Everything renders from the same Lezer tree the editor uses (`@codemirror/lang-markdown` + `@lezer/markdown` extensions). Never add markdown-it, marked or similar.
- **All user-facing text goes through `t(key)`** with i18n entries for all three languages (`ca`, `es`, `en`) — including error messages.
- **All colors go through the Obsidian-style CSS variables** (`--background-primary`, `--text-normal`, …). No hardcoded colors.
- **Folder = implicit vault.** No vault config, no database, never write config or index files into note folders.
- Link resolution, indexing and settings logic live in pure TS modules (no Tauri, no DOM imports) with Vitest unit tests.
- The Rust side stays minimal: filesystem commands and the file watcher only.
- When adding a settings option: typed schema + defaults + settings modal + i18n keys for all three languages, in the same PR.
- When touching the Lezer extensions: add parser test cases for both editing decorations and reading-mode HTML output.

## Out of scope

Graph view, plugin system, sync, publish, WYSIWYG document-model editing and Vim mode are explicitly out of scope — PRs implementing them will be declined.

## Reporting bugs

Open a GitHub issue with steps to reproduce, the expected and the actual behavior, and your OS (Windows/Linux). For security vulnerabilities, see [`SECURITY.md`](SECURITY.md) — do **not** open a public issue.
