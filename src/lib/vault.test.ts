import { describe, expect, it } from "vitest";
import { detectVault, isIgnoredDir } from "./vault";

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

describe("isIgnoredDir", () => {
  it("skips dot directories and the ignore list", () => {
    expect(isIgnoredDir(".git")).toBe(true);
    expect(isIgnoredDir(".claude")).toBe(true);
    expect(isIgnoredDir("node_modules")).toBe(true);
    expect(isIgnoredDir("Target")).toBe(true);
    expect(isIgnoredDir("notes")).toBe(false);
  });
});
