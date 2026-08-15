// Session store: persists the workspace snapshot (open tabs, active
// tab, per-file modes) as session.json in the app config dir — never
// inside note folders. Best-effort: failures never break the app.
import { appConfigDir } from "@tauri-apps/api/path";
import { joinPath } from "../lib/paths";
import { parseSession, type SessionData } from "../lib/panes";
import { ensureDir, readFile, writeFileAtomic } from "./fs";

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
