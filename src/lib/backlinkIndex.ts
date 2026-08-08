// Pure module: no Tauri, no DOM. In-memory backlink index over the open
// folder — built on folder open, kept fresh by the file watcher. Raw link
// targets are stored per file and resolved at query time with the current
// folder listing, so renames and creations never leave stale resolutions.
import { markdownParser } from "../markdown/parser";
import { normalizePath, samePath } from "./paths";
import { resolveWikilink, type FolderFile } from "./wikilinks";

/**
 * Collects link targets from a document using the shared Lezer tree:
 * wikilink paths and internal markdown link URLs (external schemes are
 * ignored). Links inside code blocks produce no nodes, so none leak in.
 */
export function extractLinkTargets(doc: string): string[] {
  const tree = markdownParser.parse(doc);
  const targets: string[] = [];
  tree.iterate({
    enter(node) {
      if (node.name === "Wikilink" || node.name === "Embed") {
        const path = node.node.getChild("WikilinkPath");
        if (path !== null) {
          targets.push(doc.slice(path.from, path.to));
        }
        return false;
      }
      if (node.name === "Link") {
        const url = node.node.getChild("URL");
        if (url !== null) {
          const target = doc.slice(url.from, url.to);
          if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
            targets.push(target);
          }
        }
        return false;
      }
      return;
    },
  });
  return targets;
}

export interface BacklinkIndex {
  setFile(path: string, doc: string): void;
  removeFile(path: string): void;
  clear(): void;
  /** Paths of indexed files whose links resolve to `path`, sorted. */
  backlinksOf(
    path: string,
    folder: string,
    folderFiles: FolderFile[],
    defaultExtension?: string,
  ): string[];
}

export function createBacklinkIndex(): BacklinkIndex {
  /** Keyed by normalized path; keeps the original path for callers. */
  const files = new Map<string, { path: string; targets: string[] }>();

  return {
    setFile(path, doc) {
      files.set(normalizePath(path), { path, targets: extractLinkTargets(doc) });
    },

    removeFile(path) {
      files.delete(normalizePath(path));
    },

    clear() {
      files.clear();
    },

    backlinksOf(path, folder, folderFiles, defaultExtension = ".md") {
      const self = normalizePath(path);
      const result: string[] = [];
      for (const [key, file] of files) {
        if (key === self) {
          continue;
        }
        const linksHere = file.targets.some((target) => {
          const resolution = resolveWikilink(
            target,
            folder,
            folderFiles,
            defaultExtension,
          );
          return resolution !== null && samePath(resolution.path, path);
        });
        if (linksHere) {
          result.push(file.path);
        }
      }
      return result.sort((a, b) => a.localeCompare(b));
    },
  };
}
