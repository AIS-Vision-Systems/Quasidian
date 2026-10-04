import { describe, expect, it } from "vitest";
import { revealOffset } from "./tabScroll";

describe("revealOffset", () => {
  it("stays put when the item is already fully visible", () => {
    expect(revealOffset(0, 300, 100, 80)).toBe(0);
    expect(revealOffset(50, 300, 50, 80)).toBe(50);
    expect(revealOffset(50, 300, 270, 80)).toBe(50);
  });

  it("scrolls back to an item cut off at the start", () => {
    expect(revealOffset(120, 300, 100, 80)).toBe(100);
    expect(revealOffset(500, 300, 0, 80)).toBe(0);
  });

  it("scrolls forward just enough for an item cut off at the end", () => {
    expect(revealOffset(0, 300, 260, 80)).toBe(40);
    expect(revealOffset(0, 300, 900, 80)).toBe(680);
  });

  it("shows the start of an item larger than the viewport", () => {
    expect(revealOffset(0, 60, 200, 80)).toBe(200);
    expect(revealOffset(250, 60, 200, 80)).toBe(200);
  });

  it("is never negative", () => {
    expect(revealOffset(-10, 300, 0, 80)).toBe(0);
    expect(revealOffset(0, 300, -5, 80)).toBe(0);
  });
});
