// Pure module: no Tauri, no DOM. Document outline from the shared Lezer
// parser — never a second parser.
import { markdownParser } from "@aisvision/quasidian-core";

export interface OutlineItem {
  /** Heading level, 1-6. */
  level: number;
  /** Heading text without the #/underline marks, raw inline source. */
  text: string;
  /** Range of the heading node, for revealing it in the editor. */
  from: number;
  to: number;
}

/** The heading matching `anchor` (case-insensitive), or null. */
export function findHeading(doc: string, anchor: string): OutlineItem | null {
  const wanted = anchor.trim().toLowerCase();
  return (
    computeOutline(doc).find(
      (item) => item.text.trim().toLowerCase() === wanted,
    ) ?? null
  );
}

/**
 * The markdown slice of the section titled `anchor` (heading included,
 * up to the next heading of the same or a higher level), or null when
 * the heading does not exist.
 */
export function sectionSlice(doc: string, anchor: string): string | null {
  const items = computeOutline(doc);
  const wanted = anchor.trim().toLowerCase();
  const index = items.findIndex(
    (item) => item.text.trim().toLowerCase() === wanted,
  );
  if (index === -1) {
    return null;
  }
  const heading = items[index];
  let end = doc.length;
  for (let i = index + 1; i < items.length; i++) {
    if (items[i].level <= heading.level) {
      end = items[i].from;
      break;
    }
  }
  return doc.slice(heading.from, end);
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
