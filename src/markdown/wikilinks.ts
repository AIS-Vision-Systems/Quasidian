// Lezer extension for Obsidian-style wikilinks: [[path]] and [[path|alias]].
// Plugs into the shared markdown parser via `markdown({ extensions })` —
// never a second parser. Pure module: only @lezer/markdown and tags.
import { tags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";

const OPEN_BRACKET = 91; /* [ */
const CLOSE_BRACKET = 93; /* ] */
const PIPE = 124; /* | */
const NEWLINE = 10;

export const wikilinks: MarkdownConfig = {
  defineNodes: [
    { name: "Wikilink" },
    { name: "WikilinkMark", style: tags.processingInstruction },
    { name: "WikilinkPath", style: tags.link },
    { name: "WikilinkAlias", style: tags.link },
  ],
  parseInline: [
    {
      name: "Wikilink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN_BRACKET || cx.char(pos + 1) !== OPEN_BRACKET) {
          return -1;
        }
        const contentStart = pos + 2;
        let pipe = -1;
        let end = -1;
        for (let i = contentStart; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === NEWLINE) {
            break;
          }
          if (ch === PIPE && pipe === -1) {
            pipe = i;
          }
          if (ch === CLOSE_BRACKET && cx.char(i + 1) === CLOSE_BRACKET) {
            end = i;
            break;
          }
        }
        const pathEnd = pipe !== -1 ? pipe : end;
        if (end === -1 || pathEnd === contentStart) {
          return -1;
        }
        const children = [cx.elt("WikilinkMark", pos, contentStart)];
        if (pipe !== -1) {
          children.push(cx.elt("WikilinkPath", contentStart, pipe));
          children.push(cx.elt("WikilinkMark", pipe, pipe + 1));
          children.push(cx.elt("WikilinkAlias", pipe + 1, end));
        } else {
          children.push(cx.elt("WikilinkPath", contentStart, end));
        }
        children.push(cx.elt("WikilinkMark", end, end + 2));
        return cx.addElement(cx.elt("Wikilink", pos, end + 2, children));
      },
    },
  ],
};
