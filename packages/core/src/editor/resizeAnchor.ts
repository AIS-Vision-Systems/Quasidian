// Pure module: no Tauri, no DOM. Decides how a scrolling view reacts
// to host resize events so the document position at the top of the
// view survives reflows (milestone 36).
//
// A window resize with line wrapping active reflows every line, so the
// pixel scroll offset no longer maps to the same document position.
// The remedy is to capture the top-visible position when a resize
// burst starts — while the height model still reflects the previous
// geometry — hold it through the burst, and let the caller re-apply it
// while heights settle. A held anchor is dropped the moment the user
// scrolls on their own: the view must never fight them.

export interface ResizeAnchorState {
  /** True while the host is hidden (last observation was zero-sized). */
  hidden: boolean;
  /** Anchor held during the current resize burst, null outside one. */
  holding: number | null;
}

export type ResizeAction =
  /** Hidden host: nothing to measure or anchor. */
  | { kind: "ignore" }
  /** Just shown, or no usable anchor: re-measure, do not scroll. */
  | { kind: "measure" }
  /** Re-measure and re-apply this anchor while heights settle. */
  | { kind: "anchor"; pos: number };

/** Hidden until the first observation: a fresh host must only measure. */
export function initialResizeAnchor(): ResizeAnchorState {
  return { hidden: true, holding: null };
}

/**
 * A host size observation arrived. The first sizing after being hidden
 * only re-measures — whoever unhid the view (mode switch, tab switch)
 * applies its own anchoring. A resize while visible captures the
 * current top position once per burst and keeps holding it, so every
 * step of a continuous resize re-anchors to where the burst started.
 * `currentTopPos` is read lazily and may return null when the view has
 * no usable anchor (empty or unrendered).
 */
export function onHostResize(
  state: ResizeAnchorState,
  width: number,
  height: number,
  currentTopPos: () => number | null,
): { state: ResizeAnchorState; action: ResizeAction } {
  if (width <= 0 || height <= 0) {
    return { state: { hidden: true, holding: null }, action: { kind: "ignore" } };
  }
  if (state.hidden) {
    return { state: { hidden: false, holding: null }, action: { kind: "measure" } };
  }
  const pos = state.holding ?? currentTopPos();
  if (pos === null) {
    return { state: { hidden: false, holding: null }, action: { kind: "measure" } };
  }
  return { state: { hidden: false, holding: pos }, action: { kind: "anchor", pos } };
}

/** The user scrolled: drop any held anchor and stop re-applying it. */
export function onUserScroll(state: ResizeAnchorState): ResizeAnchorState {
  return { hidden: state.hidden, holding: null };
}

/** The burst went quiet: release the anchor so the next resize re-captures. */
export function onBurstEnd(state: ResizeAnchorState): ResizeAnchorState {
  return { hidden: state.hidden, holding: null };
}

/** Quiet time after the last resize event before a burst is over. */
export const RESIZE_BURST_QUIET_MS = 250;
