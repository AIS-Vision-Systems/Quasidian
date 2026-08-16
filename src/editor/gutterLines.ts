// Line-number gutter refinements. Two problems with the raw gutter:
// heading lines carry big top padding, so their number floats far above
// the text; and code blocks/quotes number every line, which reads as
// noise. Numbers get per-line classes so the CSS can replicate the
// line's padding, and block innards only show numbers while the cursor
// is inside the block.
import { syntaxTree } from "@codemirror/language";
import {
  RangeSetBuilder,
  StateField,
  type EditorState,
  type RangeSet,
} from "@codemirror/state";
import { gutterLineClass, GutterMarker } from "@codemirror/view";
import { computeHeadingLines } from "./livePreview";

class LineClass extends GutterMarker {
  constructor(cls: string) {
    super();
    this.elementClass = cls;
  }
}

// One marker instance per distinct class combination.
const markerCache = new Map<string, LineClass>();
function markerFor(classes: string[]): LineClass {
  const key = classes.sort().join(" ");
  let marker = markerCache.get(key);
  if (marker === undefined) {
    marker = new LineClass(key);
    markerCache.set(key, marker);
  }
  return marker;
}

/** Block containers whose innards only get numbers while edited. */
const QUIET_BLOCKS = new Set(["FencedCode", "CodeBlock", "Blockquote"]);

function computeMarkers(state: EditorState): RangeSet<GutterMarker> {
  const classes = new Map<number, string[]>();
  const add = (lineFrom: number, cls: string): void => {
    const list = classes.get(lineFrom);
    if (list === undefined) {
      classes.set(lineFrom, [cls]);
    } else if (!list.includes(cls)) {
      list.push(cls);
    }
  };
  for (const heading of computeHeadingLines(state, 0, state.doc.length)) {
    add(heading.from, `cm-gutterline-h${heading.level}`);
  }
  const head = state.selection.main.head;
  syntaxTree(state).iterate({
    enter(node) {
      if (!QUIET_BLOCKS.has(node.name)) {
        return;
      }
      if (head >= node.from && head <= node.to) {
        return false; // being edited: keep its numbers visible
      }
      for (let pos = node.from; pos <= node.to; ) {
        const line = state.doc.lineAt(pos);
        add(line.from, "cm-gutterline-quiet");
        pos = line.to + 1;
      }
      return false;
    },
  });
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const [from, list] of [...classes.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    builder.add(from, from, markerFor(list));
  }
  return builder.finish();
}

/** Provides the per-line gutter classes; pairs with lineNumbers(). */
export const gutterLineStyles = StateField.define<RangeSet<GutterMarker>>({
  create: computeMarkers,
  update(_value, tr) {
    return computeMarkers(tr.state);
  },
  provide: (field) => gutterLineClass.from(field),
});
