import { describe, expect, it } from "vitest";
import {
  emptyUiState,
  fnv1a,
  parseUiState,
  resolveScope,
  scopeKey,
  serializeUiState,
  sessionFileName,
} from "./vaultSession";

describe("fnv1a", () => {
  it("is stable and hex-formatted", () => {
    expect(fnv1a("c:/notes")).toBe(fnv1a("c:/notes"));
    expect(fnv1a("c:/notes")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("distinguishes different inputs", () => {
    expect(fnv1a("c:/notes")).not.toBe(fnv1a("c:/altres"));
    expect(fnv1a("")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("scopeKey", () => {
  it("normalizes separators and case", () => {
    expect(scopeKey("C:\\Notes\\Sub")).toBe("c:/notes/sub");
    expect(scopeKey("C:/Notes/Sub/")).toBe("c:/notes/sub");
    expect(scopeKey("/home/User")).toBe("/home/user");
  });

  it("equates paths built through different routes", () => {
    expect(scopeKey("C:/a/./b/../b")).toBe(scopeKey("c:\\a\\b"));
  });
});

describe("sessionFileName", () => {
  it("derives distinct, stable file names per key", () => {
    const a = sessionFileName("c:/notes");
    expect(a).toBe(sessionFileName("c:/notes"));
    expect(a).toMatch(/^vault-[0-9a-f]{8}\.json$/);
    expect(a).not.toBe(sessionFileName("c:/altres"));
  });
});

describe("resolveScope", () => {
  const fs = (layout: Record<string, string[]>) =>
    (dir: string, name: string): Promise<boolean> =>
      Promise.resolve((layout[dir] ?? []).includes(name));

  it("uses the vault root for a file inside a marked tree", async () => {
    const contains = fs({ "C:/proj": ["CLAUDE.md"] });
    const scope = await resolveScope("C:/proj/docs/nota.md", "file", contains);
    expect(scope).toEqual({ root: "C:/proj", key: "c:/proj" });
  });

  it("falls back to the immediate folder for an unmarked file", async () => {
    const contains = fs({});
    const scope = await resolveScope("C:/notes/nota.md", "file", contains);
    expect(scope).toEqual({ root: "C:/notes", key: "c:/notes" });
  });

  it("uses the folder itself (or its vault root) for folders", async () => {
    const contains = fs({ "C:/proj": [".claude"] });
    expect(await resolveScope("C:/proj/docs", "folder", contains)).toEqual({
      root: "C:/proj",
      key: "c:/proj",
    });
    expect(await resolveScope("C:/solta", "folder", fs({}))).toEqual({
      root: "C:/solta",
      key: "c:/solta",
    });
  });
});

describe("ui-state", () => {
  it("round-trips", () => {
    const state = {
      panels: { left: 280, right: 340 },
      rightView: "outline" as const,
      lastVault: "C:\\Data\\Notes",
    };
    expect(parseUiState(serializeUiState(state))).toEqual(state);
  });

  it("merges defaults over partial or invalid JSON", () => {
    expect(parseUiState("not json")).toEqual(emptyUiState());
    expect(parseUiState("42")).toEqual(emptyUiState());
    expect(parseUiState("{}")).toEqual(emptyUiState());
    expect(
      parseUiState('{"panels": {"left": "x"}, "rightView": "nope", "lastVault": ""}'),
    ).toEqual(emptyUiState());
    expect(parseUiState('{"lastVault": "C:/n"}').lastVault).toBe("C:/n");
  });
});
