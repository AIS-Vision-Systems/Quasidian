// Reading mode view: rendered HTML from the shared Lezer tree, read-only
// except task-list checkboxes. Internal links navigate with the same
// resolution logic as the editor; external links open in the system
// browser.
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderToHtml } from "../markdown/render";
import {
  fillEmbedImages,
  highlightCodeBlocks,
  renderMathElements,
} from "./renderedContent";

export interface ReadingViewHooks {
  onInternalLink(target: string): void;
  /** `pos` is the document offset of the "[ ]"/"[x]" task marker. */
  onTaskToggle(pos: number, checked: boolean): void;
  /** Resolves an embed target to a loadable URL, or null if unknown. */
  resolveEmbedSrc(target: string): string | null;
  /** Renders a note embed target to HTML, or null if unknown. */
  renderEmbedNote(target: string): Promise<string | null>;
}

export interface ReadingViewHandle {
  element: HTMLElement;
  render(doc: string): void;
}

export function createReadingView(hooks: ReadingViewHooks): ReadingViewHandle {
  const element = document.createElement("div");
  element.className = "reading-view is-hidden";
  const content = document.createElement("div");
  content.className = "reading-view-content markdown-rendered";
  element.append(content);

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
      content.innerHTML = renderToHtml(doc);
      fillEmbedImages(content, hooks.resolveEmbedSrc);
      for (const embed of content.querySelectorAll<HTMLElement>(
        "span.embed-note",
      )) {
        const target = embed.dataset.target ?? "";
        void hooks.renderEmbedNote(target).then((html) => {
          if (html === null || !embed.isConnected) {
            return;
          }
          embed.replaceChildren();
          const title = document.createElement("a");
          title.className = "internal-link embed-note-title";
          title.dataset.target = target;
          title.textContent = target;
          const body = document.createElement("div");
          body.className = "embed-note-body markdown-rendered";
          body.innerHTML = html;
          fillEmbedImages(body, hooks.resolveEmbedSrc);
          highlightCodeBlocks(body);
          renderMathElements(body);
          embed.append(title, body);
        });
      }
      highlightCodeBlocks(content);
      renderMathElements(content);
    },
  };
}
