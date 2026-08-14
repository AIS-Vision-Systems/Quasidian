import { describe, expect, it } from "vitest";
import { applyRewrites, renameLinkTargets } from "./renameLinks";
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
