// Pure module: no Tauri, no DOM. Tab-list state for the workspace and
// the session snapshot that persists it, with Obsidian-style open
// semantics. All operations return a new state.
import { normalizePath } from "./paths";

export interface Tab {
  /**
   * Stable identity of this tab instance across every workspace
   * operation — per-tab view state (mode, scroll) keys off it. Not
   * persisted; sessions assign fresh ids on load.
   */
  id: number;
  /** Open file, or null for an empty ("new") tab. */
  path: string | null;
  pinned: boolean;
  /** Paths visited before the current one (per-tab history). */
  back: string[];
  /** Paths undone with "back", replayed by "forward". */
  forward: string[];
}

/** Kept per side; older entries fall off the far end. */
const HISTORY_LIMIT = 50;

let nextTabId = 1;

export function makeTab(path: string | null, pinned = false): Tab {
  return { id: nextTabId++, path, pinned, back: [], forward: [] };
}

/** A second instance of `tab`: same file and history, own identity. */
export function cloneTab(tab: Tab): Tab {
  return {
    ...tab,
    id: nextTabId++,
    back: [...tab.back],
    forward: [...tab.forward],
  };
}

/** Inserts an empty tab after the active one and activates it. */
export function newEmptyTab(state: WorkspaceState): WorkspaceState {
  const at = state.active === -1 ? state.tabs.length : state.active + 1;
  return {
    tabs: [...state.tabs.slice(0, at), makeTab(null), ...state.tabs.slice(at)],
    active: at,
  };
}

export interface WorkspaceState {
  tabs: Tab[];
  /** Index of the active tab, or -1 when none. */
  active: number;
}

export function emptyWorkspace(): WorkspaceState {
  return { tabs: [], active: -1 };
}

export function activeTabPath(state: WorkspaceState): string | null {
  return state.tabs[state.active]?.path ?? null;
}

/** Index of the tab holding `path`, or -1. */
export function findTab(state: WorkspaceState, path: string): number {
  const key = normalizePath(path);
  return state.tabs.findIndex(
    (tab) => tab.path !== null && normalizePath(tab.path) === key,
  );
}

/**
 * Opens `path` Obsidian-style: a tab already holding it is activated;
 * otherwise a new tab is inserted after the active one when `newTab` is
 * set, when no tab exists yet or when the active tab is pinned — else
 * the active tab is reused (navigation replaces its file).
 */
export function openPath(
  state: WorkspaceState,
  path: string,
  newTab = false,
): WorkspaceState {
  const existing = findTab(state, path);
  if (existing !== -1) {
    return { ...state, active: existing };
  }
  const active = state.tabs[state.active];
  if (newTab || active === undefined || active.pinned) {
    const at = active === undefined ? state.tabs.length : state.active + 1;
    return {
      tabs: [...state.tabs.slice(0, at), makeTab(path), ...state.tabs.slice(at)],
      active: at,
    };
  }
  // Navigation replaces the active tab's file: the old one goes into
  // the tab's history (empty tabs have nothing to record) and any
  // undone future is discarded.
  const tabs = [...state.tabs];
  tabs[state.active] = {
    ...active,
    path,
    back:
      active.path === null
        ? active.back
        : [...active.back, active.path].slice(-HISTORY_LIMIT),
    forward: [],
  };
  return { tabs, active: state.active };
}

/** Steps the active tab back in its history, or returns null. */
export function goBack(state: WorkspaceState): WorkspaceState | null {
  const active = state.tabs[state.active];
  const previous = active?.back[active.back.length - 1];
  if (active === undefined || active.path === null || previous === undefined) {
    return null;
  }
  const tabs = [...state.tabs];
  tabs[state.active] = {
    ...active,
    path: previous,
    back: active.back.slice(0, -1),
    forward: [...active.forward, active.path].slice(-HISTORY_LIMIT),
  };
  return { tabs, active: state.active };
}

/** Steps the active tab forward in its history, or returns null. */
export function goForward(state: WorkspaceState): WorkspaceState | null {
  const active = state.tabs[state.active];
  const next = active?.forward[active.forward.length - 1];
  if (active === undefined || active.path === null || next === undefined) {
    return null;
  }
  const tabs = [...state.tabs];
  tabs[state.active] = {
    ...active,
    path: next,
    back: [...active.back, active.path].slice(-HISTORY_LIMIT),
    forward: active.forward.slice(0, -1),
  };
  return { tabs, active: state.active };
}

/** Whether back/forward are available for the active tab. */
export function historyState(state: WorkspaceState): {
  canBack: boolean;
  canForward: boolean;
} {
  const active = state.tabs[state.active];
  return {
    canBack: active !== undefined && active.back.length > 0,
    canForward: active !== undefined && active.forward.length > 0,
  };
}

/** Closes the tab at `index`; the next tab (or previous) activates. */
export function closeTab(
  state: WorkspaceState,
  index: number,
): WorkspaceState {
  if (state.tabs[index] === undefined) {
    return state;
  }
  const tabs = state.tabs.filter((_, i) => i !== index);
  let active = state.active;
  if (tabs.length === 0) {
    active = -1;
  } else if (index < active) {
    active -= 1;
  } else if (index === active) {
    active = Math.min(index, tabs.length - 1);
  }
  return { tabs, active };
}

/** Closes every tab except `index` and the pinned ones. */
export function closeOtherTabs(
  state: WorkspaceState,
  index: number,
): WorkspaceState {
  const kept = state.tabs[index];
  if (kept === undefined) {
    return state;
  }
  const tabs = state.tabs.filter((tab, i) => i === index || tab.pinned);
  return { tabs, active: tabs.indexOf(kept) };
}

/** Closes every unpinned tab; the active tab survives only if pinned. */
export function closeAllTabs(state: WorkspaceState): WorkspaceState {
  const tabs = state.tabs.filter((tab) => tab.pinned);
  if (tabs.length === 0) {
    return { tabs, active: -1 };
  }
  const current = state.tabs[state.active];
  const index = current === undefined ? -1 : tabs.indexOf(current);
  return { tabs, active: index === -1 ? 0 : index };
}

/** Moves the tab at `from` to position `to`, keeping the active tab. */
export function moveTab(
  state: WorkspaceState,
  from: number,
  to: number,
): WorkspaceState {
  const tab = state.tabs[from];
  if (tab === undefined || from === to) {
    return state;
  }
  const target = Math.max(0, Math.min(to, state.tabs.length - 1));
  const tabs = state.tabs.filter((_, i) => i !== from);
  tabs.splice(target, 0, tab);
  const current = state.tabs[state.active];
  return {
    tabs,
    active: current === undefined ? state.active : tabs.indexOf(current),
  };
}

export function setPinned(
  state: WorkspaceState,
  index: number,
  pinned: boolean,
): WorkspaceState {
  const tab = state.tabs[index];
  if (tab === undefined || tab.pinned === pinned) {
    return state;
  }
  const tabs = [...state.tabs];
  tabs[index] = { ...tab, pinned };
  return { tabs, active: state.active };
}

/** Repoints every tab (and its history) holding `from` to `to`. */
export function renameTabPath(
  state: WorkspaceState,
  from: string,
  to: string,
): WorkspaceState {
  const key = normalizePath(from);
  const rename = (path: string): string =>
    normalizePath(path) === key ? to : path;
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    const next = {
      ...tab,
      path: tab.path === null ? null : rename(tab.path),
      back: tab.back.map(rename),
      forward: tab.forward.map(rename),
    };
    if (
      next.path !== tab.path ||
      next.back.some((path, i) => path !== tab.back[i]) ||
      next.forward.some((path, i) => path !== tab.forward[i])
    ) {
      changed = true;
      return next;
    }
    return tab;
  });
  return changed ? { tabs, active: state.active } : state;
}

// --- Session snapshot ---

export type SessionMode = "edit" | "read";

export interface SessionTab {
  path: string;
  pinned: boolean;
  mode: SessionMode;
  back: string[];
  forward: string[];
}

export interface PanelSizes {
  left: number;
  right: number;
}

export type RightPanelView = "backlinks" | "outgoing" | "outline";

export interface SessionTabs {
  tabs: SessionTab[];
  active: number;
}

/**
 * Serializable snapshot of one workspace's tabs with their modes.
 * Empty tabs are not persisted; the active index is remapped.
 */
export function serializeTabs(
  state: WorkspaceState,
  modeOf: (tab: Tab) => SessionMode,
): SessionTabs {
  const tabs: SessionTab[] = [];
  let active = 0;
  state.tabs.forEach((tab, index) => {
    if (tab.path === null) {
      return;
    }
    if (index <= state.active) {
      active = tabs.length;
    }
    tabs.push({
      path: tab.path,
      pinned: tab.pinned,
      mode: modeOf(tab),
      back: tab.back.slice(-HISTORY_LIMIT),
      forward: tab.forward.slice(-HISTORY_LIMIT),
    });
  });
  return {
    tabs,
    active: tabs.length === 0 ? -1 : Math.min(active, tabs.length - 1),
  };
}

function pathList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry !== "")
    .slice(-HISTORY_LIMIT);
}

/** Parses one workspace's serialized tabs; null when nothing valid. */
export function parseTabs(raw: unknown): SessionTabs | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const root = raw as Record<string, unknown>;
  if (!Array.isArray(root.tabs)) {
    return null;
  }
  const tabs: SessionTab[] = [];
  for (const entry of root.tabs) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.path !== "string" || item.path === "") {
      continue;
    }
    tabs.push({
      path: item.path,
      pinned: item.pinned === true,
      mode: item.mode === "read" ? "read" : "edit",
      back: pathList(item.back),
      forward: pathList(item.forward),
    });
  }
  if (tabs.length === 0) {
    return null;
  }
  const active =
    typeof root.active === "number" && Number.isInteger(root.active)
      ? Math.max(0, Math.min(root.active, tabs.length - 1))
      : 0;
  return { tabs, active };
}

/** Parses the shared session extras (panel widths, right view). */
export function parseSessionExtras(root: Record<string, unknown>): {
  panels: PanelSizes | null;
  rightView: RightPanelView | null;
} {
  const rawPanels =
    typeof root.panels === "object" && root.panels !== null
      ? (root.panels as Record<string, unknown>)
      : null;
  const panels =
    rawPanels !== null &&
    typeof rawPanels.left === "number" &&
    Number.isFinite(rawPanels.left) &&
    typeof rawPanels.right === "number" &&
    Number.isFinite(rawPanels.right)
      ? { left: rawPanels.left, right: rawPanels.right }
      : null;
  const rightView =
    root.rightView === "backlinks" ||
    root.rightView === "outgoing" ||
    root.rightView === "outline"
      ? root.rightView
      : null;
  return { panels, rightView };
}
