import { beforeEach, describe, expect, it } from "vitest";
import { detectLocale, getLocale, setLocale, t } from "./i18n";

describe("detectLocale", () => {
  it("maps regional variants to supported locales", () => {
    expect(detectLocale("ca-ES")).toBe("ca");
    expect(detectLocale("es-MX")).toBe("es");
    expect(detectLocale("en-US")).toBe("en");
  });

  it("is case-insensitive and accepts underscore separators", () => {
    expect(detectLocale("CA")).toBe("ca");
    expect(detectLocale("es_ES")).toBe("es");
  });

  it("falls back to en for unsupported languages", () => {
    expect(detectLocale("fr-FR")).toBe("en");
    expect(detectLocale("")).toBe("en");
  });
});

describe("setLocale / getLocale", () => {
  it("switches the active locale", () => {
    setLocale("ca");
    expect(getLocale()).toBe("ca");
    setLocale("en");
    expect(getLocale()).toBe("en");
  });
});

describe("t", () => {
  beforeEach(() => {
    setLocale("ca");
  });

  it("translates keys in the current locale", () => {
    expect(t("statusBar.mode.edit")).toBe("Edició");
    setLocale("es");
    expect(t("statusBar.mode.edit")).toBe("Edición");
  });

  it("returns the key itself when missing everywhere", () => {
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("replaces placeholders from params", () => {
    expect(t("statusBar.words", { count: 42 })).toBe("42 paraules");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(t("statusBar.words", { other: 1 })).toBe("{count} paraules");
  });
});
