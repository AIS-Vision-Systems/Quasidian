// Live Preview: hide markdown syntax tokens outside the active line or
// selection, like Obsidian. Inline marks (bold, italic, code, strikethrough)
// reveal when the selection touches the whole element's range; block marks
// (heading #, quote >) reveal when their line is active.
import { syntaxTree } from "@codemirror/language";
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
import { isImageTarget } from "../markdown/wikilinks";

export interface HiddenRange {
  from: number;
  to: number;
}

export interface LivePreviewHooks {
  /** Resolves an embed target to a loadable URL, or null if unknown. */
  resolveEmbedSrc(target: string): string | null;
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
 * be unit-tested on headless EditorStates.
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
      if (node.name === "Wikilink" || node.name === "Embed") {
        if (node.name === "Embed") {
          const path = node.node.getChild("WikilinkPath");
          const target =
            path === null ? "" : state.doc.sliceString(path.from, path.to);
          if (isImageTarget(target)) {
            // Image embeds are replaced whole by a widget, not mark-hidden.
            return false;
          }
        }
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

export interface ImageEmbed {
  from: number;
  to: number;
  target: string;
}

/**
 * Pure computation of the image embeds to replace with widgets in
 * [from, to]: those whose range the selection does not touch.
 */
export function computeImageEmbeds(
  state: EditorState,
  from: number,
  to: number,
): ImageEmbed[] {
  const embeds: ImageEmbed[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "Embed") {
        return;
      }
      const path = node.node.getChild("WikilinkPath");
      if (path === null) {
        return false;
      }
      const target = state.doc.sliceString(path.from, path.to);
      if (!isImageTarget(target)) {
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

const hideMark = Decoration.replace({});
const blockquoteLine = Decoration.line({ class: "cm-blockquote-line" });
const codeblockLine = Decoration.line({ class: "cm-codeblock-line" });

function hasBlockquoteAncestor(node: SyntaxNode): boolean {
  for (let cur = node.parent; cur !== null; cur = cur.parent) {
    if (cur.name === "Blockquote") {
      return true;
    }
  }
  return false;
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

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name === "Blockquote" && !hasBlockquoteAncestor(node.node)) {
          decorateLines(node.node, blockquoteLine);
          return;
        }
        if (node.name === "FencedCode" || node.name === "CodeBlock") {
          decorateLines(node.node, codeblockLine);
          return;
        }
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
    for (const marker of computeTaskMarkers(state, from, to)) {
      ranges.push(
        Decoration.replace({
          widget: new CheckboxWidget(marker.checked, marker.pos),
        }).range(marker.pos, marker.pos + 3),
      );
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
