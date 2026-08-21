import { describe, expect, it } from "vitest";
import { cachedImageSize, cacheImageSize } from "./imageSizeCache";

describe("imageSizeCache", () => {
  it("misses on an unknown src", () => {
    expect(cachedImageSize("asset://miss.png")).toBeUndefined();
  });

  it("returns the cached natural size", () => {
    cacheImageSize("asset://a.png", { width: 640, height: 480 });
    expect(cachedImageSize("asset://a.png")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("keeps the first size: later loads never shift a settled layout", () => {
    cacheImageSize("asset://b.png", { width: 100, height: 50 });
    cacheImageSize("asset://b.png", { width: 999, height: 999 });
    expect(cachedImageSize("asset://b.png")).toEqual({
      width: 100,
      height: 50,
    });
  });
});
