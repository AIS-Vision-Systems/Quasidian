import { describe, expect, it } from "vitest";
import { markdownParser } from "./parser";

interface NodeInfo {
  name: string;
  from: number;
  to: number;
}

function nodes(doc: string): NodeInfo[] {
  const found: NodeInfo[] = [];
  markdownParser.parse(doc).iterate({
    enter(node) {
      if (node.name.startsWith("Footnote")) {
        found.push({ name: node.name, from: node.from, to: node.to });
      }
    },
  });
  return found;
}

describe("footnotes Lezer extension", () => {
  it("parses inline references with marks and label", () => {
    expect(nodes("text [^1] més")).toEqual([
      { name: "FootnoteRef", from: 5, to: 9 },
      { name: "FootnoteMark", from: 5, to: 7 },
      { name: "FootnoteLabel", from: 7, to: 8 },
      { name: "FootnoteMark", from: 8, to: 9 },
    ]);
  });

  it("parses one-line definitions with inline content", () => {
    const doc = "[^nota]: text **fort**";
    const found = nodes(doc);
    expect(found[0]).toEqual({ name: "FootnoteDef", from: 0, to: 22 });
    expect(found).toContainEqual({
      name: "FootnoteLabel",
      from: 2,
      to: 6,
    });
    // The definition's content still parses inline (bold there).
    let bold = false;
    markdownParser.parse(doc).iterate({
      enter(node) {
        if (node.name === "StrongEmphasis") {
          bold = true;
        }
      },
    });
    expect(bold).toBe(true);
  });

  it("parses direct inline footnotes ^[text]", () => {
    const found = nodes("a ^[directa] b");
    expect(found[0]).toEqual({ name: "FootnoteInline", from: 2, to: 12 });
    expect(found).toContainEqual({ name: "FootnoteMark", from: 2, to: 4 });
    expect(found).toContainEqual({ name: "FootnoteMark", from: 11, to: 12 });
  });

  it("ignores malformed references", () => {
    expect(nodes("[^]")).toEqual([]);
    expect(nodes("[^amb espai]")).toEqual([]);
    expect(nodes("[normal]")).toEqual([]);
  });

  it("does not read a definition line as a reference", () => {
    const found = nodes("[^1]: def");
    expect(found.some((node) => node.name === "FootnoteRef")).toBe(false);
    expect(found.some((node) => node.name === "FootnoteDef")).toBe(true);
  });
});
