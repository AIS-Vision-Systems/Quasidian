// One pointer-driven drag for the app chrome: tabs and the file tree
// (m52). HTML5 drag and drop is not an option — the webview's native
// drag and drop intercepts it — so a drag is a mouse press that moves
// past a threshold, followed until the button is released.

export interface PointerDragHandlers {
  /** Every pointer move once the press has become a drag. */
  onMove(event: MouseEvent): void;
  /** The button was released after a real drag. */
  onDrop(event: MouseEvent): void;
  /** The button was released without ever dragging: a plain click. */
  onClick?(): void;
  /**
   * Clean-up, exactly once: before `onDrop` or `onClick`, or alone
   * when Escape cancels the drag. Remove markers here.
   */
  onEnd?(): void;
}

export interface PointerDragOptions {
  /** Distance, in pixels, before a press becomes a drag. Default 5. */
  threshold?: number;
  /** "x": only horizontal movement starts the drag (a tab strip). */
  axis?: "x" | "both";
  /** Text of a small label that follows the pointer while dragging. */
  ghostLabel?: string;
}

/**
 * Follows the mouse from a `mousedown` until the button is released.
 * The click that the browser fires after a drag is swallowed, so a
 * drop never also activates what lies under the pointer.
 */
export function startPointerDrag(
  start: MouseEvent,
  handlers: PointerDragHandlers,
  options: PointerDragOptions = {},
): void {
  const threshold = options.threshold ?? 5;
  let dragging = false;
  let ghost: HTMLElement | null = null;

  const stop = (): void => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("keydown", onKey, true);
    ghost?.remove();
    ghost = null;
    document.body.classList.remove("is-pointer-dragging");
    handlers.onEnd?.();
  };

  const swallowClick = (): void => {
    const swallow = (event: MouseEvent): void => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    // No click follows a release outside the pressed element.
    window.setTimeout(
      () => window.removeEventListener("click", swallow, { capture: true }),
      0,
    );
  };

  function onMove(event: MouseEvent): void {
    if (!dragging) {
      const dx = event.clientX - start.clientX;
      const dy = event.clientY - start.clientY;
      const moved =
        options.axis === "x" ? Math.abs(dx) : Math.hypot(dx, dy);
      if (moved < threshold) {
        return;
      }
      dragging = true;
      document.body.classList.add("is-pointer-dragging");
      if (options.ghostLabel !== undefined) {
        ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.textContent = options.ghostLabel;
        document.body.append(ghost);
      }
    }
    if (ghost !== null) {
      ghost.style.left = `${event.clientX + 12}px`;
      ghost.style.top = `${event.clientY + 14}px`;
    }
    handlers.onMove(event);
  }

  function onUp(event: MouseEvent): void {
    const wasDragging = dragging;
    stop();
    if (wasDragging) {
      swallowClick();
      handlers.onDrop(event);
    } else {
      handlers.onClick?.();
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !dragging) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // The button is still down: its release must not act as a click.
    window.addEventListener("mouseup", swallowClick, { once: true });
    stop();
  }

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  window.addEventListener("keydown", onKey, true);
}
