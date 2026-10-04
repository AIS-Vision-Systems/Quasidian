import { describe, expect, it } from "vitest";
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { lenientLinks, linkDestination } from "./links";
import { markdownExtensions, markdownParser } from "./parser";

/** The shared parser without the lenient-link extension. */
const stockParser = (markdownLanguage.parser as MarkdownParser).configure(
  markdownExtensions.filter((extension) => extension !== lenientLinks),
);

/** Every node of the first Link in `doc`, as "Name from-to". */
function linkNodes(doc: string): string[] {
  const nodes: string[] = [];
  let inside = false;
  let end = -1;
  markdownParser.parse(doc).iterate({
    enter(node) {
      if (!inside && node.name === "Link") {
        inside = true;
        end = node.to;
      }
      if (inside && node.from < end) {
        nodes.push(`${node.name} ${node.from}-${node.to}`);
      }
    },
    leave(node) {
      if (inside && node.name === "Link" && node.to === end) {
        inside = false;
        end = -2;
      }
    },
  });
  return nodes;
}

/**
 * The URL text of every Link in `doc` that has one. The stock grammar
 * also calls a bare "[text]" a Link (a shortcut reference): no URL.
 */
function linkUrls(doc: string): string[] {
  const urls: string[] = [];
  markdownParser.parse(doc).iterate({
    enter(node) {
      if (node.name === "Link") {
        const url = node.node.getChild("URL");
        if (url !== null) {
          urls.push(doc.slice(url.from, url.to));
        }
      }
    },
  });
  return urls;
}

describe("lenient links — a destination with spaces (m47)", () => {
  it("parses the heading link that CommonMark breaks", () => {
    const doc = "[exemple](docs/Exemple.md#Secció primera)";
    expect(linkNodes(doc)).toEqual([
      "Link 0-41",
      "LinkMark 0-1",
      "LinkMark 8-9",
      "LinkMark 9-10",
      "URL 10-40",
      "LinkMark 40-41",
    ]);
    expect(linkUrls(doc)).toEqual(["docs/Exemple.md#Secció primera"]);
  });

  it("really is a link the stock parser leaves without a URL", () => {
    const doc = "[exemple](docs/Exemple.md#Secció primera)";
    let url = false;
    stockParser.parse(doc).iterate({
      enter(node) {
        if (node.name === "URL") {
          url = true;
        }
      },
    });
    expect(url).toBe(false);
  });

  it("accepts spaces in the file name too", () => {
    expect(linkUrls("[n](La meva nota.md)")).toEqual(["La meva nota.md"]);
    expect(linkUrls("[n](carpeta amb espais/La nota.md#Una secció)")).toEqual([
      "carpeta amb espais/La nota.md#Una secció",
    ]);
  });

  it("keeps a quoted title apart from the destination", () => {
    const doc = '[n](La nota.md "un títol")';
    expect(linkNodes(doc)).toEqual([
      "Link 0-26",
      "LinkMark 0-1",
      "LinkMark 2-3",
      "LinkMark 3-4",
      "URL 4-14",
      "LinkTitle 15-25",
      "LinkMark 25-26",
    ]);
  });

  it("ignores padding around the destination", () => {
    expect(linkUrls("[n](  La nota.md  )")).toEqual(["La nota.md"]);
  });

  it("parses inline formatting inside the label", () => {
    const doc = "[**fort** i *suau*](La nota.md)";
    const nodes = linkNodes(doc);
    expect(nodes).toContain("StrongEmphasis 1-9");
    expect(nodes).toContain("Emphasis 12-18");
    expect(nodes).toContain("URL 20-30");
  });

  it("works in the middle of a line and next to other links", () => {
    const doc = "abans [a](u v.md) entre [b](https://x.cat) i [[Nota]] després";
    expect(linkUrls(doc)).toEqual(["u v.md", "https://x.cat"]);
  });

  it("works inside headings, lists, quotes and table cells", () => {
    expect(linkUrls("# Títol [a](b c.md)")).toEqual(["b c.md"]);
    expect(linkUrls("- item [a](b c.md)")).toEqual(["b c.md"]);
    expect(linkUrls("> cita [a](b c.md)")).toEqual(["b c.md"]);
    expect(linkUrls("| [a](b c.md) | x |\n| --- | --- |")).toEqual(["b c.md"]);
  });

  it("handles balanced parentheses in the destination", () => {
    expect(linkUrls("[n](La nota (vella).md)")).toEqual(["La nota (vella).md"]);
  });

  it("keeps a code span in the label whole", () => {
    const doc = "[`codi]` i text](La nota.md)";
    expect(linkUrls(doc)).toEqual(["La nota.md"]);
    expect(linkNodes(doc)).toContain("InlineCode 1-8");
  });

  it("never spans lines", () => {
    expect(linkUrls("[n](La nota\nsegona.md)")).toEqual([]);
    expect(linkUrls("[n\nm](La nota.md)")).toEqual([]);
  });

  it("leaves an unterminated link alone", () => {
    expect(linkUrls("[n](La nota.md")).toEqual([]);
    expect(linkUrls("[n(La nota.md)")).toEqual([]);
  });

  it("never turns a broken external URL into a note link", () => {
    expect(linkUrls("[n](https://exemple.cat/a b)")).toEqual([]);
    expect(linkUrls("[n](mailto:algú @exemple.cat)")).toEqual([]);
  });
});

describe("lenient links — everything CommonMark parses keeps its parse (m47)", () => {
  const corpus = [
    "[a](b.md)",
    "[a](b.md#secció)",
    '[a](b.md "títol")',
    "[a](b.md 'títol')",
    "[a](b.md (títol))",
    // A ")" inside a quoted title belongs to the title.
    '[a](b "t)")',
    "[a](b 't) u')",
    '[a](b "un títol (amb parèntesi) llarg")',
    "[a](b(c).md)",
    // A code span that swallows the "]" or reaches into the "(...)".
    "[a `x](y z)` b",
    "[a](y `z) w`)",
    "``[a](b c)``",
    "[a](<b c.md>)",
    '[a](<b c.md> "títol")',
    "[a](https://exemple.cat)",
    '[a](https://exemple.cat "títol")',
    "[a]()",
    "[a](La%20nota.md)",
    "![alt](imatge.png)",
    "![alt](una imatge.png)",
    '![alt](imatge.png "títol")',
    "[a][ref]\n\n[ref]: b.md",
    "[a]\n\n[a]: b.md",
    "[[Nota]] i [[Nota|àlies]]",
    "![[imatge.png]]",
    "text[^1]\n\n[^1]: nota al peu",
    "\\[a](b c.md)",
    "`[a](b c.md)`",
    "```\n[a](b c.md)\n```",
    "[a] (b c.md)",
    "[a](b c.md",
    "[x] no és un enllaç (però té parèntesis amb espais)",
    "- [ ] tasca (amb una nota)",
    "- [x] tasca (feta ahir)",
    "*[a](b.md)* i **[a](b.md)**",
    "$[a](b c)$",
    "<https://exemple.cat>",
  ];

  for (const doc of corpus) {
    it(`parses ${JSON.stringify(doc)} exactly like the stock grammar`, () => {
      expect(markdownParser.parse(doc).toString()).toBe(
        stockParser.parse(doc).toString(),
      );
    });
  }
});

describe("linkDestination (m47)", () => {
  it("returns a plain note target untouched", () => {
    expect(linkDestination("docs/Exemple.md#Secció primera")).toEqual({
      target: "docs/Exemple.md#Secció primera",
      external: false,
    });
  });

  it("strips the angle brackets of the CommonMark form", () => {
    expect(linkDestination("<docs/Exemple.md#Secció primera>")).toEqual({
      target: "docs/Exemple.md#Secció primera",
      external: false,
    });
  });

  it("decodes percent-escapes of note targets", () => {
    expect(linkDestination("La%20nota.md#Secci%C3%B3%20primera").target).toBe(
      "La nota.md#Secció primera",
    );
    expect(linkDestination("<La%20nota.md>").target).toBe("La nota.md");
  });

  it("keeps malformed escapes as written", () => {
    expect(linkDestination("100%.md").target).toBe("100%.md");
  });

  it("returns external URLs as written, without the brackets", () => {
    expect(linkDestination("https://exemple.cat/a%20b")).toEqual({
      target: "https://exemple.cat/a%20b",
      external: true,
    });
    expect(linkDestination("<https://exemple.cat/a b>")).toEqual({
      target: "https://exemple.cat/a b",
      external: true,
    });
  });

  it("treats a Windows drive path as a note, not a scheme", () => {
    expect(linkDestination("C:/notes/La nota.md").external).toBe(false);
  });

  it("leaves a lone bracket alone", () => {
    expect(linkDestination("<").target).toBe("<");
    expect(linkDestination("").target).toBe("");
  });
});
