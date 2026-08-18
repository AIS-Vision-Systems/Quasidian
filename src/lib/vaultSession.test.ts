import { describe, expect, it } from "vitest";
import {
  emptyUiState,
  fnv1a,
  parseScopeEntry,
  parseUiState,
  resolveScope,
  routeDecision,
  scopeKey,
  serializeUiState,
  sessionFileName,
  sessionOwner,
  type ScopeEntry,
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

describe("parseScopeEntry", () => {
  it("round-trips a valid entry", () => {
    const entry = parseScopeEntry(
      "w1",
      JSON.stringify({ key: "c:/notes", root: "C:/Notes", focusedAt: 42 }),
    );
    expect(entry).toEqual({
      label: "w1",
      key: "c:/notes",
      root: "C:/Notes",
      focusedAt: 42,
    });
  });

  it("rejects garbage", () => {
    expect(parseScopeEntry("w1", "not json")).toBeNull();
    expect(parseScopeEntry("w1", "42")).toBeNull();
    expect(parseScopeEntry("w1", '{"key": "", "root": "r", "focusedAt": 1}')).toBeNull();
    expect(parseScopeEntry("w1", '{"key": "k", "root": "r"}')).toBeNull();
  });
});

describe("routeDecision", () => {
  const entry = (label: string, key: string, focusedAt: number): ScopeEntry => ({
    label,
    key,
    root: key,
    focusedAt,
  });

  it("opens in place in a scopeless window or inside the own scope", () => {
    expect(routeDecision("c:/b", null, [], [], "main")).toEqual({
      action: "in-place",
    });
    expect(routeDecision("c:/a", "c:/a", [entry("w1", "c:/a", 5)], ["w1"], "main")).toEqual({
      action: "in-place",
    });
  });

  it("focuses the live window already holding the scope", () => {
    const entries = [entry("main", "c:/a", 1), entry("w1", "c:/b", 2)];
    expect(routeDecision("c:/b", "c:/a", entries, ["main", "w1"], "main")).toEqual({
      action: "focus",
      label: "w1",
    });
  });

  it("prefers the most recently focused of several holders", () => {
    const entries = [entry("w1", "c:/b", 2), entry("w2", "c:/b", 7)];
    expect(routeDecision("c:/b", "c:/a", entries, ["w1", "w2"], "main")).toEqual({
      action: "focus",
      label: "w2",
    });
  });

  it("ignores stale entries of dead windows and spawns", () => {
    const entries = [entry("w1", "c:/b", 9)];
    expect(routeDecision("c:/b", "c:/a", entries, ["main"], "main")).toEqual({
      action: "spawn",
    });
  });

  it("never routes to itself", () => {
    // A self entry with the target key would be inconsistent (homeKey
    // differs); it must not produce a focus on this same window.
    const entries = [entry("main", "c:/b", 9)];
    expect(routeDecision("c:/b", "c:/a", entries, ["main"], "main")).toEqual({
      action: "spawn",
    });
  });
});

describe("sessionOwner", () => {
  const entry = (label: string, key: string, focusedAt: number): ScopeEntry => ({
    label,
    key,
    root: key,
    focusedAt,
  });

  it("is the most recently focused live window of the scope", () => {
    const entries = [entry("main", "c:/a", 3), entry("w1", "c:/a", 8)];
    expect(sessionOwner(entries, "c:/a", ["main", "w1"])).toBe("w1");
    expect(sessionOwner(entries, "c:/a", ["main"])).toBe("main");
  });

  it("trusts the registry when no live list is given", () => {
    const entries = [entry("main", "c:/a", 3), entry("w1", "c:/a", 8)];
    expect(sessionOwner(entries, "c:/a")).toBe("w1");
  });

  it("is null when no entry matches the scope", () => {
    expect(sessionOwner([entry("main", "c:/a", 3)], "c:/b")).toBeNull();
  });

  it("breaks focusedAt ties deterministically", () => {
    const entries = [entry("w1", "c:/a", 5), entry("w2", "c:/a", 5)];
    expect(sessionOwner(entries, "c:/a")).toBe("w2");
  });
});
