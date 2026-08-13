// CodeMirror 6 markdown editor with Live Preview (syntax tokens hidden
// outside the active line/selection); styling goes through CSS variables.
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { mathTag } from "../markdown/math";
import { markdownExtensions } from "../markdown/parser";
import { highlightTag } from "../markdown/wikilinks";
import {
  emptyListItemExitCommand,
  inListItem,
  listIndentCommand,
  listOutdentCommand,
} from "./listCommands";
import { livePreview } from "./livePreview";

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
  /** Resolves an embed target to a loadable URL, or null if unknown. */
  resolveEmbedSrc(target: string): string | null;
  /** Renders a note embed target to HTML, or null if unknown. */
  renderEmbedNote(target: string): Promise<string | null>;
}

function wikilinkCompletionSource(hooks: EditorHooks) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[[^\][|]*$/);
    if (match === null) {
      return null;
    }
    const alreadyClosed =
      context.state.sliceDoc(context.pos, context.pos + 2) === "]]";
    return {
      from: match.from + 2,
      options: hooks.getWikilinkCompletions().map((name) => ({
        label: name,
        apply: alreadyClosed ? name : name + "]]",
      })),
      validFor: /^[^\][|]*$/,
    };
  };
}

export interface EditorConfig {
  showLineNumbers: boolean;
  indentation: "spaces" | "tabs";
  spellcheck: boolean;
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

  function lineNumbersExtension(c: EditorConfig) {
    return c.showLineNumbers ? lineNumbers() : [];
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
        livePreview({
          resolveEmbedSrc: hooks.resolveEmbedSrc,
          renderEmbedNote: hooks.renderEmbedNote,
          onNavigate: hooks.onWikilinkClick,
        }),
        lineNumbersCompartment.of(lineNumbersExtension(config)),
        indentCompartment.of(indentExtension(config)),
        spellcheckCompartment.of(spellcheckExtension(config)),
        autocompletion({
          override: [wikilinkCompletionSource(hooks)],
          icons: false,
        }),
        EditorView.domEventHandlers({
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
        ],
      });
    },
  };
}
