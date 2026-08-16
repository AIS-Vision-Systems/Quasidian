// Session store: persists the workspace snapshot (open tabs, active
// tab, per-file modes) as session.json in the app config dir — never
// inside note folders. Best-effort: failures never break the app.
import { appConfigDir } from "@tauri-apps/api/path";
import { joinPath } from "../lib/paths";
import { parseSession, type SessionData } from "../lib/panes";
import {
  deleteFile,
  ensureDir,
  listFolder,
  readFile,
  writeFileAtomic,
} from "./fs";

/** The main window uses session.json; others their own labeled file. */
function sessionFile(label: string): string {
  return label === "main" ? "session.json" : `session-${label}.json`;
}

export async function loadSession(
  label = "main",
): Promise<SessionData | null> {
  try {
    const dir = await appConfigDir();
    return parseSession(await readFile(joinPath(dir, sessionFile(label))));
  } catch {
    return null;
  }
}

export async function saveSession(
  data: SessionData,
  label = "main",
): Promise<void> {
  try {
    const dir = await appConfigDir();
    await ensureDir(dir);
    await writeFileAtomic(
      joinPath(dir, sessionFile(label)),
      JSON.stringify(data, null, 2),
    );
  } catch {
    // Best effort: a failed save only costs the next restore.
  }
}

// The last focused window writes its label here, so the next launch
// opens a single window restoring the session the user last worked in.
const LAST_WINDOW_FILE = "last-window.json";

export async function saveLastWindow(label: string): Promise<void> {
  try {
    const dir = await appConfigDir();
    await ensureDir(dir);
    await writeFileAtomic(
      joinPath(dir, LAST_WINDOW_FILE),
      JSON.stringify({ label }),
    );
  } catch {
    // Best effort.
  }
}

export async function loadLastWindow(): Promise<string | null> {
  try {
    const dir = await appConfigDir();
    const raw: unknown = JSON.parse(
      await readFile(joinPath(dir, LAST_WINDOW_FILE)),
    );
    const label =
      typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>).label
        : null;
    return typeof label === "string" && label !== "" ? label : null;
  } catch {
    return null;
  }
}

/**
 * Deletes the per-window session files of past secondary windows —
 * they are not reopened, so once the last-worked one has been adopted
 * (or discarded) the files are dead weight.
 */
export async function cleanupSecondarySessions(): Promise<void> {
  try {
    const dir = await appConfigDir();
    for (const entry of await listFolder(dir)) {
      if (!entry.isDir && /^session-.+\.json$/.test(entry.name)) {
        await deleteFile(entry.path).catch(() => undefined);
      }
    }
  } catch {
    // Best effort.
  }
}
