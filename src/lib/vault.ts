// Pure module: no Tauri, no DOM. Multi-folder vault modes (CLAUDE/GPT):
// a marker file in the opened folder — or any ancestor — turns that
// folder into the root of a recursive, Obsidian-style vault. Without a
// marker the app keeps its flat single-folder behavior.
import { dirname } from "./paths";

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

/**
 * Walks from `folder` to the filesystem root probing for markers via
 * the injected `contains`. The **farthest** marked ancestor wins, so a
 * whole project is always one vault regardless of nested markers.
 */
export async function detectVault(
  folder: string,
  contains: (dir: string, name: string) => Promise<boolean>,
): Promise<VaultInfo | null> {
  let found: VaultInfo | null = null;
  let dir = folder;
  for (let depth = 0; depth < 64; depth++) {
    for (const marker of VAULT_MARKERS) {
      if (await contains(dir, marker.name)) {
        found = { root: dir, mode: marker.mode, marker: marker.name };
        break;
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
