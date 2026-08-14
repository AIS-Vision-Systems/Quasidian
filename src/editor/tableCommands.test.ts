import { describe, expect, it } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdownExtensions } from "../markdown/parser";
import { computeTableEdit, inTable, type TableOp } from "./tableCommands";

const DOC = "| a | b |\n| --- | --- |\n| c | d |\n| e | f |";

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

function edited(doc: string, anchor: number, op: TableOp): string {
  const state = stateFor(doc, anchor);
  const edit = computeTableEdit(state, op);
  expect(edit).not.toBeNull();
  return state.update({ changes: edit?.changes }).newDoc.toString();
}

describe("computeTableEdit", () => {
  it("detects tables and rejects plain text", () => {
    expect(inTable(stateFor(DOC, 3), 3)).toBe(true);
    const plain = stateFor("text pla", 3);
    expect(inTable(plain, 3)).toBe(false);
    expect(computeTableEdit(plain, { kind: "addRow" })).toBeNull();
  });

  it("adds a row below the cursor's row", () => {
    // Cursor in "c" (row 2): the new row lands between c/d and e/f.
    expect(edited(DOC, 24, { kind: "addRow" })).toBe(
      "| a | b |\n| --- | --- |\n| c | d |\n|   |   |\n| e | f |",
    );
  });

  it("deletes and moves body rows, never the header", () => {
    expect(edited(DOC, 24, { kind: "deleteRow" })).toBe(
      "| a | b |\n| --- | --- |\n| e | f |",
    );
    expect(edited(DOC, 24, { kind: "moveRow", delta: 1 })).toBe(
      "| a | b |\n| --- | --- |\n| e | f |\n| c | d |",
    );
    const header = stateFor(DOC, 2);
    expect(computeTableEdit(header, { kind: "deleteRow" })).toBeNull();
  });

  it("adds, deletes and moves columns everywhere", () => {
    expect(edited(DOC, 2, { kind: "addColumn" })).toBe(
      "| a |   | b |\n| --- | --- | --- |\n| c |   | d |\n| e |   | f |",
    );
    expect(edited(DOC, 2, { kind: "deleteColumn" })).toBe(
      "| b |\n| --- |\n| d |\n| f |",
    );
    expect(edited(DOC, 2, { kind: "moveColumn", delta: 1 })).toBe(
      "| b | a |\n| --- | --- |\n| d | c |\n| f | e |",
    );
  });

  it("sets the column alignment in the delimiter row", () => {
    expect(edited(DOC, 2, { kind: "setAlignment", alignment: "center" })).toBe(
      "| a | b |\n| :---: | --- |\n| c | d |\n| e | f |",
    );
    expect(edited(DOC, 6, { kind: "setAlignment", alignment: "right" })).toBe(
      "| a | b |\n| --- | ---: |\n| c | d |\n| e | f |",
    );
  });

  it("navigates cells with Tab, appending a row at the end", () => {
    // Cursor in "a": next cell selects "b".
    const state = stateFor(DOC, 2);
    const edit = computeTableEdit(state, { kind: "nextCell" });
    expect(edit).not.toBeNull();
    // Doc unchanged, cursor after "b".
    expect(state.update({ changes: edit?.changes }).newDoc.toString()).toBe(
      DOC,
    );
    expect(edit?.selection.anchor).toBe(7);
    // From the very last cell ("f"), Tab appends an empty row.
    const last = stateFor(DOC, 40);
    const grown = computeTableEdit(last, { kind: "nextCell" });
    expect(
      last.update({ changes: grown?.changes }).newDoc.toString(),
    ).toBe(DOC + "\n|   |   |");
  });
});
