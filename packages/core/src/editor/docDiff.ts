// Minimal document replacement for reloads (m44). Reloading an open
// note used to replace the whole document, which threw away every
// reusable syntax-tree fragment and every measured block height. The
// smallest changed range keeps both alive outside the edit.

/** CodeMirror stores documents with "\n"; disk contents may not. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export interface DocChange {
  from: number;
  to: number;
  insert: string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * The smallest single replacement that turns `current` (an editor
 * document, already "\n"-separated) into `next` (line endings are
 * normalized first): the common prefix and suffix stay untouched.
 * Null when nothing changes. The range never splits a surrogate pair.
 */
export function minimalChange(current: string, next: string): DocChange | null {
  const target = normalizeLineEndings(next);
  if (target === current) {
    return null;
  }
  const shortest = Math.min(current.length, target.length);
  let prefix = 0;
  while (
    prefix < shortest &&
    current.charCodeAt(prefix) === target.charCodeAt(prefix)
  ) {
    prefix++;
  }
  // A shared high surrogate followed by differing low ones: the pair
  // changes as a whole.
  if (prefix > 0 && isHighSurrogate(current.charCodeAt(prefix - 1))) {
    prefix--;
  }
  let suffix = 0;
  const maxSuffix = shortest - prefix;
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - 1 - suffix) ===
      target.charCodeAt(target.length - 1 - suffix)
  ) {
    suffix++;
  }
  // A shared low surrogate preceded by differing high ones.
  if (
    suffix > 0 &&
    isLowSurrogate(current.charCodeAt(current.length - suffix))
  ) {
    suffix--;
  }
  return {
    from: prefix,
    to: current.length - suffix,
    insert: target.slice(prefix, target.length - suffix),
  };
}
