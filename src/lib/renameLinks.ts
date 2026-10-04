// Pure module: no Tauri, no DOM. Rewrites the wikilinks, embeds and
// markdown links that resolve to a renamed file so they point at its
// new name, walking the shared Lezer tree — never a second parser.
import { linkDestination, markdownParser } from "@aisvision/quasidian-core";
import { basename, dirname, samePath } from "./paths";
import { resolveWikilink, splitAnchor, type FolderFile } from "./wikilinks";

export interface LinkRewrite {
  from: number;
  to: number;
  insert: string;
}

/** Percent-encodes every character of `text` that `unsafe` matches. */
function escapeMatching(text: string, unsafe: RegExp): string {
  return text.replace(unsafe, (ch) => {
    // encodeURIComponent leaves parentheses and the apostrophe alone:
    // ASCII is encoded by hand, anything else (exotic spaces) by it.
    const code = ch.charCodeAt(0);
    return code < 128
      ? "%" + code.toString(16).toUpperCase().padStart(2, "0")
      : encodeURIComponent(ch);
  });
}

/**
 * The destination of a markdown link once its file is renamed to
 * `newPath`, keeping the way the link was written (m50): angle
 * brackets, the heading anchor, the folder prefix (unless the file
 * moved to another folder: the bare name then resolves vault-wide,
 * like a wikilink) and whether the note name carried its ".md".
 * Characters that would break the destination are percent-encoded,
 * except the spaces of a link that already wrote its spaces raw.
 */
export function renamedLinkUrl(
  raw: string,
  newPath: string,
  keepFolder: boolean,
): string {
  const angle = raw.length >= 2 && raw.startsWith("<") && raw.endsWith(">");
  const inner = angle ? raw.slice(1, -1) : raw;
  const hash = inner.indexOf("#");
  const notePart = hash === -1 ? inner : inner.slice(0, hash);
  const anchor = hash === -1 ? "" : inner.slice(hash);
  const slash = Math.max(notePart.lastIndexOf("/"), notePart.lastIndexOf("\\"));
  const prefix = keepFolder ? notePart.slice(0, slash + 1) : "";
  const oldFile = notePart.slice(slash + 1);
  let oldName = oldFile;
  try {
    oldName = decodeURIComponent(oldFile);
  } catch {
    // Malformed escapes: the name is what was written.
  }
  const newFile = basename(newPath);
  // A note linked without its extension stays without it; an image
  // cannot resolve without its own.
  const name =
    /\.md$/i.test(newFile) && !/\.md\s*$/i.test(oldName)
      ? newFile.replace(/\.md$/i, "")
      : newFile;
  // Quotes too: after a space the parser would read them as a title.
  const unsafe = angle
    ? /[%#<>]/g
    : /\s/.test(inner)
      ? /[%#()<>"']/g
      : /[%#()<>"'\s]/g;
  const url = prefix + escapeMatching(name, unsafe) + anchor;
  return angle ? "<" + url + ">" : url;
}

/**
 * Rewrites in `doc` for every wikilink, embed or markdown link whose
 * target resolves to `oldPath` (with the pre-rename folder listing),
 * pointing it to `newPath`. The link style is preserved: bare names
 * stay bare, an explicit .md keeps it, and aliases and labels are
 * untouched (only the path part is replaced).
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
  const keepFolder = samePath(dirname(oldPath), dirname(newPath));
  markdownParser.parse(doc).iterate({
    enter(node) {
      if (node.name === "Link") {
        // Never "return false" here: the walk must still reach any
        // wikilink inside the label — and a bare "[text]" is a Link
        // with no URL at all.
        const url = node.node.getChild("URL");
        if (url === null) {
          return;
        }
        const raw = doc.slice(url.from, url.to);
        const destination = linkDestination(raw);
        if (destination.external) {
          return;
        }
        const linked = resolveWikilink(
          destination.target,
          folder,
          files,
          defaultExtension,
        );
        if (linked !== null && samePath(linked.path, oldPath)) {
          rewrites.push({
            from: url.from,
            to: url.to,
            insert: renamedLinkUrl(raw, newPath, keepFolder),
          });
        }
        return;
      }
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
      // Preserve a heading anchor and the extension style.
      const { note, anchor } = splitAnchor(target);
      const suffix = anchor === null ? "" : `#${anchor}`;
      const base = /\.md\s*$/i.test(note) ? `${newBase}.md` : newBase;
      rewrites.push({ from: path.from, to: path.to, insert: base + suffix });
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
