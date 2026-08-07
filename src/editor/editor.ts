// CodeMirror 6 markdown editor with Live Preview (syntax tokens hidden
// outside the active line/selection); styling goes through CSS variables.
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { tags } from "@lezer/highlight";
import { wikilinks } from "../markdown/wikilinks";
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
  { tag: tags.link, class: "cm-link" },
]);

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
  onWikilinkClick(target: string): void;
  /** Basenames (without extension) of the folder's markdown files. */
  getWikilinkCompletions(): string[];
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
        markdown({ base: markdownLanguage, extensions: [wikilinks] }),
        syntaxHighlighting(markdownHighlighting),
        livePreview(),
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
