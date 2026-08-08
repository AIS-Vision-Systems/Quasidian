import { describe, expect, it } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { wikilinks } from "../markdown/wikilinks";
import {
  computeHiddenRanges,
  computeImageEmbeds,
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
    extensions: [markdown({ base: markdownLanguage, extensions: [wikilinks] })],
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
      extensions: [markdown({ base: markdownLanguage, extensions: [wikilinks] })],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    return state;
  }

  it("collects image embeds only when the selection is outside", () => {
    const doc = "![[img.png]] x";
    const outside = stateFor(doc, doc.length);
    expect(computeImageEmbeds(outside, 0, doc.length)).toEqual([
      { from: 0, to: 12, target: "img.png" },
    ]);
    const inside = stateFor(doc, 5);
    expect(computeImageEmbeds(inside, 0, doc.length)).toEqual([]);
  });

  it("ignores non-image embeds (handled as links)", () => {
    const doc = "![[nota]] x";
    const state = stateFor(doc, doc.length);
    expect(computeImageEmbeds(state, 0, doc.length)).toEqual([]);
    // Their marks hide like a wikilink instead.
    expect(computeHiddenRanges(state, 0, doc.length)).toEqual([
      { from: 0, to: 3 },
      { from: 7, to: 9 },
    ]);
  });

  it("collects task markers only on inactive lines", () => {
    const doc = "- [ ] fer\n- [x] fet";
    // Cursor on the first line: only the second marker becomes a widget.
    const state = stateFor(doc, 3);
    expect(computeTaskMarkers(state, 0, doc.length)).toEqual([
      { pos: 12, checked: true },
    ]);
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
