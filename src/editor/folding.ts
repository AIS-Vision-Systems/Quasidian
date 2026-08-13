// Section folding by heading: a heading folds everything up to the next
// heading of the same or a higher level. The range computation is pure
// and exported for tests; the extension bundles CodeMirror's folding
// with a hover chevron gutter.
import {
  codeFolding,
  foldGutter,
  foldKeymap,
  foldService,
} from "@codemirror/language";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
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

/** Folding extension: heading sections, hover chevrons, fold keymap. */
export function headingFolding(): Extension {
  return [
    codeFolding(),
    foldService.of((state, lineStart) => headingSectionRange(state, lineStart)),
    foldGutter({
      markerDOM(open) {
        const marker = document.createElement("span");
        marker.className = open ? "cm-fold-marker" : "cm-fold-marker is-folded";
        marker.append(createIcon(open ? "chevron-down" : "chevron-right"));
        return marker;
      },
    }),
    keymap.of(foldKeymap),
  ];
}
