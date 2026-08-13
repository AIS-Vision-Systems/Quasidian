import { describe, expect, it } from "vitest";
import { computeOutline } from "./outline";

describe("computeOutline", () => {
  it("collects ATX headings with level, text and range", () => {
    expect(computeOutline("# Un\ntext\n### Tres")).toEqual([
      { level: 1, text: "Un", from: 0, to: 4 },
      { level: 3, text: "Tres", from: 10, to: 18 },
    ]);
  });

  it("collects setext headings without the underline", () => {
    expect(computeOutline("Títol\n---")).toEqual([
      { level: 2, text: "Títol", from: 0, to: 9 },
    ]);
    expect(computeOutline("Gran\n===")).toEqual([
      { level: 1, text: "Gran", from: 0, to: 8 },
    ]);
  });

  it("strips closing ATX marks and keeps inline source", () => {
    expect(computeOutline("## Amb **negreta** ##")).toEqual([
      { level: 2, text: "Amb **negreta**", from: 0, to: 21 },
    ]);
  });

  it("returns an empty outline without headings", () => {
    expect(computeOutline("només text\n- llista")).toEqual([]);
  });
});
