import { describe, expect, it } from "vitest";
import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import { markdownDoublePair, wrapSelection } from "./autoPair";

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

describe("markdownDoublePair", () => {
  it("closes the double when the second marker is typed", () => {
    const state = stateFor("a*", 2);
    const result = apply(state, markdownDoublePair(state, "*"));
    expect(result.doc).toBe("a****");
    expect(result.from).toBe(3);
  });

  it("pairs ==, ~~ and $$ the same way", () => {
    const state = stateFor("=", 1);
    const result = apply(state, markdownDoublePair(state, "="));
    expect(result.doc).toBe("====");
    expect(result.from).toBe(2);
  });

  it("never grows triples", () => {
    const state = stateFor("a**", 3);
    expect(markdownDoublePair(state, "*")).toBeNull();
  });

  it("does not pair when the double closes an open marker", () => {
    const state = stateFor("**bold*", 7);
    expect(markdownDoublePair(state, "*")).toBeNull();
  });

  it("pairs again after a balanced pair on the same line", () => {
    const state = stateFor("**a** b*", 8);
    const result = apply(state, markdownDoublePair(state, "*"));
    expect(result.doc).toBe("**a** b****");
  });

  it("skips over the closing double instead of inserting", () => {
    // "**|**": typing * moves the cursor over the first closing char.
    const state = stateFor("****", 2);
    const result = apply(state, markdownDoublePair(state, "*"));
    expect(result.doc).toBe("****");
    expect(result.from).toBe(3);
  });

  it("ignores other chars and non-empty selections", () => {
    expect(markdownDoublePair(stateFor("a(", 2), "(")).toBeNull();
    const selected = stateFor("a*b", 0, 3);
    expect(markdownDoublePair(selected, "*")).toBeNull();
  });
});
