import { describe, expect, it } from "vitest";
import { GFM, parser as commonmarkParser } from "@lezer/markdown";
import { wikilinks } from "./wikilinks";

const parser = commonmarkParser.configure([GFM, wikilinks]);

interface NodeInfo {
  name: string;
  from: number;
  to: number;
}

function wikilinkNodes(doc: string): NodeInfo[] {
  const tree = parser.parse(doc);
  const nodes: NodeInfo[] = [];
  tree.iterate({
    enter(node) {
      if (node.name.startsWith("Wikilink")) {
        nodes.push({ name: node.name, from: node.from, to: node.to });
      }
    },
  });
  return nodes;
}

describe("wikilinks Lezer extension", () => {
  it("parses a plain wikilink with marks and path", () => {
    expect(wikilinkNodes("abans [[nota]] després")).toEqual([
      { name: "Wikilink", from: 6, to: 14 },
      { name: "WikilinkMark", from: 6, to: 8 },
      { name: "WikilinkPath", from: 8, to: 12 },
      { name: "WikilinkMark", from: 12, to: 14 },
    ]);
  });

  it("parses an aliased wikilink with path, pipe mark and alias", () => {
    expect(wikilinkNodes("[[nota|àlies]]")).toEqual([
      { name: "Wikilink", from: 0, to: 14 },
      { name: "WikilinkMark", from: 0, to: 2 },
      { name: "WikilinkPath", from: 2, to: 6 },
      { name: "WikilinkMark", from: 6, to: 7 },
      { name: "WikilinkAlias", from: 7, to: 12 },
      { name: "WikilinkMark", from: 12, to: 14 },
    ]);
  });

  it("keeps relative paths inside a single path node", () => {
    expect(wikilinkNodes("[[../altres/nota]]")).toEqual([
      { name: "Wikilink", from: 0, to: 18 },
      { name: "WikilinkMark", from: 0, to: 2 },
      { name: "WikilinkPath", from: 2, to: 16 },
      { name: "WikilinkMark", from: 16, to: 18 },
    ]);
  });

  it("ignores unclosed and empty wikilinks", () => {
    expect(wikilinkNodes("text [[nota")).toEqual([]);
    expect(wikilinkNodes("[[]]")).toEqual([]);
    expect(wikilinkNodes("[[nota\n]]")).toEqual([]);
  });

  it("parses wikilinks nested in bold and in headings", () => {
    expect(wikilinkNodes("**[[n]]**")).toContainEqual({
      name: "Wikilink",
      from: 2,
      to: 7,
    });
    expect(wikilinkNodes("# Títol [[n]]")).toContainEqual({
      name: "Wikilink",
      from: 8,
      to: 13,
    });
  });

  it("takes precedence over standard link syntax", () => {
    const names = wikilinkNodes("[[nota]]").map((node) => node.name);
    expect(names).toContain("Wikilink");
  });
});
