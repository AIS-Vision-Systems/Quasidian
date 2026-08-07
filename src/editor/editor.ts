// CodeMirror 6 markdown editor in plain text. Live Preview (hiding syntax
// tokens) lands in milestone 3; styling lives in app.css via CSS variables.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

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
