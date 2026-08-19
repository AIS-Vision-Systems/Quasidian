// Pure module: no Tauri, no DOM. Update check (milestone 34, reworked
// in milestone 35): the app reads the repository's latest published
// GitHub release, compares versions and points the user to the release
// page. Check-only by design — nothing downloads or installs itself.

export interface LatestInfo {
  version: string;
  /** Download page opened in the system browser. */
  url: string;
  notes: string | null;
}

/** Parses a GitHub "latest release" API response; null when invalid. */
export function parseLatestRelease(json: string): LatestInfo | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const root = raw as Record<string, unknown>;
  if (
    typeof root.tag_name !== "string" ||
    typeof root.html_url !== "string" ||
    !/^https:\/\//.test(root.html_url)
  ) {
    return null;
  }
  const version = root.tag_name.trim().replace(/^v/i, "");
  if (version === "") {
    return null;
  }
  return {
    version,
    url: root.html_url,
    notes:
      typeof root.body === "string" && root.body !== "" ? root.body : null,
  };
}

/** Numeric segments of a version, tolerating a leading "v". */
function segments(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => {
      const value = parseInt(part, 10);
      return Number.isFinite(value) ? value : 0;
    });
}

/** -1, 0 or 1 comparing dotted numeric versions ("1.2" == "1.2.0"). */
export function compareVersions(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

/** Whether `candidate` is strictly newer than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
