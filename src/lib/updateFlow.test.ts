import { describe, expect, it } from "vitest";
import {
  afterCheck,
  afterInstallPhase,
  buttonLabel,
  noticeLabel,
  statusLabel,
} from "./updateFlow";

describe("afterCheck", () => {
  it("maps every outcome to its state", () => {
    expect(afterCheck({ status: "current" })).toEqual({ kind: "current" });
    expect(afterCheck({ status: "installable", version: "1.2.0" })).toEqual({
      kind: "installable",
      version: "1.2.0",
    });
    expect(
      afterCheck({ status: "manual", version: "1.2.0", url: "https://x" }),
    ).toEqual({ kind: "manual", version: "1.2.0", url: "https://x" });
    expect(afterCheck({ status: "error" })).toEqual({ kind: "failed" });
  });
});

describe("afterInstallPhase", () => {
  it("tracks download progress, completion and failure", () => {
    expect(afterInstallPhase({ phase: "downloading" })).toEqual({
      kind: "installing",
      percent: null,
    });
    expect(afterInstallPhase({ phase: "downloading", percent: 40 })).toEqual({
      kind: "installing",
      percent: 40,
    });
    expect(afterInstallPhase({ phase: "installed" })).toEqual({
      kind: "installed",
    });
    expect(afterInstallPhase({ phase: "error" })).toEqual({ kind: "failed" });
  });
});

describe("labels", () => {
  it("walks the button through check → update → restart", () => {
    expect(buttonLabel({ kind: "idle" }).key).toBe("updates.check");
    expect(buttonLabel({ kind: "installable", version: "2" }).key).toBe(
      "updates.install",
    );
    expect(buttonLabel({ kind: "installed" }).key).toBe("updates.restart");
  });

  it("status line covers every state", () => {
    expect(statusLabel({ kind: "idle" })).toBeNull();
    expect(statusLabel({ kind: "current" })?.key).toBe("updates.current");
    expect(
      statusLabel({ kind: "installable", version: "2" })?.params,
    ).toEqual({ version: "2" });
    expect(statusLabel({ kind: "installing", percent: 60 })).toEqual({
      key: "updates.downloadingPercent",
      params: { percent: 60 },
    });
    expect(statusLabel({ kind: "installing", percent: null })?.key).toBe(
      "updates.downloading",
    );
    expect(statusLabel({ kind: "failed" })?.key).toBe("updates.error");
  });

  it("the notice hides unless something is actionable", () => {
    expect(noticeLabel({ kind: "idle" })).toBeNull();
    expect(noticeLabel({ kind: "current" })).toBeNull();
    expect(noticeLabel({ kind: "failed" })).toBeNull();
    expect(
      noticeLabel({ kind: "installable", version: "2" })?.key,
    ).toBe("updates.installNotice");
    expect(noticeLabel({ kind: "installed" })?.key).toBe("updates.restart");
  });
});
