import { describe, expect, it } from "vitest";
import ca from "./locales/ca.json";
import es from "./locales/es.json";
import en from "./locales/en.json";

type Dictionary = Record<string, string>;

/** `en` is the fallback `t()` uses, so it is the reference set of keys. */
const reference: Dictionary = en;
const translations: ReadonlyArray<[string, Dictionary]> = [
  ["ca", ca],
  ["es", es],
];

/** Same placeholder syntax `t()` substitutes. */
const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Prefixes of keys that are only ever reached through a template literal, so
 * the orphan check below cannot see them. Add one only after confirming the
 * call site — a genuinely dead key belongs in the bin, not in this list.
 */
const DYNAMIC_KEY_PREFIXES = [
  // src/ui/layout.ts: t(`rightPanel.${view}`)
  "rightPanel.",
];

// The core package consumes 46 of these keys through its injected
// translator (ct), so its sources count as call sites too.
const sourceModules = {
  ...(import.meta.glob("../**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
  ...(import.meta.glob("../../packages/core/src/**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>),
};

const sourceText = Object.entries(sourceModules)
  .filter(([path]) => !path.endsWith(".test.ts") && !path.startsWith("../i18n/"))
  .map(([, text]) => text)
  .join("\n");

function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A key counts as referenced when it appears as a complete string literal. */
function isReferenced(key: string): boolean {
  return new RegExp(`${escapeRegExp(key)}["'\`]`).test(sourceText);
}

describe("i18n locales", () => {
  it.each(translations)("%s has exactly the keys of en", (_locale, dictionary) => {
    const expected = Object.keys(reference).sort();
    expect(Object.keys(dictionary).sort()).toEqual(expected);
  });

  it.each([["en", reference], ...translations])(
    "%s has no empty values",
    (_locale, dictionary) => {
      const empty = Object.entries(dictionary)
        .filter(([, value]) => value.trim() === "")
        .map(([key]) => key);
      expect(empty).toEqual([]);
    },
  );

  it.each(translations)(
    "%s uses the same placeholders as en",
    (_locale, dictionary) => {
      const mismatched = Object.keys(reference).filter((key) => {
        const translated = dictionary[key];
        return (
          translated !== undefined &&
          placeholders(translated).join(",") !==
            placeholders(reference[key]).join(",")
        );
      });
      expect(mismatched).toEqual([]);
    },
  );

  it("has no orphan keys", () => {
    const orphans = Object.keys(reference).filter(
      (key) =>
        !DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
        !isReferenced(key),
    );
    expect(orphans).toEqual([]);
  });
});
