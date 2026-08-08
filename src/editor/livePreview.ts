// Live Preview: hide markdown syntax tokens outside the active line or
// selection, like Obsidian. Inline marks (bold, italic, code, strikethrough)
// reveal when the selection touches the whole element's range; block marks
// (heading #, quote >) reveal when their line is active. Embeds, task
// markers, bullets, code fences and tables render as widgets/decorations
// when inactive and reveal their raw text on touch.
import { LanguageDescription, syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { SyntaxNode } from "@lezer/common";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { renderToHtml } from "../markdown/render";
import { isImageTarget } from "../markdown/wikilinks";

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
      if (node.name === "QuoteMark" && parent.name === "Blockquote") {
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
        embeds.push({ from: node.from, to: node.to, target });
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

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string | null,
    readonly target: string,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.target === this.target;
  }

  toDOM(): HTMLElement {
    if (this.src === null) {
      const missing = document.createElement("span");
      missing.className = "cm-embed-missing";
      missing.textContent = this.target;
      return missing;
    }
    const image = document.createElement("img");
    image.className = "cm-embed-image";
    image.src = this.src;
    image.alt = this.target;
    return image;
  }
}

class NoteEmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly hooks: LivePreviewHooks,
  ) {
    super();
  }

  override eq(other: NoteEmbedWidget): boolean {
    return other.target === this.target;
  }

  toDOM(): HTMLElement {
    const container = document.createElement("span");
    container.className = "cm-embed-note";
    const title = document.createElement("span");
    title.className = "cm-embed-note-title";
    title.textContent = this.target;
    title.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.hooks.onNavigate(this.target);
    });
    const body = document.createElement("span");
    body.className = "cm-embed-note-body";
    container.append(title, body);
    void this.hooks.renderEmbedNote(this.target).then((html) => {
      if (html === null) {
        title.classList.add("cm-embed-missing");
      } else {
        body.innerHTML = html;
      }
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

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "cm-table-widget";
    container.innerHTML = renderToHtml(this.source);
    return container;
  }
}

const hideMark = Decoration.replace({});
const blockquoteLine = Decoration.line({ class: "cm-blockquote-line" });
const codeblockLine = Decoration.line({ class: "cm-codeblock-line" });
const bulletDecoration = Decoration.replace({ widget: new BulletWidget() });

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
        if (
          node.name === "Table" &&
          !selectionTouches(state, node.from, node.to)
        ) {
          const tableFrom = state.doc.lineAt(node.from).from;
          const tableTo = state.doc.lineAt(node.to).to;
          ranges.push(
            Decoration.replace({
              widget: new TableWidget(state.doc.sliceString(tableFrom, tableTo)),
              block: true,
            }).range(tableFrom, tableTo),
          );
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
          widget: new ImageWidget(hooks.resolveEmbedSrc(embed.target), embed.target),
        }).range(embed.from, embed.to),
      );
    }
    for (const embed of computeNoteEmbeds(state, from, to)) {
      ranges.push(
        Decoration.replace({
          widget: new NoteEmbedWidget(embed.target, hooks),
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
  }
  return Decoration.set(ranges, true);
}

export function livePreview(hooks: LivePreviewHooks) {
  return ViewPlugin.fromClass(
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
  );
}
