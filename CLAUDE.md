# CLAUDE.md — Quasidian

Quasidian is a minimalist desktop markdown editor that mimics Obsidian's look and behavior (Live Preview, wikilinks, dark theme) without the weight. The phase-1 spec lives in `docs/SPEC.md` (milestones 1–11, complete); the phase-2 spec and milestone plan live in `docs/SPEC2.md` — read both before starting any milestone.

## Stack

- Tauri 2 (Rust shell) + Vite + TypeScript (strict) + CodeMirror 6.
- Markdown parsing: `@codemirror/lang-markdown` + `@lezer/markdown` extensions. **Never write a custom markdown parser and never add a second parser** (no markdown-it, no marked): reading mode renders HTML from the same Lezer tree the editor uses.
- Targets: Windows 11 and Ubuntu. Test commands on both when they touch Rust or paths.

## Architecture rules

- **Folder = implicit vault.** No vault config, no database. The open file's immediate folder (non-recursive) is the scope for wikilink resolution, backlinks, and global search. Cross-folder links use relative/full paths. Never write config or index files into note folders.
- Indexes (backlinks, search) are built in memory on folder open and kept fresh via a file watcher.
- Rust side stays minimal: filesystem commands and the watcher only. No business logic in Rust.
- Link resolution, indexing, and settings logic live in pure TS modules (no Tauri, no DOM imports) with Vitest unit tests. UI code calls into them.
- App settings: single `settings.json` in the app config dir (Tauri `appConfigDir`), typed schema with defaults, merge-with-defaults on invalid/partial JSON — never crash on bad config. Hot-reload: changes apply without restart.

## UI conventions

- All UI text goes through `t(key)` (i18n dictionaries: `ca`, `es`, `en`). No hardcoded user-facing strings, ever — including in new features and error messages.
- All colors go through Obsidian-style CSS variables (`--background-primary`, `--text-normal`, `--interactive-accent`, …). No hardcoded colors.
- Editing mode is CM6 Live Preview (syntax tokens hidden outside the active line/selection via `Decoration.replace`). Reading mode (Ctrl+E) is rendered HTML, read-only except task-list checkboxes.

## Out of scope — do not implement

- Graph view, plugin system, sync, publish.
- WYSIWYG document-model editing (ProseMirror-style). Editing is always plain text.
- Vim mode (leave the settings hook, no implementation).

## Commands

- `npm run tauri dev` — run the app in dev mode.
- `npm run tauri build` — production build.
- `npm test` — Vitest unit tests (pure modules).
- `npm run typecheck` — `tsc --noEmit`; must pass before any commit.

## Workflow

- One milestone per PR, milestones in the order defined in `docs/SPEC.md`. Don't start milestone N+1 features while implementing milestone N.
- Conventional commits in English (`feat:`, `fix:`, `refactor:`, `chore:`).
- When adding a settings option: extend the typed schema + defaults + settings modal + i18n keys for all three languages, in the same PR.
- When touching the Lezer extensions (wikilinks, etc.), add a parser test case for both editing decorations and reading-mode HTML output so the two modes can't diverge.
