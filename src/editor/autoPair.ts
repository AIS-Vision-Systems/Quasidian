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

/** Markers that auto-close while typing (*, _, =, ~, $). */
const MARKERS = new Set(["*", "_", "=", "~", "$"]);

const WORD_CHAR = /[\p{L}\p{N}]/u;

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
 * Markdown marker auto-pair: typing a marker inserts its closing twin
 * right away (`*` gives `*|*`), and typing another marker from inside
 * an empty pair grows it (`*|*` + `*` gives `**|**`; `**|**` + `_`
 * gives `**_|_**`). Guards: typing the marker right before its closing
 * twin skips over it; markers touching letters or digits never pair
 * (snake_case, prices); and an odd count of the marker earlier on the
 * line means this one closes an open run, so it is left alone. Null
 * when the input should fall through.
 */
export function markdownMarkerPair(
  state: EditorState,
  typed: string,
): { changes?: { from: number; insert: string }; selection: { anchor: number } } | null {
  if (!MARKERS.has(typed)) {
    return null;
  }
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return null;
  }
  const pos = state.selection.main.head;
  const prev = state.sliceDoc(pos - 1, pos);
  const next = state.sliceDoc(pos, pos + 1);
  // Inside an empty pair of the same marker: grow it outward.
  if (prev === typed && next === typed) {
    return {
      changes: { from: pos, insert: typed + typed },
      selection: { anchor: pos + 1 },
    };
  }
  // Right before the closing twin: walk over it instead of inserting.
  if (next === typed) {
    return { selection: { anchor: pos + 1 } };
  }
  // Fresh pair only between non-word characters.
  if (
    (prev !== "" && WORD_CHAR.test(prev)) ||
    (next !== "" && WORD_CHAR.test(next))
  ) {
    return null;
  }
  // An odd count earlier on the line means this marker closes an open
  // run — leave it alone.
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  let count = 0;
  for (const ch of before) {
    if (ch === typed) {
      count++;
    }
  }
  if (count % 2 === 1) {
    return null;
  }
  return {
    changes: { from: pos, insert: typed + typed },
    selection: { anchor: pos + 1 },
  };
}
