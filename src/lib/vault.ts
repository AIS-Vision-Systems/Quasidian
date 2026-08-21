// Pure module: no Tauri, no DOM. Multi-folder vault modes: a marker
// file in the opened folder — or any ancestor — turns that folder into
// the root of a recursive, Obsidian-style vault. Without a marker the
// app keeps its flat single-folder behavior.
import { dirname, normalizePath } from "./paths";

export type VaultMode = "claude" | "gpt" | "obsidian" | "git";

/**
 * Marker names probed per folder, in priority order (m40). `.git` only
 * counts as a directory — a `.git` *file* is a worktree or submodule
 * pointer, and those folders belong to the checkout that contains
 * them, not to a vault of their own (maintainer decision on review).
 */
export const VAULT_MARKERS: readonly {
  name: string;
  mode: VaultMode;
  dirOnly?: true;
}[] = [
  { name: "CLAUDE.md", mode: "claude" },
  { name: ".claude", mode: "claude" },
  { name: "AGENTS.md", mode: "gpt" },
  { name: ".codex", mode: "gpt" },
  { name: ".obsidian", mode: "obsidian" },
  { name: ".git", mode: "git", dirOnly: true },
];

/** Directory names never scanned or shown inside a vault. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
]);

/**
 * Directories the vault scan must always skip, whatever the settings
 * say. The leading-dot criterion lives apart in `isHiddenDir`: hidden
 * folders scan or not by `files.showHiddenFolders` (m40). `.git` and
 * `.obsidian` are excluded here too — their contents are tool
 * internals, never user notes (and git's object store holds thousands
 * of directories that would swamp the scan). The marker probe is
 * unaffected: it matches the name in the parent, never the contents.
 */
export function isExcludedDir(name: string): boolean {
  const lower = name.toLowerCase();
  return IGNORED_DIRS.has(lower) || lower === ".git" || lower === ".obsidian";
}

/** Hidden folders: scanned only when the user opts in. */
export function isHiddenDir(name: string): boolean {
  return name.startsWith(".");
}

/** Safety bounds for the recursive scan of pathological folders. */
export const MAX_VAULT_DEPTH = 16;

export interface VaultInfo {
  /** Folder that acts as the vault root. */
  root: string;
  mode: VaultMode;
  /** Marker file that activated the mode. */
  marker: string;
}

/** Whether `dir` is `path` itself or one of its ancestors. */
function isAncestorOrSelf(dir: string, path: string): boolean {
  const dirKey = normalizePath(dir).toLowerCase();
  const pathKey = normalizePath(path).toLowerCase();
  return (
    pathKey === dirKey ||
    pathKey.startsWith(dirKey.endsWith("/") ? dirKey : dirKey + "/")
  );
}

/**
 * Walks from `folder` to the filesystem root probing for markers via
 * the injected `contains`. The **farthest** marked ancestor wins, so a
 * whole project is always one vault regardless of nested markers.
 *
 * `excludedRoot` (typically the user's home directory) and its
 * ancestors never root a vault: tool config dirs living in the home —
 * `.claude`, `.codex` — would otherwise turn the whole profile into
 * one giant vault for every note under it.
 */
/**
 * Probe injected into `detectVault`: does `dir` contain `name`? With
 * `dirOnly`, only a directory entry counts (the `.git` marker).
 */
export type MarkerProbe = (
  dir: string,
  name: string,
  dirOnly?: boolean,
) => Promise<boolean>;

export async function detectVault(
  folder: string,
  contains: MarkerProbe,
  excludedRoot?: string,
): Promise<VaultInfo | null> {
  let found: VaultInfo | null = null;
  let dir = folder;
  for (let depth = 0; depth < 64; depth++) {
    const excluded =
      excludedRoot !== undefined && isAncestorOrSelf(dir, excludedRoot);
    if (!excluded) {
      for (const marker of VAULT_MARKERS) {
        if (await contains(dir, marker.name, marker.dirOnly === true)) {
          found = { root: dir, mode: marker.mode, marker: marker.name };
          break;
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir || parent === "") {
      break;
    }
    dir = parent;
  }
  return found;
}
