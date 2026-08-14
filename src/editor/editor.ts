// CodeMirror 6 markdown editor with Live Preview (syntax tokens hidden
// outside the active line/selection); styling goes through CSS variables.
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  selectAll,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  foldedRanges,
  foldEffect,
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
  unfoldAll,
  unfoldEffect,
} from "@codemirror/language";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
} from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { t } from "../i18n/i18n";
import { footnoteTag } from "../markdown/footnotes";
import { mathTag } from "../markdown/math";
import { markdownExtensions } from "../markdown/parser";
import { highlightTag } from "../markdown/wikilinks";
import { openContextMenu } from "../ui/contextMenu";
import { renderFootnoteContent } from "../markdown/render";
import {
  scheduleHoverHide,
  scheduleHoverShow,
  scheduleHtmlHover,
} from "../ui/hoverPreview";
import {
  copyText,
  type EmbedNoteResult,
} from "../ui/renderedContent";
import {
  markdownMarkerPair,
  markerBackspace,
  surroundSelection,
  wrapSelection,
} from "./autoPair";
import {
  allHeadingFolds,
  foldedRangeStartingAt,
  foldRangeForLine,
  sectionFolding,
  type FoldRange,
} from "./folding";
import {
  emptyListItemExitCommand,
  inListItem,
  listIndentCommand,
  listOutdentCommand,
} from "./listCommands";
import { emptyTable } from "./tableCommands";
import {
  focusTableCell,
  livePreview,
  requestAddProperty,
} from "./livePreview";

// Renders markdown formatting (sizes, weights, code font) while Live Preview
// hides the marks themselves. Colors always go through CSS variables.
const markdownHighlighting = HighlightStyle.define([
  // Obsidian's heading scale; reading mode mirrors it in app.css.
  { tag: tags.heading1, fontSize: "1.802em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.602em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.424em", fontWeight: "700" },
  { tag: tags.heading4, fontSize: "1.266em", fontWeight: "700" },
  { tag: tags.heading5, fontSize: "1.125em", fontWeight: "700" },
  { tag: tags.heading6, fontSize: "1em", fontWeight: "700", color: "var(--text-muted)" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.monospace,
    fontFamily: "var(--font-monospace)",
    fontSize: "0.9em",
    backgroundColor: "var(--code-background)",
    borderRadius: "4px",
    padding: "1px 4px",
  },
  { tag: tags.quote, color: "var(--text-muted)" },
  { tag: tags.processingInstruction, color: "var(--text-faint)" },
  { tag: tags.link, class: "cm-link" },
  {
    tag: highlightTag,
    backgroundColor: "var(--text-highlight-bg)",
    borderRadius: "2px",
  },
  // Raw TeX source, shown when the selection reveals a formula.
  { tag: mathTag, fontFamily: "var(--font-monospace)", fontSize: "0.9em" },
  // Footnote references read as superscript accent text.
  {
    tag: footnoteTag,
    color: "var(--text-accent)",
    fontSize: "0.8em",
    verticalAlign: "super",
  },
  // Code-block tokens, mapped onto the theme palette.
  { tag: tags.keyword, color: "var(--color-6)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--color-4)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--text-faint)", fontStyle: "italic" },
  { tag: [tags.number, tags.bool, tags.atom, tags.literal], color: "var(--color-7)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--color-2)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--color-6)" },
  { tag: tags.propertyName, color: "var(--color-2)" },
  { tag: [tags.operator, tags.punctuation], color: "var(--text-muted)" },
  { tag: [tags.regexp, tags.escape], color: "var(--color-7)" },
]);

// Tab must never leave the editor: it indents selections and list items
// (one list level, with ordered-list renumbering), and inserts the
// configured indent unit anywhere else.
function tabIndent(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.some((range) => !range.empty)) {
    return indentMore(view);
  }
  if (inListItem(state)) {
    // A first item has nothing to nest under: swallow the Tab anyway
    // rather than breaking the list with a plain indent.
    listIndentCommand(view);
    return true;
  }
  view.dispatch(
    state.update(state.replaceSelection(state.facet(indentUnit)), {
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
}

function shiftTabIndent(view: EditorView): boolean {
  return listOutdentCommand(view) || indentLess(view);
}

function applyFormat(view: EditorView, open: string, close: string): void {
  view.dispatch({
    ...surroundSelection(view.state, open, close),
    userEvent: "input.type",
    scrollIntoView: true,
  });
  view.focus();
}

/** `[text](|)` around the selection, cursor between the parens. */
function insertLink(view: EditorView): void {
  view.dispatch(
    view.state.changeByRange((range) => ({
      changes: [
        { from: range.from, insert: "[" },
        { from: range.to, insert: "]()" },
      ],
      range: EditorSelection.cursor(range.to + 3),
    })),
  );
  view.focus();
}

async function cutOrCopySelection(view: EditorView, cut: boolean): Promise<void> {
  const { state } = view;
  const text = state.sliceDoc(state.selection.main.from, state.selection.main.to);
  if (text === "") {
    return;
  }
  const copied = await copyText(text);
  if (copied && cut) {
    view.dispatch(state.replaceSelection(""), { userEvent: "delete.cut" });
  }
  view.focus();
}

async function pasteClipboard(view: EditorView): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    view.dispatch(view.state.replaceSelection(text), {
      userEvent: "input.paste",
      scrollIntoView: true,
    });
  } catch {
    // Clipboard read unavailable: Ctrl+V still works natively.
  }
  view.focus();
}

/** Inserts an empty 2x2 table on its own block and focuses it. */
function insertTableCommand(view: EditorView): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const prefix = line.text.trim() === "" ? "" : "\n\n";
  const skeleton = emptyTable();
  const from = line.to;
  const tableFrom = from + prefix.length;
  focusTableCell(tableFrom, 0, 0);
  view.dispatch({
    changes: { from, insert: `${prefix}${skeleton}\n` },
    selection: { anchor: tableFrom + skeleton.length + 1 },
  });
}

/** Inserts `snippet` as its own block; cursor at `cursorOffset` into it. */
function insertBlockSnippet(
  view: EditorView,
  snippet: string,
  cursorOffset: number,
): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const prefix = line.text.trim() === "" ? "" : "\n\n";
  const from = line.to;
  view.dispatch({
    changes: { from, insert: `${prefix}${snippet}` },
    selection: { anchor: from + prefix.length + cursorOffset },
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * Inserts a `[^n]` reference at the cursor (next free number) and its
 * definition at the end of the note, cursor on the definition.
 */
function insertFootnoteCommand(view: EditorView): void {
  const { state } = view;
  const doc = state.doc.toString();
  let max = 0;
  for (const match of doc.matchAll(/\[\^(\d+)\]/g)) {
    max = Math.max(max, Number(match[1]));
  }
  const label = `${max + 1}`;
  const head = state.selection.main.to;
  const ref = `[^${label}]`;
  const tail = doc === "" ? "" : doc.endsWith("\n") ? "\n" : "\n\n";
  const def = `${tail}[^${label}]: `;
  view.dispatch({
    changes: [
      { from: head, insert: ref },
      { from: state.doc.length, insert: def },
    ],
    selection: { anchor: state.doc.length + ref.length + def.length },
    scrollIntoView: true,
  });
  view.focus();
}

function openEditorMenu(view: EditorView, x: number, y: number): void {
  const hasSelection = !view.state.selection.main.empty;
  openContextMenu(x, y, [
    {
      label: t("menu.cut"),
      icon: "scissors",
      disabled: !hasSelection,
      onClick: () => void cutOrCopySelection(view, true),
    },
    {
      label: t("menu.copy"),
      icon: "copy",
      disabled: !hasSelection,
      onClick: () => void cutOrCopySelection(view, false),
    },
    {
      label: t("menu.paste"),
      icon: "clipboard",
      onClick: () => void pasteClipboard(view),
    },
    {
      label: t("menu.selectAll"),
      onClick: () => {
        selectAll(view);
        view.focus();
      },
    },
    "separator",
    {
      label: t("menu.addLink"),
      icon: "link",
      onClick: () => insertLink(view),
    },
    {
      label: t("menu.insert"),
      icon: "plus",
      submenu: [
        {
          label: t("menu.insertFootnote"),
          icon: "text",
          onClick: () => insertFootnoteCommand(view),
        },
        {
          label: t("menu.table"),
          icon: "table",
          onClick: () => insertTableCommand(view),
        },
        {
          label: t("menu.insertCallout"),
          icon: "quote",
          onClick: () => insertBlockSnippet(view, "> [!note] \n> ", 10),
        },
        {
          label: t("menu.insertHr"),
          icon: "minus",
          onClick: () => insertBlockSnippet(view, "---\n", 4),
        },
        "separator",
        {
          label: t("menu.insertCodeBlock"),
          icon: "code",
          onClick: () => insertBlockSnippet(view, "```\n\n```\n", 4),
        },
        {
          label: t("menu.insertMathBlock"),
          icon: "sigma",
          onClick: () => insertBlockSnippet(view, "$$\n\n$$\n", 3),
        },
      ],
    },
    {
      label: t("menu.format"),
      icon: "pencil",
      submenu: [
        {
          label: t("menu.formatBold"),
          icon: "bold",
          onClick: () => applyFormat(view, "**", "**"),
        },
        {
          label: t("menu.formatItalic"),
          icon: "italic",
          onClick: () => applyFormat(view, "*", "*"),
        },
        {
          label: t("menu.formatHighlight"),
          icon: "highlighter",
          onClick: () => applyFormat(view, "==", "=="),
        },
        {
          label: t("menu.formatCode"),
          icon: "code",
          onClick: () => applyFormat(view, "`", "`"),
        },
      ],
    },
  ]);
}

/** Footnote content for the ref or inline note at `pos`, or null. */
function footnoteHoverAt(
  state: EditorState,
  pos: number,
): { key: string; html: string } | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0);
  while (
    node !== null &&
    node.name !== "FootnoteRef" &&
    node.name !== "FootnoteInline"
  ) {
    node = node.parent;
  }
  if (node === null) {
    return null;
  }
  const doc = state.doc.toString();
  if (node.name === "FootnoteInline") {
    const html = renderFootnoteContent(doc, null, node.from);
    return html === null ? null : { key: `fni-${node.from}`, html };
  }
  const label = node.getChild("FootnoteLabel");
  if (label === null) {
    return null;
  }
  const id = doc.slice(label.from, label.to);
  const html = renderFootnoteContent(doc, id);
  return html === null ? null : { key: `fn-${id}`, html };
}

/** Wikilink target at `pos`, or null when the position is not inside one. */
function wikilinkTargetAt(state: EditorState, pos: number): string | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 0);
  while (node !== null && node.name !== "Wikilink") {
    node = node.parent;
  }
  if (node === null) {
    return null;
  }
  const path = node.getChild("WikilinkPath");
  return path === null ? null : state.sliceDoc(path.from, path.to);
}

export interface EditorHooks {
  onDocChanged(doc: string): void;
  onSaveRequested(): void;
  onToggleModeRequested(): void;
  onWikilinkClick(target: string): void;
  /** File names offered after `[[`: markdown basenames and image files. */
  getWikilinkCompletions(): string[];
  /** Heading texts of a note, offered after `#` inside a wikilink. */
  getHeadingCompletions(note: string): Promise<string[]>;
  /** Resolves an embed target to a loadable URL, or null if unknown. */
  resolveEmbedSrc(target: string): string | null;
  /** Renders a note embed target (and resolved path), or null. */
  renderEmbedNote(target: string): Promise<EmbedNoteResult | null>;
  /** Whether a wikilink target points to an existing note. */
  isResolved(target: string): boolean;
  /** Path of the open file, for transclusion cycle detection. */
  currentFilePath(): string | null;
}

function wikilinkCompletionSource(hooks: EditorHooks) {
  return async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const alreadyClosed =
      context.state.sliceDoc(context.pos, context.pos + 2) === "]]";
    // After a #: offer the note's headings (empty note = current file).
    const anchorMatch = context.matchBefore(/\[\[[^\][|#]*#[^\][|#]*$/);
    if (anchorMatch !== null) {
      const hashIndex = anchorMatch.text.indexOf("#");
      const note = anchorMatch.text.slice(2, hashIndex).trim();
      const headings = await hooks.getHeadingCompletions(note);
      return {
        from: anchorMatch.from + hashIndex + 1,
        options: headings.map((heading) => ({
          label: heading,
          apply: alreadyClosed ? heading : heading + "]]",
        })),
        validFor: /^[^\][|#]*$/,
      };
    }
    const match = context.matchBefore(/\[\[[^\][|]*$/);
    if (match === null) {
      return null;
    }
    return {
      from: match.from + 2,
      options: hooks.getWikilinkCompletions().map((name) => ({
        label: name,
        apply: alreadyClosed ? name : name + "]]",
      })),
      validFor: /^[^\][|#]*$/,
    };
  };
}

export interface EditorConfig {
  showLineNumbers: boolean;
  indentation: "spaces" | "tabs";
  spellcheck: boolean;
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
}

export interface EditorHandle {
  /** Replaces the whole document and resets undo history (file switch). */
  setDoc(doc: string): void;
  getDoc(): string;
  /** In-place edit that preserves undo history (e.g. task toggles). */
  replaceRange(from: number, to: number, insert: string): void;
  /**
   * Replaces the whole document keeping undo history, cursor (clamped)
   * and scroll — for reloading external changes from disk.
   */
  reloadDoc(contents: string): void;
  /** Selects [from, to], scrolls it into view centered, and focuses. */
  revealRange(from: number, to: number): void;
  focus(): void;
  /** Hot-applies configurable options without recreating the editor. */
  applyConfig(config: EditorConfig): void;
  /** Currently folded ranges, for remembering them per file. */
  getFolds(): FoldRange[];
  /** Re-applies remembered folds (ranges outside the doc are dropped). */
  setFolds(ranges: FoldRange[]): void;
  foldAllSections(): void;
  unfoldAllSections(): void;
  /** Foldability and state of the line holding `pos` (reading mode). */
  foldInfoAt(pos: number): { folded: boolean } | null;
  /** Folds/unfolds the section of the line holding `pos`. */
  toggleFoldAt(pos: number): void;
  /** Opens the properties editor's add-property row. */
  addProperty(): void;
  /** Inserts an empty table at the cursor (palette command). */
  insertTable(): void;
}

export function createEditor(
  parent: HTMLElement,
  hooks: EditorHooks,
  initialConfig: EditorConfig,
): EditorHandle {
  let config = initialConfig;

  const lineNumbersCompartment = new Compartment();
  const indentCompartment = new Compartment();
  const spellcheckCompartment = new Compartment();
  const autoPairCompartment = new Compartment();

  function lineNumbersExtension(c: EditorConfig) {
    return c.showLineNumbers ? lineNumbers() : [];
  }
  function autoPairExtension(c: EditorConfig) {
    return c.autoPairBrackets
      ? [closeBrackets(), keymap.of(closeBracketsKeymap)]
      : [];
  }
  function indentExtension(c: EditorConfig) {
    return indentUnit.of(c.indentation === "tabs" ? "\t" : "    ");
  }
  function spellcheckExtension(c: EditorConfig) {
    return EditorView.contentAttributes.of({
      spellcheck: c.spellcheck ? "true" : "false",
    });
  }

  function buildState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        Prec.high(
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                hooks.onSaveRequested();
                return true;
              },
            },
            {
              key: "Mod-e",
              run: () => {
                hooks.onToggleModeRequested();
                return true;
              },
            },
            // Before lang-markdown's Enter (list continuation): an empty
            // item climbs one level instead of adding another marker.
            { key: "Enter", run: emptyListItemExitCommand },
          ]),
        ),
        history(),
        // Wrap-on-type is always on; the markdown double-marker pairing
        // follows its setting. Runs before closeBrackets' own handler so
        // selections are always wrapped, never replaced.
        EditorView.inputHandler.of((view, _from, _to, text) => {
          if (text.length !== 1) {
            return false;
          }
          const wrap = wrapSelection(view.state, text);
          if (wrap !== null) {
            view.dispatch({
              changes: wrap.changes,
              selection: wrap.selection,
              userEvent: "input.type",
              scrollIntoView: true,
            });
            return true;
          }
          if (config.autoPairMarkdown) {
            const pair = markdownMarkerPair(view.state, text);
            if (pair !== null) {
              view.dispatch({
                ...pair,
                userEvent: "input.type",
                scrollIntoView: true,
              });
              return true;
            }
          }
          return false;
        }),
        // Before the default keymap: closeBrackets' Backspace must win.
        autoPairCompartment.of(autoPairExtension(config)),
        // Backspace inside an empty marker pair deletes both sides,
        // like closeBrackets does for brackets.
        keymap.of([
          {
            key: "Backspace",
            run: (view) => {
              if (!config.autoPairMarkdown) {
                return false;
              }
              const del = markerBackspace(view.state);
              if (del === null) {
                return false;
              }
              view.dispatch({
                ...del,
                userEvent: "delete.backward",
                scrollIntoView: true,
              });
              return true;
            },
          },
        ]),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          { key: "Tab", run: tabIndent, shift: shiftTabIndent },
        ]),
        markdown({
          base: markdownLanguage,
          extensions: markdownExtensions,
          codeLanguages: languages,
        }),
        syntaxHighlighting(markdownHighlighting),
        sectionFolding(),
        livePreview({
          resolveEmbedSrc: hooks.resolveEmbedSrc,
          renderEmbedNote: hooks.renderEmbedNote,
          onNavigate: hooks.onWikilinkClick,
          isResolved: hooks.isResolved,
          currentFilePath: hooks.currentFilePath,
        }),
        lineNumbersCompartment.of(lineNumbersExtension(config)),
        indentCompartment.of(indentExtension(config)),
        spellcheckCompartment.of(spellcheckExtension(config)),
        autocompletion({
          override: [wikilinkCompletionSource(hooks)],
          icons: false,
        }),
        EditorView.domEventHandlers({
          contextmenu(event, view) {
            event.preventDefault();
            openEditorMenu(view, event.clientX, event.clientY);
            return true;
          },
          // Ctrl+hover over a wikilink previews the linked note/section.
          mousemove(event, view) {
            if (!(event.ctrlKey || event.metaKey)) {
              scheduleHoverHide();
              return false;
            }
            const pos = view.posAtCoords({
              x: event.clientX,
              y: event.clientY,
            });
            const target =
              pos === null ? null : wikilinkTargetAt(view.state, pos);
            if (target === null) {
              const note =
                pos === null ? null : footnoteHoverAt(view.state, pos);
              if (note !== null) {
                scheduleHtmlHover(
                  event.clientX,
                  event.clientY,
                  note.key,
                  note.html,
                );
                return false;
              }
              scheduleHoverHide();
              return false;
            }
            scheduleHoverShow(event.clientX, event.clientY, target, {
              resolveEmbedSrc: hooks.resolveEmbedSrc,
              renderEmbedNote: hooks.renderEmbedNote,
              isResolved: hooks.isResolved,
              onNavigate: hooks.onWikilinkClick,
            });
            return false;
          },
          mousedown(event, view) {
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) {
              return false;
            }
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) {
              return false;
            }
            const target = wikilinkTargetAt(view.state, pos);
            if (target === null) {
              return false;
            }
            event.preventDefault();
            hooks.onWikilinkClick(target);
            return true;
          },
        }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            hooks.onDocChanged(update.state.doc.toString());
          }
        }),
      ],
    });
  }

  const view = new EditorView({ parent, state: buildState("") });

  // KaTeX/monospace fonts load once after startup and change glyph
  // metrics; remeasure so line geometry stays exact.
  void document.fonts.ready.then(() => view.requestMeasure());

  return {
    setDoc(doc: string): void {
      view.setState(buildState(doc));
    },
    getDoc(): string {
      return view.state.doc.toString();
    },
    replaceRange(from: number, to: number, insert: string): void {
      view.dispatch({ changes: { from, to, insert } });
    },
    reloadDoc(contents: string): void {
      const head = Math.min(view.state.selection.main.head, contents.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: contents },
        selection: { anchor: head },
      });
    },
    revealRange(from: number, to: number): void {
      const length = view.state.doc.length;
      const anchor = Math.min(from, length);
      const head = Math.min(to, length);
      view.dispatch({
        selection: { anchor, head },
        effects: EditorView.scrollIntoView(anchor, { y: "center" }),
      });
      view.focus();
    },
    focus(): void {
      view.focus();
    },
    applyConfig(next: EditorConfig): void {
      config = next;
      view.dispatch({
        effects: [
          lineNumbersCompartment.reconfigure(lineNumbersExtension(next)),
          indentCompartment.reconfigure(indentExtension(next)),
          spellcheckCompartment.reconfigure(spellcheckExtension(next)),
          autoPairCompartment.reconfigure(autoPairExtension(next)),
        ],
      });
    },
    getFolds(): FoldRange[] {
      const ranges: FoldRange[] = [];
      foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
        ranges.push({ from, to });
      });
      return ranges;
    },
    setFolds(ranges: FoldRange[]): void {
      const length = view.state.doc.length;
      const effects = ranges
        .filter((range) => range.from >= 0 && range.to <= length && range.from < range.to)
        .map((range) => foldEffect.of(range));
      if (effects.length > 0) {
        view.dispatch({ effects });
      }
    },
    foldAllSections(): void {
      const effects = allHeadingFolds(view.state).map((range) =>
        foldEffect.of(range),
      );
      if (effects.length > 0) {
        view.dispatch({ effects });
      }
    },
    unfoldAllSections(): void {
      unfoldAll(view);
    },
    foldInfoAt(pos: number): { folded: boolean } | null {
      const clamped = Math.min(Math.max(pos, 0), view.state.doc.length);
      const line = view.state.doc.lineAt(clamped);
      const range = foldRangeForLine(view.state, line.from);
      if (range === null) {
        return null;
      }
      return {
        folded: foldedRangeStartingAt(view.state, range.from) !== null,
      };
    },
    addProperty(): void {
      requestAddProperty(view);
    },
    insertTable(): void {
      insertTableCommand(view);
    },
    toggleFoldAt(pos: number): void {
      const clamped = Math.min(Math.max(pos, 0), view.state.doc.length);
      const line = view.state.doc.lineAt(clamped);
      const range = foldRangeForLine(view.state, line.from);
      if (range === null) {
        return;
      }
      const folded = foldedRangeStartingAt(view.state, range.from);
      view.dispatch({
        effects:
          folded === null ? foldEffect.of(range) : unfoldEffect.of(folded),
      });
    },
  };
}
