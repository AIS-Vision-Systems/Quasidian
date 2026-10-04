// Lezer extension for markdown links whose destination contains
// spaces: [exemple](docs/Exemple.md#Secció primera). CommonMark ends a
// bare destination at the first space, so the stock parser leaves such
// a link as plain text. This extension accepts exactly the links the
// stock grammar rejects for that reason and nothing else — every link
// CommonMark already understands keeps its stock parse (m47). It emits
// the stock node names, so the Live Preview and the reading render
// treat both kinds alike. Pure module: only @lezer/markdown.
import type { Element, InlineContext, MarkdownConfig } from "@lezer/markdown";
import { isExternalTarget } from "./wikilinks";

const BANG = 33; /* ! */
const OPEN_PAREN = 40; /* ( */
const CLOSE_PAREN = 41; /* ) */
const OPEN_BRACKET = 91; /* [ */
const BACKSLASH = 92;
const CLOSE_BRACKET = 93; /* ] */
const CARET = 94; /* ^ */
const BACKTICK = 96;
const NEWLINE = 10;

/**
 * What CommonMark accepts after the "(" of an inline link, up to and
 * including its ")": a destination — in angle brackets, or bare,
 * without whitespace and with balanced parentheses — and an optional
 * title in quotes or parentheses. Tested against the rest of the line:
 * when it matches, the stock grammar parses this link and the
 * extension must stand back. Anchored at the start, so a ")" inside a
 * quoted title is read as part of the title, as the stock parser does.
 */
const STANDARD_TAIL =
  /^[ \t]*(?:<[^<>\n]*>|[^\s<()]*(?:\([^\s()]*\)[^\s<()]*)*)(?:[ \t]+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?[ \t]*\)/;

/** A quoted title after the destination: `path with spaces "title"`. */
const TRAILING_TITLE = /^(.*\S)(\s+)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;

/** Length of the run of backticks starting at `pos`. */
function backtickRun(cx: InlineContext, pos: number): number {
  let length = 0;
  while (pos + length < cx.end && cx.char(pos + length) === BACKTICK) {
    length++;
  }
  return length;
}

/**
 * End of the code span opened by the backtick run at `pos` — the
 * position after a closing run of the same length on the same line —
 * or -1 when the run opens nothing.
 */
function codeSpanEnd(cx: InlineContext, pos: number): number {
  const length = backtickRun(cx, pos);
  for (let i = pos + length; i < cx.end; i++) {
    const ch = cx.char(i);
    if (ch === NEWLINE) {
      return -1;
    }
    if (ch === BACKTICK) {
      const run = backtickRun(cx, i);
      if (run === length) {
        return i + run;
      }
      i += run - 1;
    }
  }
  return -1;
}

/**
 * Index of the `close` that matches the opener before `from`, or -1.
 * Code spans bind tighter than links: a bracket inside one is text.
 * With `codeSpans` off, any code span in the way gives up instead.
 */
function matchingClose(
  cx: InlineContext,
  from: number,
  open: number,
  close: number,
  codeSpans: boolean,
): number {
  let depth = 1;
  for (let i = from; i < cx.end; i++) {
    const ch = cx.char(i);
    if (ch === NEWLINE) {
      return -1;
    }
    if (ch === BACKSLASH) {
      i++;
      continue;
    }
    if (ch === BACKTICK) {
      const end = codeSpanEnd(cx, i);
      if (end === -1) {
        // Literal backticks: skip the whole run.
        i += backtickRun(cx, i) - 1;
        continue;
      }
      if (!codeSpans) {
        return -1;
      }
      i = end - 1;
      continue;
    }
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function parseLenientLink(cx: InlineContext, pos: number): number {
  // Wikilinks, footnote references and images are not ours.
  const after = cx.char(pos + 1);
  if (after === OPEN_BRACKET || after === CARET) {
    return -1;
  }
  if (pos > cx.offset && cx.char(pos - 1) === BANG) {
    return -1;
  }
  const labelEnd = matchingClose(
    cx,
    pos + 1,
    OPEN_BRACKET,
    CLOSE_BRACKET,
    true,
  );
  if (labelEnd === -1 || cx.char(labelEnd + 1) !== OPEN_PAREN) {
    return -1;
  }
  const open = labelEnd + 1;
  // Something the stock grammar already parses: leave it untouched.
  let lineEnd = open + 1;
  while (lineEnd < cx.end && cx.char(lineEnd) !== NEWLINE) {
    lineEnd++;
  }
  if (STANDARD_TAIL.test(cx.slice(open + 1, lineEnd))) {
    return -1;
  }
  // A code span reaching into the destination wins over the link.
  const close = matchingClose(cx, open + 1, OPEN_PAREN, CLOSE_PAREN, false);
  if (close === -1) {
    return -1;
  }
  const inside = cx.slice(open + 1, close);
  const trimmed = inside.trim();
  if (!/\s/.test(trimmed)) {
    return -1;
  }
  const start = open + 1 + (inside.length - inside.trimStart().length);
  const titled = TRAILING_TITLE.exec(trimmed);
  const destination = titled === null ? trimmed : titled[1];
  // An angle-bracket or external destination is never a note path with
  // spaces: a broken URL stays broken rather than becoming a note link.
  if (destination.startsWith("<") || isExternalTarget(destination)) {
    return -1;
  }
  const children: Element[] = [
    cx.elt("LinkMark", pos, pos + 1),
    ...cx.parser.parseInline(cx.slice(pos + 1, labelEnd), pos + 1),
    cx.elt("LinkMark", labelEnd, labelEnd + 1),
    cx.elt("LinkMark", open, open + 1),
    cx.elt("URL", start, start + destination.length),
  ];
  if (titled !== null) {
    const titleStart = start + destination.length + titled[2].length;
    children.push(cx.elt("LinkTitle", titleStart, titleStart + titled[3].length));
  }
  children.push(cx.elt("LinkMark", close, close + 1));
  return cx.addElement(cx.elt("Link", pos, close + 1, children));
}

export const lenientLinks: MarkdownConfig = {
  parseInline: [
    {
      name: "LenientLink",
      before: "Link",
      parse(cx, next, pos) {
        return next === OPEN_BRACKET ? parseLenientLink(cx, pos) : -1;
      },
    },
  ],
};

/**
 * The target a link's URL node points to: angle brackets removed and,
 * for note links, percent-escapes decoded (`La%20nota.md`). External
 * URLs are returned as written. Shared by the reading render, the
 * editor's click handling and the backlink index, so all three resolve
 * the same string.
 */
export function linkDestination(raw: string): {
  target: string;
  external: boolean;
} {
  let target = raw.trim();
  if (target.length >= 2 && target.startsWith("<") && target.endsWith(">")) {
    target = target.slice(1, -1);
  }
  if (isExternalTarget(target)) {
    return { target, external: true };
  }
  try {
    target = decodeURIComponent(target);
  } catch {
    // Malformed escapes: keep the raw text.
  }
  return { target, external: false };
}
