import { afterEach, describe, expect, it } from "vitest";
import ca from "../i18n/locales/ca.json";
import en from "../i18n/locales/en.json";
import es from "../i18n/locales/es.json";
import {
  CORE_STRINGS,
  ct,
  setCoreTranslator,
  type CoreStringKey,
} from "./coreStrings";

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

describe("core keys stay in step with the app dictionaries", () => {
  const keys = Object.keys(CORE_STRINGS) as CoreStringKey[];

  it("every core key exists in ca, es and en", () => {
    const dictionaries: Record<string, Record<string, string>> = {
      ca,
      es,
      en,
    };
    for (const [name, dictionary] of Object.entries(dictionaries)) {
      const missing = keys.filter((key) => !(key in dictionary));
      expect(missing, `missing in ${name}`).toEqual([]);
    }
  });

  it("every default matches the English dictionary verbatim", () => {
    const dictionary = en as Record<string, string>;
    for (const key of keys) {
      expect(CORE_STRINGS[key], key).toBe(dictionary[key]);
    }
  });
});
