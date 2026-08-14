// Reading mode view: rendered HTML from the shared Lezer tree, read-only
// except task-list checkboxes. Internal links navigate with the same
// resolution logic as the editor; external links open in the system
// browser.
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  arePropertiesCollapsed,
  setPropertiesCollapsed,
} from "../editor/livePreview";
import { renderToHtml } from "../markdown/render";
import { createIcon } from "./icons";
import {
  scheduleHoverHide,
  scheduleHoverShow,
} from "./hoverPreview";
import {
  addCodePills,
  fillEmbedImages,
  fillEmbedNotes,
  highlightCodeBlocks,
  markUnresolvedLinks,
  renderMathElements,
  type EmbedNoteResult,
} from "./renderedContent";

export interface ReadingViewHooks {
  onInternalLink(target: string): void;
  /** `pos` is the document offset of the "[ ]"/"[x]" task marker. */
  onTaskToggle(pos: number, checked: boolean): void;
  /** Resolves an embed target to a loadable URL, or null if unknown. */
  resolveEmbedSrc(target: string): string | null;
  /** Renders a note embed target (and resolved path), or null. */
  renderEmbedNote(target: string): Promise<EmbedNoteResult | null>;
  /** Whether a wikilink target points to an existing note. */
  isResolved(target: string): boolean;
  /** Path of the open file, for transclusion cycle detection. */
  currentFilePath(): string | null;
  /** Foldability and fold state of the section at a doc position. */
  foldInfoAt(pos: number): { folded: boolean } | null;
  /** Toggles the fold of the section at a doc position. */
  onToggleFold(pos: number): void;
  /** Whether reading mode shows the properties box (settings). */
  showProperties(): boolean;
}

export interface ReadingViewHandle {
  element: HTMLElement;
  render(doc: string): void;
}

/** Hides a folded heading's section: siblings up to the next peer. */
function applyHeadingFold(heading: HTMLElement, level: number): void {
  for (
    let el = heading.nextElementSibling;
    el !== null;
    el = el.nextElementSibling
  ) {
    const match = /^H([1-6])$/.exec(el.tagName);
    if (match !== null && Number(match[1]) <= level) {
      break;
    }
    el.classList.add("is-fold-hidden");
  }
}

/** Chevrons + hidden sections for headings and list items with children. */
function setupSectionFolds(
  content: HTMLElement,
  hooks: ReadingViewHooks,
): void {
  const targets = content.querySelectorAll<HTMLElement>(
    "h1[data-pos], h2[data-pos], h3[data-pos], h4[data-pos], h5[data-pos], h6[data-pos], li[data-pos]",
  );
  for (const el of targets) {
    const pos = Number(el.dataset.pos);
    if (!Number.isFinite(pos)) {
      continue;
    }
    const info = hooks.foldInfoAt(pos);
    if (info === null) {
      continue;
    }
    el.classList.add("is-foldable");
    const chevron = document.createElement("span");
    chevron.className = info.folded
      ? "reading-fold-chevron is-folded"
      : "reading-fold-chevron";
    chevron.append(createIcon(info.folded ? "chevron-right" : "chevron-down"));
    chevron.addEventListener("click", (event) => {
      event.stopPropagation();
      hooks.onToggleFold(pos);
    });
    el.prepend(chevron);
    if (info.folded) {
      const headingMatch = /^H([1-6])$/.exec(el.tagName);
      if (headingMatch !== null) {
        applyHeadingFold(el, Number(headingMatch[1]));
      } else {
        for (const list of el.querySelectorAll(":scope > ul, :scope > ol")) {
          list.classList.add("is-fold-hidden");
        }
      }
    }
  }
}

export function createReadingView(hooks: ReadingViewHooks): ReadingViewHandle {
  const element = document.createElement("div");
  element.className = "reading-view is-hidden";
  const content = document.createElement("div");
  content.className = "reading-view-content markdown-rendered";
  element.append(content);

  // Hovering an internal link previews the note (or section).
  element.addEventListener("mouseover", (event) => {
    const target = event.target;
    const link =
      target instanceof Element ? target.closest("a.internal-link") : null;
    if (link instanceof HTMLElement && link.dataset.target !== undefined) {
      scheduleHoverShow(event.clientX, event.clientY, link.dataset.target, {
        resolveEmbedSrc: hooks.resolveEmbedSrc,
        renderEmbedNote: hooks.renderEmbedNote,
        isResolved: hooks.isResolved,
        onNavigate: hooks.onInternalLink,
      });
    }
  });
  element.addEventListener("mouseout", (event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("a.internal-link") !== null
    ) {
      scheduleHoverHide();
    }
  });

  element.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const link = target.closest("a");
    if (link !== null) {
      event.preventDefault();
      const internal = link.getAttribute("data-target");
      if (internal !== null) {
        hooks.onInternalLink(internal);
        return;
      }
      const href = link.getAttribute("href");
      if (href !== null && /^https?:\/\//i.test(href)) {
        void openUrl(href);
      }
      return;
    }
    if (
      target instanceof HTMLInputElement &&
      target.classList.contains("task-checkbox")
    ) {
      const pos = Number(target.dataset.pos);
      if (Number.isFinite(pos)) {
        hooks.onTaskToggle(pos, target.checked);
      }
    }
  });

  return {
    element,
    render(doc: string): void {
      content.innerHTML = renderToHtml(doc, {
        properties: hooks.showProperties(),
      });
      fillEmbedImages(content, hooks.resolveEmbedSrc);
      const currentPath = hooks.currentFilePath();
      fillEmbedNotes(
        content,
        {
          resolveEmbedSrc: hooks.resolveEmbedSrc,
          renderEmbedNote: hooks.renderEmbedNote,
          isResolved: hooks.isResolved,
        },
        new Set(currentPath === null ? [] : [currentPath.toLowerCase()]),
      );
      markUnresolvedLinks(content, hooks.isResolved);
      highlightCodeBlocks(content);
      addCodePills(content);
      renderMathElements(content);
      setupSectionFolds(content, hooks);
      // The note's own properties box collapses here too, sharing the
      // editor state (embeds toggle locally via wirePropertiesCollapse).
      const props = content.querySelector<HTMLElement>(
        ":scope > .frontmatter-props",
      );
      if (props !== null) {
        props.classList.toggle("is-collapsed", arePropertiesCollapsed());
        props
          .querySelector<HTMLElement>(".props-header")
          ?.addEventListener("click", () => {
            const collapsed = !arePropertiesCollapsed();
            setPropertiesCollapsed(collapsed);
            props.classList.toggle("is-collapsed", collapsed);
          });
      }
    },
  };
}
