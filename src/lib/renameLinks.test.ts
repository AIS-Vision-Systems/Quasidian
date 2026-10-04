import { describe, expect, it } from "vitest";
import {
  applyRewrites,
  renamedLinkUrl,
  renameLinkTargets,
} from "./renameLinks";
import type { FolderFile } from "./wikilinks";

const FOLDER = "C:/notes";
const FILES: FolderFile[] = [
  { name: "nota.md", path: "C:/notes/nota.md" },
  { name: "altra.md", path: "C:/notes/altra.md" },
];
const OLD = "C:/notes/nota.md";
const NEW = "C:/notes/nova.md";

function renamed(doc: string): string {
  return applyRewrites(
    doc,
    renameLinkTargets(doc, FOLDER, FILES, OLD, NEW, ".md"),
  );
}

describe("renameLinkTargets", () => {
  it("rewrites bare wikilinks preserving their style", () => {
    expect(renamed("vegeu [[nota]] i [[altra]]")).toBe(
      "vegeu [[nova]] i [[altra]]",
    );
  });

  it("keeps an explicit extension", () => {
    expect(renamed("[[nota.md]]")).toBe("[[nova.md]]");
  });

  it("replaces only the path part of aliased links", () => {
    expect(renamed("[[nota|el meu àlies]]")).toBe("[[nova|el meu àlies]]");
  });

  it("rewrites embeds and case-insensitive matches", () => {
    expect(renamed("![[nota]]")).toBe("![[nova]]");
    expect(renamed("[[NOTA]]")).toBe("[[nova]]");
  });

  it("leaves unresolved and unrelated links alone", () => {
    expect(renamed("[[desconeguda]] i [[altra]]")).toBe(
      "[[desconeguda]] i [[altra]]",
    );
  });

  it("ignores links inside code blocks", () => {
    expect(renamed("```\n[[nota]]\n```")).toBe("```\n[[nota]]\n```");
  });

  it("preserves heading anchors", () => {
    expect(renamed("[[nota#La secció]]")).toBe("[[nova#La secció]]");
  });
});

describe("applyRewrites", () => {
  it("applies multiple rewrites regardless of order", () => {
    const doc = "[[nota]] text [[nota.md]]";
    expect(renamed(doc)).toBe("[[nova]] text [[nova.md]]");
  });
});

describe("renameLinkTargets — markdown links (m50)", () => {
  it("rewrites a markdown link, keeping its label and extension", () => {
    expect(renamed("vegeu [la nota](nota.md) i [altra](altra.md)")).toBe(
      "vegeu [la nota](nova.md) i [altra](altra.md)",
    );
  });

  it("keeps a link written without extension bare", () => {
    expect(renamed("[n](nota)")).toBe("[n](nova)");
  });

  it("preserves the heading anchor, spaces included", () => {
    expect(renamed("[n](nota.md#secció)")).toBe("[n](nova.md#secció)");
    expect(renamed("[n](nota.md#La secció primera)")).toBe(
      "[n](nova.md#La secció primera)",
    );
  });

  it("preserves a quoted title", () => {
    expect(renamed('[n](nota.md "títol")')).toBe('[n](nova.md "títol")');
  });

  it("preserves the angle brackets", () => {
    expect(renamed("[n](<nota.md>)")).toBe("[n](<nova.md>)");
  });

  it("leaves external and unrelated links alone", () => {
    const doc = "[web](https://exemple.cat/nota.md) [a](altra.md) [x](res.md)";
    expect(renamed(doc)).toBe(doc);
  });

  it("ignores links inside code", () => {
    expect(renamed("`[n](nota.md)`")).toBe("`[n](nota.md)`");
  });

  it("still rewrites a wikilink inside brackets or inside a link label", () => {
    // "[ … ]" alone is a Link node with no URL: the walk must go on.
    expect(renamed("[ [[nota]] ]")).toBe("[ [[nova]] ]");
    expect(renamed("[vegeu [[nota]]](altra.md)")).toBe(
      "[vegeu [[nova]]](altra.md)",
    );
    expect(renamed("[vegeu [[nota]]](nota.md)")).toBe(
      "[vegeu [[nova]]](nova.md)",
    );
  });

  it("rewrites wikilinks and markdown links in one pass", () => {
    expect(renamed("[[nota]] i [n](nota.md) i ![[nota]]")).toBe(
      "[[nova]] i [n](nova.md) i ![[nova]]",
    );
  });
});

describe("renameLinkTargets — markdown links across folders (m50)", () => {
  const folder = "C:/vault";
  const files: FolderFile[] = [
    { name: "Inici.md", path: "C:/vault/Inici.md" },
    { name: "Exemple.md", path: "C:/vault/docs/Exemple.md" },
    { name: "foto.png", path: "C:/vault/docs/foto.png" },
  ];
  const rewrite = (doc: string, oldPath: string, newPath: string): string =>
    applyRewrites(
      doc,
      renameLinkTargets(doc, folder, files, oldPath, newPath, ".md"),
    );

  it("keeps the folder prefix when the file is renamed in place", () => {
    expect(
      rewrite(
        "[e](docs/Exemple.md#Secció primera)",
        "C:/vault/docs/Exemple.md",
        "C:/vault/docs/Mostra.md",
      ),
    ).toBe("[e](docs/Mostra.md#Secció primera)");
  });

  it("drops the folder prefix when the file moves to another folder", () => {
    expect(
      rewrite(
        "[e](docs/Exemple.md)",
        "C:/vault/docs/Exemple.md",
        "C:/vault/arxiu/Exemple.md",
      ),
    ).toBe("[e](Exemple.md)");
  });

  it("renames an image link keeping its extension", () => {
    expect(
      rewrite(
        "[f](docs/foto.png)",
        "C:/vault/docs/foto.png",
        "C:/vault/docs/retrat.png",
      ),
    ).toBe("[f](docs/retrat.png)");
  });
});

describe("renamedLinkUrl (m50)", () => {
  it("percent-encodes spaces of the new name in a plain destination", () => {
    expect(renamedLinkUrl("nota.md", "C:/n/La nova nota.md", true)).toBe(
      "La%20nova%20nota.md",
    );
  });

  it("keeps the percent style of a link that used it", () => {
    expect(renamedLinkUrl("La%20nota.md", "C:/n/Una altra.md", true)).toBe(
      "Una%20altra.md",
    );
  });

  it("keeps raw spaces in a link that already wrote them raw", () => {
    expect(renamedLinkUrl("La nota.md#Una secció", "C:/n/Una altra.md", true)).toBe(
      "Una altra.md#Una secció",
    );
  });

  it("keeps the raw style when only the anchor had spaces", () => {
    expect(
      renamedLinkUrl("docs/Exemple.md#Secció primera", "C:/n/Mostra nova.md", true),
    ).toBe("docs/Mostra nova.md#Secció primera");
  });

  it("keeps raw spaces inside angle brackets", () => {
    expect(renamedLinkUrl("<La nota.md>", "C:/n/Una altra.md", true)).toBe(
      "<Una altra.md>",
    );
  });

  it("encodes what would break the destination", () => {
    expect(renamedLinkUrl("nota.md", "C:/n/a (b) #1 100%.md", true)).toBe(
      "a%20%28b%29%20%231%20100%25.md",
    );
    expect(renamedLinkUrl("<nota.md>", "C:/n/a (b) #1.md", true)).toBe(
      "<a (b) %231.md>",
    );
  });

  it("encodes quotes, which would otherwise start a title", () => {
    expect(renamedLinkUrl("nota.md", 'C:/n/diu "hola" x.md', true)).toBe(
      "diu%20%22hola%22%20x.md",
    );
    expect(renamedLinkUrl("a b.md", "C:/n/l'altra nota.md", true)).toBe(
      "l%27altra nota.md",
    );
  });

  it("keeps a Windows backslash prefix", () => {
    expect(renamedLinkUrl("docs\\nota.md", "C:/n/nova.md", true)).toBe(
      "docs\\nova.md",
    );
  });

  it("keeps or drops the folder prefix", () => {
    expect(renamedLinkUrl("docs/api/nota.md", "C:/n/nova.md", true)).toBe(
      "docs/api/nova.md",
    );
    expect(renamedLinkUrl("docs/api/nota.md", "C:/n/nova.md", false)).toBe(
      "nova.md",
    );
    expect(renamedLinkUrl("../nota.md", "C:/n/nova.md", true)).toBe("../nova.md");
  });

  it("keeps the extension style of note links", () => {
    expect(renamedLinkUrl("nota", "C:/n/nova.md", true)).toBe("nova");
    expect(renamedLinkUrl("nota.MD", "C:/n/nova.md", true)).toBe("nova.md");
  });
});
