import { describe, expect, it } from "vitest";
import {
  basename,
  copyName,
  dirname,
  joinPath,
  normalizePath,
  samePath,
} from "./paths";

describe("dirname", () => {
  it("handles unix separators", () => {
    expect(dirname("/home/user/notes/note.md")).toBe("/home/user/notes");
  });

  it("handles windows separators", () => {
    expect(dirname("C:\\notes\\note.md")).toBe("C:\\notes");
  });

  it("handles mixed separators", () => {
    expect(dirname("C:\\notes/sub/note.md")).toBe("C:\\notes/sub");
  });

  it("returns the input when there is no separator", () => {
    expect(dirname("note.md")).toBe("note.md");
  });

  it("keeps the separator on filesystem roots", () => {
    // A bare "C:" is drive-relative on Windows (resolves against the
    // current working directory), so the parent of "C:\\x" is "C:\\".
    expect(dirname("C:\\Data")).toBe("C:\\");
    expect(dirname("C:/Data")).toBe("C:/");
    expect(dirname("/home")).toBe("/");
  });

  it("is a fixed point at the root itself", () => {
    expect(dirname("C:\\")).toBe("C:\\");
    expect(dirname("C:/")).toBe("C:/");
    expect(dirname("/")).toBe("/");
  });
});

describe("basename", () => {
  it("handles unix separators", () => {
    expect(basename("/home/user/notes/note.md")).toBe("note.md");
  });

  it("handles windows separators", () => {
    expect(basename("C:\\notes\\note.md")).toBe("note.md");
  });

  it("returns the input when there is no separator", () => {
    expect(basename("note.md")).toBe("note.md");
  });
});

describe("joinPath", () => {
  it("joins with a single separator regardless of trailing/leading ones", () => {
    expect(joinPath("C:\\notes", "nota.md")).toBe("C:\\notes/nota.md");
    expect(joinPath("/home/user/", "/nota.md")).toBe("/home/user/nota.md");
  });
});

describe("normalizePath", () => {
  it("unifies separators to forward slashes", () => {
    expect(normalizePath("C:\\notes\\sub\\nota.md")).toBe("C:/notes/sub/nota.md");
  });

  it("collapses . and .. segments", () => {
    expect(normalizePath("C:/notes/./sub/../nota.md")).toBe("C:/notes/nota.md");
    expect(normalizePath("/a/b/../../c")).toBe("/c");
  });

  it("keeps leading .. on relative paths", () => {
    expect(normalizePath("../a/b")).toBe("../a/b");
  });
});

describe("samePath", () => {
  it("equates paths that differ only in separators or . segments", () => {
    expect(samePath("C:\\notes\\nota.md", "C:/notes/nota.md")).toBe(true);
    expect(samePath("C:/notes/sub/../nota.md", "C:\\notes\\nota.md")).toBe(true);
    expect(samePath("C:/notes/a.md", "C:/notes/b.md")).toBe(false);
  });
});

describe("copyName", () => {
  it("starts at the first suffix", () => {
    expect(copyName("Nota.md", () => false)).toBe("Nota 1.md");
  });

  it("takes the first free suffix, skipping taken ones", () => {
    const existing = new Set(["Nota 1.md", "Nota 2.md"]);
    expect(copyName("Nota.md", (c) => existing.has(c))).toBe("Nota 3.md");
  });

  it("fills gaps in the numbering", () => {
    const existing = new Set(["Nota 1.md", "Nota 3.md"]);
    expect(copyName("Nota.md", (c) => existing.has(c))).toBe("Nota 2.md");
  });

  it("keeps the image extension", () => {
    expect(copyName("foto.png", () => false)).toBe("foto 1.png");
  });

  it("suffixes names without an extension at the end", () => {
    expect(copyName("LEGIRME", () => false)).toBe("LEGIRME 1");
  });

  it("treats a leading dot as name, not extension", () => {
    expect(copyName(".gitignore", () => false)).toBe(".gitignore 1");
  });

  it("keeps inner dots in the stem", () => {
    expect(copyName("v1.2 notes.md", () => false)).toBe("v1.2 notes 1.md");
  });
});
