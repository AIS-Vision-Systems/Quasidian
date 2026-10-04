// Link completion inside a table cell (m46). A cell being edited is a
// plain contenteditable, not CodeMirror text, so the editor's own
// autocompletion never reaches it. This shows the same suggestions —
// they come from the same completeLink — in a list styled by the
// editor's completion theme (it is mounted inside the editor's DOM for
// that), and driven by the same keys.
import type { EditorView } from "@codemirror/view";
import {
  completeLink,
  narrowOptions,
  type LinkCompletionHooks,
  type LinkCompletionOption,
} from "./linkCompletion";

/** More would not fit on screen; typing narrows the list anyway. */
const MAX_OPTIONS = 50;

interface Session {
  cell: HTMLElement;
  /** Where the typed fragment starts, in the cell's text. */
  from: number;
  options: LinkCompletionOption[];
  selected: number;
  popup: HTMLElement;
}

// One list at a time: only one cell has the caret.
let session: Session | null = null;
// Completions resolve asynchronously (headings are read from disk);
// only the latest request may show.
let ticket = 0;

/** Selection of a cell as offsets into its text, or null when outside. */
export function cellSelection(
  cell: HTMLElement,
): { from: number; to: number } | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (
    !cell.contains(range.startContainer) ||
    !cell.contains(range.endContainer)
  ) {
    return null;
  }
  const before = document.createRange();
  before.selectNodeContents(cell);
  before.setEnd(range.startContainer, range.startOffset);
  const from = before.toString().length;
  return { from, to: from + range.toString().length };
}

/** Replaces a cell's text and selects [from, to] in it. */
export function setCellText(
  cell: HTMLElement,
  text: string,
  from: number,
  to: number = from,
): void {
  cell.textContent = text;
  const node = cell.firstChild;
  const selection = window.getSelection();
  if (selection === null) {
    return;
  }
  const range = document.createRange();
  if (node === null) {
    range.selectNodeContents(cell);
    range.collapse(true);
  } else {
    range.setStart(node, Math.min(from, text.length));
    range.setEnd(node, Math.min(to, text.length));
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export function closeCellCompletion(): void {
  ticket++;
  session?.popup.remove();
  session = null;
}

function paint(): void {
  if (session === null) {
    return;
  }
  const items = session.popup.querySelectorAll("li");
  items.forEach((item, index) => {
    if (index === session?.selected) {
      item.setAttribute("aria-selected", "true");
      item.scrollIntoView({ block: "nearest" });
    } else {
      item.removeAttribute("aria-selected");
    }
  });
}

function accept(index: number): void {
  if (session === null) {
    return;
  }
  const { cell, from } = session;
  const option = session.options[index];
  const text = cell.textContent ?? "";
  const caret = cellSelection(cell)?.to ?? text.length;
  closeCellCompletion();
  // The list describes the fragment between "from" and the caret. A
  // caret that has moved before it, or a cell that is gone, leaves
  // nothing to complete — never splice into the wrong place.
  if (option === undefined || !cell.isConnected || caret < from) {
    return;
  }
  const end = from + option.apply.length;
  setCellText(cell, text.slice(0, from) + option.apply + text.slice(caret), end);
}

function show(
  cell: HTMLElement,
  view: EditorView,
  from: number,
  options: LinkCompletionOption[],
): void {
  session?.popup.remove();
  const popup = document.createElement("div");
  popup.className = "cm-tooltip cm-tooltip-autocomplete cm-tooltip-below";
  popup.style.position = "fixed";
  const list = document.createElement("ul");
  list.setAttribute("role", "listbox");
  options.forEach((option, index) => {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    const label = document.createElement("span");
    label.className = "cm-completionLabel";
    label.textContent = option.label;
    item.append(label);
    // mousedown, not click: the cell must keep the focus (and its
    // edit) while an option is picked.
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      accept(index);
    });
    list.append(item);
  });
  popup.append(list);
  // Under the caret; a collapsed range at the end of the text has no
  // box of its own, the cell's stands in.
  const selection = window.getSelection();
  const caretBox =
    selection !== null && selection.rangeCount > 0
      ? selection.getRangeAt(0).getClientRects()[0]
      : undefined;
  const box = caretBox ?? cell.getBoundingClientRect();
  popup.style.left = `${box.left}px`;
  popup.style.top = `${box.bottom + 2}px`;
  view.dom.append(popup);
  session = { cell, from, options, selected: 0, popup };
  paint();
}

/**
 * Looks at the text around the caret of a cell being edited and
 * shows, updates or hides the list of suggestions. Call it after
 * every input.
 */
export function updateCellCompletion(
  cell: HTMLElement,
  view: EditorView,
  hooks: LinkCompletionHooks,
): void {
  const mine = ++ticket;
  const selection = cellSelection(cell);
  if (selection === null || selection.from !== selection.to) {
    closeCellCompletion();
    return;
  }
  const text = cell.textContent ?? "";
  const caret = selection.from;
  void completeLink(text.slice(0, caret), text.slice(caret), hooks)
    .then((result) => {
      if (mine !== ticket) {
        return; // a later keystroke asked again
      }
      const options =
        result === null
          ? []
          : (result.filtered
              ? result.options
              : narrowOptions(result.options, text.slice(result.from, caret))
            ).slice(0, MAX_OPTIONS);
      if (result === null || options.length === 0) {
        closeCellCompletion();
        return;
      }
      show(cell, view, result.from, options);
    })
    .catch(() => closeCellCompletion());
}

/**
 * Gives a key to the open list first: the arrows move through it,
 * Enter and Tab accept, Escape closes. True when the key was taken —
 * the table's own navigation must then leave it alone.
 */
export function cellCompletionKey(event: KeyboardEvent): boolean {
  if (session === null) {
    return false;
  }
  // Composing a character (IME): Enter and Tab belong to the
  // composition, not to the list.
  if (event.isComposing) {
    return false;
  }
  // Keys that move the caret end the completion: the list no longer
  // describes what is around it. The key keeps its own meaning.
  if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
    closeCellCompletion();
    return false;
  }
  switch (event.key) {
    case "ArrowDown":
      session.selected = (session.selected + 1) % session.options.length;
      paint();
      break;
    case "ArrowUp":
      session.selected =
        (session.selected - 1 + session.options.length) %
        session.options.length;
      paint();
      break;
    case "Enter":
    case "Tab":
      accept(session.selected);
      break;
    case "Escape":
      closeCellCompletion();
      break;
    default:
      return false;
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
}
