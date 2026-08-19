import { describe, expect, it } from "vitest";
import { compareVersions, isNewer, parseLatestRelease } from "./updates";

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

describe("parseLatestRelease", () => {
  it("parses a GitHub latest-release payload", () => {
    expect(
      parseLatestRelease(
        '{"tag_name": "v1.2.3", "html_url": "https://github.com/o/r/releases/tag/v1.2.3", "body": "notes"}',
      ),
    ).toEqual({
      version: "1.2.3",
      url: "https://github.com/o/r/releases/tag/v1.2.3",
      notes: "notes",
    });
  });

  it("strips the v prefix and normalizes an absent or empty body", () => {
    expect(
      parseLatestRelease(
        '{"tag_name": "2.0", "html_url": "https://example.com/r"}',
      ),
    ).toEqual({ version: "2.0", url: "https://example.com/r", notes: null });
    expect(
      parseLatestRelease(
        '{"tag_name": "v1.0.1", "html_url": "https://example.com/r", "body": ""}',
      )?.notes,
    ).toBeNull();
  });

  it("rejects garbage, missing fields and non-https urls", () => {
    expect(parseLatestRelease("not json")).toBeNull();
    expect(parseLatestRelease("42")).toBeNull();
    expect(parseLatestRelease('{"tag_name": "v1.0.0"}')).toBeNull();
    expect(
      parseLatestRelease('{"tag_name": "v", "html_url": "https://x.com"}'),
    ).toBeNull();
    expect(
      parseLatestRelease(
        '{"tag_name": "v1.0.0", "html_url": "http://example.com"}',
      ),
    ).toBeNull();
  });
});
