// Pure module: no Tauri, no DOM. Subsequence fuzzy matching with scoring,
// case- and diacritic-insensitive (so "alies" finds "àlies").

export interface FuzzyMatch {
  score: number;
  /** Indices (in code points) of the matched characters, for highlighting. */
  positions: number[];
}

function normalizeChar(ch: string): string {
  return ch
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function isWordBoundary(previous: string): boolean {
  return /[\s\-_./\\([{]/.test(previous);
}

/**
 * Greedy forward subsequence match of `query` inside `text`.
 * Scoring favors consecutive characters, matches at the start of the text
 * and at word boundaries; ties break toward tighter and shorter texts.
 * Returns null when `query` is not a subsequence of `text`.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const queryChars = Array.from(query).map(normalizeChar);
  if (queryChars.length === 0) {
    return { score: 0, positions: [] };
  }
  const textChars = Array.from(text);
  const normalized = textChars.map(normalizeChar);

  const positions: number[] = [];
  let score = 0;
  let searchFrom = 0;
  let lastMatch = -2;

  for (const queryChar of queryChars) {
    let found = -1;
    for (let i = searchFrom; i < normalized.length; i++) {
      if (normalized[i] === queryChar) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      return null;
    }
    let charScore = 1;
    if (found === lastMatch + 1) {
      charScore += 3;
    }
    if (found === 0) {
      charScore += 4;
    } else if (isWordBoundary(textChars[found - 1])) {
      charScore += 2;
    }
    score += charScore;
    positions.push(found);
    lastMatch = found;
    searchFrom = found + 1;
  }

  const spread = positions[positions.length - 1] - positions[0] - (queryChars.length - 1);
  score -= spread * 0.05;
  score -= textChars.length * 0.01;
  return { score, positions };
}

export interface FuzzyResult<T> {
  item: T;
  match: FuzzyMatch;
}

/**
 * Filters and ranks `items` by fuzzy-matching `query` against `key(item)`.
 * An empty query keeps every item in the original order.
 */
export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  key: (item: T) => string,
): Array<FuzzyResult<T>> {
  const results: Array<FuzzyResult<T>> = [];
  for (const item of items) {
    const match = fuzzyMatch(query, key(item));
    if (match !== null) {
      results.push({ item, match });
    }
  }
  if (query !== "") {
    results.sort((a, b) => b.match.score - a.match.score);
  }
  return results;
}
