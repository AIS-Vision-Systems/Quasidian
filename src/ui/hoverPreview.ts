// Page-preview popups: hovering a wikilink (reading mode, embeds) or
// Ctrl-hovering it (editor text) shows the linked note — or section —
// rendered through the shared pipeline. Popups stack: hovering a link
// inside a popup opens a child without closing the parent; leaving all
// popups closes the whole chain. Unresolved targets show a
// "not created yet" message. Clicking a link inside a popup navigates.
import { ct as t } from "../lib/coreStrings";
import {
  addCodePills,
  fillEmbedImages,
  fillEmbedNotes,
  highlightCodeBlocks,
  markUnresolvedLinks,
  renderMathElements,
  wirePropertiesCollapse,
  type EmbedFillHooks,
} from "./renderedContent";

interface PopupEntry {
  element: HTMLElement;
  target: string;
}

const stack: PopupEntry[] = [];
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function cancelTimers(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/** Removes every popup at `level` or deeper. */
function trimStack(level: number): void {
  while (stack.length > level) {
    stack.pop()?.element.remove();
  }
}

export function hideHoverPreview(): void {
  cancelTimers();
  trimStack(0);
}

function positionPopup(element: HTMLElement, x: number, y: number): void {
  const rect = element.getBoundingClientRect();
  const left = Math.max(
    8,
    Math.min(x + 12, window.innerWidth - rect.width - 8),
  );
  let top = y + 16;
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, y - rect.height - 12);
  }
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function attachKeepAlive(element: HTMLElement): void {
  element.addEventListener("mouseenter", cancelTimers);
  element.addEventListener("mouseleave", () => scheduleHoverHide());
}

async function show(
  x: number,
  y: number,
  target: string,
  hooks: EmbedFillHooks,
  level: number,
): Promise<void> {
  const element = document.createElement("div");
  element.className = "hover-preview";
  if (!hooks.isResolved(target)) {
    element.classList.add("hover-preview-missing");
    element.textContent = t("preview.notCreated", { name: target });
  } else {
    const result = await hooks.renderEmbedNote(target);
    if (result === null) {
      return;
    }
    const body = document.createElement("div");
    body.className = "markdown-rendered";
    body.innerHTML = result.html;
    fillEmbedImages(body, hooks.resolveEmbedSrc);
    highlightCodeBlocks(body);
    addCodePills(body);
    renderMathElements(body);
    wirePropertiesCollapse(body);
    markUnresolvedLinks(body, hooks.isResolved);
    fillEmbedNotes(body, hooks, new Set([result.path.toLowerCase()]));
    // Hover chains: a link inside this popup opens a child popup.
    body.addEventListener("mouseover", (event) => {
      const hovered = event.target;
      const link =
        hovered instanceof Element
          ? hovered.closest("a.internal-link")
          : null;
      if (link instanceof HTMLElement && link.dataset.target !== undefined) {
        scheduleHoverShow(
          event.clientX,
          event.clientY,
          link.dataset.target,
          hooks,
          level + 1,
        );
      }
    });
    body.addEventListener("mouseout", (event) => {
      const hovered = event.target;
      if (
        hovered instanceof Element &&
        hovered.closest("a.internal-link") !== null &&
        showTimer !== null
      ) {
        clearTimeout(showTimer);
        showTimer = null;
      }
    });
    // Clicking a link navigates and closes the chain.
    body.addEventListener("click", (event) => {
      const clicked = event.target;
      const link =
        clicked instanceof Element
          ? clicked.closest("a.internal-link")
          : null;
      if (link instanceof HTMLElement && link.dataset.target !== undefined) {
        event.preventDefault();
        const clickedTarget = link.dataset.target;
        hideHoverPreview();
        hooks.onNavigate?.(clickedTarget);
      }
    });
    element.append(body);
  }
  trimStack(level);
  stack.push({ element, target });
  attachKeepAlive(element);
  document.body.append(element);
  positionPopup(element, x, y);
}

/**
 * Shows a popup with prebuilt HTML (footnote content, etc.) after the
 * same delay as note previews. `key` identifies the content so
 * re-hovering the same element keeps the popup alive.
 */
export function scheduleHtmlHover(
  x: number,
  y: number,
  key: string,
  html: string,
  level = 0,
): void {
  const target = `html:${key}`;
  const existing = stack[level];
  if (existing !== undefined && existing.target === target) {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    return;
  }
  cancelTimers();
  showTimer = setTimeout(() => {
    showTimer = null;
    const element = document.createElement("div");
    element.className = "hover-preview";
    const body = document.createElement("div");
    body.className = "markdown-rendered";
    body.innerHTML = html;
    element.append(body);
    trimStack(level);
    stack.push({ element, target });
    attachKeepAlive(element);
    document.body.append(element);
    positionPopup(element, x, y);
  }, 300);
}

/**
 * Shows a preview after a short delay. `level` 0 replaces the whole
 * chain; deeper levels stack under their parent popup.
 */
export function scheduleHoverShow(
  x: number,
  y: number,
  target: string,
  hooks: EmbedFillHooks,
  level = 0,
): void {
  const existing = stack[level];
  if (existing !== undefined && existing.target === target) {
    // Already showing this target at this level: just keep it alive.
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    return;
  }
  cancelTimers();
  showTimer = setTimeout(() => {
    showTimer = null;
    void show(x, y, target, hooks, level);
  }, 300);
}

/** Schedules closing the whole chain unless a popup is re-entered. */
export function scheduleHoverHide(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (stack.length > 0 && hideTimer === null) {
    hideTimer = setTimeout(() => {
      hideTimer = null;
      trimStack(0);
    }, 250);
  }
}
