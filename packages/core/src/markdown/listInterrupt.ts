// Lezer extension: a list marker may interrupt a paragraph even when
// CommonMark says no — any start number ("3.", not just "1.") and even
// an empty item ("- ", "3. " while still typing). Obsidian — and this
// app, which renders soft line breaks as real breaks — treats those
// lines as list starts, so the marker styles as soon as the space after
// it is pressed. Pure module.
import type { Line, MarkdownConfig } from "@lezer/markdown";

export const listInterrupt: MarkdownConfig = {
  parseBlock: [
    {
      name: "ListInterrupt",
      endLeaf(_cx, line: Line): boolean {
        return /^(?:\d{1,9}[.)]|[-+*])[ \t]/.test(line.text.slice(line.pos));
      },
    },
  ],
};
