import { describe, expect, it } from "vitest";
import { pasteCarriesFiles } from "./clipboardFiles";

describe("pasteCarriesFiles", () => {
  it("is false without files", () => {
    expect(pasteCarriesFiles("", "", 0)).toBe(false);
    expect(pasteCarriesFiles("text", "<p>text</p>", 0)).toBe(false);
  });

  it("takes the files of a screenshot: no text at all", () => {
    expect(pasteCarriesFiles("", "", 1)).toBe(true);
    expect(pasteCarriesFiles("  \n", "", 1)).toBe(true);
  });

  it("takes the image copied in a browser, address or not", () => {
    const html = '<meta charset="utf-8"><img src="https://exemple.cat/foto.png" alt="">';
    expect(pasteCarriesFiles("", html, 1)).toBe(true);
    expect(pasteCarriesFiles("https://exemple.cat/foto.png", html, 1)).toBe(true);
    expect(
      pasteCarriesFiles(
        "https://exemple.cat/foto.png",
        "<html><body><!--StartFragment--><img src='x.png'>&nbsp;<!--EndFragment--></body></html>",
        1,
      ),
    ).toBe(true);
  });

  it("lets the text win when a picture only accompanies it", () => {
    // A spreadsheet: cells as text and html, plus a rendering of them.
    expect(
      pasteCarriesFiles("a\tb\n1\t2", "<table><tr><td>a</td><td>b</td></tr></table>", 1),
    ).toBe(false);
    // Rich text that happens to hold an image.
    expect(
      pasteCarriesFiles("Un títol", '<h1>Un títol</h1><img src="x.png">', 1),
    ).toBe(false);
  });

  it("lets plain text win when there is no rich content to judge by", () => {
    expect(pasteCarriesFiles("text normal", "", 1)).toBe(false);
  });
});
