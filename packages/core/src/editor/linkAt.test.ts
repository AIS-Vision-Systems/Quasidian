import { describe, expect, it } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { markdownExtensions } from "../markdown/parser";
import { linkAt } from "./linkAt";

function at(doc: string, pos: number) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: markdownExtensions }),
    ],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  return linkAt(state, pos);
}

describe("linkAt", () => {
  it("finds a wikilink anywhere inside its element", () => {
    const doc = "see [[Nota]] end";
    const expected = { target: "Nota", kind: "wikilink", from: 4, to: 12 };
    expect(at(doc, 6)).toEqual(expected);
    expect(at(doc, 9)).toEqual(expected);
  });

  it("returns the path of an aliased wikilink, from path or alias", () => {
    const doc = "[[Nota|àlies]]";
    expect(at(doc, 3)?.target).toBe("Nota");
    expect(at(doc, 9)?.target).toBe("Nota");
  });

  it("keeps the heading anchor in the target", () => {
    expect(at("[[Nota#Una secció]]", 4)?.target).toBe("Nota#Una secció");
    expect(at("[[#Aquí]]", 4)?.target).toBe("#Aquí");
  });

  it("tells an embed from a wikilink", () => {
    expect(at("![[imatge.png]]", 5)).toEqual({
      target: "imatge.png",
      kind: "embed",
      from: 0,
      to: 15,
    });
    expect(at("![[Nota]]", 5)?.kind).toBe("embed");
  });

  it("finds a markdown link from its label or its destination", () => {
    const doc = "x [Spec](docs/SPEC.md) y";
    const expected = { target: "docs/SPEC.md", kind: "link", from: 2, to: 22 };
    expect(at(doc, 4)).toEqual(expected);
    expect(at(doc, 12)).toEqual(expected);
  });

  it("resolves the destination like the reading render does (m47)", () => {
    expect(at("[n](La%20nota.md)", 2)?.target).toBe("La nota.md");
    expect(at("[n](<La nota.md>)", 2)?.target).toBe("La nota.md");
    expect(at("[n](docs/Exemple.md#Secció primera)", 2)?.target).toBe(
      "docs/Exemple.md#Secció primera",
    );
  });

  it("returns an external URL as written", () => {
    expect(at("[web](https://exemple.cat/a%20b)", 2)?.target).toBe(
      "https://exemple.cat/a%20b",
    );
  });

  it("is null outside any link", () => {
    expect(at("see [[Nota]] end", 1)).toBeNull();
    expect(at("see [[Nota]] end", 14)).toBeNull();
    expect(at("text sense enllaços", 5)).toBeNull();
    expect(at("", 0)).toBeNull();
  });

  it("is null on a bracketed text with no destination", () => {
    expect(at("un [text] sol", 5)).toBeNull();
  });

  it("is null inside code, where there are no link nodes", () => {
    expect(at("`[[Nota]]`", 4)).toBeNull();
    expect(at("```\n[[Nota]]\n```", 7)).toBeNull();
  });
});
