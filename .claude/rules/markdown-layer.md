---
paths:
  - "src/markdown/**/*.ts"
  - "src/editor/**/*.ts"
---

# Markdown and editor layer

## One parser, two renderings

`src/markdown/parser.ts` composes `@codemirror/lang-markdown` with the project's `@lezer/markdown` extensions and exports `markdownExtensions` and `markdownParser`. Editing decorations, reading mode, hover previews, embeds and PDF export all read that same tree.

Never add a second markdown parser (markdown-it, marked, remark) and never hand-roll parsing. Never re-parse the document for reading mode — that is exactly how the two modes drift apart.

## Live Preview

Syntax tokens are hidden with `Decoration.replace` *except* on the active line or inside the selection, so the raw markdown reappears where the cursor is. Keep the logic in pure `compute*` helpers that take a state and return ranges — that shape is what the tests can reach.

Widgets whose height is known late (images, note embeds, tables, KaTeX) need a cached size or an `estimatedHeight`. Late measurement is a known cause of scroll jumps.

A mode-wide behavior switch belongs in a facet or compartment the decoration builder reads. Don't fork the builder, and don't touch the parser for it.

## Tests are not optional here

Any change to a Lezer extension or to the decorations ships tests for **both** sides in the same PR:

- Parser: `commonmarkParser.configure([GFM, <ext>])`, parse, assert node names and offsets (`src/markdown/wikilinks.test.ts`).
- Reading mode: assert the HTML from `renderToHtml` (`src/markdown/render.test.ts`).
- Editing mode: build an `EditorState` with `markdown({ base: markdownLanguage, extensions: markdownExtensions })`, place the selection, assert the computed ranges — including "cursor on the line → nothing hidden" (`src/editor/livePreview.test.ts`).

Cover the construct at the start and end of the document, nested in a list or blockquote, unterminated, and escaped.

Escape everything interpolated into HTML in `render.ts`; the output goes straight into the DOM.
