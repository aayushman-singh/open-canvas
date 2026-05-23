// src/search/snippet.ts
//
// Helpers that build the `ts_headline` configuration string used by
// `searchSite` to compute per-row snippets, plus an in-memory fallback the
// smoke uses to verify the snippet shape end-to-end without a live Postgres.
//
// The Postgres `ts_headline` function takes a config string of comma-
// separated `Option=value` pairs that influence how matches are highlighted.
// We use:
//
//   MaxWords=15, MinWords=5         → keep snippets short.
//   StartSel=<mark>, StopSel=</mark> → emit HTML-safe wrappers the visitor
//                                      page can style with the existing
//                                      `<mark>` CSS.
//
// All four values are static; the only escaping we do at runtime is on the
// `text` and `q` parameters themselves, which is handled by the parameter
// binding (we never interpolate user input into the SQL string).

import type { SearchEntryDraft } from './extract.js';

/**
 * The fixed `ts_headline` options string. Exported as a constant so the
 * smoke can assert on exactly what production sends.
 */
export const TS_HEADLINE_OPTIONS = 'MaxWords=15, MinWords=5, StartSel=<mark>, StopSel=</mark>';

/**
 * Default snippet length cap when we synthesise a snippet in-memory (smoke
 * path). Real Postgres `ts_headline` enforces this via MaxWords; the
 * in-memory path mirrors the cap in characters.
 */
const IN_MEMORY_MAX_CHARS = 200;

const MARK_HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escapeForMark(text: string): string {
  return text.replace(/[&<>]/g, (ch) => MARK_HTML_ESCAPES[ch] ?? ch);
}

/**
 * Tokenise a query string into lower-case word tokens. Mirrors what Postgres
 * `plainto_tsquery('english', q)` would do at a coarse level — splits on
 * non-word characters and lower-cases. The Postgres tokeniser also strips
 * stopwords and applies stemming; for the smoke's coverage we accept the
 * imperfect overlap because the assertions use distinctive words.
 */
export function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * In-memory equivalent of `to_tsvector('english', text) @@ plainto_tsquery('english', q)`.
 * Returns `true` when every token in `q` is present as a substring in `text`
 * (case-insensitive). This is intentionally a weaker contract than the
 * Postgres FTS — stemming is omitted — so the smoke chooses query words that
 * appear verbatim in the indexed text.
 */
export function inMemoryMatches(text: string, q: string): boolean {
  const tokens = tokenizeQuery(q);
  if (tokens.length === 0) return false;
  const lower = text.toLowerCase();
  return tokens.every((t) => lower.includes(t));
}

/**
 * In-memory snippet builder used by the smoke. Mirrors the `<mark>`-wrapped
 * shape Postgres `ts_headline` would produce so the smoke can assert on the
 * exact string structure.
 *
 * Behaviour:
 *   - Find the first occurrence of any query token in `text`.
 *   - Center a window of up to MAX_CHARS characters on the match.
 *   - Wrap each token occurrence in the window in `<mark>...</mark>`.
 *   - HTML-escape the non-mark characters so a stray `<` in user text does
 *     not break the rendered snippet.
 *   - Returns the original (escaped) text when no match is found — the
 *     caller decides what to do with no-match rows (production filters them
 *     out before headline runs).
 */
export function buildInMemorySnippet(text: string, q: string): string {
  const tokens = tokenizeQuery(q);
  if (tokens.length === 0) return escapeForMark(text.slice(0, IN_MEMORY_MAX_CHARS));

  const lower = text.toLowerCase();
  let firstIdx = -1;
  for (const t of tokens) {
    const idx = lower.indexOf(t);
    if (idx >= 0 && (firstIdx === -1 || idx < firstIdx)) {
      firstIdx = idx;
    }
  }

  let windowStart = 0;
  let windowEnd = text.length;
  if (firstIdx >= 0) {
    const half = Math.floor(IN_MEMORY_MAX_CHARS / 2);
    windowStart = Math.max(0, firstIdx - half);
    windowEnd = Math.min(text.length, windowStart + IN_MEMORY_MAX_CHARS);
  } else {
    windowEnd = Math.min(text.length, IN_MEMORY_MAX_CHARS);
  }

  const slice = text.slice(windowStart, windowEnd);
  const sliceLower = slice.toLowerCase();
  // Build a list of [start, end) spans inside `slice` to wrap. Tokens may
  // overlap; we coalesce overlapping ranges so we never emit
  // `<mark><mark>...</mark></mark>`.
  const ranges: Array<[number, number]> = [];
  for (const t of tokens) {
    if (t.length === 0) continue;
    let from = 0;
    while (from <= sliceLower.length - t.length) {
      const at = sliceLower.indexOf(t, from);
      if (at < 0) break;
      ranges.push([at, at + t.length]);
      from = at + t.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  if (merged.length === 0) {
    return escapeForMark(slice);
  }

  let out = '';
  let cursor = 0;
  for (const [s, e] of merged) {
    out += escapeForMark(slice.slice(cursor, s));
    out += '<mark>' + escapeForMark(slice.slice(s, e)) + '</mark>';
    cursor = e;
  }
  out += escapeForMark(slice.slice(cursor));
  return out;
}

/**
 * Pure helper used by both the Postgres path (informational) and the
 * in-memory path. Returns the same row shape the route serialises so callers
 * can hand-stitch a search result list during testing.
 */
export interface SnippetResult {
  pageSlug: string;
  elementId: string;
  snippet: string;
}

export function buildInMemoryResults(
  entries: ReadonlyArray<SearchEntryDraft>,
  q: string,
  limit: number,
): SnippetResult[] {
  const hits: SnippetResult[] = [];
  for (const entry of entries) {
    if (!inMemoryMatches(entry.text, q)) continue;
    hits.push({
      pageSlug: entry.pageSlug,
      elementId: entry.elementId,
      snippet: buildInMemorySnippet(entry.text, q),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
