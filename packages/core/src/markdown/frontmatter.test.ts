import { describe, expect, it } from "vitest";
import { markdownParser } from "./parser";

interface NodeInfo {
  name: string;
  from: number;
  to: number;
}

function nodes(doc: string, filter: (name: string) => boolean): NodeInfo[] {
  const found: NodeInfo[] = [];
  markdownParser.parse(doc).iterate({
    enter(node) {
      if (filter(node.name)) {
        found.push({ name: node.name, from: node.from, to: node.to });
      }
    },
  });
  return found;
}

describe("frontmatter Lezer extension", () => {
  it("parses a closed frontmatter block at the start", () => {
    const doc = "---\ntags: [a]\n---\ntext";
    expect(nodes(doc, (n) => n.startsWith("Frontmatter"))).toEqual([
      { name: "Frontmatter", from: 0, to: 17 },
      { name: "FrontmatterMark", from: 0, to: 3 },
      { name: "FrontmatterMark", from: 14, to: 17 },
    ]);
    // The body still parses normally after the block.
    expect(nodes(doc, (n) => n === "Paragraph")).toEqual([
      { name: "Paragraph", from: 18, to: 22 },
    ]);
  });

  it("only counts at the very start of the document", () => {
    const doc = "text\n\n---\nno: yaml\n---";
    expect(nodes(doc, (n) => n.startsWith("Frontmatter"))).toEqual([]);
  });

  it("runs to EOF while unclosed", () => {
    const doc = "---\ntags: [a]";
    expect(nodes(doc, (n) => n === "Frontmatter")).toEqual([
      { name: "Frontmatter", from: 0, to: 13 },
    ]);
  });

  it("keeps wikilinks inside the block out of the tree", () => {
    const doc = "---\nnota: '[[link]]'\n---";
    expect(nodes(doc, (n) => n === "Wikilink")).toEqual([]);
  });

  it("leaves later --- lines as horizontal rules", () => {
    const doc = "---\na: b\n---\ntext\n\n---\n";
    expect(nodes(doc, (n) => n === "HorizontalRule")).toEqual([
      { name: "HorizontalRule", from: 19, to: 22 },
    ]);
  });
});
