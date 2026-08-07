// Pure module: no Tauri, no DOM. Resolves wikilink targets against the
// implicit vault (the open file's immediate folder), whose listing is
// passed in by the caller.
import { joinPath, normalizePath } from "./paths";

// Becomes the "default extension when creating from a wikilink" setting
// in milestone 6.
const DEFAULT_EXTENSION = ".md";

export interface FolderFile {
  /** Basename including extension, e.g. "nota.md". */
  name: string;
  /** Full path as reported by the filesystem. */
  path: string;
}

export interface WikilinkResolution {
  path: string;
  /**
   * True when the target matched a file known to exist in the folder.
   * False means "not known here": a same-folder file to create, or a
   * cross-folder path whose existence the caller must probe.
   */
  exists: boolean;
}

export function resolveWikilink(
  target: string,
  folder: string,
  folderFiles: FolderFile[],
): WikilinkResolution | null {
  const trimmed = target.trim();
  if (trimmed === "") {
    return null;
  }

  if (!/[/\\]/.test(trimmed)) {
    // Bare name: case-insensitive match against the folder's markdown
    // files, with or without the extension spelled out.
    const lower = trimmed.toLowerCase();
    const match = folderFiles.find((file) => {
      const name = file.name.toLowerCase();
      return name === lower || name === lower + DEFAULT_EXTENSION;
    });
    if (match !== undefined) {
      return { path: match.path, exists: true };
    }
    const fileName = lower.endsWith(DEFAULT_EXTENSION)
      ? trimmed
      : trimmed + DEFAULT_EXTENSION;
    return { path: normalizePath(joinPath(folder, fileName)), exists: false };
  }

  // Relative or full path (cross-folder link).
  const withExtension = trimmed.toLowerCase().endsWith(DEFAULT_EXTENSION)
    ? trimmed
    : trimmed + DEFAULT_EXTENSION;
  const isAbsolute = /^([a-zA-Z]:[/\\]|[/\\])/.test(withExtension);
  const combined = isAbsolute ? withExtension : joinPath(folder, withExtension);
  return { path: normalizePath(combined), exists: false };
}
