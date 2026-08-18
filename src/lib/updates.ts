// Pure module: no Tauri, no DOM. Update check (phase 4, milestone 34):
// the public distribution repo serves a latest.json; the app compares
// its own version against it and points the user to the download page.
// Check-only by design — nothing downloads or installs itself.

export interface LatestInfo {
  version: string;
  /** Download page opened in the system browser. */
  url: string;
  notes: string | null;
}

/** Parses latest.json; null when it is not a valid payload. */
export function parseLatest(json: string): LatestInfo | null {
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
    typeof root.version !== "string" ||
    root.version === "" ||
    typeof root.url !== "string" ||
    !/^https:\/\//.test(root.url)
  ) {
    return null;
  }
  return {
    version: root.version,
    url: root.url,
    notes:
      typeof root.notes === "string" && root.notes !== "" ? root.notes : null,
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
