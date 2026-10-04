import { describe, expect, it } from "vitest";
import { createBacklinkIndex, extractLinkTargets } from "./backlinkIndex";
import type { FolderFile } from "./wikilinks";

describe("extractLinkTargets", () => {
  it("collects wikilink targets, aliased or not", () => {
    expect(extractLinkTargets("[[nota]] i [[altra|àlies]]")).toEqual([
      "nota",
      "altra",
    ]);
  });

  it("collects internal markdown link targets and ignores external ones", () => {
    expect(
      extractLinkTargets("[text](nota.md) i [web](https://exemple.cat)"),
    ).toEqual(["nota.md"]);
  });

  it("collects markdown link targets as the string a click resolves (m47)", () => {
    // Spaces, angle brackets and percent-escapes all name the same note.
    expect(
      extractLinkTargets(
        "[a](La nota.md#Una secció) [b](<La nota.md>) [c](La%20nota.md)",
      ),
    ).toEqual(["La nota.md#Una secció", "La nota.md", "La nota.md"]);
  });

  it("treats a Windows drive path as a note target, like a click does (m47)", () => {
    // A single letter before the colon is a drive, not a URL scheme.
    expect(extractLinkTargets("[a](C:/notes/x.md)")).toEqual(["C:/notes/x.md"]);
  });

  it("ignores an external link in angle brackets (m47)", () => {
    expect(extractLinkTargets("[web](<https://exemple.cat/a b>)")).toEqual([]);
  });

  it("finds links nested in headings and emphasis", () => {
    expect(extractLinkTargets("# Títol [[a]]\n**[[b]]**")).toEqual(["a", "b"]);
  });

  it("ignores links inside code blocks", () => {
    expect(extractLinkTargets("```\n[[no]]\n```")).toEqual([]);
    expect(extractLinkTargets("`[[no]]`")).toEqual([]);
  });

  it("returns empty for documents without links", () => {
    expect(extractLinkTargets("res de res")).toEqual([]);
  });

  it("counts embeds as links", () => {
    expect(extractLinkTargets("![[img.png]] i ![[nota]]")).toEqual([
      "img.png",
      "nota",
    ]);
  });
});

describe("createBacklinkIndex", () => {
  const folder = "C:\\notes";
  const folderFiles: FolderFile[] = [
    { name: "a.md", path: "C:\\notes\\a.md" },
    { name: "b.md", path: "C:\\notes\\b.md" },
    { name: "c.md", path: "C:\\notes\\c.md" },
  ];

  function makeIndex() {
    const index = createBacklinkIndex();
    index.setFile("C:\\notes\\a.md", "enllaça [[b]]");
    index.setFile("C:\\notes\\c.md", "també [aquí](b.md)");
    index.setFile("C:\\notes\\b.md", "cap enllaç");
    return index;
  }

  it("finds files linking to a path via wikilinks and markdown links", () => {
    const index = makeIndex();
    expect(index.backlinksOf("C:\\notes\\b.md", folder, folderFiles)).toEqual([
      "C:\\notes\\a.md",
      "C:\\notes\\c.md",
    ]);
  });

  it("returns empty when nothing links to the path", () => {
    const index = makeIndex();
    expect(index.backlinksOf("C:\\notes\\a.md", folder, folderFiles)).toEqual(
      [],
    );
  });

  it("matches case-insensitively through the resolver", () => {
    const index = createBacklinkIndex();
    index.setFile("C:\\notes\\a.md", "[[B]]");
    expect(index.backlinksOf("C:\\notes\\b.md", folder, folderFiles)).toEqual([
      "C:\\notes\\a.md",
    ]);
  });

  it("resolves relative cross-folder targets", () => {
    const index = createBacklinkIndex();
    index.setFile("C:\\notes\\a.md", "[[../altres/nota]]");
    expect(
      index.backlinksOf("C:\\altres\\nota.md", folder, folderFiles),
    ).toEqual(["C:\\notes\\a.md"]);
  });

  it("does not count self-links", () => {
    const index = createBacklinkIndex();
    index.setFile("C:\\notes\\b.md", "jo mateix [[b]]");
    expect(index.backlinksOf("C:\\notes\\b.md", folder, folderFiles)).toEqual(
      [],
    );
  });

  it("updates entries on setFile and honors removeFile", () => {
    const index = makeIndex();
    index.setFile("C:\\notes\\a.md", "ja no enllaça res");
    expect(index.backlinksOf("C:\\notes\\b.md", folder, folderFiles)).toEqual([
      "C:\\notes\\c.md",
    ]);
    index.removeFile("C:\\notes\\c.md");
    expect(index.backlinksOf("C:\\notes\\b.md", folder, folderFiles)).toEqual(
      [],
    );
  });

  it("clear empties the index", () => {
    const index = makeIndex();
    index.clear();
    expect(index.backlinksOf("C:\\notes\\b.md", folder, folderFiles)).toEqual(
      [],
    );
  });
});
