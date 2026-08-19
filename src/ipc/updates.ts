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
