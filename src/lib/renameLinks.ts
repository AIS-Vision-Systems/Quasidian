// Pure module: no Tauri, no DOM. Rewrites wikilink/embed targets that
// resolve to a renamed file so they point at its new name, walking the
// shared Lezer tree — never a second parser.
import { markdownParser } from "../markdown/parser";
import { basename, samePath } from "./paths";
import { resolveWikilink, type FolderFile } from "./wikilinks";

export interface LinkRewrite {
  from: number;
  to: number;
  insert: string;
}

/**
 * Rewrites in `doc` for every wikilink or embed whose target resolves to
 * `oldPath` (with the pre-rename folder listing), pointing it to
 * `newPath`. The link style is preserved: bare names stay bare, an
 * explicit .md keeps it, and aliases are untouched (only the path part
 * is replaced).
 */
export function renameLinkTargets(
  doc: string,
  folder: string,
  files: FolderFile[],
  oldPath: string,
  newPath: string,
  defaultExtension: string,
): LinkRewrite[] {
  const rewrites: LinkRewrite[] = [];
  const newBase = basename(newPath).replace(/\.md$/i, "");
  markdownParser.parse(doc).iterate({
    enter(node) {
      if (node.name !== "Wikilink" && node.name !== "Embed") {
        return;
      }
      const path = node.node.getChild("WikilinkPath");
      if (path === null) {
        return false;
      }
      const target = doc.slice(path.from, path.to);
      const resolution = resolveWikilink(
        target,
        folder,
        files,
        defaultExtension,
      );
      if (resolution === null || !samePath(resolution.path, oldPath)) {
        return false;
      }
      const insert = /\.md\s*$/i.test(target) ? `${newBase}.md` : newBase;
      rewrites.push({ from: path.from, to: path.to, insert });
      return false;
    },
  });
  return rewrites;
}

/** Applies rewrites to `doc` (any order; positions refer to `doc`). */
export function applyRewrites(doc: string, rewrites: LinkRewrite[]): string {
  let out = doc;
  for (const rewrite of [...rewrites].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, rewrite.from) + rewrite.insert + out.slice(rewrite.to);
  }
  return out;
}
