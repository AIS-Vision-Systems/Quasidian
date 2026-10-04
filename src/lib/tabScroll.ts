// Pure module: no Tauri, no DOM. Scroll arithmetic for the tab strip.

/**
 * The scroll offset that brings an item fully into view along one
 * axis, moving as little as possible: unchanged when the item is
 * already visible, aligned to the near edge otherwise. An item larger
 * than the viewport shows its start. Never negative.
 */
export function revealOffset(
  current: number,
  viewSize: number,
  itemStart: number,
  itemSize: number,
): number {
  if (itemStart < current || itemSize >= viewSize) {
    return Math.max(0, itemStart);
  }
  const itemEnd = itemStart + itemSize;
  if (itemEnd > current + viewSize) {
    return Math.max(0, itemEnd - viewSize);
  }
  return Math.max(0, current);
}
