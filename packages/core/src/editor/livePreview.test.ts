import { describe, expect, it } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdownExtensions } from "../markdown/parser";
import {
  bumpEmbedGeneration,
  clearEmbedHtmlCache,
  computeDoneTaskLines,
  computeHeadingLines,
  computeHiddenRanges,
  computeHorizontalRules,
  computeImageEmbeds,
  computeListLines,
  computeListMarks,
  computeMathRanges,
  computeNoteEmbeds,
  computeTaskMarkers,
  buildBlockDecorations,
  estimatedImageHeight,
  getEmbedHtml,
  setEmbedHtml,
  sourceMode,
  tableBlankGuard,
  type HiddenRange,
} from "./livePreview";

function hiddenRanges(
  doc: string,
  anchor: number,
  head: number = anchor,
): HiddenRange[] {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [
      markdown({ base: markdownLanguage, extensions: markdownExtensions }),
    ],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return computeHiddenRanges(state, 0, doc.length);
}

describe("computeHiddenRanges — bold", () => {
  const doc = "**bold** tail";

  it("hides the ** marks when the cursor is outside the range", () => {
    expect(hiddenRanges(doc, doc.length)).toEqual([
      { from: 0, to: 2 },
      { from: 6, to: 8 },
    ]);
  });

  it("reveals the marks when the cursor is inside the range", () => {
    expect(hiddenRanges(doc, 4)).toEqual([]);
  });

  it("reveals the marks when the cursor touches the range boundary", () => {
    expect(hiddenRanges(doc, 8)).toEqual([]);
    expect(hiddenRanges(doc, 0)).toEqual([]);
  });

  it("hides the marks when the cursor is just past the boundary", () => {
    expect(hiddenRanges(doc, 9)).toHaveLength(2);
  });

  it("reveals the marks when a selection partially overlaps the range", () => {
    expect(hiddenRanges(doc, 7, 11)).toEqual([]);
  });
});

describe("computeHiddenRanges — italic, inline code, strikethrough", () => {
  it("hides * marks of italic when outside", () => {
    expect(hiddenRanges("*i* x", 5)).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
    expect(hiddenRanges("*i* x", 1)).toEqual([]);
  });

  it("hides ` marks of inline code when outside", () => {
    expect(hiddenRanges("`c` x", 5)).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
    expect(hiddenRanges("`c` x", 1)).toEqual([]);
  });

  it("hides ~~ marks of strikethrough when outside", () => {
    expect(hiddenRanges("~~s~~ x", 7)).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
    ]);
    expect(hiddenRanges("~~s~~ x", 3)).toEqual([]);
  });

  it("hides footnote marks when outside, reveals inside the ref", () => {
    const doc = "a [^1] b";
    expect(hiddenRanges(doc, doc.length)).toEqual([
      { from: 2, to: 4 },
      { from: 5, to: 6 },
    ]);
    expect(hiddenRanges(doc, 3)).toEqual([]);
  });

  it("hides == marks of highlights when outside", () => {
    expect(hiddenRanges("==h== x", 7)).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
    ]);
    expect(hiddenRanges("==h== x", 3)).toEqual([]);
  });
});

describe("computeHiddenRanges — setext headings", () => {
  it("hides the underline when the selection is outside the heading", () => {
    const doc = "Títol\n===\n\ntext";
    expect(hiddenRanges(doc, doc.length)).toEqual([{ from: 6, to: 9 }]);
  });

  it("reveals the underline when the selection is in the heading", () => {
    const doc = "Títol\n===\n\ntext";
    expect(hiddenRanges(doc, 2)).toEqual([]);
    expect(hiddenRanges(doc, 7)).toEqual([]);
  });

  it("hides a 3-dash underline like the = one", () => {
    const doc = "Títol\n---\n\ntext";
    expect(hiddenRanges(doc, doc.length)).toEqual([{ from: 6, to: 9 }]);
  });

  it("treats a short dash line as plain paragraph text", () => {
    // Typing "- " to start a list must not decorate the previous line.
    expect(hiddenRanges("Text\n- ", 0)).toEqual([]);
    expect(hiddenRanges("Text\n--", 0)).toEqual([]);
  });
});

describe("computeHiddenRanges — headings", () => {
  const doc = "# Title\ntext";

  it("hides the # and its following space when the line is not active", () => {
    expect(hiddenRanges(doc, 10)).toEqual([{ from: 0, to: 2 }]);
  });

  it("reveals the # when the cursor is anywhere on the heading line", () => {
    expect(hiddenRanges(doc, 5)).toEqual([]);
    expect(hiddenRanges(doc, 0)).toEqual([]);
  });

  it("handles deeper heading levels", () => {
    expect(hiddenRanges("### Deep\ntext", 10)).toEqual([{ from: 0, to: 4 }]);
  });
});

describe("computeHiddenRanges — blockquotes", () => {
  const doc = "> quote\nnext";

  it("hides the > and its following space when the line is not active", () => {
    expect(hiddenRanges(doc, 9)).toEqual([{ from: 0, to: 2 }]);
  });

  it("reveals the > when the cursor is on the quote line", () => {
    expect(hiddenRanges(doc, 3)).toEqual([]);
  });

  it("handles each quote line independently", () => {
    const multi = "> one\n> two";
    // Cursor on the second quote line: only the first line's mark hides.
    expect(hiddenRanges(multi, 8)).toEqual([{ from: 0, to: 2 }]);
  });

  it("hides continuation-line quote marks nested in the paragraph", () => {
    // "b" is a lazy continuation; the marks on lines 1 and 3 hang from
    // different parents but must both hide.
    const doc = "> a\nb\n> c\n\nx";
    expect(hiddenRanges(doc, doc.length)).toEqual([
      { from: 0, to: 2 },
      { from: 6, to: 8 },
    ]);
  });
});

describe("computeHiddenRanges — wikilinks", () => {
  it("hides only the [[ ]] marks of a plain wikilink when outside", () => {
    // "[[nota]] x" — path stays visible.
    expect(hiddenRanges("[[nota]] x", 10)).toEqual([
      { from: 0, to: 2 },
      { from: 6, to: 8 },
    ]);
  });

  it("reveals the marks when the cursor touches the wikilink", () => {
    expect(hiddenRanges("[[nota]] x", 4)).toEqual([]);
    expect(hiddenRanges("[[nota]] x", 0)).toEqual([]);
    expect(hiddenRanges("[[nota]] x", 8)).toEqual([]);
  });

  it("hides marks, path and pipe of an aliased wikilink when outside", () => {
    // "[[nota|àlies]] x" — only the alias stays visible.
    expect(hiddenRanges("[[nota|àlies]] x", 16)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 6 },
      { from: 6, to: 7 },
      { from: 12, to: 14 },
    ]);
  });

  it("reveals everything of an aliased wikilink when inside", () => {
    expect(hiddenRanges("[[nota|àlies]] x", 9)).toEqual([]);
  });
});

describe("computeHiddenRanges — markdown links", () => {
  const doc = "see [Spec](docs/SPEC.md) end";

  it("hides brackets and URL when outside: only the label shows", () => {
    expect(hiddenRanges(doc, doc.length)).toEqual([
      { from: 4, to: 5 },
      { from: 9, to: 10 },
      { from: 10, to: 11 },
      { from: 11, to: 23 },
      { from: 23, to: 24 },
    ]);
  });

  it("reveals the raw syntax when the selection touches the link", () => {
    expect(hiddenRanges(doc, 7)).toEqual([]);
    expect(hiddenRanges(doc, 4)).toEqual([]);
    expect(hiddenRanges(doc, 24)).toEqual([]);
  });
});

describe("computeImageEmbeds and computeTaskMarkers", () => {
  function stateFor(doc: string, anchor: number) {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.single(anchor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: markdownExtensions }),
      ],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    return state;
  }

  it("collects image embeds only when the selection is outside", () => {
    const doc = "![[img.png]] x";
    const outside = stateFor(doc, doc.length);
    expect(computeImageEmbeds(outside, 0, doc.length)).toEqual([
      { from: 0, to: 12, target: "img.png", alias: null },
    ]);
    const inside = stateFor(doc, 5);
    expect(computeImageEmbeds(inside, 0, doc.length)).toEqual([]);
  });

  it("carries the alias for image sizing", () => {
    const doc = "![[img.png|50]] x";
    const state = stateFor(doc, doc.length);
    expect(computeImageEmbeds(state, 0, doc.length)).toEqual([
      { from: 0, to: 15, target: "img.png", alias: "50" },
    ]);
  });

  it("collects non-image embeds for transclusion widgets", () => {
    const doc = "![[nota]] x";
    const state = stateFor(doc, doc.length);
    expect(computeImageEmbeds(state, 0, doc.length)).toEqual([]);
    expect(computeNoteEmbeds(state, 0, doc.length)).toEqual([
      { from: 0, to: 9, target: "nota", alias: null },
    ]);
    // The whole embed is widget-replaced, so nothing is mark-hidden.
    expect(computeHiddenRanges(state, 0, doc.length)).toEqual([]);
  });

  it("collects task markers except when the selection touches the marker", () => {
    const doc = "- [ ] fer\n- [x] fet";
    // Cursor inside the first "- [ ]": only the second becomes a widget.
    const state = stateFor(doc, 3);
    expect(computeTaskMarkers(state, 0, doc.length)).toEqual([
      { pos: 12, checked: true },
    ]);
  });

  it("keeps task widgets while the cursor is in the task text", () => {
    const doc = "- [ ] fer\n- [x] fet";
    const state = stateFor(doc, 8);
    expect(computeTaskMarkers(state, 0, doc.length)).toEqual([
      { pos: 2, checked: false },
      { pos: 12, checked: true },
    ]);
  });

  it("collects list marks: bullets for items, hidden marks for tasks", () => {
    const doc = "- poma\n- [ ] fer\n1. tres";
    const state = stateFor(doc, doc.length);
    expect(computeListMarks(state, 0, doc.length)).toEqual([
      { from: 0, to: 2, kind: "bullet" },
      { from: 7, to: 9, kind: "task" },
    ]);
  });

  it("shows the bullet as soon as the marker's space is typed", () => {
    const doc = "- ";
    expect(computeListMarks(stateFor(doc, 2), 0, doc.length)).toEqual([
      { from: 0, to: 2, kind: "bullet" },
    ]);
    // The cursor on the dash itself still reveals the raw marker.
    expect(computeListMarks(stateFor(doc, 1), 0, doc.length)).toEqual([]);
  });

  it("decorates ordered lists that interrupt a paragraph", () => {
    const doc = "text\n3. un";
    const state = stateFor(doc, 0);
    expect(computeListLines(state, 0, doc.length)).toHaveLength(1);
  });

  it("ignores hidden quote marks in list columns inside callouts", () => {
    const doc = "> [!note] T\n> - a\n> - b";
    const state = stateFor(doc, 0);
    const lines = computeListLines(state, 6 + 6, doc.length);
    // Same hanging indent as a top-level "- " item: the invisible "> "
    // prefix must not widen the column.
    expect(lines.every((line) => line.width === 2)).toBe(true);
    expect(lines.every((line) => line.leading === null)).toBe(true);
  });

  it("computes list lines: hanging indent, guides and fixed leading", () => {
    const doc = "- poma\n  - nena\n1. tres";
    const state = stateFor(doc, doc.length);
    expect(computeListLines(state, 0, doc.length)).toEqual([
      { from: 0, width: 2, guides: [], leading: null, marker: null },
      {
        from: 7,
        width: 6,
        guides: [2],
        leading: { from: 7, to: 9, width: 4 },
        marker: null,
      },
      {
        from: 16,
        width: 3,
        guides: [],
        leading: null,
        marker: { from: 16, to: 19, width: 3 },
      },
    ]);
  });

  it("extends the hanging indent over task markers", () => {
    const doc = "- [ ] fer";
    const state = stateFor(doc, doc.length);
    expect(computeListLines(state, 0, doc.length)).toEqual([
      { from: 0, width: 6, guides: [], leading: null, marker: null },
    ]);
  });

  it("stacks one guide per ancestor level", () => {
    const doc = "- a\n  - b\n    - c";
    const state = stateFor(doc, doc.length);
    const third = computeListLines(state, 0, doc.length).find(
      (info) => info.from === 10,
    );
    expect(third).toEqual({
      from: 10,
      width: 10,
      guides: [2, 6],
      leading: { from: 10, to: 14, width: 8 },
      marker: null,
    });
  });

  it("collects the lines of checked tasks", () => {
    const doc = "- [ ] fer\n- [x] fet";
    const state = stateFor(doc, doc.length);
    expect(computeDoneTaskLines(state, 0, doc.length)).toEqual([10]);
  });

  it("collects heading lines with their level, for both syntaxes", () => {
    const doc = "# A\ntext\n### B\nTítol\n---";
    const state = stateFor(doc, doc.length);
    expect(computeHeadingLines(state, 0, doc.length)).toEqual([
      { from: 0, level: 1 },
      { from: 9, level: 3 },
      { from: 15, level: 2 },
    ]);
  });

  it("collects math ranges only when the selection is outside", () => {
    const doc = "val $x+y$ i $$a$$";
    const outside = stateFor(doc, 0);
    expect(computeMathRanges(outside, 0, doc.length)).toEqual([
      { from: 4, to: 9, tex: "x+y", display: false },
      { from: 12, to: 17, tex: "a", display: true },
    ]);
    const inside = stateFor(doc, 6);
    expect(computeMathRanges(inside, 0, doc.length)).toEqual([
      { from: 12, to: 17, tex: "a", display: true },
    ]);
  });

  it("collects multi-line math blocks with trimmed tex", () => {
    const doc = "$$\nx = 1\n$$\n\nfora";
    const state = stateFor(doc, doc.length);
    expect(computeMathRanges(state, 0, doc.length)).toEqual([
      { from: 0, to: 11, tex: "x = 1", display: true },
    ]);
  });

  it("collects horizontal rules on inactive lines only", () => {
    const doc = "x\n\n---\n\ny";
    const outside = stateFor(doc, doc.length);
    expect(computeHorizontalRules(outside, 0, doc.length)).toEqual([
      { from: 3, to: 6 },
    ]);
    const onLine = stateFor(doc, 4);
    expect(computeHorizontalRules(onLine, 0, doc.length)).toEqual([]);
  });

  it("keeps the raw mark only while the selection touches it", () => {
    const doc = "- poma\n- pera";
    // Cursor on the first dash: that mark stays raw. (Right after the
    // marker's space the bullet already renders — see the typing test.)
    const state = stateFor(doc, 1);
    expect(computeListMarks(state, 0, doc.length)).toEqual([
      { from: 7, to: 9, kind: "bullet" },
    ]);
    // Cursor in the item text, same line: the bullet stays rendered.
    const inText = stateFor(doc, 5);
    expect(computeListMarks(inText, 0, doc.length)).toEqual([
      { from: 0, to: 2, kind: "bullet" },
      { from: 7, to: 9, kind: "bullet" },
    ]);
  });

  it("skips everything inside an inactive table", () => {
    // Blank line before "fora": without it, GFM keeps absorbing rows.
    const doc = "| **a** | b |\n| --- | --- |\n| c | d |\n\nfora";
    const state = stateFor(doc, doc.length);
    // Bold marks inside the table are not hidden: the table widget
    // replaces the whole block.
    expect(computeHiddenRanges(state, 0, doc.length)).toEqual([]);
  });
});

describe("computeHiddenRanges — nesting and multiple selections", () => {
  it("hides both heading and nested bold marks when neither is active", () => {
    expect(hiddenRanges("# A **b**\nx", 11)).toEqual([
      { from: 0, to: 2 },
      { from: 4, to: 6 },
      { from: 7, to: 9 },
    ]);
  });

  it("hides nested bold marks while the heading line is active elsewhere", () => {
    // Cursor at the start of the heading line, outside the bold range.
    expect(hiddenRanges("# A **b**\nx", 2)).toEqual([
      { from: 4, to: 6 },
      { from: 7, to: 9 },
    ]);
  });

  it("any of multiple selection ranges reveals its element", () => {
    const doc = "**a** and **b**";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([
        EditorSelection.cursor(2),
        EditorSelection.cursor(12),
      ]),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        markdown({ base: markdownLanguage }),
      ],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    expect(computeHiddenRanges(state, 0, doc.length)).toEqual([]);
  });
});

describe("tableBlankGuard — the blank line after a table is protected", () => {
  const doc = "| a |\n| --- |\n| b |\n\n| c |\n| --- |\n| d |";

  function stateFor(docText: string) {
    const state = EditorState.create({
      doc: docText,
      extensions: [
        markdown({ base: markdownLanguage, extensions: markdownExtensions }),
        tableBlankGuard,
      ],
    });
    ensureSyntaxTree(state, docText.length, 5000);
    return state;
  }

  it("blocks deleting the newline right after a table", () => {
    const state = stateFor(doc);
    const tr = state.update({ changes: { from: 19, to: 20 } });
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("blocks merging the next table up into the blank line", () => {
    const state = stateFor(doc);
    const tr = state.update({ changes: { from: 20, to: 21 } });
    expect(tr.state.doc.toString()).toBe(doc);
  });

  it("pushes typed text down to a fresh line, keeping the guard blank", () => {
    const state = stateFor(doc);
    const tr = state.update({
      changes: { from: 20, to: 20, insert: "x" },
    });
    expect(tr.state.doc.toString()).toBe(
      `${doc.slice(0, 20)}\nx${doc.slice(20)}`,
    );
    expect(tr.state.selection.main.head).toBe(22);
  });

  it("still allows deleting a whole table together with its blank line", () => {
    const state = stateFor(doc);
    const tr = state.update({ changes: { from: 0, to: 21 } });
    expect(tr.state.doc.toString()).toBe(doc.slice(21));
  });
});

describe("estimatedImageHeight — pre-measure estimate of an embed image", () => {
  it("is unknown with no dimensions and no cached size", () => {
    expect(estimatedImageHeight(null, undefined)).toBe(-1);
    expect(estimatedImageHeight("a caption", undefined)).toBe(-1);
  });

  it("takes an explicit WxH height verbatim", () => {
    expect(estimatedImageHeight("300x200", undefined)).toBe(200);
    expect(estimatedImageHeight("300x200", { width: 600, height: 900 })).toBe(
      200,
    );
  });

  it("scales a width-only dimension by the cached aspect ratio", () => {
    expect(estimatedImageHeight("300", { width: 600, height: 900 })).toBe(450);
  });

  it("is unknown for a width-only dimension without a cached size", () => {
    expect(estimatedImageHeight("300", undefined)).toBe(-1);
  });

  it("uses the cached natural height when no dimensions are given", () => {
    expect(estimatedImageHeight(null, { width: 600, height: 900 })).toBe(900);
    expect(estimatedImageHeight("caption", { width: 600, height: 900 })).toBe(
      900,
    );
  });

  it("never divides by a zero cached width", () => {
    expect(estimatedImageHeight("300", { width: 0, height: 900 })).toBe(-1);
  });
});

describe("embed html cache — stale seeding across saves (m36)", () => {
  it("misses on an unknown target", () => {
    expect(getEmbedHtml("Missing", null)).toBeUndefined();
  });

  it("serves a fresh entry after set", () => {
    setEmbedHtml("NoteA", null, "<p>a</p>");
    expect(getEmbedHtml("NoteA", null)).toEqual({
      html: "<p>a</p>",
      fresh: true,
    });
  });

  it("keys entries by target and alias independently", () => {
    setEmbedHtml("NoteB", null, "<p>plain</p>");
    setEmbedHtml("NoteB", "alias", "<p>aliased</p>");
    expect(getEmbedHtml("NoteB", null)?.html).toBe("<p>plain</p>");
    expect(getEmbedHtml("NoteB", "alias")?.html).toBe("<p>aliased</p>");
  });

  it("keeps the html but marks it stale after clearEmbedHtmlCache", () => {
    setEmbedHtml("NoteC", null, "<p>c</p>");
    clearEmbedHtmlCache();
    expect(getEmbedHtml("NoteC", null)).toEqual({
      html: "<p>c</p>",
      fresh: false,
    });
  });

  it("turns fresh again once re-set after a clear", () => {
    setEmbedHtml("NoteD", null, "<p>old</p>");
    clearEmbedHtmlCache();
    setEmbedHtml("NoteD", null, "<p>new</p>");
    expect(getEmbedHtml("NoteD", null)).toEqual({
      html: "<p>new</p>",
      fresh: true,
    });
  });

  it("drops everything on bumpEmbedGeneration (settings changes)", () => {
    setEmbedHtml("NoteE", null, "<p>e</p>");
    bumpEmbedGeneration();
    expect(getEmbedHtml("NoteE", null)).toBeUndefined();
  });
});

describe("source mode (m38) — every token visible, no widgets", () => {
  function sourceState(
    doc: string,
    anchor: number = doc.length,
  ): EditorState {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.single(anchor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: markdownExtensions }),
        sourceMode.of(true),
      ],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    return state;
  }

  it("hides nothing, wherever the cursor is", () => {
    const doc = "# Head\n\n**bold** and [[Nota|alias]] and ==mark==\n";
    expect(computeHiddenRanges(sourceState(doc, 0), 0, doc.length)).toEqual(
      [],
    );
  });

  it("replaces no embeds, math, tasks, bullets or rules", () => {
    const doc = [
      "![[img.png]]",
      "![[Altra nota]]",
      "$x^2$",
      "- [ ] task",
      "- item",
      "---",
      "",
    ].join("\n");
    const state = sourceState(doc, 0);
    expect(computeImageEmbeds(state, 0, doc.length)).toEqual([]);
    expect(computeNoteEmbeds(state, 0, doc.length)).toEqual([]);
    expect(computeMathRanges(state, 0, doc.length)).toEqual([]);
    expect(computeTaskMarkers(state, 0, doc.length)).toEqual([]);
    expect(computeListMarks(state, 0, doc.length)).toEqual([]);
    expect(computeHorizontalRules(state, 0, doc.length)).toEqual([]);
  });

  it("keeps line styling: headings, list lines, done tasks", () => {
    const doc = "# Head\n\n- [x] done\n- item\n";
    const plain = (() => {
      const state = EditorState.create({
        doc,
        selection: EditorSelection.single(doc.length),
        extensions: [
          markdown({ base: markdownLanguage, extensions: markdownExtensions }),
        ],
      });
      ensureSyntaxTree(state, doc.length, 5000);
      return state;
    })();
    const source = sourceState(doc);
    expect(computeHeadingLines(source, 0, doc.length)).toEqual(
      computeHeadingLines(plain, 0, doc.length),
    );
    expect(computeListLines(source, 0, doc.length)).toEqual(
      computeListLines(plain, 0, doc.length),
    );
    expect(computeDoneTaskLines(source, 0, doc.length)).toEqual(
      computeDoneTaskLines(plain, 0, doc.length),
    );
  });

  it("emits no block widgets: frontmatter, tables and math stay raw", () => {
    const doc = [
      "---",
      "tags: [a]",
      "---",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "$$",
      "x^2",
      "$$",
      "",
    ].join("\n");
    const plain = EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: markdownExtensions }),
      ],
    });
    // The regular build replaces all three blocks…
    expect(buildBlockDecorations(plain).size).toBeGreaterThanOrEqual(3);
    // …and the source build replaces nothing at all.
    const source = EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: markdownExtensions }),
        sourceMode.of(true),
      ],
    });
    expect(buildBlockDecorations(source).size).toBe(0);
  });

  it("changes nothing when the facet is off (Live Preview intact)", () => {
    const doc = "**bold** tail";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.single(doc.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: markdownExtensions }),
      ],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    // The default facet value is off: the usual hides are still there.
    expect(
      computeHiddenRanges(state, 0, doc.length).length,
    ).toBeGreaterThan(0);
  });
});
