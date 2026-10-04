// The link under a document position, read from the shared syntax
// tree: a wikilink, an embed or a markdown link. No DOM — the editor's
// click, hover and context-menu handlers all ask the same question.
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { linkDestination } from "../markdown/links";

export type LinkKind = "wikilink" | "embed" | "link";

/** What a host is told about a link when asked for its menu entries. */
export interface LinkMenuTarget {
  /**
   * The target as written, ready to resolve: a wikilink path (anchor
   * included), or a markdown link destination with its angle brackets
   * removed and its percent-escapes decoded.
   */
  target: string;
  kind: LinkKind;
}

export interface LinkAt extends LinkMenuTarget {
  /** Range of the whole link element in the document. */
  from: number;
  to: number;
}

/**
 * The link whose element contains `pos`, or null. A markdown link with
 * no destination (a bare `[text]`) is not a link.
 */
export function linkAt(state: EditorState, pos: number): LinkAt | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0);
  while (
    node !== null &&
    node.name !== "Wikilink" &&
    node.name !== "Embed" &&
    node.name !== "Link"
  ) {
    node = node.parent;
  }
  if (node === null) {
    return null;
  }
  if (node.name === "Link") {
    const url = node.getChild("URL");
    if (url === null) {
      return null;
    }
    // The same string the reading render resolves (m47).
    const { target } = linkDestination(state.sliceDoc(url.from, url.to));
    return { target, kind: "link", from: node.from, to: node.to };
  }
  const path = node.getChild("WikilinkPath");
  if (path === null) {
    return null;
  }
  return {
    target: state.sliceDoc(path.from, path.to),
    kind: node.name === "Embed" ? "embed" : "wikilink",
    from: node.from,
    to: node.to,
  };
}
