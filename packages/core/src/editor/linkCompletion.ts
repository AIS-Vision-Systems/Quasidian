// What to offer while a link is being typed: note names after "[[",
// headings after a "#", paths inside "](...)". One function, fed with
// the text around the cursor, so the editor's autocompletion and the
// table cells — which are not CodeMirror text — complete alike. No
// DOM and no CodeMirror: the host supplies the names through hooks.

import { isExternalTarget } from "../markdown/wikilinks";

export interface LinkCompletionHooks {
  /** File names offered after `[[`: markdown basenames and image files. */
  getWikilinkCompletions(): string[];
  /** Paths (with extension) offered inside a markdown link's `](...)`. */
  getLinkPathCompletions(): string[];
  /** Heading texts of a note ("" is the open one), offered after `#`. */
  getHeadingCompletions(note: string): Promise<string[]>;
}

export interface LinkCompletionOption {
  /** What the list shows. */
  label: string;
  /** What replaces the typed fragment. */
  apply: string;
}

export interface LinkCompletion {
  /** Offset in the text before the cursor where the fragment starts. */
  from: number;
  options: LinkCompletionOption[];
  /**
   * True when the options are already narrowed to the typed fragment
   * and ordered: the caller must not filter them again.
   */
  filtered: boolean;
  /**
   * While the fragment still matches this, the same options hold and
   * only need narrowing — no need to ask again.
   */
  validFor?: RegExp;
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text; // malformed escapes: what was typed
  }
}

/**
 * The completion for a cursor that has `before` to its left and
 * `after` to its right on the same line, or null when no link is
 * being typed there.
 */
export async function completeLink(
  before: string,
  after: string,
  hooks: LinkCompletionHooks,
): Promise<LinkCompletion | null> {
  // [[note#heading — the note's headings (no note: the open file).
  const wikiAnchor = /\[\[([^\][|#]*)#[^\][|#]*$/.exec(before);
  if (wikiAnchor !== null) {
    const closed = after.startsWith("]]");
    const headings = await hooks.getHeadingCompletions(wikiAnchor[1].trim());
    return {
      from: wikiAnchor.index + 2 + wikiAnchor[1].length + 1,
      options: headings.map((heading) => ({
        label: heading,
        apply: closed ? heading : heading + "]]",
      })),
      filtered: false,
      validFor: /^[^\][|#]*$/,
    };
  }
  // [[note
  const wiki = /\[\[[^\][|]*$/.exec(before);
  if (wiki !== null) {
    const closed = after.startsWith("]]");
    return {
      from: wiki.index + 2,
      options: hooks.getWikilinkCompletions().map((name) => ({
        label: name,
        apply: closed ? name : name + "]]",
      })),
      filtered: false,
      validFor: /^[^\][|#]*$/,
    };
  }
  // [text](path#heading — the headings of that note. A heading goes
  // in as written, spaces included: such links are understood (m47).
  const linkAnchor = /\]\((<?)([^)#\n]*)#[^)\n]*$/.exec(before);
  if (linkAnchor !== null) {
    const angle = linkAnchor[1] === "<";
    const close = angle ? ">)" : ")";
    const closed = after.startsWith(close);
    const note = decoded(linkAnchor[2].trim());
    // A web address has no headings to look up.
    if (isExternalTarget(note)) {
      return null;
    }
    const headings = await hooks.getHeadingCompletions(note);
    return {
      from: linkAnchor.index + 2 + linkAnchor[1].length + linkAnchor[2].length + 1,
      options: headings.map((heading) => ({
        label: heading,
        apply: closed ? heading : heading + close,
      })),
      filtered: false,
      validFor: /^[^)\n]*$/,
    };
  }
  // [text](path — note and image paths. The typed fragment matches
  // anywhere in the path ("guid" finds "src/help/guide.ca.md"),
  // earliest occurrence first.
  const link = /\]\([^)\s]*$/.exec(before);
  if (link !== null) {
    const closed = after.startsWith(")");
    const typed = decoded(link[0].slice(2).toLowerCase());
    const options = hooks
      .getLinkPathCompletions()
      .map((path) => ({ path, at: path.toLowerCase().indexOf(typed) }))
      .filter((entry) => entry.at !== -1)
      .sort((a, b) => a.at - b.at || a.path.localeCompare(b.path))
      .map((entry) => {
        // Spaces are percent-encoded, as markdown URLs require.
        const encoded = encodeURI(entry.path);
        return {
          label: entry.path,
          apply: closed ? encoded : encoded + ")",
        };
      });
    return { from: link.index + 2, options, filtered: true };
  }
  return null;
}

/**
 * Narrows options to a typed fragment, for callers without a filter
 * of their own: those that start with it first, then those that
 * contain it, each group in its given order. Case-insensitive.
 */
export function narrowOptions(
  options: LinkCompletionOption[],
  typed: string,
): LinkCompletionOption[] {
  const needle = typed.toLowerCase();
  if (needle === "") {
    return options;
  }
  const starts: LinkCompletionOption[] = [];
  const contains: LinkCompletionOption[] = [];
  for (const option of options) {
    const at = option.label.toLowerCase().indexOf(needle);
    if (at === 0) {
      starts.push(option);
    } else if (at > 0) {
      contains.push(option);
    }
  }
  return [...starts, ...contains];
}
