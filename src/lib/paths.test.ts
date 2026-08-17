import { describe, expect, it } from "vitest";
import { basename, dirname, joinPath, normalizePath, samePath } from "./paths";

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
