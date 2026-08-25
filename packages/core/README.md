# @aisvision/quasidian-core

[![npm](https://img.shields.io/npm/v/@aisvision/quasidian-core?logo=npm&color=blue)](https://www.npmjs.com/package/@aisvision/quasidian-core)

The embeddable heart of [Quasidian](https://github.com/AIS-Vision-Systems/Quasidian): a **CodeMirror 6 markdown editor with Obsidian-style Live Preview**, and a **reading-mode HTML renderer** fed by the *same* Lezer syntax tree — so the two views can never drift apart. No Tauri, no filesystem, no app framework: the desktop app and this package share the same sources.

- Obsidian dialect: wikilinks (`[[note]]`, aliases, headings), embeds/transclusions, callouts, footnotes, math (KaTeX), task lists, tables with cell editing, frontmatter properties.
- Live Preview (syntax hides away from the active line), a plain-text source mode, section folding, line numbers.
- Reading render from the same tree: `renderToHtml(markdown)`.
- Host integration by injection: wikilink resolution, embed sources and navigation come in through the editor hooks; UI strings ship with English defaults (`setCoreTranslator` plugs in your translator); icons ship built in (`setIconProvider` overrides them).

## Install

```sh
npm install @aisvision/quasidian-core
```

`@codemirror/*` and `@lezer/*` are **peer dependencies** — the host installs them once, because two copies of `@codemirror/state` on one page break the editor. KaTeX is a regular dependency.

## Use

```ts
import "@aisvision/quasidian-core/theme.css"; // Obsidian-style variables
import "@aisvision/quasidian-core/core.css"; // component styles
import "katex/dist/katex.min.css";
import { createEditor, renderToHtml } from "@aisvision/quasidian-core";

const editor = createEditor(hostElement, hooks, config);
editor.setDoc("# Hello\n\nSome **markdown** with [[wikilinks]].");

previewElement.innerHTML = renderToHtml(editor.getDoc());
```

`hooks` tells the core how your application resolves things (`isResolved`, `resolveEmbedSrc`, `renderEmbedNote`, completions, navigation callbacks) — see the `EditorHooks` type. `config` covers line numbers, indentation, spellcheck and auto-pairing — see `EditorConfig`. Set `<body class="theme-dark">` (or `theme-light`) for the stylesheet's variables to apply.

A complete minimal embedding lives in [`packages/demo`](../demo) of the repository:

```sh
npm run build -w @aisvision/quasidian-core
npm run dev -w quasidian-core-demo
```

## License

Dual-licensed like Quasidian itself: [PolyForm Noncommercial 1.0.0](LICENSE.md) for noncommercial use, with a [commercial license](LICENSE-COMMERCIAL.md) available. © AIS Vision Systems.
