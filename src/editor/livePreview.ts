// Live Preview: hide markdown syntax tokens outside the active line or
// selection, like Obsidian. Inline marks (bold, italic, code, strikethrough)
// reveal when the selection touches the whole element's range; block marks
// (heading #, quote >) reveal when their line is active. Embeds, task
// markers, bullets, code fences and tables render as widgets/decorations
// when inactive and reveal their raw text on touch.
import {
  ensureSyntaxTree,
  LanguageDescription,
  syntaxTree,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { SyntaxNode } from "@lezer/common";
import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import katex from "katex";
import { t } from "../i18n/i18n";
import {
  parseFrontmatter,
  serializeFrontmatter,
} from "../lib/frontmatter";
import { openContextMenu, type MenuEntry } from "../ui/contextMenu";
import { buildInlineTitleElement } from "../ui/inlineTitle";
import {
  calloutColor,
  calloutIcon,
  parseCalloutHeader,
} from "../markdown/callouts";
import {
  applyTableOp,
  parseTableSource,
  serializeTable,
  type TableData,
  type TableOp,
} from "./tableCommands";
import { renderPropertiesHtml, renderToHtml } from "../markdown/render";
import { isImageTarget } from "../markdown/wikilinks";
import { createIcon } from "../ui/icons";
import {
  scheduleHoverHide,
  scheduleHoverShow,
} from "../ui/hoverPreview";
import {
  fillEmbedImages,
  fillEmbedNotes,
  addCodePills,
  createCodePill,
  highlightCodeBlocks,
  markUnresolvedLinks,
  renderMathElements,
  wirePropertiesCollapse,
  type EmbedFillHooks,
  type EmbedNoteResult,
} from "../ui/renderedContent";

export interface HiddenRange {
  from: number;
  to: number;
}

export interface LivePreviewHooks {
  /** Resolves an embed target to a loadable URL, or null if unknown. */
  resolveEmbedSrc(target: string): string | null;
  /** Renders a note embed target (and resolved path), or null. */
  renderEmbedNote(target: string): Promise<EmbedNoteResult | null>;
  /** Navigates to a wikilink/embed target. */
  onNavigate(target: string): void;
  /** Whether a wikilink target points to an existing note. */
  isResolved(target: string): boolean;
  /** Path of the open file, for transclusion cycle detection. */
  currentFilePath(): string | null;
}

/** Inline mark node name → element node names whose range reveals it. */
const INLINE_MARKS: Record<string, string[]> = {
  EmphasisMark: ["Emphasis", "StrongEmphasis"],
  CodeMark: ["InlineCode"],
  StrikethroughMark: ["Strikethrough"],
  HighlightMark: ["Highlight"],
  FootnoteMark: ["FootnoteRef", "FootnoteInline"],
};

function selectionTouches(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from,
  );
}

function selectionTouchesLine(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return selectionTouches(state, line.from, line.to);
}

/** Extends a mark range over one following space, to hide "# " and "> ". */
function withFollowingSpace(state: EditorState, from: number, to: number): HiddenRange {
  const next = state.doc.sliceString(to, to + 1);
  return { from, to: next === " " ? to + 1 : to };
}

/**
 * Pure computation of the syntax-token ranges to hide in [from, to] given
 * the current selection. Exported separately from the ViewPlugin so it can
 * be unit-tested on headless EditorStates. Embeds and inactive tables are
 * skipped entirely here — widgets replace them whole.
 */
export function computeHiddenRanges(
  state: EditorState,
  from: number,
  to: number,
): HiddenRange[] {
  const hidden: HiddenRange[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === "Table") {
        // Tables are always widget-replaced; nothing inside is decorated.
        return false;
      }
      if (node.name === "Embed") {
        return false;
      }
      const parent = node.node.parent;
      if (parent === null) {
        return;
      }
      if (node.name === "HeaderMark" && parent.name.startsWith("ATXHeading")) {
        if (!selectionTouchesLine(state, node.from)) {
          hidden.push(withFollowingSpace(state, node.from, node.to));
        }
        return;
      }
      if (node.name === "HeaderMark" && parent.name.startsWith("SetextHeading")) {
        // The ===/--- underline hides unless the selection is somewhere
        // in the heading (text or underline line).
        if (!selectionTouches(state, parent.from, parent.to)) {
          hidden.push({ from: node.from, to: node.to });
        }
        return;
      }
      // QuoteMark parents vary: continuation-line marks hang from the
      // inner Paragraph, not from Blockquote — hide them all the same.
      if (node.name === "QuoteMark") {
        if (!selectionTouchesLine(state, node.from)) {
          hidden.push(withFollowingSpace(state, node.from, node.to));
        }
        return;
      }
      if (node.name === "Wikilink") {
        if (!selectionTouches(state, node.from, node.to)) {
          const wikilink = node.node;
          const hasAlias = wikilink.getChild("WikilinkAlias") !== null;
          for (
            let child = wikilink.firstChild;
            child !== null;
            child = child.nextSibling
          ) {
            // With an alias, hide the path too so only the alias shows.
            if (
              child.name === "WikilinkMark" ||
              (hasAlias && child.name === "WikilinkPath")
            ) {
              hidden.push({ from: child.from, to: child.to });
            }
          }
        }
        return false;
      }
      const revealedBy = INLINE_MARKS[node.name];
      if (revealedBy !== undefined && revealedBy.includes(parent.name)) {
        if (!selectionTouches(state, parent.from, parent.to)) {
          hidden.push({ from: node.from, to: node.to });
        }
      }
    },
  });
  return hidden;
}

export interface EmbedRange {
  from: number;
  to: number;
  target: string;
  /** Alias text: display title for notes, dimensions for images. */
  alias: string | null;
}

function computeEmbeds(
  state: EditorState,
  from: number,
  to: number,
  wantImages: boolean,
): EmbedRange[] {
  const embeds: EmbedRange[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === "Table") {
        // Tables are always widget-replaced; nothing inside is decorated.
        return false;
      }
      if (node.name !== "Embed") {
        return;
      }
      const path = node.node.getChild("WikilinkPath");
      if (path === null) {
        return false;
      }
      const target = state.doc.sliceString(path.from, path.to);
      if (isImageTarget(target) !== wantImages) {
        return false;
      }
      if (!selectionTouches(state, node.from, node.to)) {
        const aliasNode = node.node.getChild("WikilinkAlias");
        embeds.push({
          from: node.from,
          to: node.to,
          target,
          alias:
            aliasNode === null
              ? null
              : state.doc.sliceString(aliasNode.from, aliasNode.to),
        });
      }
      return false;
    },
  });
  return embeds;
}

/** Image embeds to replace with img widgets (selection outside). */
export function computeImageEmbeds(
  state: EditorState,
  from: number,
  to: number,
): EmbedRange[] {
  return computeEmbeds(state, from, to, true);
}

/** Note embeds to replace with transclusion widgets (selection outside). */
export function computeNoteEmbeds(
  state: EditorState,
  from: number,
  to: number,
): EmbedRange[] {
  return computeEmbeds(state, from, to, false);
}

export interface MathRange {
  from: number;
  to: number;
  tex: string;
  display: boolean;
}

/**
 * Pure computation of math elements in [from, to] whose range the
 * selection does not touch, to be replaced by KaTeX widgets.
 */
export function computeMathRanges(
  state: EditorState,
  from: number,
  to: number,
): MathRange[] {
  const ranges: MathRange[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "InlineMath" && node.name !== "MathBlock") {
        return;
      }
      if (!selectionTouches(state, node.from, node.to)) {
        const marks = node.node.getChildren("MathMark");
        const texFrom = marks[0]?.to ?? node.from;
        const texTo =
          marks.length > 1 ? marks[marks.length - 1].from : node.to;
        ranges.push({
          from: node.from,
          to: node.to,
          tex: state.doc.sliceString(texFrom, texTo).trim(),
          display: node.name === "MathBlock",
        });
      }
      return false;
    },
  });
  return ranges;
}

/**
 * Pure computation of horizontal rules (---, ***) in [from, to] on
 * inactive lines, to be replaced by a rendered rule.
 */
export function computeHorizontalRules(
  state: EditorState,
  from: number,
  to: number,
): HiddenRange[] {
  const rules: HiddenRange[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "HorizontalRule") {
        return;
      }
      if (!selectionTouchesLine(state, node.from)) {
        rules.push({ from: node.from, to: node.to });
      }
      return false;
    },
  });
  return rules;
}

export interface TaskMarkerInfo {
  /** Offset of the "[ ]"/"[x]" marker. */
  pos: number;
  checked: boolean;
}

/**
 * Pure computation of the task markers to replace with checkboxes in
 * [from, to]: those on lines the selection does not touch.
 */
export function computeTaskMarkers(
  state: EditorState,
  from: number,
  to: number,
): TaskMarkerInfo[] {
  const markers: TaskMarkerInfo[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "TaskMarker") {
        return;
      }
      // Reveals together with its list mark: only while the selection
      // touches the "- [ ]" marker region, not the whole line.
      const listMark = node.node.parent?.parent?.getChild("ListMark") ?? null;
      const revealFrom = listMark === null ? node.from : listMark.from;
      // The boundary right after the trailing space already shows the
      // checkbox: typing "- [ ] " renders it immediately.
      if (!selectionTouches(state, revealFrom, node.to)) {
        markers.push({
          pos: node.from,
          checked: state.doc
            .sliceString(node.from, node.to)
            .toLowerCase()
            .includes("x"),
        });
      }
    },
  });
  return markers;
}

export interface ListMarkInfo {
  from: number;
  to: number;
  /** "bullet" renders •; "task" hides the mark (checkbox follows). */
  kind: "bullet" | "task";
}

/**
 * Pure computation of bullet-list marks in [from, to]: plain items show a
 * bullet over the mark and its following space; task items hide the mark
 * so only the checkbox shows. The raw mark is revealed only while the
 * selection touches the marker itself (not the whole line). Ordered lists
 * keep their numbers.
 */
export function computeListMarks(
  state: EditorState,
  from: number,
  to: number,
): ListMarkInfo[] {
  const marks: ListMarkInfo[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "ListMark") {
        return;
      }
      const item = node.node.parent;
      if (item === null || item.name !== "ListItem") {
        return;
      }
      if (item.parent?.name !== "BulletList") {
        return;
      }
      const task = item.getChild("Task");
      const taskMarker = task?.getChild("TaskMarker") ?? null;
      // The marker itself, not the boundary after its space: typing
      // "- " shows the bullet as soon as the space is pressed.
      const revealTo = (taskMarker ?? node).to;
      if (selectionTouches(state, node.from, revealTo)) {
        return;
      }
      const range = withFollowingSpace(state, node.from, node.to);
      marks.push({
        from: range.from,
        to: range.to,
        kind: task !== null ? "task" : "bullet",
      });
    },
  });
  return marks;
}

export interface ListLineInfo {
  /** Start of the line holding the list marker. */
  from: number;
  /** Hanging indent: chars from line start through the marker + space. */
  width: number;
  /** Indent-guide columns (in ch): content column of each ancestor item. */
  guides: number[];
  /** Leading whitespace to render at a fixed width, or null when none. */
  leading: { from: number; to: number; width: number } | null;
  /**
   * Ordered-list marker ("1. ") to render at a fixed width so the first
   * letter lands exactly on the hanging-indent column, or null (bullets
   * are already fixed-width widgets).
   */
  marker: { from: number; to: number; width: number } | null;
}

/**
 * Each leading-whitespace column renders this many ch, so nesting steps
 * read clearly (Obsidian-like) instead of two skinny source spaces.
 */
const INDENT_SCALE = 2;

/** Leading-whitespace columns of a line (tabs count double). */
function leadingColumns(lineText: string): number {
  const ws = /^[ \t]*/.exec(lineText)?.[0] ?? "";
  let columns = 0;
  for (const ch of ws) {
    columns += ch === "\t" ? 2 : 1;
  }
  return columns;
}

/**
 * Chars taken by the (hidden) `> ` quote prefix at the line start, so
 * list columns inside blockquotes/callouts ignore the invisible marks.
 */
function quotePrefixLength(lineText: string): number {
  return /^(?:[ \t]*>[ \t]?)*/.exec(lineText)?.[0].length ?? 0;
}

/** Rendered content column of a list item: scaled leading + marker + space. */
function itemContentColumn(state: EditorState, item: SyntaxNode): number {
  const mark = item.getChild("ListMark");
  if (mark === null) {
    return 0;
  }
  const taskMarker = item.getChild("Task")?.getChild("TaskMarker") ?? null;
  const line = state.doc.lineAt(mark.from);
  const prefix = quotePrefixLength(line.text);
  const afterPrefix = line.text.slice(prefix);
  const wsLength = /^[ \t]*/.exec(afterPrefix)?.[0].length ?? 0;
  const markerLength =
    (taskMarker ?? mark).to - (line.from + prefix + wsLength) + 1;
  return leadingColumns(afterPrefix) * INDENT_SCALE + markerLength;
}

/**
 * Pure computation of list-marker lines in [from, to], for bullet,
 * ordered and task items: the hanging indent that aligns wrapped text
 * with the first letter, the ancestor columns where indent guides are
 * drawn, and the leading whitespace that must render at a fixed width so
 * columns stay put in proportional fonts.
 */
export function computeListLines(
  state: EditorState,
  from: number,
  to: number,
): ListLineInfo[] {
  // A line can hold nested markers ("- - x"): the innermost (widest) wins.
  const byLine = new Map<number, ListLineInfo>();
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "ListMark") {
        return;
      }
      const item = node.node.parent;
      if (item === null || item.name !== "ListItem") {
        return;
      }
      const line = state.doc.lineAt(node.from);
      const taskMarker = item.getChild("Task")?.getChild("TaskMarker") ?? null;
      // Hidden `> ` quote marks take no visual space: columns count
      // from after them so lists inside callouts align like reading.
      const prefix = quotePrefixLength(line.text);
      const afterPrefix = line.text.slice(prefix);
      const wsLength = /^[ \t]*/.exec(afterPrefix)?.[0].length ?? 0;
      const wsWidth = leadingColumns(afterPrefix) * INDENT_SCALE;
      const markerLength =
        (taskMarker ?? node).to - (line.from + prefix + wsLength) + 1;
      const width = wsWidth + markerLength;
      const existing = byLine.get(line.from);
      if (existing !== undefined && existing.width >= width) {
        return;
      }
      const guides: number[] = [];
      for (
        let ancestor = item.parent?.parent ?? null;
        ancestor !== null && ancestor.name === "ListItem";
        ancestor = ancestor.parent?.parent ?? null
      ) {
        const mark = ancestor.getChild("ListMark");
        // Ancestors sharing this line ("- - x") have no column to guide.
        if (mark !== null && state.doc.lineAt(mark.from).from !== line.from) {
          guides.unshift(itemContentColumn(state, ancestor));
        }
      }
      const leading =
        wsLength === 0
          ? null
          : {
              from: line.from + prefix,
              to: line.from + prefix + wsLength,
              width: wsWidth,
            };
      let marker: ListLineInfo["marker"] = null;
      if (item.parent?.name === "OrderedList" && taskMarker === null) {
        const markEnd = withFollowingSpace(state, node.from, node.to).to;
        marker = {
          from: node.from,
          to: markEnd,
          width: markEnd - node.from,
        };
      }
      byLine.set(line.from, { from: line.from, width, guides, leading, marker });
    },
  });
  return [...byLine.values()];
}

/**
 * Pure computation of the lines holding a checked task in [from, to];
 * their text renders struck through, like in reading mode.
 */
export function computeDoneTaskLines(
  state: EditorState,
  from: number,
  to: number,
): number[] {
  const lines: number[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "TaskMarker") {
        return;
      }
      if (state.doc.sliceString(node.from, node.to).toLowerCase().includes("x")) {
        lines.push(state.doc.lineAt(node.from).from);
      }
    },
  });
  return lines;
}

export interface HeadingLineInfo {
  /** Start of the heading's first line. */
  from: number;
  /** Heading level, 1-6. */
  level: number;
}

/**
 * Pure computation of heading lines in [from, to], used to give headings
 * vertical breathing room (line padding) in editing mode.
 */
export function computeHeadingLines(
  state: EditorState,
  from: number,
  to: number,
): HeadingLineInfo[] {
  const lines: HeadingLineInfo[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      const match = /^(?:ATXHeading|SetextHeading)([1-6])$/.exec(node.name);
      if (match === null) {
        return;
      }
      lines.push({
        from: state.doc.lineAt(node.from).from,
        level: Number(match[1]),
      });
    },
  });
  return lines;
}

/** Parses Obsidian-style image dimensions from an alias: "50" or "300x200". */
export function parseImageDimensions(
  alias: string | null,
): { width: number; height: number | null } | null {
  if (alias === null) {
    return null;
  }
  const match = /^(\d+)(?:x(\d+))?$/.exec(alias.trim());
  if (match === null) {
    return null;
  }
  return {
    width: Number(match[1]),
    height: match[2] === undefined ? null : Number(match[2]),
  };
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string | null,
    readonly target: string,
    readonly alias: string | null,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.target === this.target &&
      other.alias === this.alias
    );
  }

  toDOM(view: EditorView): HTMLElement {
    if (this.src === null) {
      const missing = document.createElement("span");
      missing.className = "cm-embed-missing";
      missing.textContent = this.target;
      return missing;
    }
    const src = this.src;
    const image = document.createElement("img");
    image.className = "cm-embed-image";
    // The real height is known only once loaded; remeasure so the gutter
    // and coordinate mapping stay aligned with the content. The natural
    // size is cached so a widget recreated while scrolling takes its
    // final box synchronously and the scroll position never jumps.
    image.addEventListener("load", () => {
      if (!imageSizeCache.has(src)) {
        imageSizeCache.set(src, {
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      }
      view.requestMeasure();
    });
    image.src = src;
    const cached = imageSizeCache.get(src);
    const dimensions = parseImageDimensions(this.alias);
    if (dimensions === null) {
      image.alt = this.alias ?? this.target;
      if (cached !== undefined) {
        image.width = cached.width;
        image.height = cached.height;
      }
    } else {
      image.alt = this.target;
      image.width = dimensions.width;
      if (dimensions.height !== null) {
        image.height = dimensions.height;
      } else if (cached !== undefined && cached.width > 0) {
        image.height = Math.round(
          (dimensions.width * cached.height) / cached.width,
        );
      }
    }
    return image;
  }
}

// Natural sizes of loaded embed images, per resolved src.
const imageSizeCache = new Map<string, { width: number; height: number }>();

// Inline title: the note name shown as an editable H1 above the
// document. Module state set by the layout — never part of the doc.
let inlineTitleText: string | null = null;
let inlineTitleRename: (name: string) => void = () => undefined;

export function setInlineTitle(text: string | null): void {
  inlineTitleText = text;
}

export function setInlineTitleRename(handler: (name: string) => void): void {
  inlineTitleRename = handler;
}

/** Forces the block-decorations field to rebuild (title/settings changes). */
export const refreshBlockDecorations = StateEffect.define<null>();

/** Focuses the inline title (ArrowUp entry); focusing starts the edit. */
export function focusInlineTitle(view: EditorView): boolean {
  const el = view.dom.querySelector<HTMLElement>(".cm-inline-title");
  if (el === null) {
    return false;
  }
  el.focus();
  return true;
}

class InlineTitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super();
  }

  override eq(other: InlineTitleWidget): boolean {
    return other.title === this.title;
  }

  toDOM(view: EditorView): HTMLElement {
    return buildInlineTitleElement({
      title: this.title,
      tag: "div",
      className: "cm-inline-title inline-title",
      onRename: (name) => inlineTitleRename(name),
      onExitDown: () => {
        view.focus();
        // Below the title: right after the frontmatter when present.
        let pos = 0;
        const first = syntaxTree(view.state).topNode.firstChild;
        if (
          first !== null &&
          first.name === "Frontmatter" &&
          first.from === 0
        ) {
          pos = Math.min(first.to + 1, view.state.doc.length);
        }
        view.dispatch({ selection: { anchor: pos } });
      },
    });
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

// Bumped when settings that affect embed rendering change, so cached
// note-embed widgets rebuild instead of showing stale content.
let embedGeneration = 0;

export function bumpEmbedGeneration(): void {
  embedGeneration++;
  embedHtmlCache.clear();
}

// Filled HTML per (generation, target, alias): a widget recreated while
// scrolling renders synchronously at its final height, so the scroll
// position never jumps while embeds refill. Invalidated on generation
// bumps and by the layout on saves and external folder changes.
const embedHtmlCache = new Map<string, string>();

export function clearEmbedHtmlCache(): void {
  embedHtmlCache.clear();
}

class NoteEmbedWidget extends WidgetType {
  readonly generation = embedGeneration;

  constructor(
    readonly target: string,
    readonly alias: string | null,
    readonly hooks: LivePreviewHooks,
  ) {
    super();
  }

  override eq(other: NoteEmbedWidget): boolean {
    return (
      other.target === this.target &&
      other.alias === this.alias &&
      other.generation === this.generation
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-embed-note";
    const title = document.createElement("span");
    title.className = "cm-embed-note-title";
    title.textContent = this.alias ?? this.target;
    title.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.hooks.onNavigate(this.target);
    });
    const body = document.createElement("span");
    body.className = "cm-embed-note-body markdown-rendered";
    container.append(title, body);
    const cacheKey = `${this.generation}:${this.target}|${this.alias ?? ""}`;
    const fillHooks: EmbedFillHooks = {
      resolveEmbedSrc: this.hooks.resolveEmbedSrc,
      renderEmbedNote: this.hooks.renderEmbedNote,
      isResolved: this.hooks.isResolved,
      onRendered: () => {
        // Nested transclusions keep deepening the content: keep the
        // cache at the latest markup.
        embedHtmlCache.set(cacheKey, body.innerHTML);
        view.requestMeasure();
      },
      onNavigate: this.hooks.onNavigate,
    };
    // Embedded content behaves like rendered content: plain hover
    // previews its links (any depth — events bubble to the container).
    container.addEventListener("mouseover", (event) => {
      const hovered = event.target;
      const link =
        hovered instanceof Element
          ? hovered.closest("a.internal-link")
          : null;
      if (link instanceof HTMLElement && link.dataset.target !== undefined) {
        scheduleHoverShow(
          event.clientX,
          event.clientY,
          link.dataset.target,
          fillHooks,
        );
      }
    });
    container.addEventListener("mouseout", (event) => {
      const hovered = event.target;
      if (
        hovered instanceof Element &&
        hovered.closest("a.internal-link") !== null
      ) {
        scheduleHoverHide();
      }
    });
    // Navigation must run on mousedown: a click would first move the
    // CodeMirror cursor into the embed, which swaps the widget for raw
    // text and destroys this DOM before "click" ever fires.
    container.addEventListener("mousedown", (event) => {
      const clicked = event.target;
      const link =
        clicked instanceof Element
          ? clicked.closest("a.internal-link")
          : null;
      if (link instanceof HTMLElement && link.dataset.target !== undefined) {
        event.preventDefault();
        this.hooks.onNavigate(link.dataset.target);
      }
    });
    const cachedHtml = embedHtmlCache.get(cacheKey);
    if (cachedHtml !== undefined) {
      // Synchronous restore at the final height. Listeners never
      // survive HTML caching: re-wire the interactive bits.
      body.innerHTML = cachedHtml;
      addCodePills(body);
      wirePropertiesCollapse(body);
      for (const image of body.querySelectorAll("img")) {
        image.addEventListener("load", () => view.requestMeasure());
      }
      return container;
    }
    void this.hooks.renderEmbedNote(this.target).then((result) => {
      if (result === null) {
        title.classList.add("cm-embed-missing");
      } else {
        body.innerHTML = result.html;
        fillEmbedImages(body, this.hooks.resolveEmbedSrc);
        highlightCodeBlocks(body);
        addCodePills(body);
        renderMathElements(body);
        wirePropertiesCollapse(body);
        markUnresolvedLinks(body, this.hooks.isResolved);
        for (const image of body.querySelectorAll("img")) {
          image.addEventListener("load", () => view.requestMeasure());
        }
        // Deeper transclusions, with this chain marked as visited.
        const current = this.hooks.currentFilePath();
        const visited = new Set(
          current === null
            ? [result.path.toLowerCase()]
            : [current.toLowerCase(), result.path.toLowerCase()],
        );
        fillEmbedNotes(body, fillHooks, visited, 1);
        embedHtmlCache.set(cacheKey, body.innerHTML);
      }
      // The fill changed the widget height after CodeMirror measured it.
      view.requestMeasure();
    });
    return container;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }

  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-task-checkbox";
    input.checked = this.checked;
    input.addEventListener("mousedown", (event) => event.preventDefault());
    input.addEventListener("click", (event) => {
      event.preventDefault();
      view.dispatch({
        changes: {
          from: this.pos,
          to: this.pos + 3,
          insert: this.checked ? "[ ]" : "[x]",
        },
      });
    });
    return input;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const bullet = document.createElement("span");
    bullet.className = "cm-list-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

class CodePillWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly code: string,
  ) {
    super();
  }

  override eq(other: CodePillWidget): boolean {
    return other.label === this.label && other.code === this.code;
  }

  toDOM(): HTMLElement {
    return createCodePill(this.label, () => this.code);
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class HrWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const rule = document.createElement("span");
    rule.className = "cm-hr";
    return rule;
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly pos: number,
    /** True when used as a block decoration (multi-line $$ blocks). */
    readonly standalone: boolean = false,
  ) {
    super();
  }

  override eq(other: MathWidget): boolean {
    return (
      other.tex === this.tex &&
      other.display === this.display &&
      other.pos === this.pos &&
      other.standalone === this.standalone
    );
  }

  toDOM(view: EditorView): HTMLElement {
    // Inline uses must stay inline-level (block boxes inside a text line
    // desync the gutter); block uses must be real block elements with
    // padding-based spacing, because CodeMirror measures offsetHeight
    // and CSS margins are invisible to it.
    const container = document.createElement(this.standalone ? "div" : "span");
    container.className = this.standalone
      ? "cm-math cm-math-standalone"
      : this.display
        ? "cm-math cm-math-block"
        : "cm-math";
    container.innerHTML = katex.renderToString(this.tex, {
      throwOnError: false,
      displayMode: this.display,
    });
    // Clicking a formula reveals its raw TeX with the cursor inside.
    container.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.pos } });
      view.focus();
    });
    return container;
  }
}

// Cell to focus after a table rebuild, keyed by the table's start.
let pendingTableFocus: {
  from: number;
  row: number;
  column: number;
} | null = null;

/** Asks the table widget at `from` to focus a cell when it (re)builds. */
export function focusTableCell(
  from: number,
  row: number,
  column: number,
): void {
  pendingTableFocus = { from, row, column };
}

/** Escapes pipes and newlines so a cell edit can't break the table. */
function sanitizeCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\\?\|/g, "\\|").trim();
}

function placeCaretEnd(cell: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Caret offset inside a plaintext cell (0 when unknown). */
function caretOffset(cell: HTMLElement): number {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) {
    return 0;
  }
  const range = selection.getRangeAt(0);
  return cell.contains(range.startContainer) ? range.startOffset : 0;
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly pos: number,
  ) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source && other.pos === this.pos;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-table-widget markdown-rendered table-editor";
    const data = parseTableSource(this.source);
    if (data === null) {
      container.innerHTML = renderToHtml(this.source);
      return container;
    }

    const dispatchTable = (
      next: TableData,
      focus: { row: number; column: number } | null,
    ): void => {
      const to = this.pos + this.source.length;
      let insert = serializeTable(next);
      // Always keep a blank line after the table so following text
      // never gets absorbed into it.
      const nextChar = view.state.doc.sliceString(to, to + 1);
      const charAfter = view.state.doc.sliceString(to + 1, to + 2);
      if (nextChar !== "" && (nextChar !== "\n" || (charAfter !== "" && charAfter !== "\n"))) {
        insert += "\n";
      }
      if (focus !== null) {
        pendingTableFocus = { from: this.pos, ...focus };
      }
      view.dispatch({ changes: { from: this.pos, to, insert } });
    };

    const apply = (
      op: TableOp,
      focus: { row: number; column: number } | null,
    ): void => {
      const next = applyTableOp(data, op);
      if (next !== null) {
        dispatchTable(next, focus);
      }
    };

    const rowMenuItems = (row: number): MenuEntry[] => [
      {
        label: t("menu.tableAddRowAbove"),
        onClick: () => apply({ kind: "addRow", row, side: "above" }, null),
      },
      {
        label: t("menu.tableAddRow"),
        onClick: () => apply({ kind: "addRow", row, side: "below" }, null),
      },
      {
        label: t("menu.tableDuplicateRow"),
        onClick: () => apply({ kind: "duplicateRow", row }, null),
      },
      "separator",
      {
        label: t("menu.tableMoveRowUp"),
        disabled: row < 3,
        onClick: () => apply({ kind: "moveRow", row, delta: -1 }, null),
      },
      {
        label: t("menu.tableMoveRowDown"),
        disabled: row < 2,
        onClick: () => apply({ kind: "moveRow", row, delta: 1 }, null),
      },
      "separator",
      {
        label: t("menu.tableDeleteRow"),
        danger: true,
        disabled: row < 2,
        onClick: () => apply({ kind: "deleteRow", row }, null),
      },
    ];

    const columnMenuItems = (column: number): MenuEntry[] => [
      {
        label: t("menu.tableSortAsc"),
        onClick: () => apply({ kind: "sort", column, ascending: true }, null),
      },
      {
        label: t("menu.tableSortDesc"),
        onClick: () => apply({ kind: "sort", column, ascending: false }, null),
      },
      "separator",
      {
        label: t("menu.tableAddColumnLeft"),
        onClick: () => apply({ kind: "addColumn", column, side: "left" }, null),
      },
      {
        label: t("menu.tableAddColumnRight"),
        onClick: () =>
          apply({ kind: "addColumn", column, side: "right" }, null),
      },
      "separator",
      {
        label: t("menu.tableMoveColumnLeft"),
        onClick: () => apply({ kind: "moveColumn", column, delta: -1 }, null),
      },
      {
        label: t("menu.tableMoveColumnRight"),
        onClick: () => apply({ kind: "moveColumn", column, delta: 1 }, null),
      },
      "separator",
      {
        label: t("menu.tableAlignLeft"),
        onClick: () =>
          apply({ kind: "setAlignment", column, alignment: "left" }, null),
      },
      {
        label: t("menu.tableAlignCenter"),
        onClick: () =>
          apply({ kind: "setAlignment", column, alignment: "center" }, null),
      },
      {
        label: t("menu.tableAlignRight"),
        onClick: () =>
          apply({ kind: "setAlignment", column, alignment: "right" }, null),
      },
      "separator",
      {
        label: t("menu.tableDuplicateColumn"),
        onClick: () => apply({ kind: "duplicateColumn", column }, null),
      },
      {
        label: t("menu.tableDeleteColumn"),
        danger: true,
        onClick: () => apply({ kind: "deleteColumn", column }, null),
      },
    ];

    /** The table data with the cell's current text applied. */
    const dataWithCellEdit = (cell: HTMLElement): TableData => {
      const row = Number(cell.dataset.row);
      const column = Number(cell.dataset.column);
      const text = sanitizeCell(cell.textContent ?? "");
      if (text === data.rows[row][column]) {
        return data;
      }
      return {
        rows: data.rows.map((cells, r) =>
          r === row
            ? cells.map((value, c) => (c === column ? text : value))
            : cells,
        ),
        alignments: data.alignments,
      };
    };

    const commitCell = (cell: HTMLElement): void => {
      const next = dataWithCellEdit(cell);
      if (next !== data) {
        dispatchTable(next, null);
      }
    };

    const focusCell = (row: number, column: number): void => {
      const target = container.querySelector<HTMLElement>(
        `[data-row="${row}"][data-column="${column}"]`,
      );
      if (target !== null) {
        target.focus();
        placeCaretEnd(target);
      }
    };

    /** Commits the cell (if changed) and moves focus to another cell. */
    const commitAndFocus = (
      cell: HTMLElement,
      row: number,
      column: number,
    ): void => {
      const next = dataWithCellEdit(cell);
      if (next !== data) {
        dispatchTable(next, { row, column });
      } else {
        focusCell(row, column);
      }
    };

    /** Commits the cell and grows the table by a row, focusing it. */
    const commitAndGrow = (cell: HTMLElement, column: number): void => {
      const grown = applyTableOp(dataWithCellEdit(cell), {
        kind: "addRow",
        row: data.rows.length - 1,
        side: "below",
      });
      if (grown !== null) {
        dispatchTable(grown, { row: data.rows.length, column });
      }
    };

    /** Display row below/above a model row (1 is the delimiter). */
    const rowBelow = (row: number): number | null => {
      if (row === 0) {
        return data.rows.length > 2 ? 2 : null;
      }
      return row + 1 < data.rows.length ? row + 1 : null;
    };
    const rowAbove = (row: number): number | null => {
      if (row === 2) {
        return 0;
      }
      return row > 2 ? row - 1 : null;
    };

    const makeCell = (
      tag: "th" | "td",
      row: number,
      column: number,
    ): HTMLElement => {
      const cell = document.createElement(tag);
      cell.textContent = data.rows[row][column];
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.contentEditable = "plaintext-only";
      cell.spellcheck = false;
      const alignment = data.alignments[column];
      if (alignment !== null) {
        cell.style.textAlign = alignment;
      }
      cell.addEventListener("blur", () => commitCell(cell));
      cell.addEventListener("keydown", (event) => {
        const cellRow = Number(cell.dataset.row);
        const cellColumn = Number(cell.dataset.column);
        if (event.key === "Enter") {
          // Down a cell; on the last row, grow the table.
          event.preventDefault();
          const below = rowBelow(cellRow);
          if (below !== null) {
            commitAndFocus(cell, below, cellColumn);
          } else {
            commitAndGrow(cell, cellColumn);
          }
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const editables = [
            ...container.querySelectorAll<HTMLElement>("[data-row]"),
          ];
          const index = editables.indexOf(cell);
          const target = index + (event.shiftKey ? -1 : 1);
          if (target >= 0 && target < editables.length) {
            const targetCell = editables[target];
            commitAndFocus(
              cell,
              Number(targetCell.dataset.row),
              Number(targetCell.dataset.column),
            );
          } else if (target >= editables.length) {
            commitAndGrow(cell, 0);
          }
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const target =
            event.key === "ArrowDown" ? rowBelow(cellRow) : rowAbove(cellRow);
          if (target !== null) {
            event.preventDefault();
            commitAndFocus(cell, target, cellColumn);
          }
          return;
        }
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          // Only when the caret sits at the cell's edge.
          const forward = event.key === "ArrowRight";
          const text = cell.textContent ?? "";
          const offset = caretOffset(cell);
          if (forward ? offset < text.length : offset > 0) {
            return;
          }
          const editables = [
            ...container.querySelectorAll<HTMLElement>("[data-row]"),
          ];
          const index = editables.indexOf(cell);
          const target = index + (forward ? 1 : -1);
          if (target >= 0 && target < editables.length) {
            event.preventDefault();
            const targetCell = editables[target];
            commitAndFocus(
              cell,
              Number(targetCell.dataset.row),
              Number(targetCell.dataset.column),
            );
          }
        }
      });
      cell.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(event.clientX, event.clientY, [
          { label: t("menu.tableRow"), submenu: rowMenuItems(row).filter(
            (entry): entry is Exclude<MenuEntry, "separator"> =>
              entry !== "separator",
          ) },
          {
            label: t("menu.tableColumn"),
            submenu: columnMenuItems(column).filter(
              (entry): entry is Exclude<MenuEntry, "separator"> =>
                entry !== "separator",
            ),
          },
          "separator",
          {
            label: t("menu.tableSortAsc"),
            onClick: () =>
              apply({ kind: "sort", column, ascending: true }, null),
          },
          {
            label: t("menu.tableSortDesc"),
            onClick: () =>
              apply({ kind: "sort", column, ascending: false }, null),
          },
        ]);
      });
      return cell;
    };

    const table = document.createElement("table");
    const columns = data.alignments.length;

    // Pointer-based handle dragging: native HTML5 drag & drop is
    // unreliable inside a contenteditable CodeMirror widget. While
    // dragging, the source row/column is tinted, an accent bar marks
    // the insertion point and a ghost of the handle follows the mouse.
    const startHandleDrag = (
      kind: "col" | "row",
      index: number,
      startEvent: MouseEvent,
    ): void => {
      startEvent.preventDefault();
      const handleEl = startEvent.currentTarget;
      const selector =
        kind === "col"
          ? "[data-handle-column], [data-column]"
          : "[data-handle-row], [data-row]";
      const targetOf = (element: HTMLElement): number =>
        Number(
          kind === "col"
            ? (element.dataset.handleColumn ?? element.dataset.column)
            : (element.dataset.handleRow ?? element.dataset.row),
        );
      const sourceCells = container.querySelectorAll<HTMLElement>(
        kind === "col"
          ? `[data-column="${index}"], [data-handle-column="${index}"]`
          : `[data-row="${index}"], [data-handle-row="${index}"]`,
      );
      for (const cell of sourceCells) {
        cell.classList.add("drag-source");
      }
      const indicator = document.createElement("div");
      indicator.className = "table-drop-indicator";
      indicator.style.display = "none";
      wrap.append(indicator);
      let ghost: HTMLElement | null = null;
      if (handleEl instanceof HTMLElement) {
        ghost = handleEl.cloneNode(true) as HTMLElement;
        ghost.classList.add("table-drag-ghost");
        ghost.style.width = `${handleEl.offsetWidth}px`;
        ghost.style.height = `${handleEl.offsetHeight}px`;
        document.body.append(ghost);
      }
      document.body.style.cursor = "grabbing";
      let target: number | null = null;
      const onMove = (event: MouseEvent): void => {
        if (ghost !== null) {
          ghost.style.left = `${event.clientX - ghost.offsetWidth / 2}px`;
          ghost.style.top = `${event.clientY - ghost.offsetHeight / 2}px`;
        }
        const under = document.elementFromPoint(event.clientX, event.clientY);
        const cellEl =
          under instanceof Element
            ? under.closest<HTMLElement>(selector)
            : null;
        target = null;
        indicator.style.display = "none";
        if (cellEl !== null && container.contains(cellEl)) {
          const candidate = targetOf(cellEl);
          if (Number.isFinite(candidate) && candidate !== index) {
            target = candidate;
            const cellRect = cellEl.getBoundingClientRect();
            const tableRect = table.getBoundingClientRect();
            const wrapRect = wrap.getBoundingClientRect();
            indicator.style.display = "block";
            if (kind === "col") {
              const x =
                (candidate > index ? cellRect.right : cellRect.left) -
                wrapRect.left;
              indicator.style.left = `${x - 1.5}px`;
              indicator.style.top = `${tableRect.top - wrapRect.top}px`;
              indicator.style.width = "3px";
              indicator.style.height = `${tableRect.height}px`;
            } else {
              const y =
                (candidate > index ? cellRect.bottom : cellRect.top) -
                wrapRect.top;
              indicator.style.top = `${y - 1.5}px`;
              indicator.style.left = `${tableRect.left - wrapRect.left}px`;
              indicator.style.height = "3px";
              indicator.style.width = `${tableRect.width}px`;
            }
          }
        }
      };
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        for (const cell of sourceCells) {
          cell.classList.remove("drag-source");
        }
        indicator.remove();
        ghost?.remove();
        document.body.style.cursor = "";
        if (target !== null) {
          apply(
            kind === "col"
              ? { kind: "moveColumnTo", column: index, to: target }
              : { kind: "moveRowTo", row: index, to: target },
            null,
          );
        }
      };
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
    };

    // Column handles above the header.
    const handleRow = document.createElement("tr");
    handleRow.className = "table-handle-row";
    const corner = document.createElement("th");
    corner.className = "table-corner";
    handleRow.append(corner);
    for (let column = 0; column < columns; column++) {
      const cell = document.createElement("th");
      cell.className = "table-col-handle-cell";
      cell.dataset.handleColumn = String(column);
      const handle = document.createElement("button");
      handle.className = "table-col-handle";
      handle.addEventListener("mousedown", (event) => {
        if (event.button === 0) {
          startHandleDrag("col", column, event);
        }
      });
      handle.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(event.clientX, event.clientY, columnMenuItems(column));
      });
      cell.append(handle);
      handleRow.append(cell);
    }
    table.append(handleRow);

    data.rows.forEach((cells, row) => {
      if (row === 1) {
        return;
      }
      const tr = document.createElement("tr");
      const handleCell = document.createElement("td");
      handleCell.className = "table-row-handle-cell";
      handleCell.dataset.handleRow = String(row);
      const handle = document.createElement("button");
      handle.className = "table-row-handle";
      handle.addEventListener("mousedown", (event) => {
        if (event.button === 0) {
          startHandleDrag("row", row, event);
        }
      });
      handle.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(event.clientX, event.clientY, rowMenuItems(row));
      });
      handleCell.append(handle);
      tr.append(handleCell);
      cells.forEach((_, column) => {
        tr.append(makeCell(row === 0 ? "th" : "td", row, column));
      });
      table.append(tr);
    });

    // Hovering the table's right/bottom edge offers quick add buttons.
    const wrap = document.createElement("span");
    wrap.className = "table-wrap";
    wrap.append(table);
    const addColumnButton = document.createElement("button");
    addColumnButton.className = "table-edge-add table-edge-add-col";
    addColumnButton.textContent = "+";
    addColumnButton.title = t("menu.tableAddColumnRight");
    addColumnButton.addEventListener("click", () =>
      apply(
        { kind: "addColumn", column: data.alignments.length - 1, side: "right" },
        null,
      ),
    );
    const addRowButton = document.createElement("button");
    addRowButton.className = "table-edge-add table-edge-add-row";
    addRowButton.textContent = "+";
    addRowButton.title = t("menu.tableAddRow");
    addRowButton.addEventListener("click", () =>
      apply(
        { kind: "addRow", row: data.rows.length - 1, side: "below" },
        null,
      ),
    );
    wrap.append(addColumnButton, addRowButton);
    container.append(wrap);

    if (pendingTableFocus !== null && pendingTableFocus.from === this.pos) {
      const { row, column } = pendingTableFocus;
      pendingTableFocus = null;
      setTimeout(() => {
        const cell = container.querySelector<HTMLElement>(
          `[data-row="${row}"][data-column="${column}"]`,
        );
        if (cell !== null) {
          cell.focus();
          const range = document.createRange();
          range.selectNodeContents(cell);
          range.collapse(false);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }, 0);
    }
    return container;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

// Collapse state, known keys and the pending "add property" request
// survive widget rebuilds; one open document at a time keeps these
// module-level.
let propertiesCollapsed = false;
let pendingAddProperty = false;
let knownPropertyKeys: string[] = [];

export function arePropertiesCollapsed(): boolean {
  return propertiesCollapsed;
}

export function setPropertiesCollapsed(collapsed: boolean): void {
  propertiesCollapsed = collapsed;
}

/** Vault-wide property keys offered by the add-property dropdown. */
export function setKnownPropertyKeys(keys: string[]): void {
  knownPropertyKeys = keys;
}

/**
 * Opens the properties editor's add-row (creating an empty frontmatter
 * block first when the note has none). Used by the file menu.
 */
export function requestAddProperty(view: EditorView): void {
  pendingAddProperty = true;
  propertiesCollapsed = false;
  if (!view.state.doc.sliceString(0, 4).startsWith("---")) {
    view.dispatch({ changes: { from: 0, insert: "---\n---\n" } });
  } else {
    // Selection-touch transaction so the block decorations rebuild.
    view.dispatch({ selection: view.state.selection });
  }
}

class PropertiesWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly to: number,
  ) {
    super();
  }

  override eq(other: PropertiesWidget): boolean {
    return other.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-frontmatter-widget";
    const data = parseFrontmatter(this.source);
    container.innerHTML = renderPropertiesHtml(data, true, knownPropertyKeys);
    container.classList.toggle("is-collapsed", propertiesCollapsed);

    const replaceBlock = (
      properties: ReturnType<typeof parseFrontmatter>["properties"],
    ): void => {
      const kept = properties.filter(
        (property) => property.key.trim() !== "",
      );
      const replacement =
        kept.length === 0 ? "" : serializeFrontmatter(kept);
      let to = this.to;
      if (
        replacement === "" &&
        view.state.doc.sliceString(to, to + 1) === "\n"
      ) {
        to++;
      }
      view.dispatch({ changes: { from: 0, to, insert: replacement } });
    };

    const showAddRow = (): void => {
      const row = container.querySelector<HTMLElement>(".props-add-row");
      row?.classList.remove("is-hidden");
      const key = container.querySelector<HTMLInputElement>(".props-new-key");
      setTimeout(() => key?.focus(), 0);
    };

    container.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest(".props-header") !== null) {
        propertiesCollapsed = !propertiesCollapsed;
        container.classList.toggle("is-collapsed", propertiesCollapsed);
        return;
      }
      const remove = target.closest<HTMLElement>(".props-remove");
      if (remove !== null) {
        const propIndex = Number(remove.dataset.prop);
        const valueIndex = Number(remove.dataset.value);
        replaceBlock(
          data.properties
            .map((property, index) =>
              index === propIndex
                ? {
                    ...property,
                    values: property.values.filter(
                      (_, vi) => vi !== valueIndex,
                    ),
                  }
                : property,
            )
            .filter((property) => property.values.length > 0),
        );
        return;
      }
      const scalar = target.closest<HTMLElement>(".props-value[data-prop]");
      if (scalar !== null) {
        // Swap the scalar for an inline input; Enter or blur commits.
        const propIndex = Number(scalar.dataset.prop);
        const input = document.createElement("input");
        input.className = "props-edit-value";
        input.value = data.properties[propIndex]?.values[0] ?? "";
        input.spellcheck = false;
        scalar.replaceWith(input);
        input.focus();
        input.select();
        const commit = (): void => {
          const value = input.value.trim();
          replaceBlock(
            data.properties.map((property, index) =>
              index === propIndex
                ? { ...property, values: value === "" ? [] : [value] }
                : property,
            ),
          );
        };
        input.addEventListener("keydown", (keyEvent) => {
          if (keyEvent.key === "Enter") {
            keyEvent.preventDefault();
            commit();
          }
        });
        input.addEventListener("blur", commit);
        return;
      }
      if (target.closest(".props-add") !== null) {
        showAddRow();
      }
    });

    // Enter commits from any input; Escape backs out of the add-row
    // (removing an all-empty block entirely).
    container.addEventListener("keydown", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (
          target.classList.contains("props-new-key") ||
          target.classList.contains("props-new-first")
        ) {
          if (data.properties.length === 0) {
            replaceBlock([]);
          } else {
            container
              .querySelector(".props-add-row")
              ?.classList.add("is-hidden");
          }
        } else {
          target.blur();
        }
        return;
      }
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      if (target.classList.contains("props-new-value")) {
        const propIndex = Number(target.dataset.prop);
        const value = target.value.trim();
        if (value === "") {
          return;
        }
        replaceBlock(
          data.properties.map((property, index) =>
            index === propIndex
              ? { ...property, values: [...property.values, value] }
              : property,
          ),
        );
        return;
      }
      if (
        target.classList.contains("props-new-key") ||
        target.classList.contains("props-new-first")
      ) {
        const key = container
          .querySelector<HTMLInputElement>(".props-new-key")
          ?.value.trim();
        const value = container
          .querySelector<HTMLInputElement>(".props-new-first")
          ?.value.trim();
        if (key === undefined || key === "") {
          return;
        }
        const lower = key.toLowerCase();
        // Same key again: merge into the existing property, never dupe.
        const existing = data.properties.findIndex(
          (property) => property.key.toLowerCase() === lower,
        );
        if (existing >= 0) {
          replaceBlock(
            data.properties.map((property, index) =>
              index === existing && value !== undefined && value !== ""
                ? { ...property, values: [...property.values, value] }
                : property,
            ),
          );
          return;
        }
        const isList = ["tags", "tag", "aliases", "alias"].includes(lower);
        replaceBlock([
          ...data.properties,
          {
            key,
            values: value === undefined || value === "" ? [] : [value],
            isList: isList || value === undefined || value === "",
          },
        ]);
      }
    });

    if (pendingAddProperty) {
      pendingAddProperty = false;
      showAddRow();
    }
    return container;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const hideMark = Decoration.replace({});
const blockquoteLine = Decoration.line({ class: "cm-blockquote-line" });
const codeblockLine = Decoration.line({ class: "cm-codeblock-line" });
const codeblockBegin = Decoration.line({ class: "cm-codeblock-begin" });
const codeblockEnd = Decoration.line({ class: "cm-codeblock-end" });
const headingLines = [1, 2, 3, 4, 5, 6].map((level) =>
  Decoration.line({ class: `cm-heading-line cm-heading-${level}` }),
);
const taskDoneLine = Decoration.line({ class: "cm-task-done" });
const bulletDecoration = Decoration.replace({ widget: new BulletWidget() });
const hrDecoration = Decoration.replace({ widget: new HrWidget() });

export interface CalloutRange {
  /** The `[!type]` marker (plus one following space). */
  markerFrom: number;
  markerTo: number;
  /** End of the title (the first line). */
  titleTo: number;
  type: string;
  /** Fold marker: "-" starts collapsed, "+" expanded, null not foldable. */
  fold: "+" | "-" | null;
  /** Document position of the fold sign character. */
  signPos: number;
}

/** Callout info for a blockquote node, or null when it is a plain one. */
export function calloutForQuote(
  state: EditorState,
  quote: SyntaxNode,
): CalloutRange | null {
  const paragraph = quote.getChild("Paragraph");
  if (paragraph === null) {
    return null;
  }
  const text = state.doc.sliceString(paragraph.from, paragraph.to);
  const newline = text.indexOf("\n");
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const header = parseCalloutHeader(firstLine);
  if (header === null) {
    return null;
  }
  return {
    markerFrom: paragraph.from,
    markerTo: paragraph.from + header.markerLength,
    titleTo: newline === -1 ? paragraph.to : paragraph.from + newline,
    type: header.type,
    fold: header.fold,
    signPos: paragraph.from + header.signOffset,
  };
}

/**
 * Fold chevron after a foldable callout's title. Toggling flips the
 * `+`/`-` sign in the source, so the fold state is shared by both
 * modes and persists in the file.
 */
class CalloutFoldWidget extends WidgetType {
  constructor(
    readonly folded: boolean,
    readonly signPos: number,
  ) {
    super();
  }

  override eq(other: CalloutFoldWidget): boolean {
    return other.folded === this.folded && other.signPos === this.signPos;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-callout-fold";
    span.append(createIcon(this.folded ? "chevron-right" : "chevron-down"));
    span.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        changes: {
          from: this.signPos,
          to: this.signPos + 1,
          insert: this.folded ? "+" : "-",
        },
      });
    });
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class CalloutIconWidget extends WidgetType {
  constructor(readonly type: string) {
    super();
  }

  override eq(other: CalloutIconWidget): boolean {
    return other.type === this.type;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-callout-icon";
    span.append(createIcon(calloutIcon(this.type)));
    return span;
  }
}

function hasBlockquoteAncestor(node: SyntaxNode): boolean {
  for (let cur = node.parent; cur !== null; cur = cur.parent) {
    if (cur.name === "Blockquote") {
      return true;
    }
  }
  return false;
}

function languageDisplayName(info: string): string {
  if (info === "") {
    return "";
  }
  return (
    LanguageDescription.matchLanguageName(languages, info, true)?.name ?? info
  );
}

function buildDecorations(
  view: EditorView,
  hooks: LivePreviewHooks,
): DecorationSet {
  const state = view.state;
  const ranges: Range<Decoration>[] = [];

  function decorateLines(node: SyntaxNode, decoration: Decoration): void {
    let line = state.doc.lineAt(node.from);
    for (;;) {
      ranges.push(decoration.range(line.from));
      if (line.to >= node.to || line.to >= state.doc.length) {
        break;
      }
      line = state.doc.lineAt(line.to + 1);
    }
  }

  // Rounds the block's first and last line, like reading mode's <pre>.
  function decorateCodeEdges(node: SyntaxNode): void {
    ranges.push(codeblockBegin.range(state.doc.lineAt(node.from).from));
    ranges.push(codeblockEnd.range(state.doc.lineAt(node.to).from));
  }

  function decorateFencedCode(node: SyntaxNode): void {
    decorateLines(node, codeblockLine);
    decorateCodeEdges(node);
    if (selectionTouches(state, node.from, node.to)) {
      return;
    }
    const fenceMarks = node.getChildren("CodeMark");
    const opener = fenceMarks[0];
    if (opener === undefined) {
      return;
    }
    const openLine = state.doc.lineAt(opener.from);
    const info = node.getChild("CodeInfo");
    const display = languageDisplayName(
      info === null ? "" : state.doc.sliceString(info.from, info.to),
    );
    const codeText = node.getChild("CodeText");
    const code =
      codeText === null
        ? ""
        : state.doc.sliceString(codeText.from, codeText.to);
    ranges.push(
      Decoration.line({ class: "cm-codeblock-open" }).range(openLine.from),
      Decoration.widget({
        widget: new CodePillWidget(display, code),
        side: 1,
      }).range(openLine.to),
    );
    if (openLine.to > openLine.from) {
      ranges.push(hideMark.range(openLine.from, openLine.to));
    }
    const closer = fenceMarks[fenceMarks.length - 1];
    if (closer !== undefined && closer.from > opener.to) {
      const closeLine = state.doc.lineAt(closer.from);
      if (closeLine.to > closeLine.from) {
        ranges.push(hideMark.range(closeLine.from, closeLine.to));
      }
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name === "Blockquote" && !hasBlockquoteAncestor(node.node)) {
          const callout = calloutForQuote(state, node.node);
          if (callout === null) {
            decorateLines(node.node, blockquoteLine);
            return;
          }
          // Rounded-box look: the first and last lines carry the
          // corner classes so both modes show the same callout box.
          // A collapsed callout shows only its title line.
          const collapsed =
            callout.fold === "-" &&
            !selectionTouches(state, node.from, node.to);
          const firstLine = state.doc.lineAt(node.from).number;
          const lastLine = state.doc.lineAt(node.to).number;
          for (let lineNo = firstLine; lineNo <= lastLine; lineNo++) {
            const line = state.doc.line(lineNo);
            let cls = "cm-blockquote-line cm-callout-line";
            if (lineNo === firstLine) {
              cls += " cm-callout-first";
            }
            if (lineNo === lastLine || (collapsed && lineNo === firstLine)) {
              cls += " cm-callout-last";
            }
            ranges.push(
              Decoration.line({
                class: cls,
                attributes: {
                  style: `--callout-color: ${calloutColor(callout.type)}`,
                },
              }).range(line.from),
            );
          }
          // Guarded by the visible range: a collapsed callout can
          // fragment visibleRanges and iterate the node twice, which
          // would duplicate this point widget.
          if (
            callout.fold !== null &&
            callout.titleTo >= from &&
            callout.titleTo <= to
          ) {
            ranges.push(
              Decoration.widget({
                widget: new CalloutFoldWidget(
                  callout.fold === "-",
                  callout.signPos,
                ),
                side: -1,
              }).range(callout.titleTo),
            );
          }
          // The collapsed content itself is hidden by the block
          // decorations state field: replaced ranges that cross line
          // breaks may not come from a view plugin.
          // The [!type] marker renders as the callout's icon when the
          // line is not being edited; the title reads bold.
          if (!selectionTouchesLine(state, callout.markerFrom)) {
            ranges.push(
              Decoration.replace({
                widget: new CalloutIconWidget(callout.type),
              }).range(callout.markerFrom, callout.markerTo),
            );
          }
          if (callout.titleTo > callout.markerTo) {
            ranges.push(
              Decoration.mark({ class: "cm-callout-title" }).range(
                callout.markerTo,
                callout.titleTo,
              ),
            );
          }
          return;
        }
        if (node.name === "FencedCode") {
          decorateFencedCode(node.node);
          return false;
        }
        if (node.name === "CodeBlock") {
          decorateLines(node.node, codeblockLine);
          decorateCodeEdges(node.node);
          return false;
        }
        return;
      },
    });
    for (const range of computeHiddenRanges(state, from, to)) {
      ranges.push(hideMark.range(range.from, range.to));
    }
    for (const embed of computeImageEmbeds(state, from, to)) {
      ranges.push(
        Decoration.replace({
          widget: new ImageWidget(
            hooks.resolveEmbedSrc(embed.target),
            embed.target,
            embed.alias,
          ),
        }).range(embed.from, embed.to),
      );
    }
    for (const embed of computeNoteEmbeds(state, from, to)) {
      ranges.push(
        Decoration.replace({
          widget: new NoteEmbedWidget(embed.target, embed.alias, hooks),
        }).range(embed.from, embed.to),
      );
    }
    // Unresolved wikilinks render dimmed and underline-free.
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Wikilink") {
          return;
        }
        const path = node.node.getChild("WikilinkPath");
        if (path !== null) {
          const target = state.doc.sliceString(path.from, path.to);
          if (!hooks.isResolved(target)) {
            ranges.push(
              Decoration.mark({ class: "cm-link-unresolved" }).range(
                node.from,
                node.to,
              ),
            );
          }
        }
        return false;
      },
    });
    for (const marker of computeTaskMarkers(state, from, to)) {
      ranges.push(
        Decoration.replace({
          widget: new CheckboxWidget(marker.checked, marker.pos),
        }).range(marker.pos, marker.pos + 3),
      );
    }
    for (const mark of computeListMarks(state, from, to)) {
      if (mark.kind === "task") {
        ranges.push(hideMark.range(mark.from, mark.to));
      } else {
        ranges.push(bulletDecoration.range(mark.from, mark.to));
      }
    }
    for (const info of computeListLines(state, from, to)) {
      const style = [`--list-indent: ${info.width}ch`];
      if (info.guides.length > 0) {
        // One vertical 1px gradient layer per ancestor level, at that
        // level's content column; the line box spans wrapped lines, so
        // guides stay continuous.
        const guide =
          "linear-gradient(var(--indentation-guide), var(--indentation-guide))";
        style.push(
          `background-image: ${info.guides.map(() => guide).join(", ")}`,
          `background-position: ${info.guides
            .map((column) => `calc(1em + ${column}ch - 1px) 0`)
            .join(", ")}`,
          "background-size: 1px 100%",
          "background-repeat: no-repeat",
        );
      }
      ranges.push(
        Decoration.line({
          class: "cm-list-line",
          attributes: { style: style.join("; ") },
        }).range(info.from),
      );
      if (info.leading !== null) {
        ranges.push(
          Decoration.mark({
            class: "cm-list-ws",
            attributes: { style: `width: ${info.leading.width}ch` },
          }).range(info.leading.from, info.leading.to),
        );
      }
      if (info.marker !== null) {
        ranges.push(
          Decoration.mark({
            class: "cm-list-number",
            attributes: { style: `width: ${info.marker.width}ch` },
          }).range(info.marker.from, info.marker.to),
        );
      }
    }
    for (const lineFrom of computeDoneTaskLines(state, from, to)) {
      ranges.push(taskDoneLine.range(lineFrom));
    }
    for (const heading of computeHeadingLines(state, from, to)) {
      ranges.push(headingLines[heading.level - 1].range(heading.from));
    }
    for (const rule of computeHorizontalRules(state, from, to)) {
      ranges.push(hrDecoration.range(rule.from, rule.to));
    }
    for (const math of computeMathRanges(state, from, to)) {
      const sameLine =
        state.doc.lineAt(math.from).number === state.doc.lineAt(math.to).number;
      if (sameLine) {
        // Multi-line math blocks are block decorations and live in the
        // state field below.
        ranges.push(
          Decoration.replace({
            widget: new MathWidget(math.tex, math.display, math.from),
          }).range(math.from, math.to),
        );
      }
    }
  }
  return Decoration.set(ranges, true);
}

// Block decorations may not come from a ViewPlugin (CodeMirror throws),
// so inactive tables and multi-line math blocks are replaced through a
// StateField instead.
function buildBlockDecorations(state: EditorState): DecorationSet {
  ensureSyntaxTree(state, state.doc.length, 50);
  const ranges: Range<Decoration>[] = [];
  if (inlineTitleText !== null) {
    ranges.push(
      Decoration.widget({
        widget: new InlineTitleWidget(inlineTitleText),
        side: -2,
        block: true,
      }).range(0),
    );
  }
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Frontmatter") {
        // Always replaced: the raw YAML is never edited in place — the
        // widget's controls are the only way in.
        ranges.push(
          Decoration.replace({
            widget: new PropertiesWidget(
              state.doc.sliceString(node.from, node.to),
              node.to,
            ),
            block: true,
          }).range(node.from, node.to),
        );
        return false;
      }
      if (node.name === "Table") {
        // Always a widget: tables are never edited as raw text.
        const from = state.doc.lineAt(node.from).from;
        const to = state.doc.lineAt(node.to).to;
        ranges.push(
          Decoration.replace({
            widget: new TableWidget(state.doc.sliceString(from, to), from),
            block: true,
          }).range(from, to),
        );
        return false;
      }
      if (node.name === "Blockquote" && !hasBlockquoteAncestor(node.node)) {
        // Collapsed callout: hide everything after the title line.
        // The range crosses line breaks, so it must come from this
        // state field, not the view plugin.
        const callout = calloutForQuote(state, node.node);
        if (
          callout !== null &&
          callout.fold === "-" &&
          callout.titleTo < node.to &&
          !selectionTouches(state, node.from, node.to)
        ) {
          ranges.push(Decoration.replace({}).range(callout.titleTo, node.to));
          return false;
        }
        return;
      }
      if (node.name === "MathBlock") {
        const fromLine = state.doc.lineAt(node.from);
        const toLine = state.doc.lineAt(node.to);
        if (fromLine.number === toLine.number) {
          return false; // single-line: handled inline by the view plugin
        }
        if (selectionTouches(state, node.from, node.to)) {
          return false;
        }
        for (const math of computeMathRanges(state, node.from, node.to)) {
          if (math.from === node.from) {
            ranges.push(
              Decoration.replace({
                widget: new MathWidget(math.tex, true, node.from, true),
                block: true,
              }).range(fromLine.from, toLine.to),
            );
          }
        }
        return false;
      }
      return;
    },
  });
  return Decoration.set(ranges, true);
}

const blockDecorations = StateField.define<DecorationSet>({
  create: buildBlockDecorations,
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection !== undefined ||
      tr.effects.some((effect) => effect.is(refreshBlockDecorations))
    ) {
      return buildBlockDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * The blank line after a table is protected: navigable but never
 * deletable (two tables must not merge), and typing on it pushes the
 * text to a fresh line below so it always stays blank.
 */
export const tableBlankGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) {
    return tr;
  }
  const state = tr.startState;
  interface Guard {
    tableFrom: number;
    newline: number;
    lineFrom: number;
    lineTo: number;
  }
  const guards: Guard[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") {
        return;
      }
      const end = state.doc.lineAt(node.to).to;
      if (end < state.doc.length) {
        const guardLine = state.doc.lineAt(end + 1);
        if (guardLine.text.trim() === "") {
          guards.push({
            tableFrom: state.doc.lineAt(node.from).from,
            newline: end,
            lineFrom: guardLine.from,
            lineTo: guardLine.to,
          });
        }
      }
      return false;
    },
  });
  if (guards.length === 0) {
    return tr;
  }
  // Pure insertion on a guard line: push the text to a fresh line below
  // so the guard stays blank.
  const retyped: { pos: number; text: string; fromB: number; toB: number }[] =
    [];
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const text = inserted.toString();
    for (const guard of guards) {
      if (
        fromA === toA &&
        fromA >= guard.lineFrom &&
        fromA <= guard.lineTo &&
        text !== "" &&
        !text.startsWith("\n")
      ) {
        retyped.push({ pos: fromA, text, fromB, toB });
      }
    }
  });
  const typed = retyped[0];
  if (typed !== undefined) {
    // Keep the transaction's intended cursor when it sits inside the
    // inserted text (menu snippets place it there), shifted past the
    // extra newline; otherwise put it after the insertion.
    const intended = tr.newSelection.main.anchor;
    const anchor =
      intended >= typed.fromB && intended <= typed.toB
        ? intended + 1
        : typed.pos + 1 + typed.text.length;
    return [
      {
        changes: { from: typed.pos, to: typed.pos, insert: `\n${typed.text}` },
        selection: { anchor },
        scrollIntoView: true,
      },
    ];
  }
  // Anything else: check the invariant on the resulting document — the
  // line after every surviving table must still be blank. This blocks
  // deleting the blank line (merging whatever follows, table or not)
  // while still allowing a table to be deleted whole.
  for (const guard of guards) {
    const tableStart = tr.changes.mapPos(guard.tableFrom, 1);
    const tableEnd = tr.changes.mapPos(guard.newline, -1);
    if (tableEnd <= tableStart) {
      continue;
    }
    const endLine = tr.newDoc.lineAt(Math.min(tableEnd, tr.newDoc.length));
    if (endLine.to >= tr.newDoc.length) {
      continue;
    }
    const after = tr.newDoc.lineAt(endLine.to + 1);
    if (after.text.trim() !== "") {
      return [];
    }
  }
  return tr;
});

/** Frontmatter and tables are atomic: the cursor never sits inside. */
const frontmatterAtomic = EditorView.atomicRanges.of((view) => {
  const ranges: Range<Decoration>[] = [];
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name === "Frontmatter" && node.from === 0) {
        ranges.push(hideMark.range(node.from, node.to));
        return false;
      }
      if (node.name === "Table") {
        ranges.push(hideMark.range(node.from, node.to));
        return false;
      }
      return;
    },
  });
  return Decoration.set(ranges, true);
});

/**
 * Collapsed block widgets are atomic for vertical motion, so plain
 * arrows would hop over them. When the adjacent line lies inside a
 * collapsed block, enter it instead (first line going down, last line
 * going up) — the selection change reveals the block.
 */
function moveIntoBlock(view: EditorView, forward: boolean): boolean {
  const state = view.state;
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }
  const line = state.doc.lineAt(selection.head);
  const targetPos = forward
    ? line.to >= state.doc.length
      ? -1
      : line.to + 1
    : line.from === 0
      ? -1
      : line.from - 1;
  if (targetPos < 0) {
    return false;
  }
  const decorations = state.field(blockDecorations, false);
  if (decorations === undefined) {
    return false;
  }
  let blockFrom = -1;
  let blockTo = -1;
  decorations.between(targetPos, targetPos, (from, to) => {
    blockFrom = from;
    blockTo = to;
    return false;
  });
  if (blockFrom < 0) {
    return false;
  }
  // Never step into the frontmatter or a table: their widgets are the
  // only editors (math blocks remain enterable).
  if (blockFrom === 0 && state.doc.sliceString(0, 3) === "---") {
    return false;
  }
  let insideTable = false;
  syntaxTree(state).iterate({
    from: blockFrom,
    to: blockFrom,
    enter(node) {
      if (node.name === "Table") {
        insideTable = true;
      }
    },
  });
  if (insideTable) {
    return false;
  }
  const entry = forward ? blockFrom : state.doc.lineAt(blockTo).from;
  view.dispatch({ selection: { anchor: entry }, scrollIntoView: true });
  return true;
}

export function livePreview(hooks: LivePreviewHooks) {
  return [
    blockDecorations,
    frontmatterAtomic,
    tableBlankGuard,
    Prec.high(
      keymap.of([
        { key: "ArrowDown", run: (view) => moveIntoBlock(view, true) },
        { key: "ArrowUp", run: (view) => moveIntoBlock(view, false) },
      ]),
    ),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, hooks);
        }

        update(update: ViewUpdate) {
          const hasEffects = update.transactions.some(
            (tr) => tr.effects.length > 0,
          );
          if (
            update.docChanged ||
            update.selectionSet ||
            update.viewportChanged ||
            hasEffects
          ) {
            this.decorations = buildDecorations(update.view, hooks);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}
