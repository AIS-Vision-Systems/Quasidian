// Lezer extension for footnotes: inline references `[^id]` and one-line
// definitions `[^id]: text`. Plugs into the shared markdown parser —
// never a second parser. Pure module.
import { Tag, tags } from "@lezer/highlight";
import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";

/** Styling tag for the footnote label in the editor. */
export const footnoteTag = Tag.define();

const BRACKET_OPEN = 91; /* [ */
const CARET = 94; /* ^ */
const BRACKET_CLOSE = 93; /* ] */

function parseFootnoteDef(cx: BlockContext, line: Line): boolean {
  if (line.next !== BRACKET_OPEN) {
    return false;
  }
  const text = line.text.slice(line.pos);
  const match = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/.exec(text);
  if (match === null) {
    return false;
  }
  const start = cx.lineStart + line.pos;
  const labelEnd = start + 2 + match[1].length;
  const markEnd = labelEnd + 2;
  const contentStart = start + (text.length - match[2].length);
  const end = cx.lineStart + line.pos + text.length;
  cx.addElement(
    cx.elt("FootnoteDef", start, end, [
      cx.elt("FootnoteMark", start, start + 2),
      cx.elt("FootnoteLabel", start + 2, labelEnd),
      cx.elt("FootnoteMark", labelEnd, markEnd),
      ...cx.parser.parseInline(match[2], contentStart),
    ]),
  );
  cx.nextLine();
  return true;
}

export const footnotes: MarkdownConfig = {
  defineNodes: [
    { name: "FootnoteRef", style: footnoteTag },
    { name: "FootnoteInline", style: footnoteTag },
    { name: "FootnoteDef", block: true },
    { name: "FootnoteMark", style: tags.processingInstruction },
    { name: "FootnoteLabel", style: footnoteTag },
  ],
  parseBlock: [
    {
      name: "FootnoteDef",
      before: "LinkReference",
      parse: parseFootnoteDef,
    },
  ],
  parseInline: [
    {
      // Direct footnotes `^[text]`: auto-numbered, no separate definition.
      name: "FootnoteInline",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== CARET || cx.char(pos + 1) !== BRACKET_OPEN) {
          return -1;
        }
        let i = pos + 2;
        while (i < cx.end && cx.char(i) !== BRACKET_CLOSE) {
          i++;
        }
        if (i >= cx.end || i === pos + 2) {
          return -1;
        }
        const content = cx.slice(pos + 2, i);
        return cx.addElement(
          cx.elt("FootnoteInline", pos, i + 1, [
            cx.elt("FootnoteMark", pos, pos + 2),
            ...cx.parser.parseInline(content, pos + 2),
            cx.elt("FootnoteMark", i, i + 1),
          ]),
        );
      },
    },
    {
      name: "FootnoteRef",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== BRACKET_OPEN || cx.char(pos + 1) !== CARET) {
          return -1;
        }
        let i = pos + 2;
        while (i < cx.end) {
          const ch = cx.char(i);
          if (ch === BRACKET_CLOSE) {
            break;
          }
          if (ch === BRACKET_OPEN || ch <= 32) {
            return -1;
          }
          i++;
        }
        if (i >= cx.end || i === pos + 2) {
          return -1;
        }
        // `[^id]:` at line start is a definition, not a reference.
        if (cx.char(i + 1) === 58 /* : */) {
          return -1;
        }
        return cx.addElement(
          cx.elt("FootnoteRef", pos, i + 1, [
            cx.elt("FootnoteMark", pos, pos + 2),
            cx.elt("FootnoteLabel", pos + 2, i),
            cx.elt("FootnoteMark", i, i + 1),
          ]),
        );
      },
    },
  ],
};
