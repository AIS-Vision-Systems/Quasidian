---
name: markdown-editor
description: Changing Quasidian's markdown layer — Lezer extensions in src/markdown/, the reading-mode render, or the Live Preview decorations in src/editor/livePreview.ts. Use for new syntax, changed rendering, hidden-range or widget behavior, and for the mandatory dual-mode tests that come with them.
---

# Markdown and editor extensions

## The one rule everything else follows from

There is **one parser**. `src/markdown/parser.ts` composes `@codemirror/lang-markdown` with the project's `@lezer/markdown` extensions (`footnotes`, `frontmatter`, `listInterrupt`, `math`, `setextRestriction`, `wikilinks`, `highlights`) and exports `markdownExtensions` + `markdownParser`. Editing decorations, reading mode, hover previews, embeds and PDF export all consume that same tree.

Never add markdown-it, marked, remark or a hand-rolled parser, and never parse the document a second time for reading mode — that is precisely how the two modes drift apart.

## New syntax → a Lezer extension

Add a file under `src/markdown/` exporting a `MarkdownConfig`, register it in `parser.ts`, and give the nodes names distinctive enough to match on (`Wikilink…`, `Embed`, …). Then handle those node names in **both** consumers:

- `src/markdown/render.ts` — `renderToHtml` walks the tree and emits reading-mode HTML.
- `src/editor/livePreview.ts` — the `compute*` functions decide what is hidden, decorated or replaced by a widget in editing mode.

Escape everything you interpolate into HTML in `render.ts`; the output is injected into the DOM.

## Live Preview decorations

Syntax tokens are hidden with `Decoration.replace` *except* on the active line or inside the selection, so the raw markdown reappears exactly where the cursor is. The logic lives in pure `compute*` helpers (`computeHiddenRanges`, `computeHeadingLines`, `computeImageEmbeds`, `computeNoteEmbeds`, `computeMathRanges`, …) that take a state and return ranges — keep new logic in that shape, because that is what the tests can reach.

Widgets whose height is only known later (images, note embeds, tables, KaTeX) need a stable `estimatedHeight` or a cached size; late measurement is a known source of scroll jumps.

For a mode-wide behavior switch (source mode, milestone 38), use a facet or compartment the decoration builder reads — do not fork the builder and do not touch the parser.

## Dual-mode tests are mandatory

Every change to `src/markdown/` or to the decorations ships tests for **both** sides, in the same PR:

- Parser level — `src/markdown/<ext>.test.ts`: configure `commonmarkParser.configure([GFM, <ext>])`, parse a document, assert the node names and offsets (see `src/markdown/wikilinks.test.ts`).
- Reading mode — `src/markdown/render.test.ts`: assert the emitted HTML.
- Editing mode — `src/editor/livePreview.test.ts`: build an `EditorState` with `markdown({ base: markdownLanguage, extensions: markdownExtensions })`, place the selection, and assert the computed ranges — including the "cursor on the line → nothing hidden" case.

Cover the awkward inputs, not just the happy path: the construct at the very start and end of the document, nested inside a list or a blockquote, unterminated, and escaped.

## Verify

```sh
npm run typecheck && npm test
```

Then `npm run tauri dev` and check the same document in editing and reading mode (`Ctrl+E`) side by side — they must agree.
