// Session store, phase 4: one session file per vault/folder scope
// (vault-<hash>.json) plus a global ui-state.json — all in the app
// config dir, never inside note folders. Best-effort: failures never
// break the app.
import { appConfigDir } from "@tauri-apps/api/path";
import { joinPath } from "../lib/paths";
import { parseSession, type SessionData } from "../lib/panes";
import {
  emptyUiState,
  parseUiState,
  scopeKey,
  serializeUiState,
  sessionFileName,
  type ScopeInfo,
  type UiState,
} from "../lib/vaultSession";
import {
  deleteFile,
  ensureDir,
  listFolder,
  readFile,
  writeFileAtomic,
} from "./fs";

const UI_STATE_FILE = "ui-state.json";

/**
 * Loads the session of `scope`. The stored `scope` field must map to
 * the same key — a hash collision or a moved folder reads as "no
 * session", never as another vault's tabs.
 */
export async function loadVaultSession(
  scope: ScopeInfo,
): Promise<SessionData | null> {
  try {
    const dir = await appConfigDir();
    const raw = await readFile(joinPath(dir, sessionFileName(scope.key)));
    const stored = (JSON.parse(raw) as Record<string, unknown>).scope;
    if (typeof stored !== "string" || scopeKey(stored) !== scope.key) {
      return null;
    }
    return parseSession(raw);
  } catch {
    return null;
  }
}

export async function saveVaultSession(
  scope: ScopeInfo,
  data: SessionData,
): Promise<void> {
  try {
    const dir = await appConfigDir();
    await ensureDir(dir);
    await writeFileAtomic(
      joinPath(dir, sessionFileName(scope.key)),
      JSON.stringify({ ...data, scope: scope.root }, null, 2),
    );
  } catch {
    // Best effort: a failed save only costs the next restore.
  }
}

/** Global layout fallbacks and last-vault pointer; null when absent. */
export async function loadUiState(): Promise<UiState | null> {
  try {
    const dir = await appConfigDir();
    return parseUiState(await readFile(joinPath(dir, UI_STATE_FILE)));
  } catch {
    return null;
  }
}

export async function saveUiState(state: UiState): Promise<void> {
  try {
    const dir = await appConfigDir();
    await ensureDir(dir);
    await writeFileAtomic(
      joinPath(dir, UI_STATE_FILE),
      serializeUiState(state),
    );
  } catch {
    // Best effort.
  }
}

/**
 * One-time migration of the phase-2/3 files (session.json, per-window
 * session-<label>.json, last-window.json): the last-worked window's
 * session is adopted under the vault of its active tab, ui-state.json
 * is written, and the legacy files are deleted. Runs only while
 * ui-state.json does not exist; never touches settings.json.
 */
export async function migrateLegacySessions(
  resolve: (filePath: string) => Promise<ScopeInfo>,
): Promise<void> {
  try {
    const dir = await appConfigDir();
    try {
      await readFile(joinPath(dir, UI_STATE_FILE));
      return; // already migrated (or fresh state exists)
    } catch {
      // fall through
    }
    const read = async (name: string): Promise<SessionData | null> => {
      try {
        return parseSession(await readFile(joinPath(dir, name)));
      } catch {
        return null;
      }
    };
    // Same adoption rule the old restore used: the last-focused
    // window's session wins; the main window's is the fallback.
    let lastLabel: string | null = null;
    try {
      const raw: unknown = JSON.parse(
        await readFile(joinPath(dir, "last-window.json")),
      );
      const label =
        typeof raw === "object" && raw !== null
          ? (raw as Record<string, unknown>).label
          : null;
      lastLabel = typeof label === "string" && label !== "" ? label : null;
    } catch {
      // no pointer
    }
    const session =
      (lastLabel !== null && lastLabel !== "main"
        ? await read(`session-${lastLabel}.json`)
        : null) ?? (await read("session.json"));
    let lastVault: string | null = null;
    if (session !== null) {
      const active = session.panes[session.activePane];
      const path = active?.tabs[active.active]?.path;
      if (path !== undefined) {
        const scope = await resolve(path);
        await saveVaultSession(scope, session);
        lastVault = scope.root;
      }
    }
    // Without any legacy file there is nothing to record: the first
    // real save will create ui-state.json.
    const hadLegacy = session !== null || lastLabel !== null;
    if (hadLegacy) {
      await saveUiState({
        panels: session?.panels ?? null,
        rightView: session?.rightView ?? null,
        leftVisible: session?.leftVisible ?? null,
        rightVisible: session?.rightVisible ?? null,
        lastVault,
      });
    }
    for (const entry of await listFolder(dir)) {
      if (
        !entry.isDir &&
        (entry.name === "session.json" ||
          entry.name === "last-window.json" ||
          /^session-.+\.json$/.test(entry.name))
      ) {
        await deleteFile(entry.path).catch(() => undefined);
      }
    }
  } catch {
    // Best effort: migration must never block startup.
  }
}

export { emptyUiState };
export type { UiState };
