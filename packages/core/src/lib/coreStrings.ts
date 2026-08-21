// Pure module: no Tauri, no DOM. The core's user-facing strings —
// context menus, table commands, the properties widget, code pills and
// hover previews — with English defaults, so the editor core works
// standalone (m41). The app injects its translator at startup; the
// keys are the app's own i18n keys, so `t` plugs in directly.

export const CORE_STRINGS = {
  // render
  "properties.title": "Properties",
  "properties.add": "Add property",
  "properties.remove": "Remove",
  "properties.name": "Name",
  "properties.value": "Value",
  "properties.edit": "Click to edit",
  // editor
  "menu.cut": "Cut",
  "menu.copy": "Copy",
  "menu.paste": "Paste",
  "menu.selectAll": "Select all",
  "menu.insert": "Insert",
  "menu.insertFootnote": "Footnote",
  "menu.table": "Table",
  "menu.insertCallout": "Callout",
  "menu.insertWikilink": "Wikilink",
  "menu.insertMarkdownLink": "Markdown link",
  "menu.insertHr": "Horizontal rule",
  "menu.insertCodeBlock": "Code block",
  "menu.insertMathBlock": "Math block",
  "menu.format": "Format",
  "menu.formatBold": "Bold",
  "menu.formatItalic": "Italic",
  "menu.formatHighlight": "Highlight",
  "menu.formatCode": "Code",
  // livePreview
  "menu.tableRow": "Row",
  "menu.tableColumn": "Column",
  "menu.tableAddRow": "Add row below",
  "menu.tableAddRowAbove": "Add row above",
  "menu.tableAddColumnLeft": "Add column to the left",
  "menu.tableAddColumnRight": "Add column to the right",
  "menu.tableDeleteRow": "Delete row",
  "menu.tableDeleteColumn": "Delete column",
  "menu.tableDuplicateRow": "Duplicate row",
  "menu.tableDuplicateColumn": "Duplicate column",
  "menu.tableMoveRowUp": "Move row up",
  "menu.tableMoveRowDown": "Move row down",
  "menu.tableMoveColumnLeft": "Move column left",
  "menu.tableMoveColumnRight": "Move column right",
  "menu.tableAlignLeft": "Align left",
  "menu.tableAlignCenter": "Align center",
  "menu.tableAlignRight": "Align right",
  "menu.tableSortAsc": "Sort by column (A to Z)",
  "menu.tableSortDesc": "Sort by column (Z to A)",
  // renderedContent
  "reading.copyCode": "Copy code",
  "reading.codeCopied": "Copied",
  // hoverPreview
  "preview.notCreated": "\"{name}\" is not created yet. Click to create.",
} as const;

export type CoreStringKey = keyof typeof CORE_STRINGS;

export type CoreTranslator = (
  key: CoreStringKey,
  params?: Record<string, string | number>,
) => string;

let translator: CoreTranslator | null = null;

/** Injects the host application's translator (the app passes `t`). */
export function setCoreTranslator(next: CoreTranslator | null): void {
  translator = next;
}

/**
 * Core-side `t`: the injected translator when present, the English
 * default otherwise. `{name}` placeholders are replaced from
 * `params`, mirroring the app's i18n.
 */
export function ct(
  key: CoreStringKey,
  params?: Record<string, string | number>,
): string {
  if (translator !== null) {
    return translator(key, params);
  }
  const text: string = CORE_STRINGS[key];
  if (!params) {
    return text;
  }
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}
