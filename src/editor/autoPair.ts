// Pure module: no Tauri, no DOM. Wrap-on-type and markdown double-marker
// auto-pairing, computed against an EditorState and dispatched by the
// editor's input handler.
import { EditorSelection, type EditorState } from "@codemirror/state";

/** Opening char → closing char for wrap-on-type. */
const WRAP_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "*": "*",
  _: "_",
  "=": "=",
  $: "$",
  "~": "~",
  "`": "`",
};

/** Markers whose doubled form auto-closes (**, __, ==, ~~, $$). */
const DOUBLE_MARKERS = new Set(["*", "_", "=", "~", "$"]);

/**
 * Wraps every non-empty selection range with the typed pair instead of
 * replacing it. The wrapped text stays selected, so pressing the marker
 * again doubles it (= then = gives ==text==). Null when nothing is
 * selected or the char does not wrap.
 */
export function wrapSelection(
  state: EditorState,
  typed: string,
): ReturnType<EditorState["changeByRange"]> | null {
  const close = WRAP_PAIRS[typed];
  if (close === undefined) {
    return null;
  }
  if (!state.selection.ranges.some((range) => !range.empty)) {
    return null;
  }
  return state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: { from: range.from, insert: typed },
        range: EditorSelection.cursor(range.from + typed.length),
      };
    }
    return {
      changes: [
        { from: range.from, insert: typed },
        { from: range.to, insert: close },
      ],
      range: EditorSelection.range(range.from + 1, range.to + 1),
    };
  });
}

/**
 * Markdown double-marker auto-pair: typing the char that completes a
 * double (the second `*` of `**`) also inserts the closing double, so
 * the result is `**|**`. Typing the marker right before a closing
 * double skips over one char instead of inserting. Whether the new
 * double opens (pair) or closes (leave alone) is decided by counting
 * the doubles already present on the line. Null when the rule does not
 * apply and the input should fall through.
 */
export function markdownDoublePair(
  state: EditorState,
  typed: string,
): { changes?: { from: number; insert: string }; selection: { anchor: number } } | null {
  if (!DOUBLE_MARKERS.has(typed)) {
    return null;
  }
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return null;
  }
  const pos = state.selection.main.head;
  const double = typed + typed;
  // Inside `XX|XX`: typing the marker walks over the closing pair.
  if (
    state.sliceDoc(pos, pos + 2) === double &&
    state.sliceDoc(pos - 1, pos) === typed
  ) {
    return { selection: { anchor: pos + 1 } };
  }
  // Completing a double: previous char is the marker, and the one before
  // is not (never grow triples).
  if (
    state.sliceDoc(pos - 1, pos) !== typed ||
    state.sliceDoc(pos - 2, pos - 1) === typed
  ) {
    return null;
  }
  // An odd number of earlier doubles on the line means this one closes
  // an open marker — leave it alone.
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos - 1);
  let doubles = 0;
  for (let i = 0; i + 1 < before.length; i++) {
    if (before[i] === typed && before[i + 1] === typed) {
      doubles++;
      i++;
    }
  }
  if (doubles % 2 === 1) {
    return null;
  }
  return {
    changes: { from: pos, insert: typed + double },
    selection: { anchor: pos + 1 },
  };
}
