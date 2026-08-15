// Export to PDF: renders the note through the shared reading pipeline
// into a print-only subtree and hands it to the WebView's print/PDF
// dialog (WebView2 on Windows, webkit on Ubuntu). The note name becomes
// the document title, so the dialog proposes it as the PDF filename.
import {
  fillEmbedImages,
  fillEmbedNotes,
  highlightCodeBlocks,
  markUnresolvedLinks,
  renderMathElements,
  type EmbedFillHooks,
} from "./renderedContent";
import { renderToHtml } from "../markdown/render";

/** Resolves once every image below `root` has loaded (or failed). */
function waitForImages(root: HTMLElement, timeoutMs: number): Promise<void> {
  const pending = [...root.querySelectorAll("img")].filter(
    (image) => !image.complete,
  );
  if (pending.length === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let remaining = pending.length;
    const timer = setTimeout(() => resolve(), timeoutMs);
    const done = (): void => {
      remaining--;
      if (remaining === 0) {
        clearTimeout(timer);
        resolve();
      }
    };
    for (const image of pending) {
      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
    }
  });
}

export interface PdfExportOptions {
  /** Note name without extension: printed title and proposed filename. */
  title: string;
  /** Markdown source of the note. */
  doc: string;
  hooks: EmbedFillHooks;
  showProperties: boolean;
  /** Path of the note, for transclusion cycle detection. */
  path: string | null;
}

export async function exportNoteToPdf(options: PdfExportOptions): Promise<void> {
  const root = document.createElement("div");
  root.className = "print-root markdown-rendered";
  const title = document.createElement("h1");
  title.className = "print-title";
  title.textContent = options.title;
  const content = document.createElement("div");
  content.innerHTML = renderToHtml(options.doc, {
    properties: options.showProperties,
  });
  root.append(title, content);

  fillEmbedImages(content, options.hooks.resolveEmbedSrc);
  fillEmbedNotes(
    content,
    options.hooks,
    new Set(options.path === null ? [] : [options.path.toLowerCase()]),
  );
  highlightCodeBlocks(content);
  renderMathElements(content);
  markUnresolvedLinks(content, options.hooks.isResolved);
  document.body.append(root);

  // Embeds fill asynchronously and have no completion signal: give them
  // a moment, then wait for the images they brought in.
  await new Promise((resolve) => setTimeout(resolve, 400));
  await waitForImages(root, 3000);

  const previousTitle = document.title;
  document.title = options.title;
  const cleanup = (): void => {
    if (root.isConnected) {
      root.remove();
    }
    document.title = previousTitle;
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
}
