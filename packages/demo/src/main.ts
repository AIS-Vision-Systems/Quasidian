// Minimal embedding of @aisvision/quasidian-core: the Live Preview
// editor on the left, the reading render (same Lezer tree) on the
// right. No filesystem: the hooks resolve nothing, which is exactly
// what a fresh embedder starts from.
import "@aisvision/quasidian-core/theme.css";
import "@aisvision/quasidian-core/core.css";
import "katex/dist/katex.min.css";
import {
  createEditor,
  highlightCodeBlocks,
  renderMathElements,
  renderToHtml,
} from "@aisvision/quasidian-core";

const SAMPLE = `# Quasidian core

A **markdown** editor with [[wikilinks]], ==highlights==, inline math
$e^{i\pi} + 1 = 0$ and the rest of the Obsidian dialect.

> [!tip] Live Preview
> Syntax hides away from the active line on the left; the right side
> is the reading render, fed by the same syntax tree.

- [ ] a task
- a list item

| a | b |
| --- | --- |
| 1 | 2 |
`;

const editorHost = document.getElementById("editor");
const preview = document.getElementById("preview");
if (editorHost === null || preview === null) {
  throw new Error("demo hosts missing");
}
const previewHost: HTMLElement = preview;

// renderToHtml emits the structure; math and code highlighting fill
// in afterwards, exactly like the app's reading mode does.
function renderPreview(doc: string): void {
  previewHost.innerHTML = renderToHtml(doc);
  renderMathElements(previewHost);
  highlightCodeBlocks(previewHost);
}

const editor = createEditor(
  editorHost,
  {
    onDocChanged(doc) {
      renderPreview(doc);
    },
    onSaveRequested() {},
    onToggleModeRequested() {},
    onWikilinkClick() {},
    getWikilinkCompletions: () => ["Welcome", "Ideas", "Journal"],
    getLinkPathCompletions: () => [],
    getHeadingCompletions: () => Promise.resolve([]),
    resolveEmbedSrc: () => null,
    renderEmbedNote: () => Promise.resolve(null),
    isResolved: () => false,
    currentFilePath: () => null,
  },
  {
    showLineNumbers: false,
    indentation: "spaces",
    spellcheck: false,
    autoPairBrackets: true,
    autoPairMarkdown: true,
  },
);

editor.setDoc(SAMPLE);
renderPreview(SAMPLE);
