// Pure module: no Tauri, no DOM. Multi-folder vault modes (CLAUDE/GPT):
// a marker file in the opened folder — or any ancestor — turns that
// folder into the root of a recursive, Obsidian-style vault. Without a
// marker the app keeps its flat single-folder behavior.
import { dirname, normalizePath } from "./paths";

export type VaultMode = "claude" | "gpt";

/** Marker names probed per folder, in priority order. Easy to adjust. */
export const VAULT_MARKERS: readonly { name: string; mode: VaultMode }[] = [
  { name: "CLAUDE.md", mode: "claude" },
  { name: ".claude", mode: "claude" },
  { name: "AGENTS.md", mode: "gpt" },
  { name: ".codex", mode: "gpt" },
];

/** Directory names never scanned or shown inside a vault. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
]);

/** Hidden (dot) directories and the ignore list stay out of the vault. */
export function isIgnoredDir(name: string): boolean {
  return name.startsWith(".") || IGNORED_DIRS.has(name.toLowerCase());
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
export async function detectVault(
  folder: string,
  contains: (dir: string, name: string) => Promise<boolean>,
  excludedRoot?: string,
): Promise<VaultInfo | null> {
  let found: VaultInfo | null = null;
  let dir = folder;
  for (let depth = 0; depth < 64; depth++) {
    const excluded =
      excludedRoot !== undefined && isAncestorOrSelf(dir, excludedRoot);
    if (!excluded) {
      for (const marker of VAULT_MARKERS) {
        if (await contains(dir, marker.name)) {
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
