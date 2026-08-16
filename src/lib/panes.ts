// Pure module: no Tauri, no DOM. The split layout of the central area:
// an ordered list of vertical panes ("split right" only — split down is
// out of scope), each holding its own tab workspace and a width
// fraction. One pane is always active.
import {
  closeTab,
  emptyWorkspace,
  makeTab,
  parseSessionExtras,
  parseTabs,
  serializeTabs,
  type PanelSizes,
  type RightPanelView,
  type SessionMode,
  type SessionTabs,
  type Tab,
  type WorkspaceState,
} from "./workspace";

export interface PaneState {
  /** Stable identity across splits/closes (DOM reuse, session). */
  id: number;
  workspace: WorkspaceState;
  /** Fraction of the central width, normalized to sum 1. */
  size: number;
}

export interface SplitState {
  panes: PaneState[];
  /** Id of the active pane (receives opens and commands). */
  activePane: number;
  nextId: number;
}

export function singlePane(workspace: WorkspaceState): SplitState {
  return {
    panes: [{ id: 1, workspace, size: 1 }],
    activePane: 1,
    nextId: 2,
  };
}

export function paneById(state: SplitState, id: number): PaneState | null {
  return state.panes.find((pane) => pane.id === id) ?? null;
}

export function activePane(state: SplitState): PaneState {
  return (
    paneById(state, state.activePane) ?? state.panes[0]
  );
}

export function paneIndex(state: SplitState, id: number): number {
  return state.panes.findIndex((pane) => pane.id === id);
}

function normalized(panes: PaneState[]): PaneState[] {
  const total = panes.reduce((sum, pane) => sum + pane.size, 0);
  if (total <= 0) {
    const even = 1 / panes.length;
    return panes.map((pane) => ({ ...pane, size: even }));
  }
  return panes.map((pane) => ({ ...pane, size: pane.size / total }));
}

/** Replaces the workspace of pane `id`. */
export function withWorkspace(
  state: SplitState,
  id: number,
  workspace: WorkspaceState,
): SplitState {
  return {
    ...state,
    panes: state.panes.map((pane) =>
      pane.id === id ? { ...pane, workspace } : pane,
    ),
  };
}

export function setActivePane(state: SplitState, id: number): SplitState {
  return paneById(state, id) === null
    ? state
    : { ...state, activePane: id };
}

/**
 * Splits pane `id` to the right: the new pane takes half its width and
 * becomes active, holding `tab` (or an empty tab).
 */
export function splitRight(
  state: SplitState,
  id: number,
  tab: Tab = makeTab(null),
): SplitState {
  const index = paneIndex(state, id);
  const source = state.panes[index];
  if (source === undefined) {
    return state;
  }
  const half = source.size / 2;
  const fresh: PaneState = {
    id: state.nextId,
    workspace: { tabs: [tab], active: 0 },
    size: half,
  };
  const panes = [...state.panes];
  panes[index] = { ...source, size: half };
  panes.splice(index + 1, 0, fresh);
  return {
    panes: normalized(panes),
    activePane: fresh.id,
    nextId: state.nextId + 1,
  };
}

/**
 * Removes pane `id`; its width goes to the previous neighbor (or the
 * next when it was first). The last pane is never removed.
 */
export function closePane(state: SplitState, id: number): SplitState {
  const index = paneIndex(state, id);
  if (index === -1 || state.panes.length <= 1) {
    return state;
  }
  const removed = state.panes[index];
  const panes = state.panes.filter((pane) => pane.id !== id);
  const heirIndex = Math.max(0, index - 1);
  panes[heirIndex] = {
    ...panes[heirIndex],
    size: panes[heirIndex].size + removed.size,
  };
  return {
    panes: normalized(panes),
    activePane:
      state.activePane === id ? panes[heirIndex].id : state.activePane,
    nextId: state.nextId,
  };
}

/**
 * Applies a workspace change to pane `id`; when its tab list becomes
 * empty and other panes remain, the pane collapses.
 */
export function withWorkspaceOrCollapse(
  state: SplitState,
  id: number,
  workspace: WorkspaceState,
): SplitState {
  if (workspace.tabs.length === 0 && state.panes.length > 1) {
    return closePane(state, id);
  }
  return withWorkspace(state, id, workspace);
}

/**
 * Moves the tab at `tabIndex` of pane `fromId` into pane `toId` at
 * `position` (clamped). The source pane collapses if it empties; the
 * moved tab becomes active in the target pane, which becomes active.
 */
export function moveTabToPane(
  state: SplitState,
  fromId: number,
  tabIndex: number,
  toId: number,
  position: number,
): SplitState {
  const from = paneById(state, fromId);
  const to = paneById(state, toId);
  const tab = from?.workspace.tabs[tabIndex];
  if (from === null || to === null || tab === undefined) {
    return state;
  }
  if (fromId === toId) {
    return state;
  }
  const sourceWorkspace = closeTab(from.workspace, tabIndex);
  const at = Math.max(0, Math.min(position, to.workspace.tabs.length));
  const targetWorkspace: WorkspaceState = {
    tabs: [
      ...to.workspace.tabs.slice(0, at),
      tab,
      ...to.workspace.tabs.slice(at),
    ],
    active: at,
  };
  let next = withWorkspace(state, toId, targetWorkspace);
  next = withWorkspaceOrCollapse(next, fromId, sourceWorkspace);
  return setActivePane(next, toId);
}

/**
 * Resizes the border between pane `id` and its right neighbor by
 * `delta` (fraction of the total width), keeping a minimum per pane.
 */
export function resizeBorder(
  state: SplitState,
  id: number,
  delta: number,
  minimum = 0.15,
): SplitState {
  const index = paneIndex(state, id);
  const left = state.panes[index];
  const right = state.panes[index + 1];
  if (left === undefined || right === undefined) {
    return state;
  }
  const shift = Math.max(
    -(left.size - minimum),
    Math.min(delta, right.size - minimum),
  );
  const panes = [...state.panes];
  panes[index] = { ...left, size: left.size + shift };
  panes[index + 1] = { ...right, size: right.size - shift };
  return { ...state, panes };
}

/** Total number of open tabs across all panes. */
export function totalTabs(state: SplitState): number {
  return state.panes.reduce(
    (sum, pane) => sum + pane.workspace.tabs.length,
    0,
  );
}

export function emptySplit(): SplitState {
  return singlePane(emptyWorkspace());
}

// --- Session snapshot (v3: multi-pane; older single-pane files load) ---

export interface SessionPane extends SessionTabs {
  size: number;
}

export interface SessionData {
  panes: SessionPane[];
  /** Index into `panes` of the active one. */
  activePane: number;
  panels: PanelSizes | null;
  rightView: RightPanelView | null;
}

export function serializeSession(
  state: SplitState,
  modeOf: (tab: Tab) => SessionMode,
  panels: PanelSizes | null = null,
  rightView: RightPanelView | null = null,
): SessionData {
  const panes: SessionPane[] = [];
  let active = 0;
  for (const pane of state.panes) {
    const tabs = serializeTabs(pane.workspace, modeOf);
    if (tabs.tabs.length === 0) {
      continue; // panes holding only empty tabs are not persisted
    }
    if (pane.id === state.activePane) {
      active = panes.length;
    }
    panes.push({ ...tabs, size: pane.size });
  }
  return {
    panes,
    activePane: panes.length === 0 ? 0 : Math.min(active, panes.length - 1),
    panels,
    rightView,
  };
}

/**
 * Parses a session.json payload — the multi-pane shape or the previous
 * single-workspace one. Null when nothing valid remains.
 */
export function parseSession(json: string): SessionData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const root = raw as Record<string, unknown>;
  const extras = parseSessionExtras(root);
  const panes: SessionPane[] = [];
  if (Array.isArray(root.panes)) {
    for (const entry of root.panes) {
      const tabs = parseTabs(entry);
      if (tabs === null) {
        continue;
      }
      const size =
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).size === "number" &&
        Number.isFinite((entry as Record<string, unknown>).size)
          ? ((entry as Record<string, unknown>).size as number)
          : 0;
      panes.push({ ...tabs, size });
    }
  } else {
    // Previous format: one workspace at the top level.
    const tabs = parseTabs(root);
    if (tabs !== null) {
      panes.push({ ...tabs, size: 1 });
    }
  }
  if (panes.length === 0) {
    return null;
  }
  // Renormalize sizes (dropped panes, missing values).
  const total = panes.reduce((sum, pane) => sum + pane.size, 0);
  const even = 1 / panes.length;
  for (const pane of panes) {
    pane.size = total > 0 ? pane.size / total : even;
  }
  const activePane =
    typeof root.activePane === "number" && Number.isInteger(root.activePane)
      ? Math.max(0, Math.min(root.activePane, panes.length - 1))
      : 0;
  return { panes, activePane, ...extras };
}
