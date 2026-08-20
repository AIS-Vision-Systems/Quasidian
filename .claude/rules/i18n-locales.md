---
paths:
  - "src/i18n/**/*.json"
  - "src/i18n/**/*.ts"
---

# Locale dictionaries

`ca.json`, `es.json` and `en.json` are flat `Record<string, string>` objects. They change **together**, in the same commit — a key added to one and not the others is a bug, and `locales.test.ts` fails on it.

- `en` is the fallback `t()` uses when a key is missing from the active locale, so it is the reference key set.
- Catalan is the author's language: write it first, then translate.
- Key shape: `namespace.thing` in camelCase. Settings rows use the `settings.<key>.name` / `settings.<key>.desc` pair. Reuse an existing namespace — `settings`, `menu`, `command`, `tabs`, `sidebar`, `help`, `error`, `properties`, `updates`, `statusBar`, `search`, `rightPanel`, `workspace`, `dialog`, `switcher`, `reading`, `palette`, `nav`, `backlinks`, `preview` — a new one needs a reason.
- The same `{placeholder}` set must appear in all three locales; a missing one renders the literal `{name}` to the user. Never build a sentence by concatenating translated fragments.
- Removing a feature removes its keys. `locales.test.ts` fails on orphans.
- A key only reachable through a template literal must have its prefix listed in `DYNAMIC_KEY_PREFIXES` in `locales.test.ts`, with the call site named in a comment.

Wording follows the convention already in the file: sentence case, an ellipsis on actions that open a dialog (`Open a folder…`), no trailing period on labels.

Verify with `npm test -- locales`.
