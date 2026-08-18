import { describe, expect, it } from "vitest";
import { compareVersions, isNewer, parseLatest } from "./updates";

describe("compareVersions", () => {
  it("orders major, minor and patch numerically", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.1.0", "1.0.9")).toBe(1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1); // not lexicographic
  });

  it("treats missing segments as zero and tolerates a v prefix", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("v1.2.0", "1.2")).toBe(0);
    expect(compareVersions("1", "1.0.1")).toBe(-1);
  });

  it("isNewer is strict", () => {
    expect(isNewer("1.0.1", "1.0.0")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("0.9.9", "1.0.0")).toBe(false);
  });
});

describe("parseLatest", () => {
  it("parses a valid payload", () => {
    expect(
      parseLatest(
        '{"version": "1.2.3", "url": "https://example.com/d", "notes": "x"}',
      ),
    ).toEqual({ version: "1.2.3", url: "https://example.com/d", notes: "x" });
    expect(
      parseLatest('{"version": "1.2.3", "url": "https://example.com/d"}')
        ?.notes,
    ).toBeNull();
  });

  it("rejects garbage, missing fields and non-https urls", () => {
    expect(parseLatest("not json")).toBeNull();
    expect(parseLatest("42")).toBeNull();
    expect(parseLatest('{"version": "1.0.0"}')).toBeNull();
    expect(
      parseLatest('{"version": "", "url": "https://example.com"}'),
    ).toBeNull();
    expect(
      parseLatest('{"version": "1.0.0", "url": "http://example.com"}'),
    ).toBeNull();
  });
});
