// Where text dropped on the editor really goes (m51). A drop lands on
// a pixel, and the position under it may sit inside something that is
// not plain text. The frontmatter and tables are widgets, never edited
// as raw text: the insertion moves to just after the block, on a line
// of its own. An embed, a link or a formula is one unit, shown as an
// image or as its label: text pushed into its source would break it,
// so the insertion moves to just after it. No DOM.
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/** Inline elements that are one unit: nothing is inserted inside. */
const INLINE_UNITS = new Set([
  "Embed",
  "Wikilink",
  "Link",
  "Image",
  "InlineMath",
  "InlineCode",
  "FootnoteRef",
  "Autolink",
]);

export interface Insertion {
  /** Where the text goes in. */
  from: number;
  /** The text, with the line breaks it needs to stand clear of a block. */
  insert: string;
}

/**
 * The insertion that puts `text` at `pos`, or right after the
 * frontmatter or table that holds (or touches) `pos`.
 */
export function insertionAt(
  state: EditorState,
  pos: number,
  text: string,
): Insertion {
  const at = Math.max(0, Math.min(pos, state.doc.length));
  const tree =
    ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  let block: { name: string; from: number; to: number } | null = null;
  tree.iterate({
    from: at,
    to: at,
    enter(node) {
      if (block !== null) {
        return false;
      }
      if (node.name === "Frontmatter" || node.name === "Table") {
        block = { name: node.name, from: node.from, to: node.to };
        return false;
      }
      return;
    },
  });
  const found = block as { name: string; from: number; to: number } | null;
  if (found === null) {
    // Strictly inside an inline unit: after it. Its edges are fine.
    let end = at;
    for (
      let node: SyntaxNode | null = tree.resolveInner(at, 0);
      node !== null;
      node = node.parent
    ) {
      if (INLINE_UNITS.has(node.name) && node.from < at && at < node.to) {
        end = Math.max(end, node.to);
      }
    }
    return { from: end, insert: text };
  }
  // The block's lines, whole: a position on the edge of its first or
  // last line is still inside its source.
  const end = state.doc.lineAt(found.to).to;
  if (at < state.doc.lineAt(found.from).from || at > end) {
    return { from: at, insert: text };
  }
  // A table only ends at a blank line; the frontmatter at its fence.
  return {
    from: end,
    insert: (found.name === "Table" ? "\n\n" : "\n") + text,
  };
}
