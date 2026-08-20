---
paths:
  - "src/lib/**/*.ts"
---

# Pure modules — `src/lib/`

This is the tested core. Everything here must run under Vitest in a plain Node environment, with no app around it.

- **No Tauri**: never import `@tauri-apps/*`. A module that needs the filesystem takes it as an injected function (see how `vaultSession` receives `contains`).
- **No DOM**: no `document`, no `window`, no `navigator`. UI code passes in what the module needs — `detectLocale(languageTag)` takes the tag as an argument rather than reading `navigator.language`.
- **No imports from `src/ui/` or `src/ipc/`.** The dependency arrow points one way: UI calls into `lib`, never the reverse.
- **Every module has a sibling `<name>.test.ts`.** New logic without a test is incomplete, not "to be tested later".
- Prefer pure functions over stateful singletons: given the same input, the same output. That is what makes these modules cheap to test and safe to reuse in `packages/core`.

When you find logic that belongs here sitting in `src/ui/`, moving it is usually the right call — say so rather than adding a second copy.

## Testing

Cover the awkward cases, not the happy path: empty input, the first and last element, paths on Windows *and* POSIX separators, invalid or partial data. Settings and session parsing must always fall back to defaults instead of throwing.
