import { describe, expect, it } from "vitest";
import { createSearchIndex } from "./searchIndex";

describe("createSearchIndex", () => {
  it("finds matches case-insensitively with absolute offsets", () => {
    const index = createSearchIndex();
    index.setFile("C:\\n\\a.md", "Hola món\nadeu");
    const outcome = index.search("HOLA");
    expect(outcome.totalMatches).toBe(1);
    expect(outcome.results).toEqual([
      {
        path: "C:\\n\\a.md",
        matches: [
          {
            lineNumber: 1,
            lineText: "Hola món",
            from: 0,
            to: 4,
            colFrom: 0,
            colTo: 4,
          },
        ],
      },
    ]);
  });

  it("computes offsets across lines", () => {
    const index = createSearchIndex();
    index.setFile("a.md", "Hola món\nadeu");
    const outcome = index.search("adeu");
    expect(outcome.results[0].matches[0]).toEqual({
      lineNumber: 2,
      lineText: "adeu",
      from: 9,
      to: 13,
      colFrom: 0,
      colTo: 4,
    });
  });

  it("finds multiple non-overlapping matches per line", () => {
    const index = createSearchIndex();
    index.setFile("a.md", "la la la");
    const matches = index.search("la").results[0].matches;
    expect(matches.map((m) => m.from)).toEqual([0, 3, 6]);
  });

  it("sorts results by path", () => {
    const index = createSearchIndex();
    index.setFile("C:\\n\\b.md", "tema");
    index.setFile("C:\\n\\a.md", "tema");
    const outcome = index.search("tema");
    expect(outcome.results.map((r) => r.path)).toEqual([
      "C:\\n\\a.md",
      "C:\\n\\b.md",
    ]);
  });

  it("caps matches per file and flags truncation", () => {
    const index = createSearchIndex();
    index.setFile("a.md", Array(25).fill("x").join("\n"));
    const outcome = index.search("x");
    expect(outcome.results[0].matches).toHaveLength(20);
    expect(outcome.truncated).toBe(true);
  });

  it("caps total matches across files", () => {
    const index = createSearchIndex();
    // 15 files × 20 matches = 300 candidates; cap is 200.
    for (let i = 0; i < 15; i++) {
      index.setFile(`f${String(i).padStart(2, "0")}.md`, Array(20).fill("x").join("\n"));
    }
    const outcome = index.search("x");
    expect(outcome.totalMatches).toBe(200);
    expect(outcome.truncated).toBe(true);
  });

  it("returns nothing for empty or whitespace queries", () => {
    const index = createSearchIndex();
    index.setFile("a.md", "text");
    expect(index.search("")).toEqual({
      results: [],
      totalMatches: 0,
      truncated: false,
    });
    expect(index.search("   ").totalMatches).toBe(0);
  });

  it("returns nothing when there is no match", () => {
    const index = createSearchIndex();
    index.setFile("a.md", "text");
    expect(index.search("zzz").results).toEqual([]);
  });

  it("honors removeFile and clear", () => {
    const index = createSearchIndex();
    index.setFile("a.md", "tema");
    index.setFile("b.md", "tema");
    index.removeFile("a.md");
    expect(index.search("tema").results.map((r) => r.path)).toEqual(["b.md"]);
    index.clear();
    expect(index.search("tema").results).toEqual([]);
  });
});
