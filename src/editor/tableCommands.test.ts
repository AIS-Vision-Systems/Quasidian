import { describe, expect, it } from "vitest";
import {
  applyTableOp,
  emptyTable,
  parseTableSource,
  serializeTable,
  type TableOp,
} from "./tableCommands";

const SOURCE = "| a | b |\n| --- | ---: |\n| c | d |\n| e | f |";

function edited(op: TableOp): string {
  const data = parseTableSource(SOURCE);
  expect(data).not.toBeNull();
  const next = applyTableOp(data!, op);
  expect(next).not.toBeNull();
  return serializeTable(next!);
}

describe("parseTableSource and serializeTable", () => {
  it("round-trips a normalized table with alignments", () => {
    const data = parseTableSource(SOURCE);
    expect(data?.rows[0]).toEqual(["a", "b"]);
    expect(data?.alignments).toEqual([null, "right"]);
    expect(serializeTable(data!)).toBe(SOURCE);
  });

  it("builds the empty skeleton", () => {
    expect(emptyTable()).toBe("|   |   |\n| --- | --- |\n|   |   |");
  });
});

describe("applyTableOp", () => {
  it("adds, duplicates, deletes and moves rows (never the header)", () => {
    expect(edited({ kind: "addRow", row: 2, side: "below" })).toBe(
      "| a | b |\n| --- | ---: |\n| c | d |\n|   |   |\n| e | f |",
    );
    expect(edited({ kind: "duplicateRow", row: 2 })).toBe(
      "| a | b |\n| --- | ---: |\n| c | d |\n| c | d |\n| e | f |",
    );
    expect(edited({ kind: "deleteRow", row: 2 })).toBe(
      "| a | b |\n| --- | ---: |\n| e | f |",
    );
    expect(edited({ kind: "moveRow", row: 2, delta: 1 })).toBe(
      "| a | b |\n| --- | ---: |\n| e | f |\n| c | d |",
    );
    const data = parseTableSource(SOURCE);
    expect(applyTableOp(data!, { kind: "deleteRow", row: 0 })).toBeNull();
  });

  it("adds, duplicates, deletes and moves columns with alignments", () => {
    expect(edited({ kind: "addColumn", column: 0, side: "left" })).toBe(
      "|   | a | b |\n| --- | --- | ---: |\n|   | c | d |\n|   | e | f |",
    );
    expect(edited({ kind: "duplicateColumn", column: 1 })).toBe(
      "| a | b | b |\n| --- | ---: | ---: |\n| c | d | d |\n| e | f | f |",
    );
    expect(edited({ kind: "deleteColumn", column: 0 })).toBe(
      "| b |\n| ---: |\n| d |\n| f |",
    );
    expect(edited({ kind: "moveColumn", column: 0, delta: 1 })).toBe(
      "| b | a |\n| ---: | --- |\n| d | c |\n| f | e |",
    );
  });

  it("sets alignments", () => {
    expect(edited({ kind: "setAlignment", column: 0, alignment: "center" })).toBe(
      "| a | b |\n| :---: | ---: |\n| c | d |\n| e | f |",
    );
  });

  it("sorts body rows by a column, ascending and descending", () => {
    const source = "| n |\n| --- |\n| b2 |\n| a10 |\n| a2 |";
    const data = parseTableSource(source)!;
    const asc = applyTableOp(data, {
      kind: "sort",
      column: 0,
      ascending: true,
    })!;
    expect(serializeTable(asc)).toBe(
      "| n |\n| --- |\n| a2 |\n| a10 |\n| b2 |",
    );
    const desc = applyTableOp(data, {
      kind: "sort",
      column: 0,
      ascending: false,
    })!;
    expect(serializeTable(desc)).toBe(
      "| n |\n| --- |\n| b2 |\n| a10 |\n| a2 |",
    );
  });
});
