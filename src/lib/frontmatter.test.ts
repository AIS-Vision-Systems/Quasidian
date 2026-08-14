import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("returns empty data without frontmatter", () => {
    expect(parseFrontmatter("text pla")).toEqual({
      exists: false,
      end: 0,
      properties: [],
      tags: [],
      aliases: [],
    });
    expect(parseFrontmatter("x\n---\ny")).toMatchObject({ exists: false });
  });

  it("parses scalars, inline arrays and dash lists", () => {
    const doc = '---\ntitle: "La nota"\ntags: [a, b]\naliases:\n  - Un\n  - Dos\n---\ncos';
    const data = parseFrontmatter(doc);
    expect(data.exists).toBe(true);
    expect(data.properties).toEqual([
      { key: "title", values: ["La nota"], isList: false },
      { key: "tags", values: ["a", "b"], isList: true },
      { key: "aliases", values: ["Un", "Dos"], isList: true },
    ]);
    expect(data.tags).toEqual(["a", "b"]);
    expect(data.aliases).toEqual(["Un", "Dos"]);
    expect(doc.slice(data.end - 3, data.end)).toBe("---");
    expect(doc.slice(data.end)).toBe("\ncos");
  });

  it("normalizes singular keys and leading #", () => {
    const data = parseFrontmatter("---\ntag: '#lectura'\nalias: Nom\n---");
    expect(data.tags).toEqual(["lectura"]);
    expect(data.aliases).toEqual(["Nom"]);
  });

  it("runs to the end of the document when unclosed", () => {
    const doc = "---\ntags: [x]";
    const data = parseFrontmatter(doc);
    expect(data.exists).toBe(true);
    expect(data.end).toBe(doc.length);
    expect(data.tags).toEqual(["x"]);
  });

  it("tolerates CRLF line endings", () => {
    const data = parseFrontmatter("---\r\ntags: [a]\r\n---\r\ntext");
    expect(data.exists).toBe(true);
    expect(data.tags).toEqual(["a"]);
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips scalars and lists", () => {
    const doc = "---\ntitle: Nota\ntags:\n  - a\n  - b\n---";
    const data = parseFrontmatter(doc);
    expect(serializeFrontmatter(data.properties)).toBe(doc);
  });
});
