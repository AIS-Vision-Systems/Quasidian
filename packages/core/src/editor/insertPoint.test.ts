import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { markdownExtensions } from "../markdown/parser";
import { insertionAt } from "./insertPoint";

function state(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: markdownExtensions }),
    ],
  });
}

/** The document after inserting `text` at `pos`. */
function inserted(doc: string, pos: number, text: string): string {
  const { from, insert } = insertionAt(state(doc), pos, text);
  return doc.slice(0, from) + insert + doc.slice(from);
}

describe("insertionAt", () => {
  const embed = "![[foto.png]]";

  it("inserts in place inside ordinary text", () => {
    expect(insertionAt(state("hola món"), 4, embed)).toEqual({
      from: 4,
      insert: embed,
    });
    expect(inserted("hola món", 5, embed)).toBe("hola ![[foto.png]]món");
  });

  it("inserts at the very start and end of the document", () => {
    expect(inserted("text", 0, embed)).toBe("![[foto.png]]text");
    expect(inserted("text", 4, embed)).toBe("text![[foto.png]]");
    expect(inserted("", 0, embed)).toBe(embed);
  });

  it("clamps a position outside the document", () => {
    expect(insertionAt(state("text"), 99, embed).from).toBe(4);
    expect(insertionAt(state("text"), -3, embed).from).toBe(0);
  });

  const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";

  it("moves a drop inside a table to a line of its own after it", () => {
    const doc = "abans\n\n" + table + "\n\ndesprés\n";
    const expected = "abans\n\n" + table + "\n\n![[foto.png]]\n\ndesprés\n";
    // The header, the delimiter row and the last row.
    expect(inserted(doc, 10, embed)).toBe(expected);
    expect(inserted(doc, 22, embed)).toBe(expected);
    expect(inserted(doc, 7 + table.length - 2, embed)).toBe(expected);
  });

  it("treats the edges of the table source as inside it", () => {
    const doc = "abans\n\n" + table + "\n\ndesprés\n";
    const expected = "abans\n\n" + table + "\n\n![[foto.png]]\n\ndesprés\n";
    expect(inserted(doc, 7, embed)).toBe(expected);
    expect(inserted(doc, 7 + table.length, embed)).toBe(expected);
  });

  it("leaves the lines around a table alone", () => {
    const doc = "abans\n\n" + table + "\n\ndesprés\n";
    expect(inserted(doc, 3, embed)).toBe(
      "aba![[foto.png]]ns\n\n" + table + "\n\ndesprés\n",
    );
    const after = doc.indexOf("després");
    expect(insertionAt(state(doc), after, embed)).toEqual({
      from: after,
      insert: embed,
    });
  });

  it("works on a table that ends the document", () => {
    expect(inserted("x\n\n" + table, 6, embed)).toBe(
      "x\n\n" + table + "\n\n![[foto.png]]",
    );
  });

  const frontmatter = "---\ntags: [a]\n---";

  it("moves a drop inside the frontmatter to the line after it", () => {
    const doc = frontmatter + "\n# Títol\n";
    const expected = frontmatter + "\n![[foto.png]]\n# Títol\n";
    expect(inserted(doc, 0, embed)).toBe(expected);
    expect(inserted(doc, 8, embed)).toBe(expected);
    expect(inserted(doc, frontmatter.length, embed)).toBe(expected);
  });

  it("inserts normally below the frontmatter", () => {
    const doc = frontmatter + "\n# Títol\n";
    const pos = doc.indexOf("Títol");
    expect(insertionAt(state(doc), pos, embed)).toEqual({
      from: pos,
      insert: embed,
    });
  });

  it("finds a table beyond the initially parsed prefix", () => {
    const filler = "Paràgraf de farciment amb prou text per omplir.\n\n".repeat(200);
    const doc = filler + table + "\n";
    expect(inserted(doc, filler.length + 4, embed)).toBe(
      filler + table + "\n\n![[foto.png]]\n",
    );
  });
});
