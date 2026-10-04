// A cursor that shows where a file being dragged over the editor will
// be inserted (m51). The host drives it: the drag is not an HTML5 one
// the editor could follow on its own (the desktop shell reports OS
// file drags, and the sidebar drags with plain pointer events), so
// CodeMirror's own dropCursor() never sees it.
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

/** Shows the drop cursor at a document position; null hides it. */
export const setDropCursorPos = StateEffect.define<number | null>();

class DropCursorWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const cursor = document.createElement("span");
    cursor.className = "cm-pointer-drop-cursor";
    cursor.setAttribute("aria-hidden", "true");
    return cursor;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const cursorDecoration = Decoration.widget({
  widget: new DropCursorWidget(),
  side: 1,
});

/** Position of the drop cursor, or null while nothing is dragged. */
export const dropCursorField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDropCursorPos)) {
        return effect.value;
      }
    }
    // Any edit ends the preview: the position it pointed at is gone.
    return tr.docChanged ? null : value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (pos) =>
      pos === null
        ? Decoration.none
        : Decoration.set([cursorDecoration.range(pos)]),
    ),
});
