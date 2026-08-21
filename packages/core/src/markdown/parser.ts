// The single shared markdown parser: the same GFM grammar the editor uses
// (markdownLanguage) extended with wikilinks. Reading mode renders from
// this parser so the two modes can never diverge.
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { footnotes } from "./footnotes";
import { frontmatter } from "./frontmatter";
import { listInterrupt } from "./listInterrupt";
import { math } from "./math";
import { setextRestriction } from "./setext";
import { highlights, wikilinks } from "./wikilinks";

/**
 * The full extension set: wikilinks/embeds, ==highlights==, math, the
 * 3-dash setext restriction, YAML frontmatter, footnotes and the
 * any-number ordered-list interrupt.
 */
export const markdownExtensions = [
  wikilinks,
  highlights,
  math,
  setextRestriction,
  frontmatter,
  footnotes,
  listInterrupt,
];

export const markdownParser = (
  markdownLanguage.parser as MarkdownParser
).configure(markdownExtensions);
