import { describe, expect, it } from "vitest";
import { markdownParser } from "./parser";

interface NodeInfo {
  name: string;
  from: number;
  to: number;
}

function mathNodes(doc: string): NodeInfo[] {
  const tree = markdownParser.parse(doc);
  const nodes: NodeInfo[] = [];
  tree.iterate({
    enter(node) {
      if (node.name.startsWith("Math") || node.name === "InlineMath") {
        nodes.push({ name: node.name, from: node.from, to: node.to });
      }
    },
  });
  return nodes;
}

describe("math Lezer extension — inline", () => {
  it("parses $...$ with marks", () => {
    expect(mathNodes("val $x+y$ aquí")).toEqual([
      { name: "InlineMath", from: 4, to: 9 },
      { name: "MathMark", from: 4, to: 5 },
      { name: "MathMark", from: 8, to: 9 },
    ]);
  });

  it("parses single-line $$...$$ as display math", () => {
    expect(mathNodes("abans $$x$$ després")).toEqual([
      { name: "MathBlock", from: 6, to: 11 },
      { name: "MathMark", from: 6, to: 8 },
      { name: "MathMark", from: 9, to: 11 },
    ]);
  });

  it("ignores dollars that look like prices", () => {
    expect(mathNodes("val 100$ i 200$")).toEqual([]);
  });

  it("requires no space after the opening or before the closing dollar", () => {
    expect(mathNodes("$ x$")).toEqual([]);
    expect(mathNodes("$x $")).toEqual([]);
  });

  it("ignores escaped dollars", () => {
    expect(mathNodes("\\$5 i \\$6")).toEqual([]);
  });

  it("does not close before a digit", () => {
    expect(mathNodes("$a$5")).toEqual([]);
  });

  it("does not cross lines", () => {
    expect(mathNodes("a $x\ny$ b")).toEqual([]);
  });

  it("ignores dollars inside inline code", () => {
    expect(mathNodes("`$x$`")).toEqual([]);
  });
});

describe("math Lezer extension — blocks", () => {
  it("parses a multi-line $$ block", () => {
    const doc = "$$\nx = 1\n$$";
    expect(mathNodes(doc)).toEqual([
      { name: "MathBlock", from: 0, to: 11 },
      { name: "MathMark", from: 0, to: 2 },
      { name: "MathMark", from: 9, to: 11 },
    ]);
  });

  it("parses a standalone single-line $$...$$ block", () => {
    expect(mathNodes("$$E=mc^2$$")).toEqual([
      { name: "MathBlock", from: 0, to: 10 },
      { name: "MathMark", from: 0, to: 2 },
      { name: "MathMark", from: 8, to: 10 },
    ]);
  });

  it("keeps an unclosed $$ block to the end of the document", () => {
    const nodes = mathNodes("$$\nx = 1");
    expect(nodes[0]).toEqual({ name: "MathBlock", from: 0, to: 8 });
  });
});
