// Inline-title element shared by both modes: shows the note name as an
// H1 and swaps to a styled input on click or keyboard focus — inputs
// work reliably inside CodeMirror widgets, unlike nested
// contenteditable. Enter/blur commits as a rename; Escape reverts.

export interface InlineTitleOptions {
  title: string;
  tag: "h1" | "div";
  className: string;
  onRename(name: string): void;
  /** Called when leaving downwards (Enter / ArrowDown). */
  onExitDown?(): void;
}

export function buildInlineTitleElement(
  options: InlineTitleOptions,
): HTMLElement {
  const el = document.createElement(options.tag);
  el.className = options.className;
  el.textContent = options.title;
  el.tabIndex = 0;

  function startEdit(): void {
    if (el.querySelector("input") !== null) {
      return;
    }
    const input = document.createElement("input");
    input.className = "inline-title-input";
    input.value = options.title;
    input.spellcheck = false;
    el.replaceChildren(input);
    el.classList.add("is-editing");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      const name = input.value.trim();
      el.classList.remove("is-editing");
      el.textContent = options.title;
      if (commit && name !== "" && name !== options.title) {
        options.onRename(name);
      }
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "ArrowDown") {
        event.preventDefault();
        finish(true);
        options.onExitDown?.();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  }

  el.addEventListener("mousedown", (event) => {
    if (event.target instanceof HTMLInputElement) {
      // Already editing: native caret placement and mouse selection.
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    startEdit();
  });
  el.addEventListener("focus", () => startEdit());
  return el;
}
