// Pure module: no Tauri, no DOM. Handles both `/` and `\` separators so the
// same logic works on Windows and Ubuntu.

export function dirname(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator === -1 ? path : path.slice(0, separator);
}

export function basename(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator === -1 ? path : path.slice(separator + 1);
}

export function joinPath(base: string, segment: string): string {
  return base.replace(/[/\\]+$/, "") + "/" + segment.replace(/^[/\\]+/, "");
}

/**
 * Collapses `.`/`..` segments and unifies separators to `/` (accepted by
 * both Windows and Linux filesystems), so paths built through different
 * routes compare equal.
 */
export function normalizePath(path: string): string {
  const drive = /^[a-zA-Z]:/.exec(path)?.[0] ?? "";
  const rest = drive === "" ? path : path.slice(drive.length);
  const isAbsolute = /^[/\\]/.test(rest);
  const segments: string[] = [];
  for (const segment of rest.split(/[/\\]+/)) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else if (drive === "" && !isAbsolute) {
        segments.push("..");
      }
      continue;
    }
    segments.push(segment);
  }
  const prefix = drive !== "" ? drive + "/" : isAbsolute ? "/" : "";
  return prefix + segments.join("/");
}

/** Whether two paths refer to the same file once normalized. */
export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}
