import { describe, expect, it } from "vitest";
import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import { markdownMarkerPair, wrapSelection } from "./autoPair";

function stateFor(doc: string, anchor: number, head?: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head ?? anchor),
  });
}

function apply(
  state: EditorState,
  spec: TransactionSpec | null,
): { doc: string; from: number; to: number } {
  expect(spec).not.toBeNull();
  const next = state.update(spec ?? {});
  return {
    doc: next.newDoc.toString(),
    from: next.newSelection.main.from,
    to: next.newSelection.main.to,
  };
}

describe("wrapSelection", () => {
  it("wraps the selection with the bracket pair and keeps it selected", () => {
    const state = stateFor("hola món", 0, 4);
    const result = apply(state, wrapSelection(state, "("));
    expect(result.doc).toBe("(hola) món");
    expect([result.from, result.to]).toEqual([1, 5]);
  });

  it("doubles identical markers on a second press", () => {
    const first = stateFor("text", 0, 4);
    const once = wrapSelection(first, "=");
    const mid = first.update(once ?? {}).state;
    expect(mid.doc.toString()).toBe("=text=");
    const twice = apply(mid, wrapSelection(mid, "="));
    expect(twice.doc).toBe("==text==");
    expect([twice.from, twice.to]).toEqual([2, 6]);
  });

  it("wraps with $ and square brackets", () => {
    const state = stateFor("x+y", 0, 3);
    expect(apply(state, wrapSelection(state, "$")).doc).toBe("$x+y$");
    const other = stateFor("nota", 0, 4);
    expect(apply(other, wrapSelection(other, "[")).doc).toBe("[nota]");
  });

  it("returns null without a selection or for non-wrapping chars", () => {
    expect(wrapSelection(stateFor("abc", 1), "(")).toBeNull();
    const selected = stateFor("abc", 0, 2);
    expect(wrapSelection(selected, "a")).toBeNull();
  });
});

describe("markdownMarkerPair", () => {
  it("pairs on the first keystroke", () => {
    const state = stateFor("a ", 2);
    const result = apply(state, markdownMarkerPair(state, "*"));
    expect(result.doc).toBe("a **");
    expect(result.from).toBe(3);
  });

  it("grows an empty pair from inside", () => {
    // "*|*" typing * becomes "**|**".
    const state = stateFor("**", 1);
    const result = apply(state, markdownMarkerPair(state, "*"));
    expect(result.doc).toBe("****");
    expect(result.from).toBe(2);
  });

  it("pairs a different marker inside an empty pair", () => {
    // "**|**" typing _ becomes "**_|_**".
    const state = stateFor("****", 2);
    const result = apply(state, markdownMarkerPair(state, "_"));
    expect(result.doc).toBe("**__**");
    expect(result.from).toBe(3);
  });

  it("skips over the closing twin instead of inserting", () => {
    const state = stateFor("*bold*", 5);
    const result = apply(state, markdownMarkerPair(state, "*"));
    expect(result.doc).toBe("*bold*");
    expect(result.from).toBe(6);
  });

  it("never pairs touching letters or digits", () => {
    const afterWord = stateFor("var", 3);
    expect(markdownMarkerPair(afterWord, "_")).toBeNull();
    const beforeWord = stateFor(" nom", 1);
    expect(markdownMarkerPair(beforeWord, "_")).toBeNull();
    const price = stateFor("cost 10", 7);
    expect(markdownMarkerPair(price, "$")).toBeNull();
  });

  it("does not pair when the marker closes an open run on the line", () => {
    const state = stateFor("*cursiva ", 9);
    expect(markdownMarkerPair(state, "*")).toBeNull();
  });

  it("pairs again after a balanced run on the same line", () => {
    const state = stateFor("**a** ", 6);
    const result = apply(state, markdownMarkerPair(state, "*"));
    expect(result.doc).toBe("**a** **");
    expect(result.from).toBe(7);
  });

  it("ignores other chars and non-empty selections", () => {
    expect(markdownMarkerPair(stateFor("a(", 2), "(")).toBeNull();
    const selected = stateFor("a*b", 0, 3);
    expect(markdownMarkerPair(selected, "*")).toBeNull();
  });
});
