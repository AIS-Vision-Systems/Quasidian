import { describe, expect, it } from "vitest";
import {
  activePane,
  closePane,
  emptySplit,
  moveTabToPane,
  paneById,
  parseSession,
  resizeBorder,
  serializeSession,
  setActivePane,
  singlePane,
  splitRight,
  totalTabs,
  withWorkspaceOrCollapse,
} from "./panes";
import { emptyWorkspace, makeTab, type WorkspaceState } from "./workspace";

function workspace(paths: string[], active = 0): WorkspaceState {
  return {
    tabs: paths.map((path) => makeTab(path)),
    active: paths.length === 0 ? -1 : active,
  };
}

describe("splitRight", () => {
  it("halves the source pane and activates the new one", () => {
    const state = splitRight(singlePane(workspace(["a.md"])), 1);
    expect(state.panes).toHaveLength(2);
    expect(state.panes[0].size).toBeCloseTo(0.5);
    expect(state.panes[1].size).toBeCloseTo(0.5);
    expect(state.activePane).toBe(state.panes[1].id);
    expect(activePane(state).workspace.tabs[0].path).toBeNull();
  });

  it("carries a given tab into the new pane", () => {
    const state = splitRight(singlePane(workspace(["a.md"])), 1, makeTab("a.md"));
    expect(activePane(state).workspace.tabs[0].path).toBe("a.md");
    expect(totalTabs(state)).toBe(2);
  });

  it("keeps sizes normalized after repeated splits", () => {
    let state = splitRight(singlePane(workspace(["a.md"])), 1);
    state = splitRight(state, state.activePane);
    const total = state.panes.reduce((sum, pane) => sum + pane.size, 0);
    expect(total).toBeCloseTo(1);
    expect(state.panes).toHaveLength(3);
  });
});

describe("closePane", () => {
  it("gives the width to the previous neighbor and re-activates it", () => {
    let state = splitRight(singlePane(workspace(["a.md"])), 1);
    const closing = state.activePane;
    state = closePane(state, closing);
    expect(state.panes).toHaveLength(1);
    expect(state.panes[0].size).toBeCloseTo(1);
    expect(state.activePane).toBe(state.panes[0].id);
  });

  it("never removes the last pane", () => {
    const state = singlePane(workspace(["a.md"]));
    expect(closePane(state, 1)).toBe(state);
  });

  it("collapses a pane whose workspace empties", () => {
    let state = splitRight(singlePane(workspace(["a.md"])), 1);
    const target = state.activePane;
    state = withWorkspaceOrCollapse(state, target, emptyWorkspace());
    expect(state.panes).toHaveLength(1);
    expect(paneById(state, target)).toBeNull();
  });
});

describe("moveTabToPane", () => {
  it("moves a tab, activates it in the target and collapses the source", () => {
    let state = splitRight(
      singlePane(workspace(["a.md", "b.md"], 0)),
      1,
      makeTab("c.md"),
    );
    const source = state.activePane;
    const target = state.panes[0].id;
    state = moveTabToPane(state, source, 0, target, 1);
    expect(state.panes).toHaveLength(1);
    expect(state.panes[0].workspace.tabs.map((tab) => tab.path)).toEqual([
      "a.md",
      "c.md",
      "b.md",
    ]);
    expect(state.panes[0].workspace.active).toBe(1);
    expect(state.activePane).toBe(target);
  });

  it("keeps both panes when the source still has tabs", () => {
    let state = splitRight(
      singlePane(workspace(["a.md", "b.md"], 0)),
      1,
      makeTab("c.md"),
    );
    const source = state.panes[0].id;
    const target = state.activePane;
    state = moveTabToPane(state, source, 1, target, 0);
    expect(state.panes).toHaveLength(2);
    expect(paneById(state, source)?.workspace.tabs).toHaveLength(1);
    expect(paneById(state, target)?.workspace.tabs.map((t) => t.path)).toEqual(
      ["b.md", "c.md"],
    );
  });
});

describe("resizeBorder and setActivePane", () => {
  it("shifts width between neighbors with a minimum", () => {
    let state = splitRight(singlePane(workspace(["a.md"])), 1);
    const left = state.panes[0].id;
    state = resizeBorder(state, left, 0.2);
    expect(state.panes[0].size).toBeCloseTo(0.7);
    expect(state.panes[1].size).toBeCloseTo(0.3);
    // Clamped at the minimum.
    state = resizeBorder(state, left, 0.5);
    expect(state.panes[1].size).toBeCloseTo(0.15);
  });

  it("ignores activating an unknown pane", () => {
    const state = emptySplit();
    expect(setActivePane(state, 99)).toBe(state);
  });
});

describe("session snapshot (multi-pane)", () => {
  it("round trips panes with sizes, active pane and extras", () => {
    let state = splitRight(
      singlePane(workspace(["a.md"])),
      1,
      makeTab("b.md"),
    );
    state = resizeBorder(state, state.panes[0].id, 0.2);
    const session = serializeSession(
      state,
      () => "edit",
      { left: 200, right: 260 },
      "outline",
    );
    const parsed = parseSession(JSON.stringify(session));
    expect(parsed).not.toBeNull();
    expect(parsed!.panes).toHaveLength(2);
    expect(parsed!.panes[0].tabs[0].path).toBe("a.md");
    expect(parsed!.panes[1].tabs[0].path).toBe("b.md");
    expect(parsed!.panes[0].size).toBeCloseTo(0.7);
    expect(parsed!.activePane).toBe(1);
    expect(parsed!.panels).toEqual({ left: 200, right: 260 });
    expect(parsed!.rightView).toBe("outline");
  });

  it("drops panes holding only empty tabs", () => {
    const state = splitRight(singlePane(workspace(["a.md"])), 1); // empty pane
    const session = serializeSession(state, () => "edit");
    expect(session.panes).toHaveLength(1);
    expect(session.activePane).toBe(0);
  });

  it("loads the previous single-workspace format as one pane", () => {
    const parsed = parseSession(
      JSON.stringify({
        tabs: [{ path: "a.md", pinned: false, mode: "edit" }],
        active: 0,
        rightView: "outgoing",
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.panes).toHaveLength(1);
    expect(parsed!.panes[0].tabs[0].path).toBe("a.md");
    expect(parsed!.panes[0].size).toBe(1);
    expect(parsed!.rightView).toBe("outgoing");
  });

  it("returns null on malformed input", () => {
    expect(parseSession("not json")).toBeNull();
    expect(parseSession('{"panes": []}')).toBeNull();
    expect(parseSession('{"panes": [{"tabs": []}]}')).toBeNull();
  });
});
