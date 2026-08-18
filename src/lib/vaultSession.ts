// Pure module: no Tauri, no DOM. Per-vault sessions (phase 4): every
// vault or folder scope persists its own session file, plus one global
// ui-state file holding the layout fallbacks and the last active
// vault. Scope keys are lowercased like `insideVault` in the layout —
// on a case-sensitive filesystem two folders differing only in case
// would share a key, which we accept for consistency.
import { dirname, normalizePath } from "./paths";
import { detectVault } from "./vault";
import { parseSessionExtras, type PanelSizes, type RightPanelView } from "./workspace";

/** 32-bit FNV-1a hash of `text`, as 8 hex characters. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // hash *= 16777619, in 32-bit arithmetic without BigInt.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Canonical, comparable key of a scope root. */
export function scopeKey(root: string): string {
  return normalizePath(root).toLowerCase();
}

/** Session file name for a scope key, unique per key via the hash. */
export function sessionFileName(key: string): string {
  return `vault-${fnv1a(key)}.json`;
}

export interface ScopeInfo {
  /** Scope root path, in its original (display) case. */
  root: string;
  /** Canonical key — always `scopeKey(root)`. */
  key: string;
}

export function scopeOf(root: string): ScopeInfo {
  return { root, key: scopeKey(root) };
}

/**
 * Scope of a file or folder: the root of its vault (marker files, via
 * the injected `contains`) or, without markers, the immediate folder.
 * `excludedRoot` (the user home) and its ancestors never root a vault.
 */
export async function resolveScope(
  path: string,
  kind: "file" | "folder",
  contains: (dir: string, name: string) => Promise<boolean>,
  excludedRoot?: string,
): Promise<ScopeInfo> {
  const folder = kind === "file" ? dirname(path) : path;
  const vault = await detectVault(folder, contains, excludedRoot);
  return scopeOf(vault?.root ?? folder);
}

// --- Global UI state (ui-state.json) ---

export interface UiState {
  /** Panel-size fallback for vaults without a session. */
  panels: PanelSizes | null;
  /** Right-panel view fallback for vaults without a session. */
  rightView: RightPanelView | null;
  /** Root of the last active vault, restored on plain startups. */
  lastVault: string | null;
}

export function emptyUiState(): UiState {
  return { panels: null, rightView: null, lastVault: null };
}

/** Parses ui-state.json; merge-with-defaults, never throws. */
export function parseUiState(json: string): UiState {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return emptyUiState();
  }
  if (typeof raw !== "object" || raw === null) {
    return emptyUiState();
  }
  const root = raw as Record<string, unknown>;
  const { panels, rightView } = parseSessionExtras(root);
  const lastVault =
    typeof root.lastVault === "string" && root.lastVault !== ""
      ? root.lastVault
      : null;
  return { panels, rightView, lastVault };
}

export function serializeUiState(state: UiState): string {
  return JSON.stringify(state, null, 2);
}
