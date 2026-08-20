import { describe, expect, it } from "vitest";
import {
  codeFolding,
  ensureSyntaxTree,
  foldEffect,
  unfoldEffect,
} from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { markdownExtensions } from "../markdown/parser";
import {
  foldRangeForLine,
  foldToggleAction,
  headingSectionRange,
} from "./folding";

function stateFor(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: markdownExtensions }),
    ],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return state;
}

describe("headingSectionRange", () => {
  it("folds a section up to the next heading of the same level", () => {
    const doc = "# A\ntext\nmore\n# B\nx";
    const state = stateFor(doc);
    expect(headingSectionRange(state, 0)).toEqual({ from: 3, to: 13 });
  });

  it("includes deeper subsections in the fold", () => {
    const doc = "# A\ntext\n## Sub\nsx\n# B\ny";
    const state = stateFor(doc);
    // "# A" swallows "## Sub" and its body, stops before "# B".
    expect(headingSectionRange(state, 0)).toEqual({ from: 3, to: 18 });
    // "## Sub" (line at 9) folds its own body only.
    expect(headingSectionRange(state, 9)).toEqual({ from: 15, to: 18 });
  });

  it("runs to the end of the document without a next heading", () => {
    const doc = "# A\ntext\nfinal";
    const state = stateFor(doc);
    expect(headingSectionRange(state, 0)).toEqual({
      from: 3,
      to: doc.length,
    });
  });

  it("folds setext headings from after the underline", () => {
    const doc = "Títol\n---\ntext";
    const state = stateFor(doc);
    expect(headingSectionRange(state, 0)).toEqual({ from: 9, to: 14 });
  });

  it("returns null on non-heading lines and empty sections", () => {
    const doc = "# A\n# B\ntext";
    const state = stateFor(doc);
    // "# A" has nothing before "# B".
    expect(headingSectionRange(state, 0)).toBeNull();
    // "text" line (from 8) holds no heading.
    expect(headingSectionRange(state, 8)).toBeNull();
  });
});

describe("foldRangeForLine", () => {
  it("folds list items that contain nested lists", () => {
    const state = stateFor("- a\n  - b\n- c");
    expect(foldRangeForLine(state, 0)).toEqual({ from: 3, to: 9 });
    // "  - b" (line at 4) and "- c" (line at 10) have no children.
    expect(foldRangeForLine(state, 4)).toBeNull();
    expect(foldRangeForLine(state, 10)).toBeNull();
  });

  it("never folds paragraphs, code blocks or blockquotes", () => {
    expect(foldRangeForLine(stateFor("una\ndues"), 0)).toBeNull();
    expect(foldRangeForLine(stateFor("```js\nx\n```"), 0)).toBeNull();
    expect(foldRangeForLine(stateFor("> a\n> b"), 0)).toBeNull();
  });
});

describe("foldToggleAction — the toggle-all decision (m37)", () => {
  function foldableState(doc: string): EditorState {
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: markdownExtensions }),
        codeFolding(),
      ],
    });
    ensureSyntaxTree(state, doc.length, 5000);
    return state;
  }

  const doc = "# A\ntext\n# B\nmore";

  it("folds when nothing is folded", () => {
    expect(foldToggleAction(foldableState(doc))).toBe("fold");
  });

  it("unfolds when any fold is active", () => {
    const state = foldableState(doc);
    const range = headingSectionRange(state, 0);
    expect(range).not.toBeNull();
    const folded = state.update({
      effects: foldEffect.of(range as { from: number; to: number }),
    }).state;
    expect(foldToggleAction(folded)).toBe("unfold");
  });

  it("folds again once every fold is lifted", () => {
    const state = foldableState(doc);
    const range = headingSectionRange(state, 0) as {
      from: number;
      to: number;
    };
    const folded = state.update({ effects: foldEffect.of(range) }).state;
    const unfolded = folded.update({
      effects: unfoldEffect.of(range),
    }).state;
    expect(foldToggleAction(unfolded)).toBe("fold");
  });

  it("folds an empty document (harmless no-op downstream)", () => {
    expect(foldToggleAction(foldableState(""))).toBe("fold");
  });
});
