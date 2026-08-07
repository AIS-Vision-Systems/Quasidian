// The single shared markdown parser: the same GFM grammar the editor uses
// (markdownLanguage) extended with wikilinks. Reading mode renders from
// this parser so the two modes can never diverge.
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { wikilinks } from "./wikilinks";

export const markdownParser = (
  markdownLanguage.parser as MarkdownParser
).configure(wikilinks);
