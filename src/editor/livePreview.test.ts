import { describe, expect, it } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdownExtensions } from "../markdown/parser";
import {
  computeHeadingLines,
  computeHiddenRanges,
  computeHorizontalRules,
  computeImageEmbeds,
  computeListIndents,
  computeListMarks,
  computeMathRanges,
  computeNoteEmbeds,
  computeTaskMarkers,
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

  it("computes hanging indents for bullet, nested and ordered items", () => {
    const doc = "- poma\n  - nena\n1. tres";
    const state = stateFor(doc, doc.length);
    expect(computeListIndents(state, 0, doc.length)).toEqual([
      { from: 0, width: 2 },
      { from: 7, width: 4 },
      { from: 16, width: 3 },
    ]);
  });

  it("extends the hanging indent over task markers", () => {
    const doc = "- [ ] fer";
    const state = stateFor(doc, doc.length);
    expect(computeListIndents(state, 0, doc.length)).toEqual([
      { from: 0, width: 6 },
    ]);
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
    // Cursor right after the first "- ": that mark stays raw.
    const state = stateFor(doc, 2);
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
