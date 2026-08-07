import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches subsequences and reports positions", () => {
    const match = fuzzyMatch("nt", "nota");
    expect(match).not.toBeNull();
    expect(match?.positions).toEqual([0, 2]);
  });

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyMatch("xyz", "nota")).toBeNull();
    expect(fuzzyMatch("aa", "abc")).toBeNull();
  });

  it("matches everything with an empty query", () => {
    expect(fuzzyMatch("", "nota")).toEqual({ score: 0, positions: [] });
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("NOTA", "nota")?.positions).toEqual([0, 1, 2, 3]);
  });

  it("is diacritic-insensitive", () => {
    expect(fuzzyMatch("alies", "àlies")?.positions).toEqual([0, 1, 2, 3, 4]);
    expect(fuzzyMatch("cancon", "cançó nova")?.positions).toEqual([
      0, 1, 2, 3, 4, 6,
    ]);
  });

  it("scores consecutive matches above scattered ones", () => {
    const consecutive = fuzzyMatch("abc", "abcdef");
    const scattered = fuzzyMatch("abc", "axbxcx");
    expect(consecutive!.score).toBeGreaterThan(scattered!.score);
  });

  it("scores start-of-text above mid-text matches", () => {
    const atStart = fuzzyMatch("no", "notes");
    const inMiddle = fuzzyMatch("no", "sinnot");
    expect(atStart!.score).toBeGreaterThan(inMiddle!.score);
  });

  it("scores word-boundary matches above interior ones", () => {
    const boundary = fuzzyMatch("ma", "el mar");
    const interior = fuzzyMatch("ma", "semma");
    expect(boundary!.score).toBeGreaterThan(interior!.score);
  });
});

describe("fuzzyFilter", () => {
  const items = ["projectes", "diari", "idees velles", "arxiu"];

  it("keeps the original order with an empty query", () => {
    expect(fuzzyFilter("", items, (s) => s).map((r) => r.item)).toEqual(items);
  });

  it("filters out non-matching items", () => {
    expect(fuzzyFilter("di", items, (s) => s).map((r) => r.item)).toEqual([
      "diari",
    ]);
  });

  it("ranks better matches first", () => {
    const ranked = fuzzyFilter("id", items, (s) => s).map((r) => r.item);
    expect(ranked[0]).toBe("idees velles");
  });

  it("supports arbitrary items through the key function", () => {
    const objects = [{ name: "nota" }, { name: "altra" }];
    const results = fuzzyFilter("no", objects, (o) => o.name);
    expect(results).toHaveLength(1);
    expect(results[0].item.name).toBe("nota");
  });
});
