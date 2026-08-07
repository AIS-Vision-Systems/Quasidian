import { describe, expect, it } from "vitest";
import { countWords } from "./text";

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
