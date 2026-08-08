// Lezer extension for Obsidian-style wikilinks and embeds: [[path]],
// [[path|alias]] and ![[path]]. Plugs into the shared markdown parser via
// `markdown({ extensions })` — never a second parser. Pure module: only
// @lezer/markdown and tags.
import { Tag, tags } from "@lezer/highlight";
import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

/** Styling tag for ==highlighted== text. */
export const highlightTag = Tag.define();

const BANG = 33; /* ! */
const OPEN_BRACKET = 91; /* [ */
const CLOSE_BRACKET = 93; /* ] */
const PIPE = 124; /* | */
const NEWLINE = 10;

/** Whether an embed target points at an image file. */
export function isImageTarget(target: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(target.trim());
}

/**
 * Parses the shared `[[path|alias]]` body. `start` is where the element
 * (and its first mark) begins; `contentStart` is right after the `[[`.
 */
function parseBody(
  cx: InlineContext,
  start: number,
  contentStart: number,
  nodeName: "Wikilink" | "Embed",
): number {
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
  const children = [cx.elt("WikilinkMark", start, contentStart)];
  if (pipe !== -1) {
    children.push(cx.elt("WikilinkPath", contentStart, pipe));
    children.push(cx.elt("WikilinkMark", pipe, pipe + 1));
    children.push(cx.elt("WikilinkAlias", pipe + 1, end));
  } else {
    children.push(cx.elt("WikilinkPath", contentStart, end));
  }
  children.push(cx.elt("WikilinkMark", end, end + 2));
  return cx.addElement(cx.elt(nodeName, start, end + 2, children));
}

const EQUALS = 61; /* = */
const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

/** Obsidian-style ==highlight== inline syntax, delimiter-based like GFM
 * strikethrough so nested formatting keeps working. */
export const highlights: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: highlightTag },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS) {
          return -1;
        }
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, true, true);
      },
      after: "Emphasis",
    },
  ],
};

export const wikilinks: MarkdownConfig = {
  defineNodes: [
    { name: "Wikilink" },
    { name: "Embed" },
    { name: "WikilinkMark", style: tags.processingInstruction },
    { name: "WikilinkPath", style: tags.link },
    { name: "WikilinkAlias", style: tags.link },
  ],
  parseInline: [
    {
      name: "Embed",
      before: "Image",
      parse(cx, next, pos) {
        if (
          next !== BANG ||
          cx.char(pos + 1) !== OPEN_BRACKET ||
          cx.char(pos + 2) !== OPEN_BRACKET
        ) {
          return -1;
        }
        return parseBody(cx, pos, pos + 3, "Embed");
      },
    },
    {
      name: "Wikilink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== OPEN_BRACKET || cx.char(pos + 1) !== OPEN_BRACKET) {
          return -1;
        }
        return parseBody(cx, pos, pos + 2, "Wikilink");
      },
    },
  ],
};
