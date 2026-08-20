import { describe, expect, it } from "vitest";
import {
  initialResizeAnchor,
  onBurstEnd,
  onHostResize,
  onUserScroll,
  type ResizeAnchorState,
} from "./resizeAnchor";

const visible: ResizeAnchorState = { hidden: false, holding: null };

describe("onHostResize", () => {
  it("ignores zero-sized observations and marks the host hidden", () => {
    const { state, action } = onHostResize(visible, 0, 0, () => 42);
    expect(action).toEqual({ kind: "ignore" });
    expect(state).toEqual({ hidden: true, holding: null });
  });

  it("treats a zero dimension as hidden even with the other set", () => {
    expect(onHostResize(visible, 800, 0, () => 42).action).toEqual({
      kind: "ignore",
    });
    expect(onHostResize(visible, 0, 600, () => 42).action).toEqual({
      kind: "ignore",
    });
  });

  it("only measures on the first sizing after being hidden", () => {
    const { state, action } = onHostResize(
      initialResizeAnchor(),
      800,
      600,
      () => 42,
    );
    expect(action).toEqual({ kind: "measure" });
    expect(state).toEqual({ hidden: false, holding: null });
  });

  it("captures the current top position when a burst starts", () => {
    const { state, action } = onHostResize(visible, 800, 600, () => 42);
    expect(action).toEqual({ kind: "anchor", pos: 42 });
    expect(state.holding).toBe(42);
  });

  it("keeps the held anchor through the burst instead of re-reading", () => {
    const first = onHostResize(visible, 800, 600, () => 42);
    const second = onHostResize(first.state, 900, 700, () => {
      throw new Error("must not re-read mid-burst");
    });
    expect(second.action).toEqual({ kind: "anchor", pos: 42 });
    expect(second.state.holding).toBe(42);
  });

  it("only measures when the view has no usable anchor", () => {
    const { state, action } = onHostResize(visible, 800, 600, () => null);
    expect(action).toEqual({ kind: "measure" });
    expect(state.holding).toBeNull();
  });

  it("re-captures after hide and show", () => {
    const held = onHostResize(visible, 800, 600, () => 42).state;
    const hidden = onHostResize(held, 0, 0, () => 42).state;
    const shown = onHostResize(hidden, 800, 600, () => 7);
    expect(shown.action).toEqual({ kind: "measure" });
    const next = onHostResize(shown.state, 900, 600, () => 7);
    expect(next.action).toEqual({ kind: "anchor", pos: 7 });
  });
});

describe("onUserScroll", () => {
  it("drops the held anchor", () => {
    const held = onHostResize(visible, 800, 600, () => 42).state;
    expect(onUserScroll(held)).toEqual({ hidden: false, holding: null });
  });
});

describe("onBurstEnd", () => {
  it("releases the anchor so the next resize re-captures", () => {
    const held = onHostResize(visible, 800, 600, () => 42).state;
    const released = onBurstEnd(held);
    expect(released.holding).toBeNull();
    const next = onHostResize(released, 900, 600, () => 7);
    expect(next.action).toEqual({ kind: "anchor", pos: 7 });
  });
});
