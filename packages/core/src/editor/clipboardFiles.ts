// Whether a paste is about its files or about its text (m51). A
// clipboard often carries both: an office suite adds a picture of the
// cells that were copied, and a browser adds the address of the image
// that was copied. No DOM: the caller reads the clipboard.

/**
 * True when the files of a paste are what the user copied. Text wins
 * whenever there is real text — pasting a spreadsheet must paste its
 * text, not a picture of it — except when the rich content is nothing
 * but an image: that is "Copy image" in a browser, whose plain text
 * is at most the image's address.
 */
export function pasteCarriesFiles(
  plain: string,
  html: string,
  fileCount: number,
): boolean {
  if (fileCount === 0) {
    return false;
  }
  if (plain.trim() === "") {
    return true;
  }
  if (!/<img\b/i.test(html)) {
    return false;
  }
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return text === "";
}
