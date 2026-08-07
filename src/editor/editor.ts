// CodeMirror 6 markdown editor with Live Preview (syntax tokens hidden
// outside the active line/selection); styling goes through CSS variables.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { livePreview } from "./livePreview";

// Renders markdown formatting (sizes, weights, code font) while Live Preview
// hides the marks themselves. Colors always go through CSS variables.
const markdownHighlighting = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.6em", fontWeight: "700" },
  { tag: tags.heading2, fontSize: "1.4em", fontWeight: "700" },
  { tag: tags.heading3, fontSize: "1.25em", fontWeight: "700" },
  { tag: tags.heading4, fontSize: "1.1em", fontWeight: "700" },
  { tag: tags.heading5, fontSize: "1em", fontWeight: "700" },
  { tag: tags.heading6, fontSize: "1em", fontWeight: "700", color: "var(--text-muted)" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  {
    tag: tags.monospace,
    fontFamily: "var(--font-monospace)",
    fontSize: "0.9em",
    backgroundColor: "var(--code-background)",
    borderRadius: "3px",
  },
  { tag: tags.quote, color: "var(--text-muted)" },
  { tag: tags.processingInstruction, color: "var(--text-faint)" },
]);

export interface EditorHooks {
  onDocChanged(doc: string): void;
  onSaveRequested(): void;
}

export interface EditorHandle {
  /** Replaces the whole document and resets undo history (file switch). */
  setDoc(doc: string): void;
  getDoc(): string;
  focus(): void;
}

export function createEditor(
  parent: HTMLElement,
  hooks: EditorHooks,
): EditorHandle {
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
          ]),
        ),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(markdownHighlighting),
        livePreview(),
        EditorView.lineWrapping,
        // Spellcheck off until the setting lands in milestone 6.
        EditorView.contentAttributes.of({ spellcheck: "false" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            hooks.onDocChanged(update.state.doc.toString());
          }
        }),
      ],
    });
  }

  const view = new EditorView({ parent, state: buildState("") });

  return {
    setDoc(doc: string): void {
      view.setState(buildState(doc));
    },
    getDoc(): string {
      return view.state.doc.toString();
    },
    focus(): void {
      view.focus();
    },
  };
}
