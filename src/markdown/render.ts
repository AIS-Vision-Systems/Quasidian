// Pure module: no Tauri, no DOM. Renders markdown to an HTML string by
// walking the shared Lezer tree — never a second parser. Syntax marks are
// omitted; text content is always escaped (raw HTML in the source is
// rendered as escaped text, not injected).
import type { SyntaxNode } from "@lezer/common";
import { markdownParser } from "./parser";
import { isImageTarget } from "./wikilinks";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Mark/metadata nodes that produce no output of their own. */
const SKIP = new Set([
  "HeaderMark",
  "QuoteMark",
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "ListMark",
  "LinkMark",
  "WikilinkMark",
  "TableDelimiter",
  "CodeInfo",
  "CodeText",
  "LinkTitle",
  "LinkLabel",
  "LinkReference",
]);

const INLINE_WRAPPERS: Record<string, [string, string]> = {
  Paragraph: ["<p>", "</p>"],
  StrongEmphasis: ["<strong>", "</strong>"],
  Emphasis: ["<em>", "</em>"],
  Strikethrough: ["<del>", "</del>"],
};

const BLOCK_WRAPPERS: Record<string, [string, string]> = {
  Blockquote: ["<blockquote>", "</blockquote>"],
  BulletList: ["<ul>", "</ul>"],
  OrderedList: ["<ol>", "</ol>"],
};

const HEADING_LEVELS: Record<string, number> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

/** Emits the node's inline content in [from, to]: text plus child elements. */
function renderInline(
  node: SyntaxNode,
  from: number,
  to: number,
  doc: string,
  out: string[],
): void {
  let pos = from;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.from >= to || child.to <= from) {
      continue;
    }
    if (child.from > pos) {
      out.push(escapeHtml(doc.slice(pos, child.from)));
    }
    renderNode(child, doc, out);
    pos = child.to;
  }
  if (pos < to) {
    out.push(escapeHtml(doc.slice(pos, to)));
  }
}

function renderBlockChildren(node: SyntaxNode, doc: string, out: string[]): void {
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    renderNode(child, doc, out);
  }
}

function renderHeading(
  node: SyntaxNode,
  level: number,
  doc: string,
  out: string[],
): void {
  const marks = node.getChildren("HeaderMark");
  let from = node.from;
  let to = node.to;
  const first = marks[0];
  if (first !== undefined && first.from === node.from) {
    // ATX: skip the leading marks and one following space.
    from = doc[first.to] === " " ? first.to + 1 : first.to;
  }
  const last = marks[marks.length - 1];
  if (last !== undefined && last.to === node.to) {
    // ATX closing marks or the setext underline line.
    to = last.from;
    while (to > from && /\s/.test(doc[to - 1])) {
      to--;
    }
  }
  out.push(`<h${level}>`);
  renderInline(node, from, to, doc, out);
  out.push(`</h${level}>`);
}

function renderTableRow(
  row: SyntaxNode,
  cellTag: "th" | "td",
  doc: string,
  out: string[],
): void {
  out.push("<tr>");
  for (let cell = row.firstChild; cell !== null; cell = cell.nextSibling) {
    if (cell.name === "TableCell") {
      out.push(`<${cellTag}>`);
      renderInline(cell, cell.from, cell.to, doc, out);
      out.push(`</${cellTag}>`);
    }
  }
  out.push("</tr>");
}

function renderNode(node: SyntaxNode, doc: string, out: string[]): void {
  const name = node.name;
  if (SKIP.has(name)) {
    return;
  }

  const headingLevel = HEADING_LEVELS[name];
  if (headingLevel !== undefined) {
    renderHeading(node, headingLevel, doc, out);
    return;
  }

  const inlineWrapper = INLINE_WRAPPERS[name];
  if (inlineWrapper !== undefined) {
    out.push(inlineWrapper[0]);
    renderInline(node, node.from, node.to, doc, out);
    out.push(inlineWrapper[1]);
    return;
  }

  const blockWrapper = BLOCK_WRAPPERS[name];
  if (blockWrapper !== undefined) {
    out.push(blockWrapper[0]);
    renderBlockChildren(node, doc, out);
    out.push(blockWrapper[1]);
    return;
  }

  switch (name) {
    case "ListItem": {
      const isTask = node.getChild("Task") !== null;
      out.push(isTask ? '<li class="task-list-item">' : "<li>");
      renderBlockChildren(node, doc, out);
      out.push("</li>");
      return;
    }
    case "Task":
      renderInline(node, node.from, node.to, doc, out);
      return;
    case "TaskMarker": {
      const checked = doc
        .slice(node.from, node.to)
        .toLowerCase()
        .includes("x");
      out.push(
        `<input type="checkbox" class="task-checkbox" data-pos="${node.from}"${
          checked ? " checked" : ""
        }>`,
      );
      return;
    }
    case "InlineCode": {
      const marks = node.getChildren("CodeMark");
      const from = marks[0]?.to ?? node.from;
      const to = marks[marks.length - 1]?.from ?? node.to;
      out.push("<code>", escapeHtml(doc.slice(from, to)), "</code>");
      return;
    }
    case "FencedCode": {
      const codeText = node.getChild("CodeText");
      const info = node.getChild("CodeInfo");
      const code = codeText === null ? "" : doc.slice(codeText.from, codeText.to);
      const lang = info === null ? "" : doc.slice(info.from, info.to);
      out.push(
        lang === ""
          ? "<pre><code>"
          : `<pre><code class="language-${escapeHtml(lang)}">`,
      );
      out.push(escapeHtml(code), "</code></pre>");
      return;
    }
    case "CodeBlock": {
      const code = doc
        .slice(node.from, node.to)
        .split("\n")
        .map((line) => line.replace(/^(?: {4}|\t)/, ""))
        .join("\n");
      out.push("<pre><code>", escapeHtml(code), "</code></pre>");
      return;
    }
    case "HorizontalRule":
      out.push("<hr>");
      return;
    case "Link": {
      const urlNode = node.getChild("URL");
      const url = urlNode === null ? "" : doc.slice(urlNode.from, urlNode.to);
      const marks = node.getChildren("LinkMark");
      const from = marks[0]?.to ?? node.from;
      const to = marks[1]?.from ?? node.to;
      const isExternal = /^[a-z][a-z0-9+.-]*:/i.test(url);
      out.push(
        isExternal
          ? `<a class="external-link" href="${escapeHtml(url)}">`
          : `<a class="internal-link" data-target="${escapeHtml(url)}">`,
      );
      renderInline(node, from, to, doc, out);
      out.push("</a>");
      return;
    }
    case "Image": {
      const urlNode = node.getChild("URL");
      const url = urlNode === null ? "" : doc.slice(urlNode.from, urlNode.to);
      const marks = node.getChildren("LinkMark");
      const from = marks[0]?.to ?? node.from;
      const to = marks[1]?.from ?? node.to;
      out.push(
        `<img src="${escapeHtml(url)}" alt="${escapeHtml(doc.slice(from, to))}">`,
      );
      return;
    }
    case "Autolink": {
      const urlNode = node.getChild("URL");
      const url =
        urlNode === null
          ? doc.slice(node.from, node.to).replace(/^<|>$/g, "")
          : doc.slice(urlNode.from, urlNode.to);
      out.push(
        `<a class="external-link" href="${escapeHtml(url)}">${escapeHtml(url)}</a>`,
      );
      return;
    }
    case "URL": {
      const url = doc.slice(node.from, node.to);
      out.push(
        `<a class="external-link" href="${escapeHtml(url)}">${escapeHtml(url)}</a>`,
      );
      return;
    }
    case "Wikilink":
    case "Embed": {
      const pathNode = node.getChild("WikilinkPath");
      const aliasNode = node.getChild("WikilinkAlias");
      const target = pathNode === null ? "" : doc.slice(pathNode.from, pathNode.to);
      const display =
        aliasNode === null ? target : doc.slice(aliasNode.from, aliasNode.to);
      if (name === "Embed" && isImageTarget(target)) {
        // The src stays unresolved here (pure module); the reading view
        // fills it in through its resolveEmbedSrc hook.
        out.push(
          `<img class="internal-embed" data-target="${escapeHtml(target)}" alt="${escapeHtml(display)}">`,
        );
        return;
      }
      if (name === "Embed") {
        // Placeholder for note transclusion; the reading view fills it in
        // (depth 1 — nested embeds inside stay as placeholders).
        out.push(
          `<span class="internal-embed embed-note" data-target="${escapeHtml(target)}">${escapeHtml(display)}</span>`,
        );
        return;
      }
      out.push(
        `<a class="internal-link" data-target="${escapeHtml(target)}">${escapeHtml(display)}</a>`,
      );
      return;
    }
    case "Table": {
      out.push("<table>");
      const header = node.getChild("TableHeader");
      if (header !== null) {
        out.push("<thead>");
        renderTableRow(header, "th", doc, out);
        out.push("</thead>");
      }
      const rows = node.getChildren("TableRow");
      if (rows.length > 0) {
        out.push("<tbody>");
        for (const row of rows) {
          renderTableRow(row, "td", doc, out);
        }
        out.push("</tbody>");
      }
      out.push("</table>");
      return;
    }
    case "HardBreak":
      out.push("<br>");
      return;
    case "Escape":
      out.push(escapeHtml(doc.slice(node.from + 1, node.to)));
      return;
    case "Entity":
      out.push(doc.slice(node.from, node.to));
      return;
    case "HTMLBlock":
      out.push("<p>", escapeHtml(doc.slice(node.from, node.to)), "</p>");
      return;
    case "HTMLTag":
    case "CommentBlock":
      out.push(escapeHtml(doc.slice(node.from, node.to)));
      return;
    default:
      // Unknown node: keep its inline content so no text is ever lost.
      renderInline(node, node.from, node.to, doc, out);
  }
}

export function renderToHtml(doc: string): string {
  const tree = markdownParser.parse(doc);
  const out: string[] = [];
  for (
    let child = tree.topNode.firstChild;
    child !== null;
    child = child.nextSibling
  ) {
    renderNode(child, doc, out);
  }
  return out.join("");
}
