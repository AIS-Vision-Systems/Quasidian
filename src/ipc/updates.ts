// Update check against the public distribution repo. Check-only: the
// result points the user at the download page, nothing installs
// itself. Failures degrade to an explicit error status — the check
// must never break the app.
import { getVersion } from "@tauri-apps/api/app";
import { isNewer, parseLatest, type LatestInfo } from "../lib/updates";

const LATEST_URL =
  "https://raw.githubusercontent.com/XaviAnguera/Quasidian-releases/main/latest.json";

export type UpdateCheck =
  | { status: "current"; version: string }
  | { status: "outdated"; current: string; latest: LatestInfo }
  | { status: "error" };

export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    const current = await getVersion();
    const response = await fetch(LATEST_URL, { cache: "no-store" });
    if (!response.ok) {
      return { status: "error" };
    }
    const latest = parseLatest(await response.text());
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
