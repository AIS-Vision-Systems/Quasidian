// Obsidian-style context menu: single instance, keyboard-dismissable,
// clamped to the viewport, with one level of submenus. All labels are
// passed in already translated.
import { createIcon, type IconName } from "./icons";

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** Rendered in the error color (destructive actions). */
  danger?: boolean;
  disabled?: boolean;
  /** Shows a check mark on the right (toggle items). */
  checked?: boolean;
  onClick?: () => void;
  submenu?: MenuEntry[];
}

export type MenuEntry = MenuItem | "separator";

let activeClose: (() => void) | null = null;

export function closeContextMenu(): void {
  activeClose?.();
}

function buildItem(
  item: MenuItem,
  close: () => void,
): HTMLElement {
  const element = document.createElement("div");
  element.className = "context-menu-item";
  element.classList.toggle("is-danger", item.danger === true);
  element.classList.toggle("is-disabled", item.disabled === true);
  const iconSlot = document.createElement("span");
  iconSlot.className = "context-menu-icon";
  if (item.icon !== undefined) {
    iconSlot.append(createIcon(item.icon));
  }
  const label = document.createElement("span");
  label.className = "context-menu-label";
  label.textContent = item.label;
  element.append(iconSlot, label);
  if (item.checked === true) {
    const check = document.createElement("span");
    check.className = "context-menu-check";
    check.append(createIcon("check"));
    element.append(check);
  }
  if (item.submenu !== undefined) {
    const arrow = document.createElement("span");
    arrow.className = "context-menu-arrow";
    arrow.append(createIcon("chevron-right"));
    element.append(arrow);
    const submenu = document.createElement("div");
    submenu.className = "context-menu context-menu-submenu";
    for (const child of item.submenu) {
      if (child === "separator") {
        const separator = document.createElement("div");
        separator.className = "context-menu-separator";
        submenu.append(separator);
      } else {
        submenu.append(buildItem(child, close));
      }
    }
    element.append(submenu);
  } else if (item.disabled !== true) {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      close();
      item.onClick?.();
    });
  }
  return element;
}

export function openContextMenu(
  x: number,
  y: number,
  entries: MenuEntry[],
): void {
  activeClose?.();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  for (const entry of entries) {
    if (entry === "separator") {
      const separator = document.createElement("div");
      separator.className = "context-menu-separator";
      menu.append(separator);
    } else {
      menu.append(buildItem(entry, close));
    }
  }
  document.body.append(menu);

  // Clamp inside the viewport once the size is known.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;

  function onMouseDown(event: MouseEvent): void {
    if (!(event.target instanceof Node) || !menu.contains(event.target)) {
      close();
    }
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }
  function close(): void {
    activeClose = null;
    window.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("keydown", onKeydown, true);
    menu.remove();
  }
  activeClose = close;
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("keydown", onKeydown, true);
}

/**
 * Minimal one-field prompt modal (rename…): resolves with the trimmed
 * value on Enter/accept, or null when cancelled.
 */
export function openPromptModal(options: {
  title: string;
  initial: string;
  acceptLabel: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const modal = document.createElement("div");
    modal.className = "prompt-modal";
    const heading = document.createElement("div");
    heading.className = "prompt-modal-title";
    heading.textContent = options.title;
    const input = document.createElement("input");
    input.className = "prompt-modal-input";
    input.type = "text";
    input.value = options.initial;
    input.spellcheck = false;
    const accept = document.createElement("button");
    accept.className = "prompt-modal-accept";
    accept.textContent = options.acceptLabel;
    modal.append(heading, input, accept);
    overlay.append(modal);
    document.body.append(overlay);
    input.focus();
    input.select();

    function finish(value: string | null): void {
      window.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      resolve(value);
    }
    function onKeydown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        finish(input.value.trim() === "" ? null : input.value.trim());
      }
    }
    window.addEventListener("keydown", onKeydown, true);
    overlay.addEventListener("mousedown", (event) => {
      if (event.target === overlay) {
        finish(null);
      }
    });
    accept.addEventListener("click", () => {
      finish(input.value.trim() === "" ? null : input.value.trim());
    });
  });
}
