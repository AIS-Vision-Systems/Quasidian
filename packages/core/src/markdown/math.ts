// Lezer extension for TeX math: $inline$, $$display$$ on one line, and
// multi-line $$ blocks. Plugs into the shared markdown parser — never a
// second parser. Pure module: only @lezer/markdown and tags.
//
// Anti-false-positive rules (Pandoc/Obsidian convention): the opening $
// must not be followed by whitespace, the closing $ must not be preceded
// by whitespace nor followed by a digit, and \$ never delimits — so
// "val 100$ i 200$" stays plain text.
import { Tag, tags } from "@lezer/highlight";
import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";

/** Styling tag for raw TeX source when revealed in the editor. */
export const mathTag = Tag.define();

const DOLLAR = 36; /* $ */
const BACKSLASH = 92; /* \ */
const SPACE = 32;
const TAB = 9;

function isSpace(ch: number): boolean {
  return ch === SPACE || ch === TAB;
}

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57;
}

function parseBlockMath(cx: BlockContext, line: Line): boolean {
  if (line.next !== DOLLAR) {
    return false;
  }
  const text = line.text.slice(line.pos);
  if (!text.startsWith("$$")) {
    return false;
  }
  const start = cx.lineStart + line.pos;
  const openMark = cx.elt("MathMark", start, start + 2);
  const rest = text.slice(2);
  const closeInFirst = rest.indexOf("$$");
  if (closeInFirst !== -1 && rest.slice(closeInFirst + 2).trim() === "") {
    // Single-line $$...$$ standing on its own block line.
    if (rest.slice(0, closeInFirst).trim() === "") {
      return false;
    }
    const closePos = start + 2 + closeInFirst;
    cx.addElement(
      cx.elt("MathBlock", start, closePos + 2, [
        openMark,
        cx.elt("MathMark", closePos, closePos + 2),
      ]),
    );
    cx.nextLine();
    return true;
  }
  while (cx.nextLine()) {
    const trimmed = line.text.trim();
    if (trimmed.endsWith("$$")) {
      const closeIdx = line.text.lastIndexOf("$$");
      const closePos = cx.lineStart + closeIdx;
      cx.addElement(
        cx.elt("MathBlock", start, closePos + 2, [
          openMark,
          cx.elt("MathMark", closePos, closePos + 2),
        ]),
      );
      cx.nextLine();
      return true;
    }
  }
  // Unclosed at end of document: keep what we consumed as a math block.
  cx.addElement(cx.elt("MathBlock", start, cx.prevLineEnd(), [openMark]));
  return true;
}

export const math: MarkdownConfig = {
  defineNodes: [
    { name: "InlineMath", style: mathTag },
    { name: "MathBlock", style: mathTag },
    { name: "MathMark", style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: "MathBlock",
      parse: parseBlockMath,
    },
  ],
  parseInline: [
    {
      name: "InlineMath",
      parse(cx, next, pos) {
        if (next !== DOLLAR || cx.char(pos - 1) === BACKSLASH) {
          return -1;
        }
        const double = cx.char(pos + 1) === DOLLAR;
        const contentStart = pos + (double ? 2 : 1);
        const first = cx.char(contentStart);
        if (first === -1 || isSpace(first) || (!double && first === DOLLAR)) {
          return -1;
        }
        for (let i = contentStart; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === 10 /* \n */) {
            // Inline math is single-line; multi-line $$ blocks are the
            // block parser's job.
            return -1;
          }
          if (ch === BACKSLASH) {
            i++;
            continue;
          }
          if (ch !== DOLLAR) {
            continue;
          }
          if (double) {
            if (cx.char(i + 1) !== DOLLAR || i === contentStart) {
              continue;
            }
            return cx.addElement(
              cx.elt("MathBlock", pos, i + 2, [
                cx.elt("MathMark", pos, contentStart),
                cx.elt("MathMark", i, i + 2),
              ]),
            );
          }
          if (isSpace(cx.char(i - 1)) || isDigit(cx.char(i + 1))) {
            continue;
          }
          if (i === contentStart) {
            return -1;
          }
          return cx.addElement(
            cx.elt("InlineMath", pos, i + 1, [
              cx.elt("MathMark", pos, contentStart),
              cx.elt("MathMark", i, i + 1),
            ]),
          );
        }
        return -1;
      },
    },
  ],
};
