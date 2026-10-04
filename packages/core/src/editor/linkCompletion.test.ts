import { describe, expect, it } from "vitest";
import {
  completeLink,
  narrowOptions,
  type LinkCompletionHooks,
} from "./linkCompletion";

const asked: string[] = [];
const hooks: LinkCompletionHooks = {
  getWikilinkCompletions: () => ["Inici", "Nota A", "foto.png"],
  getLinkPathCompletions: () => [
    "Inici.md",
    "docs/Exemple.md",
    "docs/La nota.md",
    "src/help/guide.ca.md",
  ],
  getHeadingCompletions: (note) => {
    asked.push(note);
    return Promise.resolve(["Secció primera", "Segona"]);
  },
};

describe("completeLink — wikilinks", () => {
  it("offers note names after [[ and closes the link", async () => {
    const result = await completeLink("vegeu [[No", "", hooks);
    expect(result?.from).toBe(8);
    expect(result?.filtered).toBe(false);
    expect(result?.options).toContainEqual({
      label: "Nota A",
      apply: "Nota A]]",
    });
  });

  it("does not close a link that is already closed", async () => {
    const result = await completeLink("[[No", "]] i més", hooks);
    expect(result?.options).toContainEqual({ label: "Nota A", apply: "Nota A" });
  });

  it("offers the note's headings after a #", async () => {
    asked.length = 0;
    const result = await completeLink("[[Nota A#Sec", "", hooks);
    expect(asked).toEqual(["Nota A"]);
    expect(result?.from).toBe(9);
    expect(result?.options).toEqual([
      { label: "Secció primera", apply: "Secció primera]]" },
      { label: "Segona", apply: "Segona]]" },
    ]);
  });

  it("asks for the open note's headings on a bare [[#", async () => {
    asked.length = 0;
    const result = await completeLink("[[#", "]]", hooks);
    expect(asked).toEqual([""]);
    expect(result?.from).toBe(3);
    expect(result?.options[0]).toEqual({
      label: "Secció primera",
      apply: "Secció primera",
    });
  });

  it("stops offering once the alias starts", async () => {
    expect(await completeLink("[[Nota A|àl", "", hooks)).toBeNull();
  });
});

describe("completeLink — markdown links", () => {
  it("offers paths that contain the typed fragment, earliest match first", async () => {
    const result = await completeLink("un [text](guid", "", hooks);
    expect(result?.from).toBe(10);
    expect(result?.filtered).toBe(true);
    expect(result?.options).toEqual([
      { label: "src/help/guide.ca.md", apply: "src/help/guide.ca.md)" },
    ]);
  });

  it("percent-encodes the spaces of a path", async () => {
    const result = await completeLink("[n](la", "", hooks);
    expect(result?.options).toContainEqual({
      label: "docs/La nota.md",
      apply: "docs/La%20nota.md)",
    });
  });

  it("offers the headings of the linked note after a # (m47)", async () => {
    asked.length = 0;
    const result = await completeLink("[e](docs/Exemple.md#", "", hooks);
    expect(asked).toEqual(["docs/Exemple.md"]);
    expect(result?.from).toBe(20);
    expect(result?.filtered).toBe(false);
    expect(result?.options).toEqual([
      { label: "Secció primera", apply: "Secció primera)" },
      { label: "Segona", apply: "Segona)" },
    ]);
  });

  it("keeps offering headings while the fragment has spaces", async () => {
    const result = await completeLink("[e](docs/Exemple.md#Secció pri", ")", hooks);
    expect(result?.from).toBe(20);
    expect(result?.validFor?.test("Secció pri")).toBe(true);
    // Already closed: nothing is appended.
    expect(result?.options[0]).toEqual({
      label: "Secció primera",
      apply: "Secció primera",
    });
  });

  it("decodes the path it asks the headings of", async () => {
    asked.length = 0;
    await completeLink("[n](docs/La%20nota.md#", "", hooks);
    expect(asked).toEqual(["docs/La nota.md"]);
  });

  it("handles the angle-bracket form", async () => {
    asked.length = 0;
    const result = await completeLink("[n](<docs/La nota.md#Se", "", hooks);
    expect(asked).toEqual(["docs/La nota.md"]);
    expect(result?.from).toBe(21);
    expect(result?.options[1]).toEqual({ label: "Segona", apply: "Segona>)" });
  });

  it("offers nothing after the # of a web address", async () => {
    asked.length = 0;
    expect(
      await completeLink("[web](https://exemple.cat/pagina#se", "", hooks),
    ).toBeNull();
    expect(asked).toEqual([]);
  });

  it("asks for the open note's headings on a bare (#", async () => {
    asked.length = 0;
    await completeLink("[aquí](#", ")", hooks);
    expect(asked).toEqual([""]);
  });
});

describe("completeLink — outside a link", () => {
  it("is null in plain text and after a finished link", async () => {
    expect(await completeLink("text normal", "", hooks)).toBeNull();
    expect(await completeLink("[[Nota A]] i ", "", hooks)).toBeNull();
    expect(await completeLink("[n](a.md) i # no", "", hooks)).toBeNull();
    expect(await completeLink("", "", hooks)).toBeNull();
  });
});

describe("narrowOptions", () => {
  const options = [
    { label: "Segona nota", apply: "a" },
    { label: "Nota A", apply: "b" },
    { label: "nota b", apply: "c" },
    { label: "Altres", apply: "d" },
  ];

  it("returns everything for an empty fragment", () => {
    expect(narrowOptions(options, "")).toEqual(options);
  });

  it("puts prefix matches before the others, ignoring case", () => {
    expect(narrowOptions(options, "nota").map((o) => o.label)).toEqual([
      "Nota A",
      "nota b",
      "Segona nota",
    ]);
  });

  it("drops what does not match", () => {
    expect(narrowOptions(options, "zzz")).toEqual([]);
  });
});
