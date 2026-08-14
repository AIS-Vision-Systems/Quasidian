import { describe, expect, it } from "vitest";
import { resolveWikilink, type FolderFile } from "./wikilinks";

const folder = "C:\\notes";
const files: FolderFile[] = [
  { name: "Nota.md", path: "C:\\notes\\Nota.md" },
  { name: "altra.md", path: "C:\\notes\\altra.md" },
];

describe("resolveWikilink — bare names", () => {
  it("matches a folder file by name without extension", () => {
    expect(resolveWikilink("altra", folder, files)).toEqual({
      path: "C:\\notes\\altra.md",
      exists: true,
    });
  });

  it("matches case-insensitively", () => {
    expect(resolveWikilink("nota", folder, files)).toEqual({
      path: "C:\\notes\\Nota.md",
      exists: true,
    });
  });

  it("matches when the extension is spelled out", () => {
    expect(resolveWikilink("Nota.md", folder, files)).toEqual({
      path: "C:\\notes\\Nota.md",
      exists: true,
    });
  });

  it("returns the creation path for unknown names", () => {
    expect(resolveWikilink("nova", folder, files)).toEqual({
      path: "C:/notes/nova.md",
      exists: false,
    });
  });

  it("resolves frontmatter aliases, after real names", () => {
    const withAliases: FolderFile[] = [
      { name: "Nota.md", path: "C:\\notes\\Nota.md", aliases: ["altra"] },
      { name: "altra.md", path: "C:\\notes\\altra.md" },
      {
        name: "assaig.md",
        path: "C:\\notes\\assaig.md",
        aliases: ["Against Egalitarianism"],
      },
    ];
    // The alias resolves case-insensitively…
    expect(
      resolveWikilink("against egalitarianism", folder, withAliases),
    ).toEqual({ path: "C:\\notes\\assaig.md", exists: true });
    // …but a real file name always wins over a same-named alias.
    expect(resolveWikilink("altra", folder, withAliases)).toEqual({
      path: "C:\\notes\\altra.md",
      exists: true,
    });
  });

  it("returns null for empty targets", () => {
    expect(resolveWikilink("  ", folder, files)).toBeNull();
  });
});

describe("resolveWikilink — relative and full paths", () => {
  it("resolves subfolder links against the current folder", () => {
    expect(resolveWikilink("sub/nota", folder, files)).toEqual({
      path: "C:/notes/sub/nota.md",
      exists: false,
    });
  });

  it("resolves parent-folder links", () => {
    expect(resolveWikilink("../altres/nota", folder, files)).toEqual({
      path: "C:/altres/nota.md",
      exists: false,
    });
  });

  it("keeps an explicit extension", () => {
    expect(resolveWikilink("sub/nota.md", folder, files)).toEqual({
      path: "C:/notes/sub/nota.md",
      exists: false,
    });
  });

  it("accepts absolute paths", () => {
    expect(resolveWikilink("C:/tot/arreu/nota", folder, files)).toEqual({
      path: "C:/tot/arreu/nota.md",
      exists: false,
    });
  });
});

describe("resolveWikilink — default extension setting", () => {
  it("uses the configured extension when creating", () => {
    expect(resolveWikilink("nova", folder, files, ".markdown")).toEqual({
      path: "C:/notes/nova.markdown",
      exists: false,
    });
  });

  it("keeps any explicit extension untouched", () => {
    expect(resolveWikilink("sub/nota.txt", folder, files, ".markdown")).toEqual(
      {
        path: "C:/notes/sub/nota.txt",
        exists: false,
      },
    );
  });

  it("still matches existing .md files by bare name", () => {
    expect(resolveWikilink("altra", folder, files, ".markdown")).toEqual({
      path: "C:\\notes\\altra.md",
      exists: true,
    });
  });
});
