import { describe, expect, it } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { markdownExtensions } from "../markdown/parser";
import { headingSectionRange } from "./folding";

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
