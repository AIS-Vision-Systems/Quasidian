// Section folding: headings fold their whole section (up to the next
// heading of the same or a higher level) and list items fold their
// sub-lists. Chevrons are inline widgets at the start of each foldable
// line — they ride at the text's height and can reveal on per-line
// hover — instead of the generic fold gutter, and the language's
// foldNodeProp folding (paragraphs, code blocks, quotes) is never used.
import { codeFolding, foldedRanges, foldEffect, syntaxTree, unfoldEffect } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { createIcon } from "../ui/icons";

const HEADING_RE = /^(?:ATXHeading|SetextHeading)([1-6])$/;

export interface FoldRange {
  from: number;
  to: number;
}

/**
 * Fold range of the section started by the heading on the line at
 * `lineFrom`: from the end of the heading (underline included) to the
 * end of the line before the next heading of the same or higher level.
 * Null when the line holds no heading or the section is empty.
 */
export function headingSectionRange(
  state: EditorState,
  lineFrom: number,
): FoldRange | null {
  const line = state.doc.lineAt(lineFrom);
  // Array instead of a nullable let: TS does not track closure writes.
  const matches: { to: number; level: number }[] = [];
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      const match = HEADING_RE.exec(node.name);
      if (
        match !== null &&
        state.doc.lineAt(node.from).from === line.from
      ) {
        matches.push({ to: node.to, level: Number(match[1]) });
      }
    },
  });
  const heading = matches[matches.length - 1];
  if (heading === undefined) {
    return null;
  }
  let end = state.doc.length;
  let done = false;
  syntaxTree(state).iterate({
    from: heading.to,
    to: state.doc.length,
    enter(node) {
      if (done) {
        return false;
      }
      const match = HEADING_RE.exec(node.name);
      if (
        match === null ||
        node.from <= heading.to ||
        Number(match[1]) > heading.level
      ) {
        return;
      }
      // Keep the newline before the next heading outside the fold.
      end = state.doc.lineAt(node.from).from - 1;
      done = true;
      return false;
    },
  });
  return end <= heading.to ? null : { from: heading.to, to: end };
}

/**
 * Fold range of a list item whose marker sits on the line at `lineFrom`
 * and that contains a nested list: from the end of the marker line to
 * the end of the item. Null otherwise.
 */
export function listItemFoldRange(
  state: EditorState,
  lineFrom: number,
): FoldRange | null {
  const line = state.doc.lineAt(lineFrom);
  const candidates: FoldRange[] = [];
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (node.name !== "ListMark") {
        return;
      }
      const item = node.node.parent;
      if (
        item === null ||
        item.name !== "ListItem" ||
        state.doc.lineAt(node.from).from !== line.from
      ) {
        return;
      }
      const hasNestedList =
        item.getChild("BulletList") !== null ||
        item.getChild("OrderedList") !== null;
      if (hasNestedList && item.to > line.to) {
        candidates.push({ from: line.to, to: item.to });
      }
    },
  });
  return candidates[candidates.length - 1] ?? null;
}

/** Foldable range for the line: heading section or list sub-items. */
export function foldRangeForLine(
  state: EditorState,
  lineFrom: number,
): FoldRange | null {
  return (
    headingSectionRange(state, lineFrom) ?? listItemFoldRange(state, lineFrom)
  );
}

/** The already-folded range starting exactly at `from`, or null. */
export function foldedRangeStartingAt(
  state: EditorState,
  from: number,
): FoldRange | null {
  const found: FoldRange[] = [];
  foldedRanges(state).between(from, from, (rangeFrom, rangeTo) => {
    if (rangeFrom === from) {
      found.push({ from: rangeFrom, to: rangeTo });
    }
  });
  return found[0] ?? null;
}

/** Fold ranges of every heading section in the document. */
export function allHeadingFolds(state: EditorState): FoldRange[] {
  const folds: FoldRange[] = [];
  const lines = new Set<number>();
  syntaxTree(state).iterate({
    enter(node) {
      if (HEADING_RE.test(node.name)) {
        lines.add(state.doc.lineAt(node.from).from);
      }
    },
  });
  for (const lineFrom of lines) {
    const range = headingSectionRange(state, lineFrom);
    if (range !== null) {
      folds.push(range);
    }
  }
  return folds;
}

function toggleFold(view: EditorView, range: FoldRange): void {
  const folded = foldedRangeStartingAt(view.state, range.from);
  view.dispatch({
    effects:
      folded === null ? foldEffect.of(range) : unfoldEffect.of(folded),
  });
}

class ChevronWidget extends WidgetType {
  constructor(
    readonly range: FoldRange,
    readonly folded: boolean,
  ) {
    super();
  }

  override eq(other: ChevronWidget): boolean {
    return (
      other.range.from === this.range.from &&
      other.range.to === this.range.to &&
      other.folded === this.folded
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = this.folded
      ? "cm-fold-chevron is-folded"
      : "cm-fold-chevron";
    span.append(createIcon(this.folded ? "chevron-right" : "chevron-down"));
    span.addEventListener("mousedown", (event) => {
      event.preventDefault();
      toggleFold(view, this.range);
    });
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function buildChevrons(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const range = foldRangeForLine(view.state, line.from);
      if (range !== null) {
        ranges.push(
          Decoration.widget({
            widget: new ChevronWidget(
              range,
              foldedRangeStartingAt(view.state, range.from) !== null,
            ),
            side: -1,
          }).range(line.from),
        );
      }
      if (line.to >= to) {
        break;
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

const chevronPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildChevrons(view);
    }

    update(update: ViewUpdate): void {
      const foldsChanged = update.transactions.some((tr) =>
        tr.effects.some(
          (effect) => effect.is(foldEffect) || effect.is(unfoldEffect),
        ),
      );
      if (update.docChanged || update.viewportChanged || foldsChanged) {
        this.decorations = buildChevrons(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

/** Folding for heading sections and list sub-items, with inline chevrons. */
export function sectionFolding(): Extension {
  return [codeFolding(), chevronPlugin];
}
