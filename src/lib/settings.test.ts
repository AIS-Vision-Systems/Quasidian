import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  parseSettings,
} from "./settings";

describe("parseSettings", () => {
  it("returns defaults for malformed JSON", () => {
    expect(parseSettings("not json {")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("")).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for an empty object", () => {
    expect(parseSettings("{}")).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial settings over the defaults", () => {
    const settings = parseSettings('{"appearance":{"theme":"light"}}');
    expect(settings.appearance.theme).toBe("light");
    expect(settings.appearance.fontSize).toBe(
      DEFAULT_SETTINGS.appearance.fontSize,
    );
    expect(settings.editor).toEqual(DEFAULT_SETTINGS.editor);
  });

  it("defaults both auto-pair options to enabled", () => {
    const settings = parseSettings("{}");
    expect(settings.editor.autoPairBrackets).toBe(true);
    expect(settings.editor.autoPairMarkdown).toBe(true);
    const off = parseSettings('{"editor":{"autoPairMarkdown":false}}');
    expect(off.editor.autoPairMarkdown).toBe(false);
    expect(off.editor.autoPairBrackets).toBe(true);
  });
});

describe("mergeSettings", () => {
  it("returns defaults for non-object input", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("dark")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    const settings = mergeSettings({
      language: "es",
      editor: { autosaveIntervalMs: 5000, indentation: "tabs" },
      files: { defaultExtension: ".markdown" },
    });
    expect(settings.language).toBe("es");
    expect(settings.editor.autosaveIntervalMs).toBe(5000);
    expect(settings.editor.indentation).toBe("tabs");
    expect(settings.files.defaultExtension).toBe(".markdown");
  });

  it("falls back per key on wrong types", () => {
    const settings = mergeSettings({
      language: 3,
      appearance: { fontSize: "big", readableLineLength: "yes" },
      editor: { autosave: "on" },
    });
    expect(settings.language).toBe(DEFAULT_SETTINGS.language);
    expect(settings.appearance.fontSize).toBe(
      DEFAULT_SETTINGS.appearance.fontSize,
    );
    expect(settings.appearance.readableLineLength).toBe(
      DEFAULT_SETTINGS.appearance.readableLineLength,
    );
    expect(settings.editor.autosave).toBe(DEFAULT_SETTINGS.editor.autosave);
  });

  it("falls back on invalid enum values", () => {
    const settings = mergeSettings({
      appearance: { theme: "blue", editorFont: "serif" },
      editor: { defaultMode: "preview", indentation: "elastic" },
    });
    expect(settings.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme);
    expect(settings.appearance.editorFont).toBe(
      DEFAULT_SETTINGS.appearance.editorFont,
    );
    expect(settings.editor.defaultMode).toBe(
      DEFAULT_SETTINGS.editor.defaultMode,
    );
    expect(settings.editor.indentation).toBe(
      DEFAULT_SETTINGS.editor.indentation,
    );
  });

  it("clamps out-of-range numbers back to defaults", () => {
    const settings = mergeSettings({
      appearance: { fontSize: 200 },
      editor: { autosaveIntervalMs: 5 },
    });
    expect(settings.appearance.fontSize).toBe(
      DEFAULT_SETTINGS.appearance.fontSize,
    );
    expect(settings.editor.autosaveIntervalMs).toBe(
      DEFAULT_SETTINGS.editor.autosaveIntervalMs,
    );
  });

  it("ignores unknown keys", () => {
    const settings = mergeSettings({
      unknown: true,
      appearance: { alpha: 1 },
    });
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("does not return the DEFAULT_SETTINGS object itself", () => {
    const settings = mergeSettings(undefined);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings).not.toBe(DEFAULT_SETTINGS);
    expect(settings.appearance).not.toBe(DEFAULT_SETTINGS.appearance);
  });
});

describe("files.showHiddenFolders (m40)", () => {
  it("defaults to off", () => {
    expect(DEFAULT_SETTINGS.files.showHiddenFolders).toBe(false);
    expect(mergeSettings({}).files.showHiddenFolders).toBe(false);
  });

  it("keeps a valid value", () => {
    const settings = mergeSettings({ files: { showHiddenFolders: true } });
    expect(settings.files.showHiddenFolders).toBe(true);
  });

  it("falls back to the default on garbage", () => {
    const settings = mergeSettings({ files: { showHiddenFolders: "yes" } });
    expect(settings.files.showHiddenFolders).toBe(false);
  });
});
