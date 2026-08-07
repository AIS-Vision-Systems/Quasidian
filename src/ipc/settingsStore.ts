// Settings store: loads/persists settings.json in the app config dir
// (never inside note folders) and notifies subscribers on every change —
// that is the hot-reload mechanism.
import { appConfigDir } from "@tauri-apps/api/path";
import { joinPath } from "../lib/paths";
import { mergeSettings, parseSettings, type Settings } from "../lib/settings";
import { ensureDir, readFile, writeFileAtomic } from "./fs";

const SETTINGS_FILE = "settings.json";

type Listener = (settings: Settings) => void;

let current: Settings = mergeSettings(undefined);
let configDir: string | null = null;
const listeners = new Set<Listener>();

export function getSettings(): Settings {
  return current;
}

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    listener(current);
  }
}

export async function loadSettings(): Promise<Settings> {
  configDir = await appConfigDir();
  try {
    const json = await readFile(joinPath(configDir, SETTINGS_FILE));
    current = parseSettings(json);
  } catch {
    // Missing or unreadable file: start from defaults.
    current = mergeSettings(undefined);
  }
  notify();
  return current;
}

/**
 * Applies `mutate` to the current settings, notifies subscribers
 * immediately (hot apply) and persists atomically in the background.
 */
export async function updateSettings(
  mutate: (settings: Settings) => Settings,
): Promise<void> {
  current = mergeSettings(mutate(current));
  notify();
  try {
    if (configDir === null) {
      configDir = await appConfigDir();
    }
    await ensureDir(configDir);
    await writeFileAtomic(
      joinPath(configDir, SETTINGS_FILE),
      JSON.stringify(current, null, 2),
    );
  } catch (error) {
    console.error("settings: could not persist", error);
  }
}
