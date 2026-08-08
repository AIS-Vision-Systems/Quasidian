// Reading mode view: rendered HTML from the shared Lezer tree, read-only
// except task-list checkboxes. Internal links navigate with the same
// resolution logic as the editor; external links open in the system
// browser.
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderToHtml } from "../markdown/render";

export interface ReadingViewHooks {
  onInternalLink(target: string): void;
  /** `pos` is the document offset of the "[ ]"/"[x]" task marker. */
  onTaskToggle(pos: number, checked: boolean): void;
  /** Resolves an embed target to a loadable URL, or null if unknown. */
  resolveEmbedSrc(target: string): string | null;
  /** Renders a note embed target to HTML, or null if unknown. */
  renderEmbedNote(target: string): Promise<string | null>;
}

/** Best-effort async syntax highlighting; unknown languages stay plain. */
async function highlightBlock(codeEl: HTMLElement, langName: string): Promise<void> {
  const description = LanguageDescription.matchLanguageName(
    languages,
    langName,
    true,
  );
  if (description === null) {
    return;
  }
  const support = await description.load().catch(() => null);
  if (support === null) {
    return;
  }
  const code = codeEl.textContent ?? "";
  const tree = support.language.parser.parse(code);
  const fragment = document.createDocumentFragment();
  highlightCode(
    code,
    tree,
    classHighlighter,
    (text, classes) => {
      if (classes === "") {
        fragment.append(document.createTextNode(text));
      } else {
        const span = document.createElement("span");
        span.className = classes;
        span.textContent = text;
        fragment.append(span);
      }
    },
    () => {
      fragment.append(document.createTextNode("\n"));
    },
  );
  codeEl.replaceChildren(fragment);
}

export interface ReadingViewHandle {
  element: HTMLElement;
  render(doc: string): void;
}

export function createReadingView(hooks: ReadingViewHooks): ReadingViewHandle {
  const element = document.createElement("div");
  element.className = "reading-view is-hidden";
  const content = document.createElement("div");
  content.className = "reading-view-content";
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
      for (const image of content.querySelectorAll<HTMLImageElement>(
        "img.internal-embed",
      )) {
        const target = image.dataset.target ?? "";
        const src = hooks.resolveEmbedSrc(target);
        if (src === null) {
          const missing = document.createElement("span");
          missing.className = "embed-missing";
          missing.textContent = target;
          image.replaceWith(missing);
        } else {
          image.src = src;
        }
      }
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
          body.className = "embed-note-body";
          body.innerHTML = html;
          embed.append(title, body);
        });
      }
      for (const codeEl of content.querySelectorAll<HTMLElement>(
        'pre > code[class*="language-"]',
      )) {
        const match = /language-(\S+)/.exec(codeEl.className);
        if (match !== null) {
          void highlightBlock(codeEl, match[1]);
        }
      }
    },
  };
}
