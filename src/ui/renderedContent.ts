// Shared post-processing for HTML produced by renderToHtml: resolving
// embed image sources and syntax-highlighting code blocks. Used by the
// reading view and by the editor's embed/table widgets.
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import katex from "katex";
import { t } from "../i18n/i18n";
import { createIcon } from "./icons";

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

/** Clipboard write with a fallback for webviews without the async API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let copied: boolean;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }
}

/**
 * Rounded language pill sitting on a code block's top-right corner;
 * clicking it copies the block. Shared by reading mode and the editor's
 * Live Preview widget. An empty label falls back to a copy glyph.
 */
export function createCodePill(
  label: string,
  code: () => string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-lang-pill";
  const showLabel = () => {
    if (label === "") {
      button.replaceChildren(createIcon("copy"));
    } else {
      button.textContent = label;
    }
  };
  showLabel();
  button.title = t("reading.copyCode");
  button.setAttribute("aria-label", t("reading.copyCode"));
  // Keep the editor selection where it is when the pill is clicked.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    void copyText(code()).then((copied) => {
      if (!copied) {
        return;
      }
      button.textContent = t("reading.codeCopied");
      setTimeout(showLabel, 1500);
    });
  });
  return button;
}

/** Adds the copy pill to every code block under `root`. */
export function addCodePills(root: HTMLElement): void {
  for (const pre of root.querySelectorAll<HTMLPreElement>("pre")) {
    if (pre.querySelector(".code-lang-pill") !== null) {
      continue;
    }
    const code = pre.querySelector("code");
    if (code === null) {
      continue;
    }
    pre.append(
      createCodePill(pre.dataset.lang ?? "", () => code.textContent ?? ""),
    );
  }
}

export interface EmbedNoteResult {
  html: string;
  /** Resolved path, used for transclusion cycle detection. */
  path: string;
}

export interface EmbedFillHooks {
  resolveEmbedSrc(target: string): string | null;
  renderEmbedNote(target: string): Promise<EmbedNoteResult | null>;
  isResolved(target: string): boolean;
  /** Called when async content lands (editor re-measure). */
  onRendered?(): void;
}

/** Dims internal links whose note does not exist. */
export function markUnresolvedLinks(
  root: HTMLElement,
  isResolved: (target: string) => boolean,
): void {
  for (const link of root.querySelectorAll<HTMLElement>("a.internal-link")) {
    const target = link.dataset.target;
    if (target !== undefined) {
      link.classList.toggle("is-unresolved", !isResolved(target));
    }
  }
}

const MAX_EMBED_DEPTH = 4;

/**
 * Fills note-embed placeholders recursively: each level renders through
 * the shared pipeline and recurses into its own embeds, stopping at
 * MAX_EMBED_DEPTH or when a note already appears in the chain (cycle).
 * Stopped placeholders keep their target text, dimmed.
 */
export function fillEmbedNotes(
  root: HTMLElement,
  hooks: EmbedFillHooks,
  visited: ReadonlySet<string>,
  depth = 0,
): void {
  for (const embed of root.querySelectorAll<HTMLElement>("span.embed-note")) {
    const target = embed.dataset.target ?? "";
    void hooks.renderEmbedNote(target).then((result) => {
      if (result === null || !embed.isConnected) {
        return;
      }
      const key = result.path.toLowerCase();
      if (depth >= MAX_EMBED_DEPTH || visited.has(key)) {
        embed.classList.add("embed-cycle");
        return;
      }
      embed.replaceChildren();
      const title = document.createElement("a");
      title.className = "internal-link embed-note-title";
      title.dataset.target = target;
      title.textContent = target;
      const body = document.createElement("div");
      body.className = "embed-note-body markdown-rendered";
      body.innerHTML = result.html;
      fillEmbedImages(body, hooks.resolveEmbedSrc);
      highlightCodeBlocks(body);
      addCodePills(body);
      renderMathElements(body);
      wirePropertiesCollapse(body);
      markUnresolvedLinks(body, hooks.isResolved);
      if (hooks.onRendered !== undefined) {
        for (const image of body.querySelectorAll("img")) {
          image.addEventListener("load", hooks.onRendered);
        }
      }
      embed.append(title, body);
      fillEmbedNotes(body, hooks, new Set([...visited, key]), depth + 1);
      hooks.onRendered?.();
    });
  }
}

/** Local collapse toggling for properties boxes (embedded notes). */
export function wirePropertiesCollapse(root: HTMLElement): void {
  for (const props of root.querySelectorAll<HTMLElement>(
    ".frontmatter-props",
  )) {
    props
      .querySelector<HTMLElement>(".props-header")
      ?.addEventListener("click", () => {
        props.classList.toggle("is-collapsed");
      });
  }
}

/** Replaces math placeholders with KaTeX output; errors render as text. */
export function renderMathElements(root: HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>(
    ".math-inline, .math-block",
  )) {
    el.innerHTML = katex.renderToString(el.dataset.tex ?? "", {
      throwOnError: false,
      displayMode: el.classList.contains("math-block"),
    });
  }
}
