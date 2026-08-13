// Pure module: no Tauri, no DOM. Restricts setext headings so that a dash
// underline needs at least 3 dashes: while typing "- " to start a list
// under a paragraph, CommonMark's 1-dash rule would flash the paragraph as
// an H2. "=" underlines keep the CommonMark behavior (any length).
//
// The default SetextHeading parser must STAY registered: the built-in
// HorizontalRule paragraph-interrupt check defers "---" lines to setext by
// looking for that exact parser (by function identity) — removing it would
// turn "Foo\n---" into a paragraph plus a rule instead of a heading. So
// this extension installs a leaf parser directly before the default one:
// it produces valid headings itself (so the default never runs), and when
// a too-short dash underline appears it unhooks the default parser from
// that leaf so it cannot claim the line either.
import {
  parser as baseParser,
  type BlockContext,
  type LeafBlock,
  type LeafBlockParser,
  type Line,
  type MarkdownConfig,
} from "@lezer/markdown";

const DASH = 45;
const EQUALS = 61;

function isSpace(ch: number): boolean {
  return ch === 32 || ch === 9 || ch === 10 || ch === 13;
}

/**
 * End of the underline marker run, or -1 when the line is not a setext
 * underline at all. Mirrors the upstream check: a run of `-` or `=` at
 * less than 4 columns of indent, followed only by whitespace.
 */
function underlineEnd(line: Line): number {
  if (
    (line.next !== DASH && line.next !== EQUALS) ||
    line.indent >= line.baseIndent + 4
  ) {
    return -1;
  }
  let pos = line.pos + 1;
  while (pos < line.text.length && line.text.charCodeAt(pos) === line.next) {
    pos++;
  }
  const end = pos;
  while (pos < line.text.length) {
    if (!isSpace(line.text.charCodeAt(pos))) {
      return -1;
    }
    pos++;
  }
  return end;
}

// The upstream parser class is not exported; grab its constructor through
// the base parser's registration so instances can be recognized. The
// factory ignores its arguments. If an upstream update breaks this lookup,
// the constructor stays undefined and the tests below the extension catch
// the regression (1-2 dash underlines would make headings again).
type LeafFactory = (cx: BlockContext, leaf: LeafBlock) => LeafBlockParser | null;
const internals = baseParser as unknown as {
  blockNames: string[];
  leafBlockParsers: Array<LeafFactory | undefined>;
};
const defaultSetextFactory =
  internals.leafBlockParsers?.[internals.blockNames?.indexOf("SetextHeading")];
const defaultSetextCtor = defaultSetextFactory?.(
  undefined as unknown as BlockContext,
  undefined as unknown as LeafBlock,
)?.constructor;

function unhookDefaultSetext(leaf: LeafBlock): void {
  if (defaultSetextCtor === undefined) {
    return;
  }
  for (let i = leaf.parsers.length - 1; i >= 0; i--) {
    if (leaf.parsers[i].constructor === defaultSetextCtor) {
      leaf.parsers.splice(i, 1);
    }
  }
}

class RestrictedSetextParser implements LeafBlockParser {
  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock): boolean {
    // Lazy continuation lines (e.g. inside a blockquote without its ">")
    // never underline; same guard as upstream, via the internal line.depth.
    if ((line as unknown as { depth: number }).depth < cx.depth) {
      return false;
    }
    const end = underlineEnd(line);
    if (end < 0) {
      return false;
    }
    if (line.next === DASH && end - line.pos < 3) {
      unhookDefaultSetext(leaf);
      return false;
    }
    const underline = cx.elt(
      "HeaderMark",
      cx.lineStart + line.pos,
      cx.lineStart + end,
    );
    const type = line.next === EQUALS ? "SetextHeading1" : "SetextHeading2";
    cx.nextLine();
    cx.addLeafElement(
      leaf,
      cx.elt(type, leaf.start, cx.prevLineEnd(), [
        ...cx.parser.parseInline(leaf.content, leaf.start),
        underline,
      ]),
    );
    return true;
  }

  finish(): boolean {
    return false;
  }
}

/** Setext headings only with `===`-style or `---` of 3+ dashes. */
export const setextRestriction: MarkdownConfig = {
  parseBlock: [
    {
      name: "SetextRestriction",
      leaf: () => new RestrictedSetextParser(),
      before: "SetextHeading",
    },
  ],
};
