import { beforeEach, describe, expect, it } from "vitest";
import {
  cachedWidgetHeight,
  cacheWidgetHeight,
  clearWidgetHeights,
  estimatedTableHeight,
  tableRowCount,
} from "./widgetHeightCache";

beforeEach(() => {
  clearWidgetHeights();
});

describe("widget height cache", () => {
  it("is unknown (-1) until measured", () => {
    expect(cachedWidgetHeight("table:a")).toBe(-1);
  });

  it("returns the last measurement, rounded", () => {
    cacheWidgetHeight("table:a", 120.4);
    expect(cachedWidgetHeight("table:a")).toBe(120);
    cacheWidgetHeight("table:a", 96);
    expect(cachedWidgetHeight("table:a")).toBe(96);
  });

  it("keeps keys apart", () => {
    cacheWidgetHeight("table:a", 100);
    cacheWidgetHeight("math:a", 40);
    expect(cachedWidgetHeight("table:a")).toBe(100);
    expect(cachedWidgetHeight("math:a")).toBe(40);
  });

  it("ignores measurements of hidden or detached widgets", () => {
    cacheWidgetHeight("table:a", 100);
    cacheWidgetHeight("table:a", 0);
    cacheWidgetHeight("table:a", -5);
    cacheWidgetHeight("table:a", Number.NaN);
    expect(cachedWidgetHeight("table:a")).toBe(100);
    cacheWidgetHeight("table:b", 0);
    expect(cachedWidgetHeight("table:b")).toBe(-1);
  });

  it("stays bounded, dropping the least recently used key", () => {
    cacheWidgetHeight("first", 10);
    cacheWidgetHeight("second", 20);
    for (let i = 0; i < 498; i++) {
      cacheWidgetHeight(`filler-${i}`, 30);
    }
    // Reading "first" makes "second" the oldest entry.
    expect(cachedWidgetHeight("first")).toBe(10);
    cacheWidgetHeight("overflow", 40);
    expect(cachedWidgetHeight("second")).toBe(-1);
    expect(cachedWidgetHeight("first")).toBe(10);
    expect(cachedWidgetHeight("overflow")).toBe(40);
  });
});

describe("table height estimate", () => {
  const table = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";

  it("counts the rendered rows: header and body, not the delimiter", () => {
    expect(tableRowCount(table)).toBe(3);
    expect(tableRowCount("| a |\n| --- |")).toBe(1);
    expect(tableRowCount(table + "\n")).toBe(3);
  });

  it("multiplies rows by the last measured row height", () => {
    expect(estimatedTableHeight(table, 30)).toBe(90);
    expect(estimatedTableHeight(table, 28.5)).toBe(86);
  });

  it("is unknown until a table has been measured", () => {
    expect(estimatedTableHeight(table, -1)).toBe(-1);
    expect(estimatedTableHeight(table, 0)).toBe(-1);
    expect(estimatedTableHeight(table, Number.NaN)).toBe(-1);
  });
});
