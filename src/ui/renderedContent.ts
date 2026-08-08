// Shared post-processing for HTML produced by renderToHtml: resolving
// embed image sources and syntax-highlighting code blocks. Used by the
// reading view and by the editor's embed/table widgets.
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightCode } from "@lezer/highlight";

export function fillEmbedImages(
  root: HTMLElement,
  resolve: (target: string) => string | null,
): void {
  for (const image of root.querySelectorAll<HTMLImageElement>(
    "img.internal-embed",
  )) {
    const target = image.dataset.target ?? "";
    const src = resolve(target);
    if (src === null) {
      const missing = document.createElement("span");
      missing.className = "embed-missing";
      missing.textContent = target;
      image.replaceWith(missing);
    } else {
      image.src = src;
    }
  }
}

/** Best-effort async syntax highlighting; unknown languages stay plain. */
async function highlightBlock(
  codeEl: HTMLElement,
  langName: string,
): Promise<void> {
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

export function highlightCodeBlocks(root: HTMLElement): void {
  for (const codeEl of root.querySelectorAll<HTMLElement>(
    'pre > code[class*="language-"]',
  )) {
    const match = /language-(\S+)/.exec(codeEl.className);
    if (match !== null) {
      void highlightBlock(codeEl, match[1]);
    }
  }
}
