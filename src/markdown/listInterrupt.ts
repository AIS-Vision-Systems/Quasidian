// Lezer extension: an ordered list may interrupt a paragraph whatever
// its start number. CommonMark only lets "1." interrupt; Obsidian — and
// this app, which renders soft line breaks as real breaks — treats any
// "n. item" line as the start of a list. Pure module.
import type { Line, MarkdownConfig } from "@lezer/markdown";

export const listInterrupt: MarkdownConfig = {
  parseBlock: [
    {
      name: "OrderedListInterrupt",
      endLeaf(_cx, line: Line): boolean {
        return /^\d{1,9}[.)][ \t]+\S/.test(line.text.slice(line.pos));
      },
    },
  ],
};
