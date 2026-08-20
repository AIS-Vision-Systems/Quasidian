---
paths:
  - "src/ui/**/*.ts"
  - "src/styles/**/*.css"
---

# UI layer

`src/ui/` is the only place that touches the DOM, and it has no tests — so it should hold as little logic as possible. Anything decidable from data belongs in `src/lib/` with a test, called from here.

- **Every user-facing string goes through `t(key)`**, with entries in `ca`, `es` and `en`. That includes tooltips, `aria-label`s, empty states and error messages. See `/i18n-text`.
- **Every color goes through the Obsidian-style CSS variables** in `src/styles/theme.css` (`--background-primary`, `--text-normal`, `--interactive-accent`, …). No `#rrggbb`, no `rgb()`, no named colors, no inline style with a literal color. The accent drives derived colors; don't duplicate a shade by hand.
- **Context menus use the app's own component** (`src/ui/contextMenu.ts`), never the native WebView menu.
- Reuse what exists before building: the fuzzy modal behind the palette and quick switcher, the menu component, the reading render in `renderedContent.ts`. A second way to do something already done is a review finding.
- Reading mode is read-only except task-list checkboxes. The inline title is never written into the file.
- Settings apply hot, without a restart — route through `applySettings.ts`.
- Nothing is ever written into a user's note folder: no config, no index, no cache. Session and settings state lives in the Tauri `appConfigDir`.

Behavior you cannot unit-test gets checked by hand with `npm run tauri dev`; say in the PR what you exercised and on which platform.
