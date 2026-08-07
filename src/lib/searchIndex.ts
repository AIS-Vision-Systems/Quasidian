// Pure module: no Tauri, no DOM. In-memory full-text search over the open
// folder — same lifecycle as the backlink index: built on folder open,
// kept fresh by the file watcher. Plain case-insensitive substring, line
// by line; no operators, no regex.
import { normalizePath } from "./paths";

export interface SearchMatch {
  /** 1-based line number. */
  lineNumber: number;
  lineText: string;
  /** Absolute document offsets, for jumping to the match. */
  from: number;
  to: number;
  /** Column offsets within lineText, for highlighting. */
  colFrom: number;
  colTo: number;
}

export interface SearchResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchOutcome {
  results: SearchResult[];
  totalMatches: number;
  truncated: boolean;
}

const MAX_MATCHES_PER_FILE = 20;
const MAX_TOTAL_MATCHES = 200;

export interface SearchIndex {
  setFile(path: string, doc: string): void;
  removeFile(path: string): void;
  clear(): void;
  search(query: string): SearchOutcome;
}

export function createSearchIndex(): SearchIndex {
  const files = new Map<string, { path: string; doc: string }>();

  return {
    setFile(path, doc) {
      files.set(normalizePath(path), { path, doc });
    },

    removeFile(path) {
      files.delete(normalizePath(path));
    },

    clear() {
      files.clear();
    },

    search(query) {
      const needle = query.trim().toLowerCase();
      if (needle === "") {
        return { results: [], totalMatches: 0, truncated: false };
      }
      const results: SearchResult[] = [];
      let totalMatches = 0;
      let truncated = false;
      const sorted = [...files.values()].sort((a, b) =>
        a.path.localeCompare(b.path),
      );
      for (const file of sorted) {
        if (totalMatches >= MAX_TOTAL_MATCHES) {
          truncated = true;
          break;
        }
        const matches: SearchMatch[] = [];
        let lineStart = 0;
        let lineNumber = 0;
        lines: for (const line of file.doc.split("\n")) {
          lineNumber++;
          const lower = line.toLowerCase();
          let column = lower.indexOf(needle);
          while (column !== -1) {
            if (
              matches.length >= MAX_MATCHES_PER_FILE ||
              totalMatches >= MAX_TOTAL_MATCHES
            ) {
              truncated = true;
              break lines;
            }
            matches.push({
              lineNumber,
              lineText: line,
              from: lineStart + column,
              to: lineStart + column + needle.length,
              colFrom: column,
              colTo: column + needle.length,
            });
            totalMatches++;
            column = lower.indexOf(needle, column + needle.length);
          }
          lineStart += line.length + 1;
        }
        if (matches.length > 0) {
          results.push({ path: file.path, matches });
        }
      }
      return { results, totalMatches, truncated };
    },
  };
}
