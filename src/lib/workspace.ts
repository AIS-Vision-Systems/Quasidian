// Pure module: no Tauri, no DOM. Tab-list state for the workspace and
// the session snapshot that persists it, with Obsidian-style open
// semantics. All operations return a new state.
import { normalizePath } from "./paths";

export interface Tab {
  path: string;
  pinned: boolean;
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
  return state.tabs.findIndex((tab) => normalizePath(tab.path) === key);
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
  const tab: Tab = { path, pinned: false };
  const active = state.tabs[state.active];
  if (newTab || active === undefined || active.pinned) {
    const at = active === undefined ? state.tabs.length : state.active + 1;
    return {
      tabs: [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)],
      active: at,
    };
  }
  const tabs = [...state.tabs];
  tabs[state.active] = tab;
  return { tabs, active: state.active };
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

/** Repoints every tab holding `from` to `to` (file renames). */
export function renameTabPath(
  state: WorkspaceState,
  from: string,
  to: string,
): WorkspaceState {
  const key = normalizePath(from);
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (normalizePath(tab.path) === key) {
      changed = true;
      return { ...tab, path: to };
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
}

export interface SessionData {
  tabs: SessionTab[];
  active: number;
}

/** Snapshot of the workspace plus each tab's mode, for session.json. */
export function serializeSession(
  state: WorkspaceState,
  modeOf: (path: string) => SessionMode,
): SessionData {
  return {
    tabs: state.tabs.map((tab) => ({
      path: tab.path,
      pinned: tab.pinned,
      mode: modeOf(tab.path),
    })),
    active: state.active,
  };
}

/**
 * Parses a session.json payload; malformed input or an empty tab list
 * yields null (start fresh). Individual bad entries are dropped.
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
