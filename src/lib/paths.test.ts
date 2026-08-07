import { describe, expect, it } from "vitest";
import { basename, dirname } from "./paths";

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
