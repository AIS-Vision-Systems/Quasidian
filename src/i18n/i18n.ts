// Pure module: no Tauri, no DOM. UI code passes in whatever it needs
// (e.g. `navigator.language` for detectLocale).
import ca from "./locales/ca.json";
import es from "./locales/es.json";
import en from "./locales/en.json";

export const LOCALES = ["ca", "es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = { ca, es, en };

let currentLocale: Locale = "en";

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Maps a BCP 47 language tag to a supported locale, falling back to `en`. */
export function detectLocale(languageTag: string): Locale {
  const language = languageTag.toLowerCase().split(/[-_]/)[0];
  const match = LOCALES.find((locale) => locale === language);
  return match ?? "en";
}

/**
 * Looks up `key` in the current locale, falling back to `en`, then to the
 * key itself. `{name}` placeholders are replaced from `params`.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const template: string | undefined =
    dictionaries[currentLocale][key] ?? dictionaries.en[key];
  const text = template ?? key;
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}
