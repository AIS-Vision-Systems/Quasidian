// Pure module: no Tauri, no DOM. Renders markdown to an HTML string by
// walking the shared Lezer tree — never a second parser. Syntax marks are
// omitted; text content is always escaped (raw HTML in the source is
// rendered as escaped text, not injected).
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { SyntaxNode } from "@lezer/common";
import { t } from "../i18n/i18n";
import {
  parseFrontmatter,
  type FrontmatterData,
} from "../lib/frontmatter";
import { iconMarkup } from "../ui/icons";
import { calloutColor, calloutIcon, parseCalloutHeader } from "./callouts";
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
  "HighlightMark",
  "MathMark",
  "FrontmatterMark",
]);

/** Icon for a property key: tags and aliases get their own glyphs. */
function propertyIcon(key: string): string {
  const lower = key.toLowerCase();
  if (lower === "tags" || lower === "tag") {
    return iconMarkup("tag");
  }
  if (lower === "aliases" || lower === "alias") {
    return iconMarkup("corner-up-right");
  }
  return iconMarkup("text");
}

/**
 * Properties block HTML shared by reading mode and the editor widget;
 * `interactive` adds the edit controls (remove, inline value inputs,
 * add-property row, collapse chevron) the widget wires up.
 */
export function renderPropertiesHtml(
  data: FrontmatterData,
  interactive: boolean,
  knownKeys: readonly string[] = [],
): string {
  if (data.properties.length === 0 && !interactive) {
    return "";
  }
  const out: string[] = ['<div class="frontmatter-props">'];
  out.push('<div class="props-header">');
  out.push(`<span class="props-chevron">${iconMarkup("chevron-down")}</span>`);
  out.push(
    `<span class="props-title">${escapeHtml(t("properties.title"))}</span>`,
  );
  out.push("</div>");
  out.push('<div class="props-body">');
  data.properties.forEach((property, propIndex) => {
    out.push('<div class="props-row">');
    out.push(
      `<span class="props-key"><span class="props-key-icon">${propertyIcon(property.key)}</span>${escapeHtml(property.key)}</span>`,
    );
    out.push('<span class="props-values">');
    property.values.forEach((value, valueIndex) => {
      if (property.isList) {
        out.push(`<span class="props-pill">${escapeHtml(value)}`);
        if (interactive) {
          out.push(
            `<button class="props-remove" data-prop="${propIndex}" data-value="${valueIndex}" aria-label="${escapeHtml(t("properties.remove"))}">×</button>`,
          );
        }
        out.push("</span>");
      } else if (interactive) {
        out.push(
          `<span class="props-value" data-prop="${propIndex}" data-value="${valueIndex}" title="${escapeHtml(t("properties.edit"))}">${escapeHtml(value)}</span>`,
        );
      } else {
        out.push(`<span class="props-value">${escapeHtml(value)}</span>`);
      }
    });
    if (interactive && property.isList) {
      out.push(
        `<input class="props-new-value" data-prop="${propIndex}" placeholder="${escapeHtml(t("properties.value"))}" spellcheck="false">`,
      );
    }
    out.push("</span></div>");
  });
  if (interactive) {
    // Known keys (tags/aliases first) as a datalist; free text still
    // works, and keys already present in the note are not offered.
    const present = new Set(
      data.properties.map((property) => property.key.toLowerCase()),
    );
    const ordered = [
      "tags",
      "aliases",
      ...knownKeys.filter(
        (key) => !["tags", "aliases"].includes(key.toLowerCase()),
      ),
    ].filter((key) => !present.has(key.toLowerCase()));
    const seen = new Set<string>();
    const options = ordered
      .filter((key) => {
        const lower = key.toLowerCase();
        if (seen.has(lower)) {
          return false;
        }
        seen.add(lower);
        return true;
      })
      .map((key) => `<option value="${escapeHtml(key)}"></option>`)
      .join("");
    out.push(
      '<div class="props-add-row is-hidden">' +
        `<input class="props-new-key" list="qs-prop-keys" placeholder="${escapeHtml(t("properties.name"))}" spellcheck="false">` +
        `<datalist id="qs-prop-keys">${options}</datalist>` +
        `<input class="props-new-first" placeholder="${escapeHtml(t("properties.value"))}" spellcheck="false">` +
        "</div>",
    );
    out.push(
      `<button class="props-add">+ ${escapeHtml(t("properties.add"))}</button>`,
    );
  }
  out.push("</div></div>");
  return out.join("");
}

const INLINE_WRAPPERS: Record<string, [string, string]> = {
  Paragraph: ["<p>", "</p>"],
  StrongEmphasis: ["<strong>", "</strong>"],
  Emphasis: ["<em>", "</em>"],
  Strikethrough: ["<del>", "</del>"],
  Highlight: ["<mark>", "</mark>"],
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

/**
 * Inline text: escaped, with soft line breaks rendered as real breaks —
 * Obsidian treats single newlines as line breaks, unlike strict
 * CommonMark, and the two modes must agree.
 */
function inlineText(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

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
      out.push(inlineText(doc.slice(pos, child.from)));
    }
    renderNode(child, doc, out);
    pos = child.to;
  }
  if (pos < to) {
    out.push(inlineText(doc.slice(pos, to)));
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
  // data-pos lets reading mode map the heading back to the document
  // for section folding.
  out.push(`<h${level} data-pos="${node.from}">`);
  renderInline(node, from, to, doc, out);
  out.push(`</h${level}>`);
}

/** Column alignments from the GFM delimiter row (:---, :---:, ---:). */
export function tableAlignments(
  delimiter: string,
): ("left" | "center" | "right" | null)[] {
  return delimiter
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "")
    .map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      if (left && right) {
        return "center";
      }
      if (right) {
        return "right";
      }
      if (left) {
        return "left";
      }
      return null;
    });
}

function renderTableRow(
  row: SyntaxNode,
  cellTag: "th" | "td",
  doc: string,
  out: string[],
  alignments: ("left" | "center" | "right" | null)[],
): void {
  // Empty cells produce no TableCell node, so the pipes in the source
  // drive the row's shape and each span is matched to its node (if any).
  const text = doc.slice(row.from, row.to);
  const pipes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "|" && (i === 0 || text[i - 1] !== "\\")) {
      pipes.push(i);
    }
  }
  const spans: { from: number; to: number }[] = [];
  let start = 0;
  for (const pipe of pipes) {
    spans.push({ from: start, to: pipe });
    start = pipe + 1;
  }
  spans.push({ from: start, to: text.length });
  // A leading/trailing pipe delimits the row: the whitespace outside it
  // is not a cell.
  if (
    spans.length > 1 &&
    pipes.length > 0 &&
    text.slice(0, pipes[0]).trim() === ""
  ) {
    spans.shift();
  }
  if (spans.length > 0 && text.slice(spans[spans.length - 1].from).trim() === "") {
    spans.pop();
  }
  const cells: SyntaxNode[] = [];
  for (let cell = row.firstChild; cell !== null; cell = cell.nextSibling) {
    if (cell.name === "TableCell") {
      cells.push(cell);
    }
  }
  out.push("<tr>");
  spans.forEach((span, column) => {
    const alignment = alignments[column] ?? null;
    out.push(
      alignment === null
        ? `<${cellTag}>`
        : `<${cellTag} style="text-align:${alignment}">`,
    );
    const cell = cells.find(
      (candidate) =>
        candidate.from >= row.from + span.from &&
        candidate.to <= row.from + span.to,
    );
    if (cell !== undefined) {
      renderInline(cell, cell.from, cell.to, doc, out);
    }
    out.push(`</${cellTag}>`);
  });
  out.push("</tr>");
}

/** Renders `> [!type] Títol` blockquotes as callout boxes. */
function renderCallout(node: SyntaxNode, doc: string, out: string[]): boolean {
  const paragraph = node.getChild("Paragraph");
  if (paragraph === null) {
    return false;
  }
  const text = doc.slice(paragraph.from, paragraph.to);
  const newline = text.indexOf("\n");
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const header = parseCalloutHeader(firstLine);
  if (header === null) {
    return false;
  }
  const firstLineEnd =
    newline === -1 ? paragraph.to : paragraph.from + newline;
  let cls = "callout";
  if (header.fold !== null) {
    cls += " callout-foldable";
    if (header.fold === "-") {
      cls += " is-collapsed";
    }
  }
  const foldAttr =
    header.fold === null
      ? ""
      : ` data-fold-pos="${paragraph.from + header.signOffset}"`;
  out.push(
    `<div class="${cls}" data-callout="${escapeHtml(header.type)}"${foldAttr} style="--callout-color:${calloutColor(header.type)}">`,
  );
  out.push(
    `<div class="callout-title">${iconMarkup(calloutIcon(header.type))}<span class="callout-title-text">`,
  );
  if (header.title !== "") {
    renderInline(
      paragraph,
      paragraph.from + header.markerLength,
      firstLineEnd,
      doc,
      out,
    );
  } else {
    out.push(
      escapeHtml(
        header.type.charAt(0).toUpperCase() + header.type.slice(1),
      ),
    );
  }
  out.push("</span>");
  if (header.fold !== null) {
    out.push(`<span class="callout-fold">${iconMarkup("chevron-down")}</span>`);
  }
  out.push("</div>");
  out.push('<div class="callout-content">');
  if (firstLineEnd < paragraph.to) {
    out.push("<p>");
    renderInline(paragraph, firstLineEnd + 1, paragraph.to, doc, out);
    out.push("</p>");
  }
  for (
    let child = paragraph.nextSibling;
    child !== null;
    child = child.nextSibling
  ) {
    renderNode(child, doc, out);
  }
  out.push("</div></div>");
  return true;
}

function renderNode(node: SyntaxNode, doc: string, out: string[]): void {
  const name = node.name;
  if (SKIP.has(name)) {
    return;
  }
  if (name === "Blockquote" && renderCallout(node, doc, out)) {
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
    case "FootnoteRef": {
      const label = node.getChild("FootnoteLabel");
      const id =
        label === null ? "" : escapeHtml(doc.slice(label.from, label.to));
      const number = footnoteNumbers.get(id) ?? "?";
      out.push(
        `<sup class="footnote-ref"><a class="footnote-link" id="fnref-${id}" href="#fn-${id}">[${number}]</a></sup>`,
      );
      return;
    }
    case "FootnoteInline": {
      const number = inlineNoteNumbers.get(node.from) ?? "?";
      out.push(
        `<sup class="footnote-ref"><a class="footnote-link" id="fnref-i${number}" href="#fn-i${number}">[${number}]</a></sup>`,
      );
      return;
    }
    case "FootnoteDef":
      // Collected and rendered at the bottom of the note.
      return;
    case "Frontmatter": {
      if (renderProperties) {
        out.push(renderPropertiesHtml(parseFrontmatter(doc), false));
      }
      return;
    }
    case "ListItem": {
      const isTask = node.getChild("Task") !== null;
      out.push(
        isTask
          ? `<li class="task-list-item" data-pos="${node.from}">`
          : `<li data-pos="${node.from}">`,
      );
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
    case "InlineMath":
    case "MathBlock": {
      // TeX stays raw here (pure module); the view renders it with KaTeX.
      // math-block is a span so inline $$...$$ never breaks its paragraph.
      const marks = node.getChildren("MathMark");
      const from = marks[0]?.to ?? node.from;
      const to = marks.length > 1 ? marks[marks.length - 1].from : node.to;
      const tex = doc.slice(from, to).trim();
      const cls = name === "InlineMath" ? "math-inline" : "math-block";
      out.push(
        `<span class="${cls}" data-tex="${escapeHtml(tex)}">${escapeHtml(tex)}</span>`,
      );
      return;
    }
    case "FencedCode": {
      const codeText = node.getChild("CodeText");
      const info = node.getChild("CodeInfo");
      const code = codeText === null ? "" : doc.slice(codeText.from, codeText.to);
      const lang = info === null ? "" : doc.slice(info.from, info.to);
      if (lang === "") {
        out.push("<pre><code>");
      } else {
        const display =
          LanguageDescription.matchLanguageName(languages, lang, true)?.name ??
          lang;
        out.push(
          `<pre data-lang="${escapeHtml(display)}"><code class="language-${escapeHtml(lang)}">`,
        );
      }
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
        // The src stays unresolved here (pure module); the view fills it
        // in through its resolveEmbedSrc hook. A numeric alias sets the
        // display size, Obsidian-style: ![[img.png|50]] or |300x200.
        const dims = /^(\d+)(?:x(\d+))?$/.exec(display.trim());
        const size =
          dims === null
            ? ""
            : ` width="${dims[1]}"` +
              (dims[2] === undefined ? "" : ` height="${dims[2]}"`);
        const alt = dims === null ? display : target;
        out.push(
          `<img class="internal-embed" data-target="${escapeHtml(target)}" alt="${escapeHtml(alt)}"${size}>`,
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
      const delimiter = node.getChild("TableDelimiter");
      const alignments =
        delimiter === null
          ? []
          : tableAlignments(doc.slice(delimiter.from, delimiter.to));
      const header = node.getChild("TableHeader");
      if (header !== null) {
        out.push("<thead>");
        renderTableRow(header, "th", doc, out, alignments);
        out.push("</thead>");
      }
      const rows = node.getChildren("TableRow");
      if (rows.length > 0) {
        out.push("<tbody>");
        for (const row of rows) {
          renderTableRow(row, "td", doc, out, alignments);
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

// Whether the current render emits the properties box; single-threaded
// rendering keeps this a module flag instead of threading a parameter
// through every renderer.
let renderProperties = true;

// Footnote numbering for the current render: labels are numbered by
// first appearance (references first, then leftover definitions), and
// inline notes `^[…]` take the next number at their position.
let footnoteNumbers = new Map<string, number>();
let inlineNoteNumbers = new Map<number, number>();

/**
 * Content HTML of the definition for `label`, or of the inline note at
 * `notePos` — used by the footnote hover popups so both modes share the
 * render pipeline.
 */
export function renderFootnoteContent(
  doc: string,
  label: string | null,
  notePos?: number,
): string | null {
  const tree = markdownParser.parse(doc);
  let html: string | null = null;
  tree.iterate({
    enter(ref) {
      if (html !== null) {
        return false;
      }
      if (label !== null && ref.name === "FootnoteDef") {
        const node = ref.node;
        const labelNode = node.getChild("FootnoteLabel");
        if (
          labelNode === null ||
          doc.slice(labelNode.from, labelNode.to) !== label
        ) {
          return;
        }
        const marks = node.getChildren("FootnoteMark");
        let contentFrom = marks[1]?.to ?? node.from;
        if (doc[contentFrom] === " " || doc[contentFrom] === "\t") {
          contentFrom++;
        }
        const out: string[] = ["<p>"];
        renderInline(node, Math.min(contentFrom, node.to), node.to, doc, out);
        out.push("</p>");
        html = out.join("");
      } else if (
        label === null &&
        ref.name === "FootnoteInline" &&
        ref.from === notePos
      ) {
        const node = ref.node;
        const marks = node.getChildren("FootnoteMark");
        const from = marks[0]?.to ?? node.from;
        const to = marks[marks.length - 1]?.from ?? node.to;
        const out: string[] = ["<p>"];
        renderInline(node, from, to, doc, out);
        out.push("</p>");
        html = out.join("");
      }
    },
  });
  return html;
}

export function renderToHtml(
  doc: string,
  options?: { properties?: boolean },
): string {
  renderProperties = options?.properties ?? true;
  const tree = markdownParser.parse(doc);

  // Pre-scan: assign footnote numbers and collect definitions/inline
  // notes so they all render at the bottom, Obsidian-style.
  footnoteNumbers = new Map();
  inlineNoteNumbers = new Map();
  const defs: SyntaxNode[] = [];
  const inlineNotes: SyntaxNode[] = [];
  let next = 1;
  tree.iterate({
    enter(ref) {
      if (ref.name === "FootnoteRef") {
        const label = ref.node.getChild("FootnoteLabel");
        if (label !== null) {
          const id = escapeHtml(doc.slice(label.from, label.to));
          if (!footnoteNumbers.has(id)) {
            footnoteNumbers.set(id, next++);
          }
        }
      } else if (ref.name === "FootnoteInline") {
        inlineNoteNumbers.set(ref.from, next++);
        inlineNotes.push(ref.node);
      } else if (ref.name === "FootnoteDef") {
        defs.push(ref.node);
      }
    },
  });
  for (const def of defs) {
    const label = def.getChild("FootnoteLabel");
    if (label !== null) {
      const id = escapeHtml(doc.slice(label.from, label.to));
      if (!footnoteNumbers.has(id)) {
        footnoteNumbers.set(id, next++);
      }
    }
  }

  const out: string[] = [];
  for (
    let child = tree.topNode.firstChild;
    child !== null;
    child = child.nextSibling
  ) {
    renderNode(child, doc, out);
  }

  // Footnote section: every definition and inline note, in number order,
  // after a separator line.
  const entries: { number: number; html: string }[] = [];
  for (const def of defs) {
    const label = def.getChild("FootnoteLabel");
    const id =
      label === null ? "" : escapeHtml(doc.slice(label.from, label.to));
    const number = footnoteNumbers.get(id) ?? 0;
    const marks = def.getChildren("FootnoteMark");
    let contentFrom = marks[1]?.to ?? def.from;
    if (doc[contentFrom] === " " || doc[contentFrom] === "\t") {
      contentFrom++;
    }
    const parts: string[] = [
      `<li class="footnote-def" id="fn-${id}" value="${number}">`,
    ];
    renderInline(def, Math.min(contentFrom, def.to), def.to, doc, parts);
    parts.push(
      ` <a class="footnote-back" href="#fnref-${id}">↩</a></li>`,
    );
    entries.push({ number, html: parts.join("") });
  }
  for (const note of inlineNotes) {
    const number = inlineNoteNumbers.get(note.from) ?? 0;
    const marks = note.getChildren("FootnoteMark");
    const from = marks[0]?.to ?? note.from;
    const to = marks[marks.length - 1]?.from ?? note.to;
    const parts: string[] = [
      `<li class="footnote-def" id="fn-i${number}" value="${number}">`,
    ];
    renderInline(note, from, to, doc, parts);
    parts.push(
      ` <a class="footnote-back" href="#fnref-i${number}">↩</a></li>`,
    );
    entries.push({ number, html: parts.join("") });
  }
  if (entries.length > 0) {
    entries.sort((a, b) => a.number - b.number);
    out.push('<div class="footnotes"><hr class="footnotes-sep"><ol class="footnotes-list">');
    for (const entry of entries) {
      out.push(entry.html);
    }
    out.push("</ol></div>");
  }
  return out.join("");
}
