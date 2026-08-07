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
