import { describe, expect, it } from "vitest";
import { minimalChange, normalizeLineEndings } from "./docDiff";

/** Applies a change the way the editor would. */
function apply(current: string, next: string): string {
  const change = minimalChange(current, next);
  if (change === null) {
    return current;
  }
  return current.slice(0, change.from) + change.insert + current.slice(change.to);
}

describe("normalizeLineEndings", () => {
  it("turns CRLF and lone CR into LF", () => {
    expect(normalizeLineEndings("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(normalizeLineEndings("\r\n\r\n")).toBe("\n\n");
  });

  it("leaves LF-only text untouched", () => {
    expect(normalizeLineEndings("a\nb\n")).toBe("a\nb\n");
    expect(normalizeLineEndings("")).toBe("");
  });
});

describe("minimalChange", () => {
  it("is null for equal documents", () => {
    expect(minimalChange("", "")).toBeNull();
    expect(minimalChange("# Nota\n\ntext\n", "# Nota\n\ntext\n")).toBeNull();
  });

  it("is null when only the line endings differ (CRLF file on disk)", () => {
    expect(minimalChange("a\nb\nc", "a\r\nb\r\nc")).toBeNull();
    expect(minimalChange("a\nb", "a\rb")).toBeNull();
  });

  it("covers only the inserted text", () => {
    expect(minimalChange("abc", "Xabc")).toEqual({ from: 0, to: 0, insert: "X" });
    expect(minimalChange("abc", "abXc")).toEqual({ from: 2, to: 2, insert: "X" });
    expect(minimalChange("abc", "abcX")).toEqual({ from: 3, to: 3, insert: "X" });
  });

  it("covers only the deleted text", () => {
    expect(minimalChange("abc", "bc")).toEqual({ from: 0, to: 1, insert: "" });
    expect(minimalChange("abc", "ac")).toEqual({ from: 1, to: 2, insert: "" });
    expect(minimalChange("abc", "ab")).toEqual({ from: 2, to: 3, insert: "" });
  });

  it("covers only the replaced middle", () => {
    expect(minimalChange("one two three", "one 2 three")).toEqual({
      from: 4,
      to: 7,
      insert: "2",
    });
  });

  it("handles empty documents on either side", () => {
    expect(minimalChange("", "abc")).toEqual({ from: 0, to: 0, insert: "abc" });
    expect(minimalChange("abc", "")).toEqual({ from: 0, to: 3, insert: "" });
  });

  it("never lets prefix and suffix overlap on repeated text", () => {
    expect(apply("aaa", "aaaa")).toBe("aaaa");
    expect(apply("aaaa", "aa")).toBe("aa");
    expect(apply("abab", "ab")).toBe("ab");
    expect(apply("ab", "abab")).toBe("abab");
    const change = minimalChange("aaa", "aaaa");
    expect(change).not.toBeNull();
    expect(change!.from).toBeLessThanOrEqual(change!.to);
  });

  it("normalizes the incoming text before diffing", () => {
    expect(minimalChange("a\nb\nc", "a\r\nB\r\nc")).toEqual({
      from: 2,
      to: 3,
      insert: "B",
    });
  });

  it("never splits a surrogate pair", () => {
    // U+1F600 and U+1F601 share the high surrogate; U+1F600 and
    // U+1F400 share nothing but would share a low one with U+1F000.
    const grin = "\u{1F600}";
    const beam = "\u{1F601}";
    expect(minimalChange(`a${grin}b`, `a${beam}b`)).toEqual({
      from: 1,
      to: 3,
      insert: beam,
    });
    const low = "\u{1F600}";
    const sameLow = "\u{1F200}";
    expect(low.charCodeAt(1)).toBe(sameLow.charCodeAt(1));
    expect(minimalChange(`a${low}b`, `a${sameLow}b`)).toEqual({
      from: 1,
      to: 3,
      insert: sameLow,
    });
    expect(apply(`x${grin}`, `x${beam}`)).toBe(`x${beam}`);
    expect(apply(`${low}y`, `${sameLow}y`)).toBe(`${sameLow}y`);
  });

  it("round-trips arbitrary edits", () => {
    const cases: [string, string][] = [
      ["# Títol\n\n| a | b |\n| - | - |\n", "# Títol\n\nnou\n\n| a | b |\n| - | - |\n"],
      ["línia\n".repeat(50), "línia\n".repeat(49) + "final\n"],
      ["abc", "xyz"],
      ["mateix", "mateix"],
    ];
    for (const [current, next] of cases) {
      expect(apply(current, next)).toBe(next);
    }
  });
});
