// The single shared markdown parser: the same GFM grammar the editor uses
// (markdownLanguage) extended with wikilinks. Reading mode renders from
// this parser so the two modes can never diverge.
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { highlights, wikilinks } from "./wikilinks";

/** The full extension set: wikilinks/embeds plus ==highlights==. */
export const markdownExtensions = [wikilinks, highlights];

export const markdownParser = (
  markdownLanguage.parser as MarkdownParser
).configure(markdownExtensions);
