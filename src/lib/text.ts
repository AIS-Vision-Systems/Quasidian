// Pure module: no Tauri, no DOM.

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** Unicode code points, spaces included, line terminators excluded. */
export function countCharacters(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (ch !== "\n" && ch !== "\r") {
      count++;
    }
  }
  return count;
}
