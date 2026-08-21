// Update check against this repository's latest published GitHub
// release (api.github.com sends CORS headers; release-asset downloads
// do not, so the API is the only feed a webview fetch can read).
// Check-only: the result points the user at the release page, nothing
// installs itself. Failures degrade to an explicit error status — the
// check must never break the app.
import { getVersion } from "@tauri-apps/api/app";
import { isNewer, parseLatestRelease, type LatestInfo } from "../lib/updates";

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/AIS-Vision-Systems/Quasidian/releases/latest";

export type UpdateCheck =
  | { status: "current"; version: string }
  | { status: "outdated"; current: string; latest: LatestInfo }
  | { status: "error" };

export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const current = await getVersion();
    const response = await fetch(LATEST_RELEASE_URL, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      return { status: "error" };
    }
    const latest = parseLatestRelease(await response.text());
    if (latest === null) {
      return { status: "error" };
    }
    return isNewer(latest.version, current)
      ? { status: "outdated", current, latest }
      : { status: "current", version: current };
  } catch {
    return { status: "error" };
  }
}

// --- Signed updater flow (m43) ---
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

export type UpdateFlow =
  | { status: "current"; version: string }
  | { status: "installable"; current: string; version: string; update: Update }
  | { status: "manual"; current: string; latest: LatestInfo }
  | { status: "error" };

/**
 * Signed-updater check with a manual fallback: installs the updater
 * supports (NSIS on Windows, AppImage on Linux) get an installable
 * update; a .deb — or any updater failure, including releases from
 * before the manifest existed — degrades to the check-only API flow.
 * Nothing ever installs without an explicit user action downstream.
 */
export async function checkForUpdateFlow(): Promise<UpdateFlow> {
  const current = await getVersion();
  try {
    const update = await check();
    if (update !== null) {
      return { status: "installable", current, version: update.version, update };
    }
    return { status: "current", version: current };
  } catch {
    const legacy = await checkForUpdate();
    if (legacy.status === "outdated") {
      return { status: "manual", current, latest: legacy.latest };
    }
    return legacy.status === "current"
      ? { status: "current", version: current }
      : { status: "error" };
  }
}

export type InstallPhase =
  | { phase: "downloading"; percent: number | null }
  | { phase: "installed" }
  | { phase: "error" };

/**
 * Downloads and installs `update`, reporting progress. Only ever
 * called from an explicit user click; resolving true means the app
 * is ready to be relaunched (also a user decision).
 */
export async function installUpdate(
  update: Update,
  onPhase: (phase: InstallPhase) => void,
): Promise<boolean> {
  try {
    let total: number | null = null;
    let received = 0;
    onPhase({ phase: "downloading", percent: null });
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        onPhase({
          phase: "downloading",
          percent:
            total !== null && total > 0
              ? Math.min(100, Math.round((received / total) * 100))
              : null,
        });
      }
    });
    onPhase({ phase: "installed" });
    return true;
  } catch {
    onPhase({ phase: "error" });
    return false;
  }
}

/** Restarts the app to run the freshly installed version. */
export function relaunchApp(): Promise<void> {
  return relaunch();
}
