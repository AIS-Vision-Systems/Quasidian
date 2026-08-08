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
import { StateField, type EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import katex from "katex";
import { renderToHtml } from "../markdown/render";
import { isImageTarget } from "../markdown/wikilinks";
import {
  fillEmbedImages,
  highlightCodeBlocks,
  renderMathElements,
} from "../ui/renderedContent";

export interface HiddenRange {
  from: number;
  to: number;
}

export interface LivePreviewHooks {
  /** Resolves an embed target to a loadable URL, or null if unknown. */
  resolveEmbedSrc(target: string): string | null;
  /** Renders a note embed target to HTML, or null if unknown. */
  renderEmbedNote(target: string): Promise<string | null>;
  /** Navigates to a wikilink/embed target. */
  onNavigate(target: string): void;
}

/** Inline mark node name → element node names whose range reveals it. */
const INLINE_MARKS: Record<string, string[]> = {
  EmphasisMark: ["Emphasis", "StrongEmphasis"],
  CodeMark: ["InlineCode"],
  StrikethroughMark: ["Strikethrough"],
  HighlightMark: ["Highlight"],
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
      if (node.name === "Table" && !selectionTouches(state, node.from, node.to)) {
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
      if (node.name === "Table" && !selectionTouches(state, node.from, node.to)) {
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
      if (!selectionTouchesLine(state, node.from)) {
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
 * Pure computation of bullet-list marks in [from, to] on inactive lines:
 * plain items show a bullet instead of the dash/star/plus mark; task items
 * hide the mark so only the checkbox shows. Ordered lists keep numbers.
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
      if (selectionTouchesLine(state, node.from)) {
        return;
      }
      if (item.getChild("Task") !== null) {
        const range = withFollowingSpace(state, node.from, node.to);
        marks.push({ from: range.from, to: range.to, kind: "task" });
      } else {
        marks.push({ from: node.from, to: node.to, kind: "bullet" });
      }
    },
  });
  return marks;
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
    const image = document.createElement("img");
    image.className = "cm-embed-image";
    // The real height is known only once loaded; remeasure so the gutter
    // and coordinate mapping stay aligned with the content.
    image.addEventListener("load", () => view.requestMeasure());
    image.src = this.src;
    const dimensions = parseImageDimensions(this.alias);
    if (dimensions === null) {
      image.alt = this.alias ?? this.target;
    } else {
      image.alt = this.target;
      image.width = dimensions.width;
      if (dimensions.height !== null) {
        image.height = dimensions.height;
      }
    }
    return image;
  }
}

class NoteEmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly alias: string | null,
    readonly hooks: LivePreviewHooks,
  ) {
    super();
  }

  override eq(other: NoteEmbedWidget): boolean {
    return other.target === this.target && other.alias === this.alias;
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
    void this.hooks.renderEmbedNote(this.target).then((html) => {
      if (html === null) {
        title.classList.add("cm-embed-missing");
      } else {
        body.innerHTML = html;
        fillEmbedImages(body, this.hooks.resolveEmbedSrc);
        highlightCodeBlocks(body);
        renderMathElements(body);
        for (const image of body.querySelectorAll("img")) {
          image.addEventListener("load", () => view.requestMeasure());
        }
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
  ) {
    super();
  }

  override eq(other: MathWidget): boolean {
    return (
      other.tex === this.tex &&
      other.display === this.display &&
      other.pos === this.pos
    );
  }

  toDOM(view: EditorView): HTMLElement {
    // Always a span: inline uses must not introduce block boxes inside a
    // text line (they desync the gutter); CSS makes the display variant
    // full-width.
    const container = document.createElement("span");
    container.className = this.display ? "cm-math cm-math-block" : "cm-math";
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
    container.className = "cm-table-widget markdown-rendered";
    container.innerHTML = renderToHtml(this.source);
    // Clicking the table reveals its raw markdown with the cursor inside.
    container.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.pos } });
      view.focus();
    });
    return container;
  }
}

const hideMark = Decoration.replace({});
const blockquoteLine = Decoration.line({ class: "cm-blockquote-line" });
const codeblockLine = Decoration.line({ class: "cm-codeblock-line" });
const bulletDecoration = Decoration.replace({ widget: new BulletWidget() });
const hrDecoration = Decoration.replace({ widget: new HrWidget() });

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

  function decorateFencedCode(node: SyntaxNode): void {
    decorateLines(node, codeblockLine);
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
    ranges.push(
      Decoration.line({
        class: "cm-codeblock-open",
        attributes: display === "" ? {} : { "data-lang": display },
      }).range(openLine.from),
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
          decorateLines(node.node, blockquoteLine);
          return;
        }
        if (node.name === "FencedCode") {
          decorateFencedCode(node.node);
          return false;
        }
        if (node.name === "CodeBlock") {
          decorateLines(node.node, codeblockLine);
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
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Table") {
        if (selectionTouches(state, node.from, node.to)) {
          return false;
        }
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
                widget: new MathWidget(math.tex, true, node.from),
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
    if (tr.docChanged || tr.selection !== undefined) {
      return buildBlockDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function livePreview(hooks: LivePreviewHooks) {
  return [
    blockDecorations,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, hooks);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = buildDecorations(update.view, hooks);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}
