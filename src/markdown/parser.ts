// The single shared markdown parser: the same GFM grammar the editor uses
// (markdownLanguage) extended with wikilinks. Reading mode renders from
// this parser so the two modes can never diverge.
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { math } from "./math";
import { highlights, wikilinks } from "./wikilinks";

/** The full extension set: wikilinks/embeds, ==highlights== and math. */
export const markdownExtensions = [wikilinks, highlights, math];

export const markdownParser = (
  markdownLanguage.parser as MarkdownParser
).configure(markdownExtensions);
