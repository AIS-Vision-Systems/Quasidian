// Session store: persists the workspace snapshot (open tabs, active
// tab, per-file modes) as session.json in the app config dir — never
// inside note folders. Best-effort: failures never break the app.
import { appConfigDir } from "@tauri-apps/api/path";
import { joinPath } from "../lib/paths";
import { parseSession, type SessionData } from "../lib/panes";
import { ensureDir, readFile, writeFileAtomic } from "./fs";

const SESSION_FILE = "session.json";

export async function loadSession(): Promise<SessionData | null> {
  try {
    const dir = await appConfigDir();
    return parseSession(await readFile(joinPath(dir, SESSION_FILE)));
  } catch {
    return null;
  }
}

export async function saveSession(data: SessionData): Promise<void> {
  try {
    const dir = await appConfigDir();
    await ensureDir(dir);
    await writeFileAtomic(
      joinPath(dir, SESSION_FILE),
      JSON.stringify(data, null, 2),
    );
  } catch {
    // Best effort: a failed save only costs the next restore.
  }
}
