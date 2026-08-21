import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaveScheduler } from "./autosave";

describe("createAutosaveScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves after the interval elapses", () => {
    const save = vi.fn();
    const scheduler = createAutosaveScheduler(save, {
      enabled: true,
      intervalMs: 2000,
    });
    scheduler.notifyChange();
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(scheduler.isDirty()).toBe(false);
  });

  it("debounces consecutive changes", () => {
    const save = vi.fn();
    const scheduler = createAutosaveScheduler(save, {
      enabled: true,
      intervalMs: 2000,
    });
    scheduler.notifyChange();
    vi.advanceTimersByTime(1500);
    scheduler.notifyChange();
    vi.advanceTimersByTime(1500);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush saves immediately when dirty and cancels the pending timer", () => {
    const save = vi.fn();
    const scheduler = createAutosaveScheduler(save, {
      enabled: true,
      intervalMs: 2000,
    });
    scheduler.notifyChange();
    scheduler.flush();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush does nothing when not dirty", () => {
    const save = vi.fn();
    const scheduler = createAutosaveScheduler(save, {
      enabled: true,
      intervalMs: 2000,
    });
    scheduler.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("does not schedule saves when disabled, but flush still saves", () => {
    const save = vi.fn();
    const scheduler = createAutosaveScheduler(save, {
      enabled: false,
      intervalMs: 2000,
    });
    scheduler.notifyChange();
    vi.advanceTimersByTime(10000);
    expect(save).not.toHaveBeenCalled();
    expect(scheduler.isDirty()).toBe(true);
    scheduler.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cancel drops the dirty flag and the pending save", () => {
    const save = vi.fn();
    const scheduler = createAutosaveScheduler(save, {
      enabled: true,
      intervalMs: 2000,
    });
    scheduler.notifyChange();
    scheduler.cancel();
    vi.advanceTimersByTime(5000);
    expect(save).not.toHaveBeenCalled();
    expect(scheduler.isDirty()).toBe(false);
  });
});
