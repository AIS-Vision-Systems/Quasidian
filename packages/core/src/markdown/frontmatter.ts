// Lezer extension for YAML frontmatter: a --- fence that only counts at
// the very start of the document, closed by a --- line (or running to
// EOF while being typed). Plugs into the shared markdown parser — never
// a second parser; the YAML itself is read by lib/frontmatter. Content
// gets no inline parsing, so wikilinks inside it never index.
import { tags } from "@lezer/highlight";
import type { BlockContext, Line, MarkdownConfig } from "@lezer/markdown";

function parseFrontmatterBlock(cx: BlockContext, line: Line): boolean {
  if (cx.lineStart !== 0 || line.pos !== 0 || line.text !== "---") {
    return false;
  }
  const openMark = cx.elt("FrontmatterMark", 0, 3);
  while (cx.nextLine()) {
    if (line.text === "---") {
      const closeStart = cx.lineStart;
      cx.addElement(
        cx.elt("Frontmatter", 0, closeStart + 3, [
          openMark,
          cx.elt("FrontmatterMark", closeStart, closeStart + 3),
        ]),
      );
      cx.nextLine();
      return true;
    }
  }
  // Still being typed: swallow to EOF, like an unclosed code fence.
  cx.addElement(cx.elt("Frontmatter", 0, cx.prevLineEnd(), [openMark]));
  return true;
}

export const frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: "Frontmatter", block: true },
    { name: "FrontmatterMark", style: tags.processingInstruction },
  ],
  parseBlock: [
    {
      name: "Frontmatter",
      before: "HorizontalRule",
      parse: parseFrontmatterBlock,
    },
  ],
};
