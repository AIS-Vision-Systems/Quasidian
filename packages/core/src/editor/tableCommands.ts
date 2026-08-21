// Table model: parsing a table's source into rows/alignments, applying
// structural operations (rows, columns, alignment, sorting) and
// serializing back normalized. Pure module — the interactive table
// widget in livePreview dispatches the results.

export type ColumnAlignment = "left" | "center" | "right" | null;

export interface TableData {
  /** Cell texts per row; index 1 is the delimiter row (texts unused). */
  rows: string[][];
  alignments: ColumnAlignment[];
}

export type TableOp =
  | { kind: "addRow"; row: number; side: "above" | "below" }
  | { kind: "duplicateRow"; row: number }
  | { kind: "deleteRow"; row: number }
  | { kind: "moveRow"; row: number; delta: -1 | 1 }
  | { kind: "moveRowTo"; row: number; to: number }
  | { kind: "moveColumnTo"; column: number; to: number }
  | { kind: "addColumn"; column: number; side: "left" | "right" }
  | { kind: "duplicateColumn"; column: number }
  | { kind: "deleteColumn"; column: number }
  | { kind: "moveColumn"; column: number; delta: -1 | 1 }
  | { kind: "setAlignment"; column: number; alignment: ColumnAlignment }
  | { kind: "sort"; column: number; ascending: boolean };

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
function splitCells(line: string): string[] {
  const boundaries: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && line[i - 1] !== "\\") {
      boundaries.push(i);
    }
  }
  const segments: { from: number; to: number }[] = [];
  let prev = 0;
  for (const boundary of boundaries) {
    segments.push({ from: prev, to: boundary });
    prev = boundary + 1;
  }
  segments.push({ from: prev, to: line.length });
  const leading = (segments[0]?.to ?? 0) === (boundaries[0] ?? 0)
    ? line.slice(0, boundaries[0] ?? line.length).trim() === ""
    : false;
  return segments
    .filter((segment, index) => {
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
    })
    .map((segment) => line.slice(segment.from, segment.to).trim());
}

/** Parses a table's source text; null when it is not a table. */
export function parseTableSource(source: string): TableData | null {
  const lines = source.split("\n");
  if (lines.length < 2) {
    return null;
  }
  const rows = lines.map(splitCells);
  const alignments = rows[1].map(alignmentOf);
  const columns = Math.max(...rows.map((cells) => cells.length));
  for (const cells of rows) {
    while (cells.length < columns) {
      cells.push("");
    }
  }
  while (alignments.length < columns) {
    alignments.push(null);
  }
  return { rows, alignments };
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

/** Serializes normalized (`| a | b |`), no trailing newline. */
export function serializeTable(data: TableData): string {
  return data.rows
    .map((cells, rowIndex) => {
      const rendered =
        rowIndex === 1
          ? data.alignments.map(delimiterCell)
          : cells.map((cell) => (cell === "" ? " " : cell));
      return `| ${rendered.join(" | ")} |`;
    })
    .join("\n");
}

/**
 * Applies a structural operation. Row indexes are model rows (0 header,
 * 1 delimiter, 2+ body); ops on the delimiter or that would empty the
 * table return null.
 */
export function applyTableOp(data: TableData, op: TableOp): TableData | null {
  const rows = data.rows.map((cells) => [...cells]);
  const alignments = [...data.alignments];
  const columns = alignments.length;
  switch (op.kind) {
    case "addRow": {
      const at =
        op.side === "below"
          ? Math.max(op.row + 1, 2)
          : Math.max(op.row, 2);
      rows.splice(at, 0, Array.from({ length: columns }, () => ""));
      return { rows, alignments };
    }
    case "duplicateRow": {
      if (op.row === 1) {
        return null;
      }
      const at = op.row === 0 ? 2 : op.row + 1;
      rows.splice(at, 0, [...rows[op.row]]);
      return { rows, alignments };
    }
    case "deleteRow": {
      if (op.row < 2) {
        return null;
      }
      rows.splice(op.row, 1);
      return { rows, alignments };
    }
    case "moveRow": {
      const target = op.row + op.delta;
      if (op.row < 2 || target < 2 || target >= rows.length) {
        return null;
      }
      const [moved] = rows.splice(op.row, 1);
      rows.splice(target, 0, moved);
      return { rows, alignments };
    }
    case "moveRowTo": {
      if (
        op.row < 2 ||
        op.to < 2 ||
        op.row >= rows.length ||
        op.to >= rows.length ||
        op.row === op.to
      ) {
        return null;
      }
      const [moved] = rows.splice(op.row, 1);
      rows.splice(op.to, 0, moved);
      return { rows, alignments };
    }
    case "moveColumnTo": {
      if (
        op.column < 0 ||
        op.to < 0 ||
        op.column >= columns ||
        op.to >= columns ||
        op.column === op.to
      ) {
        return null;
      }
      for (const cells of rows) {
        const [moved] = cells.splice(op.column, 1);
        cells.splice(op.to, 0, moved);
      }
      const [moved] = alignments.splice(op.column, 1);
      alignments.splice(op.to, 0, moved);
      return { rows, alignments };
    }
    case "addColumn": {
      const at = op.side === "right" ? op.column + 1 : op.column;
      for (const cells of rows) {
        cells.splice(at, 0, "");
      }
      alignments.splice(at, 0, null);
      return { rows, alignments };
    }
    case "duplicateColumn": {
      for (const cells of rows) {
        cells.splice(op.column + 1, 0, cells[op.column]);
      }
      alignments.splice(op.column + 1, 0, alignments[op.column]);
      return { rows, alignments };
    }
    case "deleteColumn": {
      if (columns <= 1) {
        return null;
      }
      for (const cells of rows) {
        cells.splice(op.column, 1);
      }
      alignments.splice(op.column, 1);
      return { rows, alignments };
    }
    case "moveColumn": {
      const target = op.column + op.delta;
      if (target < 0 || target >= columns) {
        return null;
      }
      for (const cells of rows) {
        const [moved] = cells.splice(op.column, 1);
        cells.splice(target, 0, moved);
      }
      const [moved] = alignments.splice(op.column, 1);
      alignments.splice(target, 0, moved);
      return { rows, alignments };
    }
    case "setAlignment": {
      alignments[op.column] = op.alignment;
      return { rows, alignments };
    }
    case "sort": {
      const body = rows.slice(2);
      body.sort((a, b) => {
        const compared = (a[op.column] ?? "").localeCompare(
          b[op.column] ?? "",
          undefined,
          { numeric: true, sensitivity: "base" },
        );
        return op.ascending ? compared : -compared;
      });
      return { rows: [...rows.slice(0, 2), ...body], alignments };
    }
  }
}

/** A fresh 2x2 table skeleton. */
export function emptyTable(): string {
  return serializeTable({
    rows: [
      ["", ""],
      ["", ""],
      ["", ""],
    ],
    alignments: [null, null],
  });
}
