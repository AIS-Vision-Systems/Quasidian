---
paths:
  - "packages/**/*"
---

# `packages/core` — the embeddable core

Milestone 41. The package exposes the Quasidian core without Tauri: the Live Preview markdown editor and the viewer that renders HTML from the same Lezer tree.

- **Single source of truth.** The desktop app and the package share the same sources. Never create a divergent copy of the pipeline or the editor — if the app needs something the package has, the app imports it.
- **The package never imports anything from the app.** No `src/ui/`, no `src/ipc/`, no Tauri. Anything the core needs from the outside is injected: the wikilink resolver (the core knows no filesystem), the icon provider, and the UI strings (English defaults; the app injects `t`).
- **`@codemirror/*` and `@lezer/*` are peerDependencies.** Two CodeMirror copies on one page break the editor. KaTeX is a regular dependency.
- The theme CSS (the Obsidian variables) ships as an exported stylesheet.
- Same dual licence as the app — PolyForm Noncommercial 1.0.0 plus the commercial licence — with its own README documenting only the public surface.
- The web demo in the workspace is manual proof that the package works standalone; keep it working.

Publishing to npm is a manual author operation, not something to automate here.
