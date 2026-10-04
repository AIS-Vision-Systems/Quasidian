// Measured heights of Live Preview widgets, per content key (m45).
// CodeMirror assumes one line for any block widget that gives no
// estimate, and corrects it only once the widget scrolls into view —
// which shifts everything below it. A widget rebuilt with content
// that was measured before reports its last real height instead, so
// the layout is already right before it is drawn. Pure: the DOM
// observation that feeds it lives in the Live Preview module.

/** Enough for every widget of the notes open at once; oldest go first. */
const MAX_ENTRIES = 500;

const heights = new Map<string, number>();

/** Last measured height for `key`, or -1 when it was never measured. */
export function cachedWidgetHeight(key: string): number {
  const height = heights.get(key);
  if (height === undefined) {
    return -1;
  }
  // Re-insert: a Map iterates in insertion order, which makes the
  // first key the least recently used one.
  heights.delete(key);
  heights.set(key, height);
  return height;
}

/** Records a measurement. Non-positive heights (hidden panes) are ignored. */
export function cacheWidgetHeight(key: string, height: number): void {
  if (!Number.isFinite(height) || height <= 0) {
    return;
  }
  heights.delete(key);
  heights.set(key, Math.round(height));
  while (heights.size > MAX_ENTRIES) {
    const oldest = heights.keys().next();
    if (oldest.done === true) {
      break;
    }
    heights.delete(oldest.value);
  }
}

export function clearWidgetHeights(): void {
  heights.clear();
}

/** Rendered rows of a table source: every line but the delimiter row. */
export function tableRowCount(source: string): number {
  const lines = source.split("\n").filter((line) => line.trim() !== "");
  return Math.max(1, lines.length - 1);
}

/**
 * Height of a table never measured before, from the height of one
 * row as last measured on another table. -1 (unknown) until some
 * table has been measured.
 */
export function estimatedTableHeight(source: string, rowHeight: number): number {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
    return -1;
  }
  return Math.round(tableRowCount(source) * rowHeight);
}

export type WidgetKind = "table" | "math" | "properties" | "title" | "embed";

/** Cache key of a widget: its kind plus the content that sizes it. */
export function widgetHeightKey(kind: WidgetKind, content: string): string {
  return kind + ":" + content;
}
