// The core package ships English defaults for its strings; the app
// injects its translator over the same keys. This guard keeps the two
// sides in step: every core key must exist in the three dictionaries,
// and the shipped defaults must match the English one verbatim.
import { describe, expect, it } from "vitest";
import {
  CORE_STRINGS,
  type CoreStringKey,
} from "@aisvision/quasidian-core";
import ca from "./locales/ca.json";
import en from "./locales/en.json";
import es from "./locales/es.json";

describe("core strings stay in step with the app dictionaries", () => {
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
