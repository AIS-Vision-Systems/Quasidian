---
name: i18n-text
description: Adding, changing or removing user-facing text in Quasidian — t(key) plus entries in ca, es and en. Use whenever a change introduces a label, tooltip, menu entry, placeholder, dialog or error message, or removes a feature that had one.
---

# User-facing text

No hardcoded user-facing string, ever — including error messages, tooltips, `aria-label`s and the empty states nobody looks at. Everything goes through `t(key)` from `src/i18n/i18n.ts`.

## Adding a key

Add it to **all three** files, which are flat `Record<string, string>` objects:

- `src/i18n/locales/ca.json` — Catalan (the author's language; get this one right first)
- `src/i18n/locales/es.json`
- `src/i18n/locales/en.json` — the fallback `t()` uses when a key is missing from the active locale

Existing namespaces, in order of size: `settings`, `menu`, `command`, `tabs`, `sidebar`, `help`, `error`, `properties`, `updates`, `statusBar`, `search`, `rightPanel`, `workspace`, `dialog`, `switcher`, `reading`, `palette`, `nav`, `backlinks`, `preview`. Reuse one; a new namespace needs a reason.

Naming: `namespace.thing` in camelCase (`sidebar.openFolder`, `command.toggleReadingMode`). Settings rows use the `settings.<key>.name` / `settings.<key>.desc` pair. Match the surrounding style rather than inventing a scheme.

Wording follows the OS convention the app already uses: sentence case, an ellipsis on actions that open a dialog (`Open a folder…`), no trailing period on labels.

## Placeholders

`t()` substitutes `{name}` from a params object:

```ts
t("error.copyFailed", { name: fileName })
```

The **same placeholder set must appear in all three locales** — a missing `{name}` silently renders the literal `{name}` to the user. Never concatenate translated fragments to build a sentence; put the whole sentence in the key with placeholders.

## Dynamic keys

A few call sites build the key at runtime, e.g. `t(\`rightPanel.${view}\`)` in `src/ui/layout.ts`, and many pass a key stored in a table (`nameKey`, `labelKey`, `descKey`). If you add a key that is **only** reachable through a template literal, add its prefix to `DYNAMIC_KEY_PREFIXES` in `src/i18n/locales.test.ts` — otherwise the orphan check will flag it.

## Removing a feature

Delete its keys from all three locales in the same commit. `src/i18n/locales.test.ts` fails on orphans, so a forgotten key breaks CI rather than rotting quietly.

## Verify

```sh
npm test -- locales
```

checks key parity across the three locales, non-empty values, matching placeholders, and orphans. The PR checklist item *"Any new user-facing text uses `t(key)` with entries in `ca`, `es` and `en`"* is exactly this test.
