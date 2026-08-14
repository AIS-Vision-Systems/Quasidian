// Page-preview popup: hovering a wikilink (reading mode) or
// Ctrl-hovering it (editing mode) shows the linked note — or its
// section, when the link carries an anchor — rendered through the same
// pipeline as everything else. Single instance; stays open while the
// pointer is over it.
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

let popup: HTMLElement | null = null;
let currentTarget: string | null = null;
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

export function hideHoverPreview(): void {
  cancelTimers();
  popup?.remove();
  popup = null;
  currentTarget = null;
}

async function show(
  x: number,
  y: number,
  target: string,
  hooks: EmbedFillHooks,
): Promise<void> {
  const result = await hooks.renderEmbedNote(target);
  if (result === null) {
    return;
  }
  hideHoverPreview();
  currentTarget = target;
  popup = document.createElement("div");
  popup.className = "hover-preview";
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
  popup.append(body);
  popup.addEventListener("mouseenter", cancelTimers);
  popup.addEventListener("mouseleave", () => scheduleHoverHide());
  document.body.append(popup);
  const rect = popup.getBoundingClientRect();
  const left = Math.max(
    8,
    Math.min(x + 12, window.innerWidth - rect.width - 8),
  );
  let top = y + 16;
  if (top + rect.height > window.innerHeight - 8) {
    top = Math.max(8, y - rect.height - 12);
  }
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

/** Shows the preview after a short delay; re-hovers keep it alive. */
export function scheduleHoverShow(
  x: number,
  y: number,
  target: string,
  hooks: EmbedFillHooks,
): void {
  if (popup !== null && currentTarget === target) {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    return;
  }
  cancelTimers();
  showTimer = setTimeout(() => {
    showTimer = null;
    void show(x, y, target, hooks);
  }, 300);
}

export function scheduleHoverHide(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (popup !== null && hideTimer === null) {
    hideTimer = setTimeout(() => {
      hideTimer = null;
      hideHoverPreview();
    }, 250);
  }
}
