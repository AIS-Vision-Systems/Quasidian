// Pure module: callout detection over blockquote text (`> [!note] Títol`)
// and the per-type color/icon catalogue, shared by both modes.
import type { IconName } from "../ui/icons";

export interface CalloutHeader {
  type: string;
  /** Title text after the marker; empty means "use the type name". */
  title: string;
  /** Length of the `[!type]` marker plus one following space. */
  markerLength: number;
  /** Fold marker: "-" starts collapsed, "+" expanded, null not foldable. */
  fold: "+" | "-" | null;
  /** Offset of the fold sign within the first line (right after `]`). */
  signOffset: number;
}

// The type catalogue follows Obsidian's callout help page (aliases
// included).
const CALLOUT_STYLES: Record<string, { color: string; icon: IconName }> = {
  note: { color: "68,138,255", icon: "pencil" },
  info: { color: "68,138,255", icon: "info" },
  todo: { color: "68,138,255", icon: "check" },
  abstract: { color: "0,176,255", icon: "list" },
  summary: { color: "0,176,255", icon: "list" },
  tldr: { color: "0,176,255", icon: "list" },
  tip: { color: "0,191,188", icon: "flame" },
  hint: { color: "0,191,188", icon: "flame" },
  important: { color: "0,191,188", icon: "flame" },
  success: { color: "68,207,110", icon: "check" },
  check: { color: "68,207,110", icon: "check" },
  done: { color: "68,207,110", icon: "check" },
  question: { color: "233,151,63", icon: "help-circle" },
  help: { color: "233,151,63", icon: "help-circle" },
  faq: { color: "233,151,63", icon: "help-circle" },
  warning: { color: "233,151,63", icon: "alert-triangle" },
  caution: { color: "233,151,63", icon: "alert-triangle" },
  attention: { color: "233,151,63", icon: "alert-triangle" },
  danger: { color: "233,49,71", icon: "alert-triangle" },
  error: { color: "233,49,71", icon: "alert-triangle" },
  failure: { color: "233,49,71", icon: "x" },
  fail: { color: "233,49,71", icon: "x" },
  missing: { color: "233,49,71", icon: "x" },
  bug: { color: "233,49,71", icon: "x" },
  example: { color: "168,130,255", icon: "list" },
  quote: { color: "158,158,158", icon: "text" },
  cite: { color: "158,158,158", icon: "text" },
};

const DEFAULT_STYLE = { color: "68,138,255", icon: "pencil" as IconName };

/** Parses `[!type] Títol` at the start of a blockquote's first line. */
export function parseCalloutHeader(firstLine: string): CalloutHeader | null {
  const match = /^\[!([A-Za-z]+)\]([+-])?( ?)(.*)$/.exec(firstLine);
  if (match === null) {
    return null;
  }
  const headerLength = firstLine.length - match[4].length;
  return {
    type: match[1].toLowerCase(),
    title: match[4].trim(),
    markerLength: headerLength,
    fold: match[2] === "+" || match[2] === "-" ? match[2] : null,
    signOffset: 2 + match[1].length + 1,
  };
}

export function calloutColor(type: string): string {
  return (CALLOUT_STYLES[type] ?? DEFAULT_STYLE).color;
}

export function calloutIcon(type: string): IconName {
  return (CALLOUT_STYLES[type] ?? DEFAULT_STYLE).icon;
}
