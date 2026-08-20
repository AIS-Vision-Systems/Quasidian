---
name: settings-option
description: Adding or changing an app setting in Quasidian — typed schema, default, merge-with-defaults, settings modal row, hot application and i18n in ca/es/en, all in one PR. Use when a milestone introduces a toggle, a dropdown, a number or a color the user can configure.
---

# Adding a settings option

All five pieces land in the **same PR**. A setting that exists in the schema but not in the modal, or that needs a restart to take effect, is an incomplete change.

## 1. Schema and default — `src/lib/settings.ts`

Pure module, no Tauri and no DOM. Settings are grouped into sections; today: `AppearanceSettings`, `EditorSettings`, `FilesSettings`, `UpdatesSettings`, composed into `Settings`.

- Add the field to the right section interface (use a string-literal union type for enums, as `ThemeSetting` and `IndentationSetting` do).
- Add its default to `DEFAULT_SETTINGS`. Defaults are a public decision: a new setting that changes existing behavior defaults to the *current* behavior.
- Read it in `mergeSettings` with the matching helper — `pickBoolean`, `pickNumber` (takes min/max), `pickString`, `pickEnum`. This is what makes a corrupt or partial `settings.json` merge with defaults instead of crashing. **Never** trust the parsed JSON directly.

## 2. Test — `src/lib/settings.test.ts`

Cover: the default is what you claim, a valid value survives the round trip, and a garbage value (wrong type, out of range, unknown enum member) falls back to the default.

## 3. Modal row — `src/ui/settingsModal.ts`

Sections are declared in `SECTIONS` (`general`, `appearance`, `editor`, `files`). Add the row to the section the setting belongs to, using the existing row builders — they take a `nameKey` and a `descKey`, and dropdowns take `options` with a `labelKey` each. Don't hand-roll a control that already exists.

## 4. Hot application — `src/ui/applySettings.ts`

Changes apply without restart. Route through the existing entry points: `applyAppearance`, `applyLanguage`, or `editorConfigFrom` for anything the CodeMirror configuration consumes. A setting that changes what is scanned from disk (e.g. `files.showHiddenFolders`) must trigger a rescan of the open folder or vault.

## 5. i18n ×3

`settings.<key>.name` and `settings.<key>.desc`, plus one `labelKey` per dropdown option, in `ca`, `es` and `en`. See `/i18n-text`.

## Constraints

- `settings.json` lives in the Tauri `appConfigDir` — **never** inside a note folder. No per-vault settings file, no index file on disk.
- No hardcoded colors in whatever you add to the modal; use the theme variables.
- Anything that needs to persist per vault or per tab is **session** state (`src/lib/vaultSession.ts`), not a setting.

## Verify

```sh
npm run typecheck && npm test
```

Then `npm run tauri dev`: toggle the option and confirm it takes effect immediately, survives a restart, and that hand-editing `settings.json` to something invalid still opens the app with the default.
