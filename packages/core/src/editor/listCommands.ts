// List editing commands: Tab indents the item one level, Shift-Tab
// outdents it, and Enter on an empty item climbs back one level (or exits
// the list at the top level). Every structural change renumbers ordered
// lists sequentially from 1 — custom start numbers are not preserved.
//
// Indenting aligns the item with the previous sibling's content column
// (CommonMark requires reaching it to nest — 2 spaces for "- ", 3 for
// "1. "); outdenting returns to the parent item's own indentation.
//
// The change-set builders are exported separately from the commands so
// they can be unit-tested on headless EditorStates.
import { indentUnit, syntaxTree } from "@codemirror/language";
import type { ChangeSpec, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { markdownParser } from "../markdown/parser";

interface SimpleChange {
  from: number;
  to: number;
  insert: string;
}

/** Innermost ListItem at the main cursor, or null. */
function listItemAt(state: EditorState, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node !== null && node.name !== "ListItem") {
    node = node.parent;
  }
  return node;
}

/** Whether the main cursor sits inside a list item. */
export function inListItem(state: EditorState): boolean {
  return listItemAt(state, state.selection.main.head) !== null;
}

function leadingLength(lineText: string): number {
  return /^[ \t]*/.exec(lineText)?.[0].length ?? 0;
}

/** Content column of an item: end of its marker(s) + one space. */
function contentColumn(state: EditorState, item: SyntaxNode): number | null {
  const mark = item.getChild("ListMark");
  if (mark === null) {
    return null;
  }
  const taskMarker = item.getChild("Task")?.getChild("TaskMarker") ?? null;
  return (taskMarker ?? mark).to - state.doc.lineAt(mark.from).from + 1;
}

function previousListItem(item: SyntaxNode): SyntaxNode | null {
  for (let prev = item.prevSibling; prev !== null; prev = prev.prevSibling) {
    if (prev.name === "ListItem") {
      return prev;
    }
  }
  return null;
}

function parentListItem(item: SyntaxNode): SyntaxNode | null {
  const parent = item.parent?.parent ?? null;
  return parent !== null && parent.name === "ListItem" ? parent : null;
}

/**
 * Sequential renumbering (1., 2., …) of every ordered list in `doc`,
 * as changes in `doc` coordinates. Lists that are already sequential
 * produce no changes.
 */
export function computeRenumberChanges(doc: string): SimpleChange[] {
  const changes: SimpleChange[] = [];
  markdownParser.parse(doc).iterate({
    enter(node) {
      if (node.name !== "OrderedList") {
        return;
      }
      let expected = 1;
      for (
        let item = node.node.firstChild;
        item !== null;
        item = item.nextSibling
      ) {
        if (item.name !== "ListItem") {
          continue;
        }
        const mark = item.getChild("ListMark");
        if (mark === null) {
          continue;
        }
        const text = doc.slice(mark.from, mark.to);
        const desired = `${expected}${text.endsWith(")") ? ")" : "."}`;
        if (text !== desired) {
          changes.push({ from: mark.from, to: mark.to, insert: desired });
        }
        expected++;
      }
    },
  });
  return changes;
}

/**
 * `primary` plus the ordered-list renumbering it triggers, composed as a
 * single change set in the current document's coordinates (one undo step).
 */
function withRenumber(state: EditorState, primary: SimpleChange): ChangeSpec[] {
  const tr = state.update({ changes: primary });
  const back = tr.changes.invertedDesc;
  return [
    primary,
    ...computeRenumberChanges(tr.newDoc.toString()).map((change) => ({
      from: back.mapPos(change.from, 1),
      to: back.mapPos(change.to, -1),
      insert: change.insert,
    })),
  ];
}

/** Marker line of an item (where its ListMark lives), or null. */
function markerLine(state: EditorState, item: SyntaxNode) {
  const mark = item.getChild("ListMark");
  return mark === null ? null : state.doc.lineAt(mark.from);
}

/**
 * Changes to indent the item at the main cursor one level, or null when
 * the cursor is not in a list or the item has no previous sibling to
 * nest under.
 */
export function computeListIndent(state: EditorState): ChangeSpec[] | null {
  const item = listItemAt(state, state.selection.main.head);
  if (item === null) {
    return null;
  }
  const line = markerLine(state, item);
  const previous = item !== null ? previousListItem(item) : null;
  if (line === null || previous === null) {
    return null;
  }
  let insert: string;
  if (state.facet(indentUnit) === "\t") {
    insert = "\t";
  } else {
    const target = contentColumn(state, previous);
    const missing = target === null ? 0 : target - leadingLength(line.text);
    if (missing <= 0) {
      return null;
    }
    insert = " ".repeat(missing);
  }
  return withRenumber(state, { from: line.from, to: line.from, insert });
}

/** The outdent-one-level change for `item`, or null at the top level. */
function outdentChange(
  state: EditorState,
  item: SyntaxNode,
): SimpleChange | null {
  const line = markerLine(state, item);
  const parent = parentListItem(item);
  if (line === null || parent === null) {
    return null;
  }
  const parentLine = markerLine(state, parent);
  if (parentLine === null) {
    return null;
  }
  const remove =
    leadingLength(line.text) - leadingLength(parentLine.text);
  if (remove <= 0) {
    return null;
  }
  return { from: line.from, to: line.from + remove, insert: "" };
}

/** Changes to outdent the item at the main cursor one level, or null. */
export function computeListOutdent(state: EditorState): ChangeSpec[] | null {
  const item = listItemAt(state, state.selection.main.head);
  if (item === null) {
    return null;
  }
  const change = outdentChange(state, item);
  return change === null ? null : withRenumber(state, change);
}

/**
 * Enter on an empty list item: outdent one level, or clear the marker at
 * the top level so the line becomes plain text. Null when the cursor is
 * not at the end of an empty item.
 */
export function computeEmptyListItemExit(
  state: EditorState,
): ChangeSpec[] | null {
  const selection = state.selection.main;
  if (!selection.empty) {
    return null;
  }
  const line = state.doc.lineAt(selection.head);
  if (selection.head !== line.to) {
    return null;
  }
  if (!/^[ \t]*(?:[-+*]|\d+[.)])(?:\s+\[[ xX]\])?\s*$/.test(line.text)) {
    return null;
  }
  const item = listItemAt(state, selection.head);
  if (item === null) {
    return null;
  }
  const outdent = outdentChange(state, item);
  if (outdent !== null) {
    return withRenumber(state, outdent);
  }
  return withRenumber(state, { from: line.from, to: line.to, insert: "" });
}

export function listIndentCommand(view: EditorView): boolean {
  const changes = computeListIndent(view.state);
  if (changes === null) {
    return false;
  }
  view.dispatch({ changes, userEvent: "input.indent" });
  return true;
}

export function listOutdentCommand(view: EditorView): boolean {
  const changes = computeListOutdent(view.state);
  if (changes === null) {
    return false;
  }
  view.dispatch({ changes, userEvent: "delete.dedent" });
  return true;
}

export function emptyListItemExitCommand(view: EditorView): boolean {
  const changes = computeEmptyListItemExit(view.state);
  if (changes === null) {
    return false;
  }
  view.dispatch({ changes, userEvent: "delete.dedent" });
  return true;
}
