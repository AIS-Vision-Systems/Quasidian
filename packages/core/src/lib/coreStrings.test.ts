import { afterEach, describe, expect, it } from "vitest";
import { ct, setCoreTranslator } from "./coreStrings";

afterEach(() => {
  setCoreTranslator(null);
});

describe("ct — core strings with an injectable translator", () => {
  it("returns the English default without a translator", () => {
    expect(ct("menu.cut")).toBe("Cut");
    expect(ct("properties.title")).toBe("Properties");
  });

  it("interpolates {name} placeholders in the defaults", () => {
    expect(ct("preview.notCreated", { name: "Nota" })).toBe(
      '"Nota" is not created yet. Click to create.',
    );
  });

  it("delegates to the injected translator, and can be cleared", () => {
    setCoreTranslator((key) => `[${key}]`);
    expect(ct("menu.cut")).toBe("[menu.cut]");
    setCoreTranslator(null);
    expect(ct("menu.cut")).toBe("Cut");
  });

  it("passes params through to the translator", () => {
    setCoreTranslator((key, params) => `${key}:${params?.name ?? ""}`);
    expect(ct("preview.notCreated", { name: "X" })).toBe(
      "preview.notCreated:X",
    );
  });
});
