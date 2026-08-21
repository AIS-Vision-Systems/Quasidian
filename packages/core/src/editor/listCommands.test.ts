import { describe, expect, it } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  EditorSelection,
  EditorState,
  type ChangeSpec,
} from "@codemirror/state";
import { markdownExtensions } from "../markdown/parser";
import {
  computeEmptyListItemExit,
  computeListIndent,
  computeListOutdent,
  computeRenumberChanges,
} from "./listCommands";

function stateFor(doc: string, anchor: number): EditorState {
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

/** Applies the computed changes and returns the resulting document. */
function applied(state: EditorState, changes: ChangeSpec[] | null): string {
  expect(changes).not.toBeNull();
  return state.update({ changes: changes ?? [] }).newDoc.toString();
}

describe("computeListIndent", () => {
  it("indents a bullet item under the previous one", () => {
    const state = stateFor("- a\n- b", 6);
    expect(applied(state, computeListIndent(state))).toBe("- a\n  - b");
  });

  it("reaches the previous item's content column for ordered items", () => {
    // "1. " needs 3 spaces of indent to nest, and the sublist restarts
    // at 1 while the outer list renumbers.
    const state = stateFor("1. a\n2. b\n3. c", 7);
    expect(applied(state, computeListIndent(state))).toBe(
      "1. a\n   1. b\n2. c",
    );
  });

  it("returns null outside a list and on a first item", () => {
    const plain = stateFor("text pla", 4);
    expect(computeListIndent(plain)).toBeNull();
    const first = stateFor("- a\n- b", 2);
    expect(computeListIndent(first)).toBeNull();
  });
});

describe("computeListOutdent", () => {
  it("outdents a nested item and renumbers both lists", () => {
    const state = stateFor("1. a\n   1. b\n2. c", 10);
    expect(applied(state, computeListOutdent(state))).toBe(
      "1. a\n2. b\n3. c",
    );
  });

  it("returns null on a top-level item", () => {
    const state = stateFor("- a\n- b", 6);
    expect(computeListOutdent(state)).toBeNull();
  });
});

describe("computeEmptyListItemExit", () => {
  it("outdents an empty nested item", () => {
    const doc = "- a\n  - ";
    const state = stateFor(doc, doc.length);
    expect(applied(state, computeEmptyListItemExit(state))).toBe("- a\n- ");
  });

  it("clears the marker of an empty top-level item", () => {
    const doc = "- a\n- ";
    const state = stateFor(doc, doc.length);
    expect(applied(state, computeEmptyListItemExit(state))).toBe("- a\n");
  });

  it("renumbers the survivors when an ordered item exits", () => {
    // The blank line keeps a single (loose) list, so "3." becomes "2.".
    const state = stateFor("1. a\n2. \n3. c", 8);
    expect(applied(state, computeEmptyListItemExit(state))).toBe(
      "1. a\n\n2. c",
    );
  });

  it("returns null on a non-empty item, clears a fresh empty marker", () => {
    const list = stateFor("- a\n- b", 7);
    expect(computeEmptyListItemExit(list)).toBeNull();
    // "- " under a paragraph is already an empty item (listInterrupt):
    // Enter clears the marker back to plain text.
    const plain = stateFor("text\n- ", 7);
    expect(applied(plain, computeEmptyListItemExit(plain))).toBe("text\n");
  });
});

describe("computeRenumberChanges", () => {
  it("normalizes each ordered list to 1..n, keeping the delimiter", () => {
    // The delimiter switch starts a second list; both restart at 1.
    expect(computeRenumberChanges("3. a\n5) b\n\ntext")).toEqual([
      { from: 0, to: 2, insert: "1." },
      { from: 5, to: 7, insert: "1)" },
    ]);
  });

  it("produces no changes for already sequential lists", () => {
    expect(computeRenumberChanges("1. a\n2. b")).toEqual([]);
  });
});
