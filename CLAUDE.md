# CLAUDE.md — Quasidian

Quasidian is a minimalist desktop markdown editor that mimics Obsidian's look and behavior (Live Preview, wikilinks, dark theme) without the weight. The specs are in Catalan and are **historical documents — never rewrite them to match the present**: `docs/SPEC.md` (milestones 1–11), `SPEC2.md` (12–23), `SPEC3.md` (24–29), `SPEC4.md` (30–34) and `SPEC5.md` (35), all complete, plus `docs/SPEC6.md` (36–43, current phase). Read the entry for the milestone you are implementing; for constraints carried over from earlier phases ask the `spec-navigator` agent instead of loading all six. New work needs a phase-7 spec first. The README is the public source of truth.

## Stack

- Tauri 2 (Rust shell) + Vite + TypeScript (strict) + CodeMirror 6.
- Markdown parsing: `@codemirror/lang-markdown` + `@lezer/markdown` extensions. **Never write a custom markdown parser and never add a second parser** (no markdown-it, no marked): reading mode renders HTML from the same Lezer tree the editor uses.
- Targets: Windows 11 and Ubuntu. Test on both whenever a change touches Rust, paths, the watcher, printing or the CSP.

## Where things live

- `src/lib/` — pure TS modules (no Tauri, no DOM), each with a sibling `.test.ts`: `vault`, `vaultSession`, `workspace`, `panes`, `folderTree`, `paths`, `wikilinks`, `renameLinks`, `backlinkIndex`, `searchIndex`, `outline`, `frontmatter`, `fuzzy`, `text`, `settings`, `updates`.
- `src/markdown/` — Lezer extensions + reading-mode render: `parser`, `render`, `wikilinks`, `math`, `callouts`, `footnotes`, `frontmatter`, `setext`, `listInterrupt`.
- `src/editor/` — CM6 extensions: `editor`, `livePreview`, `folding`, `autoPair`, `autosave`, `listCommands`, `tableCommands`, `gutterLines`.
- `src/ui/` — DOM code (no tests). `src/ipc/` — the Tauri boundary (no tests).
- `src/i18n/locales/{ca,en,es}.json` — flat `Record<string, string>` dictionaries.
- `src/help/guide.{ca,en,es}.md` — the user guide bundled with the app.
- `src-tauri/src/{main,lib}.rs` — the only Rust files. `src-tauri/capabilities/default.json` — permissions.
- `/test/` at the repo root is **not** test code: it is a personal sample vault, gitignored. Tests are colocated next to their source under `src/`.

## Architecture rules

- **Folder = implicit vault.** No vault config, no database. The open file's immediate folder (non-recursive) is the scope for wikilink resolution, backlinks, and global search. Cross-folder links use relative/full paths. Never write config or index files into note folders. (Marker files — `CLAUDE.md`, `.claude`, `AGENTS.md`, … — switch on a bounded recursive vault mode; see SPEC3 m29.)
- Indexes (backlinks, search) are built in memory on folder open and kept fresh via a file watcher.
- Rust side stays minimal: filesystem commands and the watcher only. No business logic in Rust.
- Link resolution, indexing, and settings logic live in pure TS modules (no Tauri, no DOM imports) with Vitest unit tests. UI code calls into them.
- App settings: single `settings.json` in the app config dir (Tauri `appConfigDir`), typed schema with defaults, merge-with-defaults on invalid/partial JSON — never crash on bad config. Hot-reload: changes apply without restart.
- Never embed a token or secret in the binary or the repo. The update check is public and read-only; releases are written by CI with the ephemeral workflow token.
- The app version is never hardcoded — read it from the Tauri config at runtime.

## UI conventions

- All UI text goes through `t(key)` (i18n dictionaries: `ca`, `es`, `en`). No hardcoded user-facing strings, ever — including in new features and error messages.
- All colors go through Obsidian-style CSS variables (`--background-primary`, `--text-normal`, `--interactive-accent`, …). No hardcoded colors.
- Editing mode is CM6 Live Preview; reading mode (Ctrl+E) is rendered HTML, read-only except task-list checkboxes.

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

- One milestone per PR, in spec order. Don't start milestone N+1 features while implementing milestone N.
- Conventional commits in English (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `ci:`). `main` takes no direct pushes — everything goes through a PR.
- Committing, pushing a branch and opening a PR are autonomous. **Merging a PR, tagging a version and publishing a release are not** — they need the maintainer's explicit go-ahead, every time.
- When adding a settings option: extend the typed schema + defaults + settings modal + i18n keys for all three languages, in the same PR.
- Every change to the parser **or to the dual-mode decorations** ships tests for both editing decorations and reading-mode HTML output, so the two modes can't diverge.
- A version bump touches five files: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and both lockfiles.
- For recurring procedures invoke the matching skill instead of re-deriving it: `/milestone-workflow`, `/i18n-text`, `/settings-option`, `/markdown-editor`, `/release-version`, `/docs-sync`, `/commit-pr`, `/skill-creator`.
- Layer-specific constraints live in `.claude/rules/` and load when you open a file they cover. They are the detail behind the rules above, not exceptions to them.
