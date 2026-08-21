// Minimal embedding of @aisvision/quasidian-core: the Live Preview
// editor on the left, the interactive reading view on the right —
// both fed by the same document and the same Lezer tree. No
// filesystem: the hooks resolve nothing, which is exactly what a
// fresh embedder starts from.
import "@aisvision/quasidian-core/theme.css";
import "@aisvision/quasidian-core/core.css";
import "katex/dist/katex.min.css";
import {
  createEditor,
  createReadingView,
  type EditorHandle,
} from "@aisvision/quasidian-core";

const SAMPLE = `# Quasidian core

A **markdown** editor with [[wikilinks]], ==highlights==, inline math
$e^{i\\pi} + 1 = 0$ and the rest of the Obsidian dialect.

> [!tip]- Live Preview
> Syntax hides away from the active line on the left; the right side
> is the reading view, fed by the same syntax tree. This callout is
> foldable — click its chevron.

## Try both sides

- [ ] toggle this task on either side
- fold this heading with the chevron on the right

| a | b |
| --- | --- |
| 1 | 2 |
`;

const editorHost = document.getElementById("editor");
const previewHost = document.getElementById("preview");
if (editorHost === null || previewHost === null) {
  throw new Error("demo hosts missing");
}

// The two views close over each other: `editor` is assigned right
// after createEditor returns, before any hook can fire.
let editor: EditorHandle;

const reading = createReadingView({
  onInternalLink() {},
  onTaskToggle(pos, checked) {
    // The document is the single source of truth: write the marker
    // through the editor and re-render the reading side from it.
    editor.replaceRange(pos, pos + 3, checked ? "[x]" : "[ ]");
    void reading.render(editor.getDoc());
  },
  resolveEmbedSrc: () => null,
  renderEmbedNote: () => Promise.resolve(null),
  isResolved: () => false,
  currentFilePath: () => null,
  // Fold state lives in the editor, so both views stay in step.
  foldInfoAt: (pos) => editor.foldInfoAt(pos),
  onToggleFold(pos) {
    editor.toggleFoldAt(pos);
    void reading.render(editor.getDoc());
  },
  onCalloutToggle(pos, fold) {
    editor.replaceRange(pos, pos + 1, fold ? "-" : "+");
    void reading.render(editor.getDoc());
  },
  showProperties: () => true,
  inlineTitle: () => null,
  onInlineTitleRename() {},
  onExternalLink(url) {
    window.open(url, "_blank", "noopener");
  },
});
reading.element.classList.remove("is-hidden");
previewHost.append(reading.element);

editor = createEditor(
  editorHost,
  {
    onDocChanged(doc) {
      void reading.render(doc);
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
void reading.render(SAMPLE);
