import { describe, expect, it } from "vitest";
import {
  activeTabPath,
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  emptyWorkspace,
  findTab,
  goBack,
  goForward,
  historyState,
  makeTab,
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
    tabs: paths.map((path) => makeTab(path)),
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

describe("per-tab navigation history", () => {
  it("records the replaced path and discards the undone future", () => {
    let state = workspace(["a.md"]);
    state = openPath(state, "b.md");
    state = openPath(state, "c.md");
    expect(state.tabs[0].back).toEqual(["a.md", "b.md"]);
    expect(historyState(state)).toEqual({ canBack: true, canForward: false });
    state = goBack(state)!;
    expect(activeTabPath(state)).toBe("b.md");
    state = openPath(state, "d.md");
    expect(state.tabs[0].forward).toEqual([]);
    expect(state.tabs[0].back).toEqual(["a.md", "b.md"]);
  });

  it("goes back and forward symmetrically", () => {
    let state = openPath(openPath(workspace(["a.md"]), "b.md"), "c.md");
    state = goBack(state)!;
    state = goBack(state)!;
    expect(activeTabPath(state)).toBe("a.md");
    expect(goBack(state)).toBeNull();
    state = goForward(state)!;
    state = goForward(state)!;
    expect(activeTabPath(state)).toBe("c.md");
    expect(goForward(state)).toBeNull();
  });

  it("keeps history per tab: new tabs start clean", () => {
    let state = openPath(workspace(["a.md"]), "b.md");
    state = openPath(state, "c.md", true);
    expect(state.tabs[1].back).toEqual([]);
    expect(historyState(state).canBack).toBe(false);
  });

  it("renames paths inside the history stacks too", () => {
    let state = openPath(workspace(["a.md"]), "b.md");
    state = renameTabPath(state, "a.md", "z.md");
    expect(state.tabs[0].back).toEqual(["z.md"]);
  });
});

describe("session snapshot", () => {
  it("serializes tabs with modes, history and panels; round trips", () => {
    let state = openPath(workspace(["a.md"]), "b.md");
    state = setPinned(state, 0, true);
    const session = serializeSession(
      state,
      (path) => (path === "b.md" ? "read" : "edit"),
      { left: 220, right: 300 },
    );
    const parsed = parseSession(JSON.stringify(session));
    expect(parsed).toEqual({
      tabs: [
        {
          path: "b.md",
          pinned: true,
          mode: "read",
          back: ["a.md"],
          forward: [],
        },
      ],
      active: 0,
      panels: { left: 220, right: 300 },
    });
  });

  it("returns null on malformed input", () => {
    expect(parseSession("not json")).toBeNull();
    expect(parseSession("42")).toBeNull();
    expect(parseSession('{"tabs": "nope"}')).toBeNull();
    expect(parseSession('{"tabs": []}')).toBeNull();
  });

  it("drops bad entries, clamps active and tolerates missing fields", () => {
    const parsed = parseSession(
      JSON.stringify({
        tabs: [{ path: "a.md", back: "nope" }, { nope: true }, { path: "" }],
        active: 7,
        panels: { left: "wide" },
      }),
    );
    expect(parsed).toEqual({
      tabs: [
        { path: "a.md", pinned: false, mode: "edit", back: [], forward: [] },
      ],
      active: 0,
      panels: null,
    });
  });
});
