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
  /** Side-panel visibility fallbacks (collapsed or expanded). */
  leftVisible: boolean | null;
  rightVisible: boolean | null;
  /** Root of the last active vault, restored on plain startups. */
  lastVault: string | null;
}

export function emptyUiState(): UiState {
  return {
    panels: null,
    rightView: null,
    leftVisible: null,
    rightVisible: null,
    lastVault: null,
  };
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
  const { panels, rightView, leftVisible, rightVisible } =
    parseSessionExtras(root);
  const lastVault =
    typeof root.lastVault === "string" && root.lastVault !== ""
      ? root.lastVault
      : null;
  return { panels, rightView, leftVisible, rightVisible, lastVault };
}

export function serializeUiState(state: UiState): string {
  return JSON.stringify(state, null, 2);
}

// --- Window registry and routing (milestone 31) ---

/** One window's published scope, as stored in the shared registry. */
export interface ScopeEntry {
  label: string;
  key: string;
  /** Scope root in display case (spawned windows need it verbatim). */
  root: string;
  /** Last time the window gained focus or published; newest wins. */
  focusedAt: number;
}

/** Parses one registry value; null when it is not a valid entry. */
export function parseScopeEntry(label: string, json: string): ScopeEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const entry = raw as Record<string, unknown>;
  if (
    typeof entry.key !== "string" ||
    entry.key === "" ||
    typeof entry.root !== "string" ||
    entry.root === "" ||
    typeof entry.focusedAt !== "number" ||
    !Number.isFinite(entry.focusedAt)
  ) {
    return null;
  }
  return { label, key: entry.key, root: entry.root, focusedAt: entry.focusedAt };
}

export type RouteDecision =
  | { action: "in-place" }
  | { action: "focus"; label: string }
  | { action: "spawn" };

/**
 * Where an explicit open of `targetKey` should land: this window (its
 * own scope, or none adopted yet), the live window already holding the
 * scope (the most recently focused one when several), or a new window.
 * Registry entries of dead windows (crashes) are ignored via
 * `liveLabels`.
 */
export function routeDecision(
  targetKey: string,
  homeKey: string | null,
  entries: readonly ScopeEntry[],
  liveLabels: readonly string[],
  selfLabel: string,
): RouteDecision {
  if (homeKey === null || homeKey === targetKey) {
    return { action: "in-place" };
  }
  const holder = latestForKey(entries, targetKey, liveLabels, selfLabel);
  return holder === null
    ? { action: "spawn" }
    : { action: "focus", label: holder };
}

/**
 * Which window persists the tab session of `key`: the most recently
 * focused live one — so a stray second window on the same vault never
 * clobbers the session of the one the user works in. Null when no
 * entry qualifies (the caller saves). Omitting `liveLabels` trusts the
 * registry as-is (the synchronous close path).
 */
export function sessionOwner(
  entries: readonly ScopeEntry[],
  key: string,
  liveLabels?: readonly string[],
): string | null {
  return latestForKey(entries, key, liveLabels ?? null, null);
}

/** Latest-focused entry for `key`, filtered and deterministic. */
function latestForKey(
  entries: readonly ScopeEntry[],
  key: string,
  liveLabels: readonly string[] | null,
  excludeLabel: string | null,
): string | null {
  let best: ScopeEntry | null = null;
  for (const entry of entries) {
    if (entry.key !== key || entry.label === excludeLabel) {
      continue;
    }
    if (liveLabels !== null && !liveLabels.includes(entry.label)) {
      continue;
    }
    if (
      best === null ||
      entry.focusedAt > best.focusedAt ||
      (entry.focusedAt === best.focusedAt && entry.label > best.label)
    ) {
      best = entry;
    }
  }
  return best?.label ?? null;
}
