// Pure module: no Tauri, no DOM. Resolves wikilink targets against the
// implicit vault — the open file's immediate folder, or the whole
// recursive vault when a multi-folder mode is active. The caller passes
// the corresponding file listing; the logic is the same for both.
import { joinPath, normalizePath } from "./paths";

const MARKDOWN_EXTENSION = ".md";

function hasExtension(target: string): boolean {
  return /\.[^./\\]+$/.test(target);
}

export interface FolderFile {
  /** Basename including extension, e.g. "nota.md". */
  name: string;
  /** Full path as reported by the filesystem. */
  path: string;
  /** Frontmatter aliases, when the caller has indexed them. */
  aliases?: string[];
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

/** Splits a wikilink target into its note part and heading anchor. */
export function splitAnchor(target: string): {
  note: string;
  anchor: string | null;
} {
  const hash = target.indexOf("#");
  if (hash === -1) {
    return { note: target.trim(), anchor: null };
  }
  const anchor = target.slice(hash + 1).trim();
  return {
    note: target.slice(0, hash).trim(),
    anchor: anchor === "" ? null : anchor,
  };
}

/** Among files matching a name, the shallowest path (then alphabetical)
 * wins — deterministic, Obsidian-style resolution for duplicates. */
function bestCandidate(candidates: FolderFile[]): FolderFile | undefined {
  return [...candidates].sort((a, b) => {
    const depthA = normalizePath(a.path).split("/").length;
    const depthB = normalizePath(b.path).split("/").length;
    if (depthA !== depthB) {
      return depthA - depthB;
    }
    return a.path.localeCompare(b.path);
  })[0];
}

/**
 * Resolver over one folder listing with the name and alias lookups
 * prebuilt, for bulk resolution (the backlink query resolves every
 * target of every note — a full list scan per link made tab switches
 * in a large vault pay for it visibly). `resolveWikilink` delegates
 * here, so both paths share one set of semantics.
 */
export function createWikilinkResolver(
  folder: string,
  folderFiles: FolderFile[],
  defaultExtension: string = MARKDOWN_EXTENSION,
): { resolve(target: string): WikilinkResolution | null } {
  // A file "nota.md" registers under "nota.md" and "nota": exactly the
  // two spellings a bare-name target may use.
  const byName = new Map<string, FolderFile[]>();
  const byAlias = new Map<string, FolderFile[]>();
  const add = (map: Map<string, FolderFile[]>, key: string, file: FolderFile) => {
    const bucket = map.get(key);
    if (bucket === undefined) {
      map.set(key, [file]);
    } else {
      bucket.push(file);
    }
  };
  for (const file of folderFiles) {
    const lower = file.name.toLowerCase();
    add(byName, lower, file);
    if (lower.endsWith(MARKDOWN_EXTENSION)) {
      add(byName, lower.slice(0, -MARKDOWN_EXTENSION.length), file);
    }
    for (const alias of file.aliases ?? []) {
      add(byAlias, alias.toLowerCase(), file);
    }
  }

  function resolve(target: string): WikilinkResolution | null {
    // Heading anchors never take part in file resolution; a bare
    // "#secció" (same-file anchor) resolves to nothing here — callers
    // handle it.
    const trimmed = splitAnchor(target).note;
    if (trimmed === "") {
      return null;
    }

    if (!/[/\\]/.test(trimmed)) {
      // Bare name: case-insensitive match against the vault's markdown
      // files, with or without the extension spelled out. Duplicate
      // names in a recursive vault resolve to the shallowest path.
      const lower = trimmed.toLowerCase();
      const match = bestCandidate(byName.get(lower) ?? []);
      if (match !== undefined) {
        return { path: match.path, exists: true };
      }
      // Frontmatter aliases resolve after real names.
      const aliasMatch = bestCandidate(byAlias.get(lower) ?? []);
      if (aliasMatch !== undefined) {
        return { path: aliasMatch.path, exists: true };
      }
      const fileName = hasExtension(trimmed)
        ? trimmed
        : trimmed + defaultExtension;
      return { path: normalizePath(joinPath(folder, fileName)), exists: false };
    }
    return resolvePathTarget(trimmed, folder, folderFiles, defaultExtension);
  }

  return { resolve };
}

export function resolveWikilink(
  target: string,
  folder: string,
  folderFiles: FolderFile[],
  defaultExtension: string = MARKDOWN_EXTENSION,
): WikilinkResolution | null {
  return createWikilinkResolver(folder, folderFiles, defaultExtension).resolve(
    target,
  );
}

/** Slash-form targets: subpath disambiguation, then relative/full. */
function resolvePathTarget(
  trimmed: string,
  folder: string,
  folderFiles: FolderFile[],
  defaultExtension: string,
): WikilinkResolution {

  const withExtension = hasExtension(trimmed)
    ? trimmed
    : trimmed + defaultExtension;
  const isAbsolute = /^([a-zA-Z]:[/\\]|[/\\])/.test(withExtension);
  // Plain subpaths ("dir/nota") disambiguate duplicates Obsidian-style:
  // a case-insensitive path-suffix match against the vault listing.
  if (!isAbsolute && !/^\.\.?[/\\]/.test(withExtension)) {
    const suffix = "/" + normalizePath(withExtension).toLowerCase();
    const match = bestCandidate(
      folderFiles.filter((file) =>
        normalizePath(file.path).toLowerCase().endsWith(suffix),
      ),
    );
    if (match !== undefined) {
      return { path: match.path, exists: true };
    }
  }
  // Relative or full path (cross-folder link).
  const combined = isAbsolute ? withExtension : joinPath(folder, withExtension);
  return { path: normalizePath(combined), exists: false };
}
