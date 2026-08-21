import { describe, expect, it } from "vitest";
import { detectVault, isExcludedDir, isHiddenDir } from "./vault";

/** Simulated filesystem: folder path → names it contains. */
function fs(layout: Record<string, string[]>) {
  return (dir: string, name: string): Promise<boolean> =>
    Promise.resolve((layout[dir] ?? []).includes(name));
}

describe("detectVault", () => {
  it("returns null when no marker exists anywhere", async () => {
    const contains = fs({ "C:/notes": ["a.md"], "C:/": [] });
    expect(await detectVault("C:/notes", contains)).toBeNull();
  });

  it("detects a CLAUDE marker in the opened folder", async () => {
    const contains = fs({ "C:/proj/docs": ["CLAUDE.md", "a.md"] });
    expect(await detectVault("C:/proj/docs", contains)).toEqual({
      root: "C:/proj/docs",
      mode: "claude",
      marker: "CLAUDE.md",
    });
  });

  it("detects a marker in an ancestor and roots the vault there", async () => {
    const contains = fs({ "C:/proj": [".claude"] });
    expect(await detectVault("C:/proj/docs/notes", contains)).toEqual({
      root: "C:/proj",
      mode: "claude",
      marker: ".claude",
    });
  });

  it("the farthest marked ancestor wins over nested markers", async () => {
    const contains = fs({
      "C:/proj/docs": ["CLAUDE.md"],
      "C:/proj": ["CLAUDE.md"],
    });
    const info = await detectVault("C:/proj/docs", contains);
    expect(info?.root).toBe("C:/proj");
  });

  it("detects GPT markers", async () => {
    const contains = fs({ "C:/proj": ["AGENTS.md"] });
    expect(await detectVault("C:/proj/x", contains)).toEqual({
      root: "C:/proj",
      mode: "gpt",
      marker: "AGENTS.md",
    });
  });

  it("CLAUDE markers take priority within one folder", async () => {
    const contains = fs({ "C:/proj": ["AGENTS.md", "CLAUDE.md"] });
    expect((await detectVault("C:/proj", contains))?.mode).toBe("claude");
  });

  it("markers in the excluded root or its ancestors never win", async () => {
    // The user's home holds tool config dirs (.claude, .codex) that
    // must not turn the whole profile into a vault.
    const contains = fs({
      "C:/Users/xavia": [".claude"],
      "C:/Users": ["CLAUDE.md"],
    });
    expect(
      await detectVault("C:/Users/xavia/Documents/notes", contains, "C:/Users/xavia"),
    ).toBeNull();
  });

  it("a marked project under the excluded root is still a vault", async () => {
    const contains = fs({
      "C:/Users/xavia": [".claude"],
      "C:/Users/xavia/proj": ["CLAUDE.md"],
    });
    expect(
      (await detectVault("C:/Users/xavia/proj/docs", contains, "C:/Users/xavia"))?.root,
    ).toBe("C:/Users/xavia/proj");
  });

  it("exclusion matches whole path segments, not name prefixes", async () => {
    const contains = fs({ "C:/Users/xavia2": ["CLAUDE.md"] });
    expect(
      (await detectVault("C:/Users/xavia2/docs", contains, "C:/Users/xavia"))?.root,
    ).toBe("C:/Users/xavia2");
  });

  it("never probes a bare drive, only the rooted drive path", async () => {
    // "C:" without a separator is drive-relative on Windows: listing it
    // reads the current working directory, which Explorer sets to the
    // opened file's folder — probing it would hijack the vault root.
    const probed: string[] = [];
    const contains = (dir: string, name: string): Promise<boolean> => {
      probed.push(dir);
      return Promise.resolve(
        dir === "C:/proj/docs" && name === "CLAUDE.md",
      );
    };
    const info = await detectVault("C:/proj/docs", contains);
    expect(info?.root).toBe("C:/proj/docs");
    expect(probed).not.toContain("C:");
    expect(probed).toContain("C:/");
  });
});

describe("isExcludedDir / isHiddenDir — the two criteria, apart (m40)", () => {
  it("always excludes the ignore list, case-insensitively", () => {
    expect(isExcludedDir("node_modules")).toBe(true);
    expect(isExcludedDir("Target")).toBe(true);
    expect(isExcludedDir("dist")).toBe(true);
    expect(isExcludedDir("notes")).toBe(false);
  });

  it("always excludes .git contents — never user notes, huge inside", () => {
    expect(isExcludedDir(".git")).toBe(true);
    expect(isExcludedDir(".GIT")).toBe(true);
    // Other dot folders stay a setting decision, not an exclusion.
    expect(isExcludedDir(".obsidian")).toBe(false);
    expect(isExcludedDir(".claude")).toBe(false);
  });

  it("flags dot folders as hidden, nothing else", () => {
    expect(isHiddenDir(".git")).toBe(true);
    expect(isHiddenDir(".claude")).toBe(true);
    expect(isHiddenDir(".obsidian")).toBe(true);
    expect(isHiddenDir("node_modules")).toBe(false);
    expect(isHiddenDir("notes")).toBe(false);
  });
});

describe("detectVault — .obsidian and .git markers (m40)", () => {
  it("an .obsidian folder roots an obsidian vault", async () => {
    const contains = fs({ "C:/notes": [".obsidian", "a.md"] });
    expect(await detectVault("C:/notes/sub", contains)).toEqual({
      root: "C:/notes",
      mode: "obsidian",
      marker: ".obsidian",
    });
  });

  it("a .git marker roots a git vault (file or folder alike)", async () => {
    // The probe matches names only, so a .git *file* (worktrees,
    // submodules) counts exactly like the directory.
    const contains = fs({ "C:/proj": [".git"] });
    expect(await detectVault("C:/proj/docs", contains)).toEqual({
      root: "C:/proj",
      mode: "git",
      marker: ".git",
    });
  });

  it(".obsidian outranks .git within one folder", async () => {
    const contains = fs({ "C:/proj": [".git", ".obsidian"] });
    expect((await detectVault("C:/proj", contains))?.mode).toBe("obsidian");
  });

  it("existing markers outrank the new ones within one folder", async () => {
    const contains = fs({ "C:/proj": [".git", "CLAUDE.md"] });
    expect((await detectVault("C:/proj", contains))?.mode).toBe("claude");
  });

  it("the farthest ancestor still wins across marker kinds", async () => {
    // A CLAUDE project nested inside a git checkout: the checkout is
    // the vault, whatever the nested marker says.
    const contains = fs({
      "C:/repo": [".git"],
      "C:/repo/proj": ["CLAUDE.md"],
    });
    const info = await detectVault("C:/repo/proj/docs", contains);
    expect(info).toEqual({ root: "C:/repo", mode: "git", marker: ".git" });
  });

  it("a .git under the excluded root still never wins", async () => {
    const contains = fs({ "C:/Users/xavia": [".git"] });
    expect(
      await detectVault(
        "C:/Users/xavia/Documents/notes",
        contains,
        "C:/Users/xavia",
      ),
    ).toBeNull();
  });
});
