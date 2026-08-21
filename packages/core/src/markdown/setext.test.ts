import { describe, expect, it } from "vitest";
import { markdownParser } from "./parser";

interface NodeInfo {
  name: string;
  from: number;
  to: number;
}

/** Top-level block nodes of the parsed document. */
function blockNodes(doc: string): NodeInfo[] {
  const tree = markdownParser.parse(doc);
  const nodes: NodeInfo[] = [];
  const cursor = tree.cursor();
  if (cursor.firstChild()) {
    do {
      nodes.push({ name: cursor.name, from: cursor.from, to: cursor.to });
    } while (cursor.nextSibling());
  }
  return nodes;
}

function blockNames(doc: string): string[] {
  return blockNodes(doc).map((node) => node.name);
}

describe("setext restriction — dash underlines need 3+ dashes", () => {
  it("does not turn the previous line into a heading with 1 or 2 dashes", () => {
    expect(blockNames("Foo\n-")).toEqual(["Paragraph"]);
    // "- " starts a list at once (listInterrupt) — never a heading.
    expect(blockNames("Foo\n- ")).toEqual(["Paragraph", "BulletList"]);
    expect(blockNames("Foo\n--")).toEqual(["Paragraph"]);
  });

  it("keeps a bare dash line as paragraph text", () => {
    expect(blockNodes("Foo\n-")).toEqual([
      { name: "Paragraph", from: 0, to: 5 },
    ]);
    expect(blockNames("Foo\n-\nbar")).toEqual(["Paragraph"]);
  });

  it("still makes a setext H2 with 3 or more dashes", () => {
    expect(blockNames("Foo\n---")).toEqual(["SetextHeading2"]);
    expect(blockNames("Foo\n----")).toEqual(["SetextHeading2"]);
  });

  it("emits the underline as a HeaderMark inside the heading", () => {
    const tree = markdownParser.parse("Foo\n---");
    const marks: NodeInfo[] = [];
    tree.iterate({
      enter(node) {
        if (node.name === "HeaderMark") {
          marks.push({ name: node.name, from: node.from, to: node.to });
        }
      },
    });
    expect(marks).toEqual([{ name: "HeaderMark", from: 4, to: 7 }]);
  });

  it("keeps the CommonMark behavior for = underlines", () => {
    expect(blockNames("Foo\n=")).toEqual(["SetextHeading1"]);
    expect(blockNames("Foo\n===")).toEqual(["SetextHeading1"]);
  });

  it("keeps horizontal rules after a blank line", () => {
    expect(blockNames("Foo\n\n---")).toEqual(["Paragraph", "HorizontalRule"]);
  });

  it("lets a non-empty list item interrupt the paragraph as before", () => {
    expect(blockNames("Foo\n- x")).toEqual(["Paragraph", "BulletList"]);
  });

  it("ignores underlines on lazy continuation lines inside blockquotes", () => {
    // The "===" line is missing the ">", so it is plain paragraph text.
    const tree = markdownParser.parse("> Foo\n===");
    let sawHeading = false;
    tree.iterate({
      enter(node) {
        if (node.name.startsWith("SetextHeading")) {
          sawHeading = true;
        }
      },
    });
    expect(sawHeading).toBe(false);
  });

  it("still parses inline formatting inside the heading text", () => {
    const tree = markdownParser.parse("Foo **bar**\n---");
    const names: string[] = [];
    tree.iterate({
      enter(node) {
        names.push(node.name);
      },
    });
    expect(names).toContain("SetextHeading2");
    expect(names).toContain("StrongEmphasis");
  });
});
