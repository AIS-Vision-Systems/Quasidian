import { describe, expect, it } from "vitest";
import {
  activeTabPath,
  cloneTab,
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
  newEmptyTab,
  openPath,
  parseTabs,
  peekBack,
  peekForward,
  renameTabPath,
  serializeTabs,
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

  it("peeks back and forward without mutating", () => {
    let state = openPath(openPath(workspace(["a.md"]), "b.md"), "c.md");
    expect(peekBack(state)).toBe("b.md");
    expect(peekForward(state)).toBeNull();
    const before = state;
    state = goBack(state)!;
    expect(peekBack(state)).toBe("a.md");
    expect(peekForward(state)).toBe("c.md");
    expect(before.tabs[0].back).toEqual(["a.md", "b.md"]); // untouched
    expect(peekBack(workspace(["a.md"]))).toBeNull();
    expect(peekBack(emptyWorkspace())).toBeNull();
  });
});

describe("empty tabs", () => {
  it("newEmptyTab inserts after the active tab and activates it", () => {
    const state = newEmptyTab(workspace(["a.md", "b.md"], 0));
    expect(state.tabs.map((tab) => tab.path)).toEqual(["a.md", null, "b.md"]);
    expect(state.active).toBe(1);
    expect(activeTabPath(state)).toBeNull();
  });

  it("navigating an empty tab records no history", () => {
    let state = newEmptyTab(workspace(["a.md"]));
    state = openPath(state, "b.md");
    expect(activeTabPath(state)).toBe("b.md");
    expect(state.tabs[1].back).toEqual([]);
    expect(goBack(state)).toBeNull();
  });

  it("empty tabs never match a path lookup", () => {
    expect(findTab(newEmptyTab(emptyWorkspace()), "a.md")).toBe(-1);
  });

  it("tabs keep their identity through operations; clones get a new one", () => {
    const a = makeTab("a.md");
    expect(makeTab("a.md").id).not.toBe(a.id);
    const copy = cloneTab(a);
    expect(copy.id).not.toBe(a.id);
    expect(copy.path).toBe("a.md");
    // Navigation mutates the tab but preserves its identity.
    const state = openPath({ tabs: [a], active: 0 }, "b.md");
    expect(state.tabs[0].id).toBe(a.id);
    expect(renameTabPath(state, "b.md", "c.md").tabs[0].id).toBe(a.id);
  });

  it("serialization drops empty tabs and remaps the active index", () => {
    let state = workspace(["a.md", "b.md"], 1);
    state = newEmptyTab(state); // a, b, (empty active)
    const session = serializeTabs(state, () => "edit");
    expect(session.tabs.map((tab) => tab.path)).toEqual(["a.md", "b.md"]);
    expect(session.active).toBe(1);
  });
});

describe("tab serialization", () => {
  it("round trips tabs with modes, pins and history", () => {
    let state = openPath(workspace(["a.md"]), "b.md");
    state = setPinned(state, 0, true);
    const session = serializeTabs(state, (tab) =>
      tab.path === "b.md" ? "read" : "edit",
    );
    expect(parseTabs(JSON.parse(JSON.stringify(session)))).toEqual({
      tabs: [
        {
          path: "b.md",
          pinned: true,
          mode: "read",
          source: false,
          back: ["a.md"],
          forward: [],
        },
      ],
      active: 0,
    });
  });

  it("round trips the per-tab source flag (m38)", () => {
    const state = openPath(workspace(["a.md"]), "b.md");
    const session = serializeTabs(
      state,
      () => "edit",
      (tab) => tab.path === "b.md",
    );
    const parsed = parseTabs(JSON.parse(JSON.stringify(session)));
    expect(parsed?.tabs[0].source).toBe(true);
  });

  it("defaults the source flag to off for pre-m38 sessions", () => {
    const parsed = parseTabs({
      tabs: [{ path: "a.md", mode: "edit" }],
      active: 0,
    });
    expect(parsed?.tabs[0].source).toBe(false);
  });

  it("returns null on malformed input", () => {
    expect(parseTabs(42)).toBeNull();
    expect(parseTabs({ tabs: "nope" })).toBeNull();
    expect(parseTabs({ tabs: [] })).toBeNull();
  });

  it("drops bad entries and clamps the active index", () => {
    expect(
      parseTabs({
        tabs: [{ path: "a.md", back: "nope" }, { nope: true }, { path: "" }],
        active: 7,
      }),
    ).toEqual({
      tabs: [
        {
          path: "a.md",
          pinned: false,
          mode: "edit",
          source: false,
          back: [],
          forward: [],
        },
      ],
      active: 0,
    });
  });
});
