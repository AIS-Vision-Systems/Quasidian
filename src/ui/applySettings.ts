// Hot-appliers: translate Settings into DOM/CSS state. Colors always go
// through CSS variables — these functions only set the variables.
import { detectLocale, setLocale } from "../i18n/i18n";
import type { Settings, ThemeSetting } from "../lib/settings";
import type { EditorConfig } from "@aisvision/quasidian-core";

let systemThemeQuery: MediaQueryList | null = null;
let systemThemeListener: (() => void) | null = null;

function setThemeClass(theme: "dark" | "light"): void {
  document.body.classList.toggle("theme-dark", theme === "dark");
  document.body.classList.toggle("theme-light", theme === "light");
}

function applyTheme(theme: ThemeSetting): void {
  if (systemThemeQuery !== null && systemThemeListener !== null) {
    systemThemeQuery.removeEventListener("change", systemThemeListener);
    systemThemeQuery = null;
    systemThemeListener = null;
  }
  if (theme === "system") {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const listener = () => setThemeClass(query.matches ? "light" : "dark");
    query.addEventListener("change", listener);
    systemThemeQuery = query;
    systemThemeListener = listener;
    listener();
  } else {
    setThemeClass(theme);
  }
}

export function applyAppearance(settings: Settings): void {
  const { appearance } = settings;
  applyTheme(appearance.theme);
  const root = document.documentElement;
  root.style.setProperty("--interactive-accent", appearance.accentColor);
  root.style.setProperty(
    "--interactive-accent-hover",
    `color-mix(in srgb, ${appearance.accentColor} 82%, white)`,
  );
  if (appearance.interfaceFont.trim() !== "") {
    root.style.setProperty("--font-interface", appearance.interfaceFont);
  } else {
    root.style.removeProperty("--font-interface");
  }
  root.style.setProperty(
    "--font-text",
    appearance.editorFont === "monospace"
      ? "var(--font-monospace)"
      : "var(--font-interface)",
  );
  root.style.setProperty("--font-text-size", `${appearance.fontSize}px`);
  document.body.classList.toggle(
    "is-readable-line-length",
    appearance.readableLineLength,
  );
}

export function applyLanguage(settings: Settings): void {
  const locale =
    settings.language === "system"
      ? detectLocale(navigator.language)
      : settings.language;
  setLocale(locale);
  document.documentElement.lang = locale;
}

export function editorConfigFrom(settings: Settings): EditorConfig {
  return {
    showLineNumbers: settings.editor.showLineNumbers,
    indentation: settings.editor.indentation,
    spellcheck: settings.editor.spellcheck,
    autoPairBrackets: settings.editor.autoPairBrackets,
    autoPairMarkdown: settings.editor.autoPairMarkdown,
  };
}
