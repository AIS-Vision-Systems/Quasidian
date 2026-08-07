// Shared Obsidian-style overlay for the quick switcher and the command
// palette: input on top, fuzzy-filtered results below.
import { fuzzyFilter } from "../lib/fuzzy";

export interface PaletteItem {
  id: string;
  label: string;
  /** Right-aligned hint, e.g. a hotkey. */
  hint?: string;
}

export interface PaletteOptions {
  placeholder: string;
  emptyLabel: string;
  items: PaletteItem[];
  onSelect(item: PaletteItem): void;
  /** When set, offers a create row unless the query matches a label exactly. */
  onCreate?(query: string): void;
  /** Label for the create row; receives the trimmed query. */
  createLabel?(query: string): string;
  onClose?(): void;
}

type Row =
  | { kind: "item"; item: PaletteItem; positions: number[] }
  | { kind: "create"; query: string };

let activeClose: (() => void) | null = null;

export function closePalette(): void {
  activeClose?.();
}

export function openPalette(options: PaletteOptions): void {
  closePalette();

  const overlay = document.createElement("div");
  overlay.className = "palette-overlay";
  const panel = document.createElement("div");
  panel.className = "palette";
  const input = document.createElement("input");
  input.className = "palette-input";
  input.placeholder = options.placeholder;
  input.spellcheck = false;
  const results = document.createElement("ul");
  results.className = "palette-results";
  panel.append(input, results);
  overlay.append(panel);
  document.body.append(overlay);

  let rows: Row[] = [];
  let selected = 0;

  function close(): void {
    activeClose = null;
    overlay.remove();
    options.onClose?.();
  }
  activeClose = close;

  function choose(row: Row | undefined): void {
    if (row === undefined) {
      return;
    }
    close();
    if (row.kind === "item") {
      options.onSelect(row.item);
    } else {
      options.onCreate?.(row.query);
    }
  }

  function appendHighlighted(
    parent: HTMLElement,
    text: string,
    positions: number[],
  ): void {
    const matched = new Set(positions);
    let buffer = "";
    let inMatch = false;
    const flush = () => {
      if (buffer === "") {
        return;
      }
      if (inMatch) {
        const span = document.createElement("span");
        span.className = "palette-match";
        span.textContent = buffer;
        parent.append(span);
      } else {
        parent.append(document.createTextNode(buffer));
      }
      buffer = "";
    };
    Array.from(text).forEach((ch, index) => {
      const isMatch = matched.has(index);
      if (isMatch !== inMatch) {
        flush();
        inMatch = isMatch;
      }
      buffer += ch;
    });
    flush();
  }

  function renderRows(): void {
    const query = input.value;
    const matches = fuzzyFilter(query, options.items, (item) => item.label);
    rows = matches.map(({ item, match }) => ({
      kind: "item",
      item,
      positions: match.positions,
    }));
    const trimmed = query.trim();
    if (
      options.onCreate !== undefined &&
      trimmed !== "" &&
      !options.items.some(
        (item) => item.label.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      rows.push({ kind: "create", query: trimmed });
    }
    if (selected >= rows.length) {
      selected = Math.max(0, rows.length - 1);
    }
    if (rows.length === 0) {
      const empty = document.createElement("li");
      empty.className = "palette-empty";
      empty.textContent = options.emptyLabel;
      results.replaceChildren(empty);
      return;
    }
    results.replaceChildren(
      ...rows.map((row, index) => {
        const item = document.createElement("li");
        item.className = "palette-item";
        item.classList.toggle("is-selected", index === selected);
        const label = document.createElement("span");
        label.className = "palette-label";
        if (row.kind === "item") {
          appendHighlighted(label, row.item.label, row.positions);
        } else {
          label.textContent = options.createLabel?.(row.query) ?? row.query;
        }
        item.append(label);
        if (row.kind === "item" && row.item.hint !== undefined) {
          const hint = document.createElement("span");
          hint.className = "palette-hint";
          hint.textContent = row.item.hint;
          item.append(hint);
        }
        item.addEventListener("mousedown", (event) => {
          event.preventDefault();
          choose(row);
        });
        return item;
      }),
    );
    results.children[selected]?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", () => {
    selected = 0;
    renderRows();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) {
        return;
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      selected = (selected + delta + rows.length) % rows.length;
      renderRows();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  renderRows();
  input.focus();
}
