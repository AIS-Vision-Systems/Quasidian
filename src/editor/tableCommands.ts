// Table editing: cell navigation with Tab, and structural operations
// (rows, columns, alignment) that rewrite the whole table normalized.
// The computations are pure over an EditorState and exported for tests;
// thin commands dispatch them.
import { syntaxTree } from "@codemirror/language";
import type { ChangeSpec, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

export type ColumnAlignment = "left" | "center" | "right" | null;

export type TableOp =
  | { kind: "nextCell" }
  | { kind: "prevCell" }
  | { kind: "addRow" }
  | { kind: "deleteRow" }
  | { kind: "moveRow"; delta: -1 | 1 }
  | { kind: "addColumn" }
  | { kind: "deleteColumn" }
  | { kind: "moveColumn"; delta: -1 | 1 }
  | { kind: "setAlignment"; alignment: ColumnAlignment };

interface TableModel {
  from: number;
  to: number;
  /** Cell texts per row; index 1 is the delimiter row. */
  rows: string[][];
  alignments: ColumnAlignment[];
  row: number;
  column: number;
}

function tableNodeAt(state: EditorState, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node !== null && node.name !== "Table") {
    node = node.parent;
  }
  return node;
}

export function inTable(state: EditorState, pos: number): boolean {
  return tableNodeAt(state, pos) !== null;
}

function alignmentOf(cell: string): ColumnAlignment {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  if (left) {
    return "left";
  }
  return null;
}

/** Splits a table line into trimmed cells, ignoring the border pipes. */
function splitCells(line: string): { texts: string[]; starts: number[] } {
  const texts: string[] = [];
  const starts: number[] = [];
  const boundaries: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && line[i - 1] !== "\\") {
      boundaries.push(i);
    }
  }
  const leading = line.slice(0, boundaries[0] ?? line.length).trim() === "";
  const segments: { from: number; to: number }[] = [];
  let prev = 0;
  for (const boundary of boundaries) {
    segments.push({ from: prev, to: boundary });
    prev = boundary + 1;
  }
  segments.push({ from: prev, to: line.length });
  const usable = segments.filter((segment, index) => {
    if (index === 0 && leading) {
      return false;
    }
    if (
      index === segments.length - 1 &&
      line.slice(segment.from, segment.to).trim() === ""
    ) {
      return false;
    }
    return true;
  });
  for (const segment of usable) {
    texts.push(line.slice(segment.from, segment.to).trim());
    starts.push(segment.from);
  }
  return { texts, starts };
}

function parseTable(state: EditorState, pos: number): TableModel | null {
  const node = tableNodeAt(state, pos);
  if (node === null) {
    return null;
  }
  const startLine = state.doc.lineAt(node.from);
  const endLine = state.doc.lineAt(node.to);
  const rows: string[][] = [];
  let alignments: ColumnAlignment[] = [];
  let row = 0;
  let column = 0;
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = state.doc.line(n);
    const { texts, starts } = splitCells(line.text);
    const index = n - startLine.number;
    if (index === 1) {
      alignments = texts.map(alignmentOf);
    }
    rows.push(texts);
    if (pos >= line.from && pos <= line.to) {
      row = index;
      column = 0;
      for (let c = starts.length - 1; c >= 0; c--) {
        if (pos - line.from >= starts[c]) {
          column = c;
          break;
        }
      }
    }
  }
  if (rows.length < 2) {
    return null;
  }
  const columns = Math.max(...rows.map((cells) => cells.length));
  for (const cells of rows) {
    while (cells.length < columns) {
      cells.push("");
    }
  }
  while (alignments.length < columns) {
    alignments.push(null);
  }
  return { from: startLine.from, to: endLine.to, rows, alignments, row, column };
}

function delimiterCell(alignment: ColumnAlignment): string {
  switch (alignment) {
    case "left":
      return ":---";
    case "center":
      return ":---:";
    case "right":
      return "---:";
    default:
      return "---";
  }
}

/** Serialized table plus the offset of each cell's content start. */
function serializeTable(
  rows: string[][],
  alignments: ColumnAlignment[],
): { text: string; cellOffsets: number[][] } {
  const lines: string[] = [];
  const cellOffsets: number[][] = [];
  let offset = 0;
  rows.forEach((cells, rowIndex) => {
    const rendered =
      rowIndex === 1
        ? alignments.map(delimiterCell)
        : cells.map((cell) => (cell === "" ? " " : cell));
    const offsets: number[] = [];
    let line = "|";
    for (const cell of rendered) {
      line += " ";
      offsets.push(offset + line.length);
      line += `${cell} |`;
    }
    cellOffsets.push(offsets);
    lines.push(line);
    offset += line.length + 1;
  });
  return { text: lines.join("\n"), cellOffsets };
}

interface TableEditResult {
  rows: string[][];
  alignments: ColumnAlignment[];
  row: number;
  column: number;
}

function transform(model: TableModel, op: TableOp): TableEditResult | null {
  const rows = model.rows.map((cells) => [...cells]);
  const alignments = [...model.alignments];
  const columns = alignments.length;
  let { row, column } = model;
  const lastRow = rows.length - 1;
  switch (op.kind) {
    case "nextCell":
    case "prevCell": {
      const forward = op.kind === "nextCell";
      // Flat order over header (0) and body rows (2..), skipping the
      // delimiter.
      const order: [number, number][] = [];
      rows.forEach((cells, r) => {
        if (r !== 1) {
          cells.forEach((_, c) => order.push([r, c]));
        }
      });
      const current = order.findIndex(([r, c]) => r === row && c === column);
      const target = current + (forward ? 1 : -1);
      if (current === -1 || target < 0) {
        return null;
      }
      if (target >= order.length) {
        // Tab past the last cell starts a fresh row.
        rows.push(Array.from({ length: columns }, () => ""));
        return { rows, alignments, row: rows.length - 1, column: 0 };
      }
      return { rows, alignments, row: order[target][0], column: order[target][1] };
    }
    case "addRow": {
      const at = Math.max(row + 1, 2);
      rows.splice(at, 0, Array.from({ length: columns }, () => ""));
      return { rows, alignments, row: at, column: 0 };
    }
    case "deleteRow": {
      if (row < 2) {
        return null;
      }
      rows.splice(row, 1);
      return { rows, alignments, row: Math.min(row, rows.length - 1), column };
    }
    case "moveRow": {
      const target = row + op.delta;
      if (row < 2 || target < 2 || target > lastRow) {
        return null;
      }
      const [moved] = rows.splice(row, 1);
      rows.splice(target, 0, moved);
      return { rows, alignments, row: target, column };
    }
    case "addColumn": {
      for (const cells of rows) {
        cells.splice(column + 1, 0, "");
      }
      alignments.splice(column + 1, 0, null);
      return { rows, alignments, row, column: column + 1 };
    }
    case "deleteColumn": {
      if (columns <= 1) {
        return null;
      }
      for (const cells of rows) {
        cells.splice(column, 1);
      }
      alignments.splice(column, 1);
      return {
        rows,
        alignments,
        row,
        column: Math.min(column, columns - 2),
      };
    }
    case "moveColumn": {
      const target = column + op.delta;
      if (target < 0 || target >= columns) {
        return null;
      }
      for (const cells of rows) {
        const [moved] = cells.splice(column, 1);
        cells.splice(target, 0, moved);
      }
      const [movedAlignment] = alignments.splice(column, 1);
      alignments.splice(target, 0, movedAlignment);
      return { rows, alignments, row, column: target };
    }
    case "setAlignment": {
      alignments[column] = op.alignment;
      return { rows, alignments, row, column };
    }
  }
}

/** The table edit for `op` at the main cursor, or null. */
export function computeTableEdit(
  state: EditorState,
  op: TableOp,
): { changes: ChangeSpec; selection: { anchor: number } } | null {
  const model = parseTable(state, state.selection.main.head);
  if (model === null) {
    return null;
  }
  const result = transform(model, op);
  if (result === null) {
    return null;
  }
  const serialized = serializeTable(result.rows, result.alignments);
  const offsets = serialized.cellOffsets[result.row] ?? [];
  const cellStart = offsets[result.column] ?? 0;
  const cellText =
    result.row === 1
      ? ""
      : (result.rows[result.row]?.[result.column] ?? "");
  return {
    changes: { from: model.from, to: model.to, insert: serialized.text },
    selection: { anchor: model.from + cellStart + cellText.length },
  };
}

export function tableEditCommand(op: TableOp) {
  return (view: EditorView): boolean => {
    const edit = computeTableEdit(view.state, op);
    if (edit === null) {
      return false;
    }
    view.dispatch({
      ...edit,
      scrollIntoView: true,
      userEvent: "input",
    });
    view.focus();
    return true;
  };
}
