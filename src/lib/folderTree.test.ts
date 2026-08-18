import { describe, expect, it } from "vitest";
import { buildFolderTree, collapsedByDefault, relativePath } from "./folderTree";

describe("relativePath", () => {
  it("strips the root prefix, case-insensitively", () => {
    expect(relativePath("C:/vault", "C:/vault/a/b.md")).toBe("a/b.md");
    expect(relativePath("C:/Vault", "c:/vault/x.md")).toBe("x.md");
    expect(relativePath("C:/vault", "C:/vault")).toBe("");
  });

  it("returns the path untouched when outside the root", () => {
    expect(relativePath("C:/vault", "C:/other/x.md")).toBe("C:/other/x.md");
  });
});

describe("buildFolderTree", () => {
  it("nests entries under their folders, dirs first, sorted", () => {
    const tree = buildFolderTree("C:/vault", [
      { path: "C:/vault/z.md", isDir: false },
      { path: "C:/vault/a.md", isDir: false },
      { path: "C:/vault/sub", isDir: true },
      { path: "C:/vault/sub/inner.md", isDir: false },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["sub", "a.md", "z.md"]);
    expect(tree[0].isDir).toBe(true);
    expect(tree[0].children.map((node) => node.name)).toEqual(["inner.md"]);
  });

  it("creates missing intermediate folders implicitly", () => {
    const tree = buildFolderTree("C:/vault", [
      { path: "C:/vault/a/b/c.md", isDir: false },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("a");
    expect(tree[0].children[0].name).toBe("b");
    expect(tree[0].children[0].children[0].name).toBe("c.md");
  });

  it("ignores the root itself and entries outside it", () => {
    const tree = buildFolderTree("C:/vault", [
      { path: "C:/vault", isDir: true },
      { path: "C:/elsewhere/x.md", isDir: false },
      { path: "C:/vault/x.md", isDir: false },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["x.md"]);
  });

  it("keeps empty folders visible", () => {
    const tree = buildFolderTree("C:/vault", [
      { path: "C:/vault/empty", isDir: true },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["empty"]);
    expect(tree[0].children).toEqual([]);
  });
});

describe("collapsedByDefault", () => {
  it("collapses branches with no managed files anywhere", () => {
    const tree = buildFolderTree("C:/vault", [
      { path: "C:/vault/docs", isDir: true },
      { path: "C:/vault/docs/spec.md", isDir: false },
      { path: "C:/vault/src", isDir: true },
      { path: "C:/vault/src/deep", isDir: true },
      { path: "C:/vault/assets", isDir: true },
      { path: "C:/vault/assets/photo.png", isDir: false },
    ]);
    const collapsed = collapsedByDefault(tree);
    expect(collapsed).toContain("C:/vault/src");
    expect(collapsed).toContain("C:/vault/src/deep");
    expect(collapsed).not.toContain("C:/vault/docs");
    expect(collapsed).not.toContain("C:/vault/assets");
  });

  it("expands a folder whose content sits deeper down", () => {
    const tree = buildFolderTree("C:/vault", [
      { path: "C:/vault/a/b/c/nota.md", isDir: false },
    ]);
    expect(collapsedByDefault(tree)).toEqual([]);
  });

  it("is empty for a flat list of files", () => {
    const tree = buildFolderTree("C:/vault", [
      { path: "C:/vault/x.md", isDir: false },
    ]);
    expect(collapsedByDefault(tree)).toEqual([]);
  });
});
