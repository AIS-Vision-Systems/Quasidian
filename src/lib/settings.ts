// Pure module: no Tauri, no DOM. Typed settings schema, defaults, and a
// validating merge that never throws on invalid or partial input.

export type LanguageSetting = "system" | "ca" | "es" | "en";
export type ThemeSetting = "dark" | "light" | "system";
export type EditorFontSetting = "proportional" | "monospace";
export type EditorModeSetting = "edit" | "read";
export type IndentationSetting = "spaces" | "tabs";

export interface AppearanceSettings {
  theme: ThemeSetting;
  /** Applied to --interactive-accent. */
  accentColor: string;
  /** CSS font-family for the UI; empty string keeps the theme default. */
  interfaceFont: string;
  editorFont: EditorFontSetting;
  /** Editor font size in px. */
  fontSize: number;
  readableLineLength: boolean;
}

export interface EditorSettings {
  /** Mode when opening a file; "read" takes effect once reading mode lands. */
  defaultMode: EditorModeSetting;
  autosave: boolean;
  autosaveIntervalMs: number;
  showLineNumbers: boolean;
  /** Settings hook only — vim mode is intentionally not implemented. */
  vimMode: boolean;
  indentation: IndentationSetting;
  spellcheck: boolean;
  /** Auto-close brackets and quotes while typing. */
  autoPairBrackets: boolean;
  /** Auto-close markdown double markers (**, ==, $$, …) while typing. */
  autoPairMarkdown: boolean;
  /** Show the properties box in reading mode and embedded notes. */
  showProperties: boolean;
}

export interface FilesSettings {
  confirmDelete: boolean;
  /** Extension used when creating notes from wikilinks. */
  defaultExtension: string;
}

export interface Settings {
  language: LanguageSetting;
  appearance: AppearanceSettings;
  editor: EditorSettings;
  files: FilesSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "system",
  appearance: {
    theme: "dark",
    accentColor: "#483699",
    interfaceFont: "",
    editorFont: "proportional",
    fontSize: 15,
    readableLineLength: true,
  },
  editor: {
    defaultMode: "edit",
    autosave: true,
    autosaveIntervalMs: 2000,
    showLineNumbers: false,
    vimMode: false,
    indentation: "spaces",
    spellcheck: false,
    autoPairBrackets: true,
    autoPairMarkdown: true,
    showProperties: false,
  },
  files: {
    confirmDelete: true,
    defaultExtension: ".md",
  },
};

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : fallback;
}

function pickEnum<T extends string>(
  value: unknown,
  fallback: T,
  allowed: readonly T[],
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function asSection(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Builds a complete Settings object from arbitrary input, falling back to
 * defaults per key on missing or invalid values. Never throws.
 */
export function mergeSettings(raw: unknown): Settings {
  const root = asSection(raw);
  const appearance = asSection(root.appearance);
  const editor = asSection(root.editor);
  const files = asSection(root.files);
  const d = DEFAULT_SETTINGS;
  return {
    language: pickEnum(root.language, d.language, ["system", "ca", "es", "en"]),
    appearance: {
      theme: pickEnum(appearance.theme, d.appearance.theme, [
        "dark",
        "light",
        "system",
      ]),
      accentColor: pickString(appearance.accentColor, d.appearance.accentColor),
      interfaceFont: pickString(
        appearance.interfaceFont,
        d.appearance.interfaceFont,
      ),
      editorFont: pickEnum(appearance.editorFont, d.appearance.editorFont, [
        "proportional",
        "monospace",
      ]),
      fontSize: pickNumber(appearance.fontSize, d.appearance.fontSize, 8, 40),
      readableLineLength: pickBoolean(
        appearance.readableLineLength,
        d.appearance.readableLineLength,
      ),
    },
    editor: {
      defaultMode: pickEnum(editor.defaultMode, d.editor.defaultMode, [
        "edit",
        "read",
      ]),
      autosave: pickBoolean(editor.autosave, d.editor.autosave),
      autosaveIntervalMs: pickNumber(
        editor.autosaveIntervalMs,
        d.editor.autosaveIntervalMs,
        200,
        600000,
      ),
      showLineNumbers: pickBoolean(
        editor.showLineNumbers,
        d.editor.showLineNumbers,
      ),
      vimMode: pickBoolean(editor.vimMode, d.editor.vimMode),
      indentation: pickEnum(editor.indentation, d.editor.indentation, [
        "spaces",
        "tabs",
      ]),
      spellcheck: pickBoolean(editor.spellcheck, d.editor.spellcheck),
      autoPairBrackets: pickBoolean(
        editor.autoPairBrackets,
        d.editor.autoPairBrackets,
      ),
      autoPairMarkdown: pickBoolean(
        editor.autoPairMarkdown,
        d.editor.autoPairMarkdown,
      ),
      showProperties: pickBoolean(
        editor.showProperties,
        d.editor.showProperties,
      ),
    },
    files: {
      confirmDelete: pickBoolean(files.confirmDelete, d.files.confirmDelete),
      defaultExtension: pickString(
        files.defaultExtension,
        d.files.defaultExtension,
      ),
    },
  };
}

/** Parses a settings.json payload; malformed JSON yields the defaults. */
export function parseSettings(json: string): Settings {
  try {
    return mergeSettings(JSON.parse(json));
  } catch {
    return mergeSettings(undefined);
  }
}
