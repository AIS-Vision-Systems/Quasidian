import { describe, expect, it } from "vitest";
import { countCharacters, countWords } from "./text";

describe("countWords", () => {
  it("returns 0 for empty and whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });

  it("counts words separated by any whitespace", () => {
    expect(countWords("one two three")).toBe(3);
    expect(countWords("one\ntwo\t three ")).toBe(3);
  });

  it("counts a single word", () => {
    expect(countWords("hello")).toBe(1);
  });
});

describe("countCharacters", () => {
  it("returns 0 for empty text", () => {
    expect(countCharacters("")).toBe(0);
  });

  it("counts spaces but not line terminators", () => {
    expect(countCharacters("a b")).toBe(3);
    expect(countCharacters("a\nb\r\nc")).toBe(3);
  });

  it("counts code points, not UTF-16 units", () => {
    expect(countCharacters("héllo")).toBe(5);
    expect(countCharacters("a😀b")).toBe(3);
  });
});
