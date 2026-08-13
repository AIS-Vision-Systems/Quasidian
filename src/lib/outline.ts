// Pure module: no Tauri, no DOM. Document outline from the shared Lezer
// parser — never a second parser.
import { markdownParser } from "../markdown/parser";

export interface OutlineItem {
  /** Heading level, 1-6. */
  level: number;
  /** Heading text without the #/underline marks, raw inline source. */
  text: string;
  /** Range of the heading node, for revealing it in the editor. */
  from: number;
  to: number;
}

export function computeOutline(doc: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  markdownParser.parse(doc).iterate({
    enter(node) {
      const match = /^(?:ATXHeading|SetextHeading)([1-6])$/.exec(node.name);
      if (match === null) {
        return;
      }
      // Drop the marks (#s or the setext underline) from the text.
      let text = "";
      let cursor = node.from;
      for (const mark of node.node.getChildren("HeaderMark")) {
        text += doc.slice(cursor, mark.from);
        cursor = mark.to;
      }
      text += doc.slice(cursor, node.to);
      items.push({
        level: Number(match[1]),
        text: text.trim(),
        from: node.from,
        to: node.to,
      });
    },
  });
  return items;
}
