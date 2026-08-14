import { describe, expect, it } from "vitest";
import {
  activeTabPath,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  emptyWorkspace,
  findTab,
  moveTab,
  openPath,
  parseSession,
  renameTabPath,
  serializeSession,
  setPinned,
  type WorkspaceState,
} from "./workspace";

function workspace(paths: string[], active = 0): WorkspaceState {
  return {
    tabs: paths.map((path) => ({ path, pinned: false })),
    active: paths.length === 0 ? -1 : active,
  };
}

describe("openPath — Obsidian-style navigation", () => {
  it("creates the first tab", () => {
    const state = openPath(emptyWorkspace(), "C:/notes/a.md");
    expect(state.tabs).toHaveLength(1);
    expect(state.active).toBe(0);
    expect(activeTabPath(state)).toBe("C:/notes/a.md");
  });

  it("reuses the active tab when navigating", () => {
    const state = openPath(workspace(["a.md"]), "b.md");
    expect(state.tabs).toHaveLength(1);
    expect(activeTabPath(state)).toBe("b.md");
  });

  it("opens a new tab after the active one when asked", () => {
    const state = openPath(workspace(["a.md", "c.md"], 0), "b.md", true);
    expect(state.tabs.map((tab) => tab.path)).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
    expect(state.active).toBe(1);
  });

  it("activates an existing tab instead of duplicating it", () => {
    const state = openPath(workspace(["a.md", "b.md"], 0), "b.md", true);
    expect(state.tabs).toHaveLength(2);
    expect(state.active).toBe(1);
  });

  it("matches existing tabs across separator styles", () => {
    expect(findTab(workspace(["C:/Notes/A.md"]), "C:\\Notes\\A.md")).toBe(0);
  });

  it("never replaces a pinned tab: navigation opens a new one", () => {
    const pinned = setPinned(workspace(["a.md"]), 0, true);
    const state = openPath(pinned, "b.md");
    expect(state.tabs.map((tab) => tab.path)).toEqual(["a.md", "b.md"]);
    expect(state.active).toBe(1);
  });
});

describe("closeTab", () => {
  it("activates the next tab, or the previous at the end", () => {
    const mid = closeTab(workspace(["a.md", "b.md", "c.md"], 1), 1);
    expect(activeTabPath(mid)).toBe("c.md");
    const last = closeTab(workspace(["a.md", "b.md"], 1), 1);
    expect(activeTabPath(last)).toBe("a.md");
  });

  it("keeps the active tab when closing another one", () => {
    const state = closeTab(workspace(["a.md", "b.md", "c.md"], 2), 0);
    expect(activeTabPath(state)).toBe("c.md");
  });

  it("empties the workspace when the last tab closes", () => {
    const state = closeTab(workspace(["a.md"]), 0);
    expect(state.tabs).toHaveLength(0);
    expect(state.active).toBe(-1);
    expect(activeTabPath(state)).toBeNull();
  });
});

describe("closeOtherTabs and closeAllTabs", () => {
  it("close others keeps the chosen tab and the pinned ones", () => {
    const pinned = setPinned(workspace(["a.md", "b.md", "c.md"], 2), 0, true);
    const state = closeOtherTabs(pinned, 2);
    expect(state.tabs.map((tab) => tab.path)).toEqual(["a.md", "c.md"]);
    expect(activeTabPath(state)).toBe("c.md");
  });

  it("close all keeps only pinned tabs", () => {
    const pinned = setPinned(workspace(["a.md", "b.md"], 1), 0, true);
    const state = closeAllTabs(pinned);
    expect(state.tabs.map((tab) => tab.path)).toEqual(["a.md"]);
    expect(state.active).toBe(0);
  });

  it("close all with nothing pinned empties the workspace", () => {
    const state = closeAllTabs(workspace(["a.md", "b.md"]));
    expect(state.tabs).toHaveLength(0);
    expect(state.active).toBe(-1);
  });
});

describe("moveTab", () => {
  it("reorders and keeps the active tab active", () => {
    const state = moveTab(workspace(["a.md", "b.md", "c.md"], 0), 0, 2);
    expect(state.tabs.map((tab) => tab.path)).toEqual([
      "b.md",
      "c.md",
      "a.md",
    ]);
    expect(activeTabPath(state)).toBe("a.md");
  });

  it("clamps the target position", () => {
    const state = moveTab(workspace(["a.md", "b.md"], 1), 1, 99);
    expect(state.tabs.map((tab) => tab.path)).toEqual(["a.md", "b.md"]);
  });
});

describe("renameTabPath", () => {
  it("repoints tabs holding the old path", () => {
    const state = renameTabPath(workspace(["a.md", "b.md"]), "a.md", "z.md");
    expect(state.tabs[0].path).toBe("z.md");
    expect(state.tabs[1].path).toBe("b.md");
  });
});

describe("session snapshot", () => {
  it("serializes tabs with their modes and survives a round trip", () => {
    const pinned = setPinned(workspace(["a.md", "b.md"], 1), 0, true);
    const session = serializeSession(pinned, (path) =>
      path === "a.md" ? "read" : "edit",
    );
    const parsed = parseSession(JSON.stringify(session));
    expect(parsed).toEqual({
      tabs: [
        { path: "a.md", pinned: true, mode: "read" },
        { path: "b.md", pinned: false, mode: "edit" },
      ],
      active: 1,
    });
  });

  it("returns null on malformed input", () => {
    expect(parseSession("not json")).toBeNull();
    expect(parseSession("42")).toBeNull();
    expect(parseSession('{"tabs": "nope"}')).toBeNull();
    expect(parseSession('{"tabs": []}')).toBeNull();
  });

  it("drops bad entries and clamps the active index", () => {
    const parsed = parseSession(
      JSON.stringify({
        tabs: [{ path: "a.md" }, { nope: true }, { path: "" }],
        active: 7,
      }),
    );
    expect(parsed).toEqual({
      tabs: [{ path: "a.md", pinned: false, mode: "edit" }],
      active: 0,
    });
  });
});
