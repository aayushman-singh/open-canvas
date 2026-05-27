// src/search/query.ts
//
// Wave 3 #13 — Server-side query handler. Composes the FTS SQL against
// `site_search_entry`, runs it via `db.execute`, and shapes the result into
// `{ pageSlug, elementId, snippet }` rows the public route serialises.
//
// SQL shape (single statement):
//
//   SELECT page_slug,
//          element_id,
//          ts_headline('english', text, plainto_tsquery('english', $q),
//                      'MaxWords=15, MinWords=5, StartSel=<mark>, StopSel=</mark>') AS snippet,
//          ts_rank(tsv, plainto_tsquery('english', $q))                 AS rank
//     FROM site_search_entry
//    WHERE site_id = $siteId
//      AND tsv @@ plainto_tsquery('english', $q)
//    ORDER BY rank DESC
//    LIMIT $limit;
//
// User input safety:
//   - `q` is passed as a bound parameter to `plainto_tsquery`. The Postgres
//     `plainto_tsquery` function never interprets the input as SQL syntax —
//     it tokenises plain text into a query AST. There is no path from `q`
//     into the SQL string.
//   - We additionally reject empty queries (`{ kind: 'empty' }`) and queries
//     longer than 100 chars (`{ kind: 'too-long' }`) BEFORE issuing the SQL.
//     This is defence in depth and a UX guard against runaway queries; per
//     the brief, the route maps these to 400-class responses.
//
// Length cap rationale:
//   Plain text doesn't realistically exceed ~50 chars for a site search box;
//   100 is generous. A higher cap risks a malicious caller forcing Postgres
//   to tokenise excessively long strings on every request.

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { TS_HEADLINE_OPTIONS } from './snippet.js';

/** Max characters accepted in the `q` parameter. Inclusive bound. */
export const MAX_QUERY_LENGTH = 100;

/** Default result cap when the caller omits `limit`. */
export const DEFAULT_QUERY_LIMIT = 10;

/** Upper bound on `limit` — protects against expensive scans. */
export const MAX_QUERY_LIMIT = 25;

export type QueryValidation =
  | { kind: 'ok'; normalized: string }
  | { kind: 'empty' }
  | { kind: 'too-long' };

/**
 * Normalise + validate user input. Trims whitespace, then checks the empty
 * and length rules. The route layer maps `'empty'` and `'too-long'` to HTTP
 * 400 responses with distinct messages.
 */
export function validateQuery(raw: unknown): QueryValidation {
  if (typeof raw !== 'string') return { kind: 'empty' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  if (trimmed.length > MAX_QUERY_LENGTH) return { kind: 'too-long' };
  return { kind: 'ok', normalized: trimmed };
}

export interface SearchHit {
  pageSlug: string;
  elementId: string;
  snippet: string;
}

export interface SearchSiteOptions {
  /** Drizzle DB handle — neon-http or compatible. */
  db: Pick<Db, 'execute'>;
  siteId: string;
  q: string;
  /** Defaults to `DEFAULT_QUERY_LIMIT`. Clamped to `MAX_QUERY_LIMIT`. */
  limit?: number;
}

/**
 * Execute the FTS query against Postgres. The caller must have already
 * validated `q` via `validateQuery`; passing an empty / too-long query is a
 * caller bug and we throw to avoid silently issuing nonsense SQL.
 */
export async function searchSite(opts: SearchSiteOptions): Promise<SearchHit[]> {
  const { db, siteId, q } = opts;
  if (typeof siteId !== 'string' || siteId.length === 0) {
    throw new Error('[search] searchSite: siteId is required');
  }
  const validation = validateQuery(q);
  if (validation.kind !== 'ok') {
    throw new Error(`[search] searchSite: invalid q (${validation.kind})`);
  }
  const limitRaw = opts.limit ?? DEFAULT_QUERY_LIMIT;
  const limit = Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.floor(limitRaw)));

  // The SQL string is composed entirely of static fragments + bound
  // parameters. There is no path from `q` or `siteId` into the SQL text.
  // `TS_HEADLINE_OPTIONS` is a module constant; `sql.raw` is used only on
  // that constant, never on user input.
  // REVIEW: `sql.raw()` on any string is a code smell even when the value is a module constant today. If `TS_HEADLINE_OPTIONS` is ever refactored to accept dynamic input, this becomes SQL injection. Consider binding it as a parameter or adding a `// SQL-SAFE: static constant` annotation with a grep-enforced lint rule.
  const headlineOpts = sql.raw(`'${TS_HEADLINE_OPTIONS}'`);
  const query = sql`
    SELECT
      page_slug                                                                                AS "pageSlug",
      element_id                                                                               AS "elementId",
      ts_headline('english', text, plainto_tsquery('english', ${validation.normalized}), ${headlineOpts}) AS "snippet"
    FROM site_search_entry
    WHERE site_id = ${siteId}
      AND tsv @@ plainto_tsquery('english', ${validation.normalized})
    ORDER BY ts_rank(tsv, plainto_tsquery('english', ${validation.normalized})) DESC
    LIMIT ${limit}
  `;

  // Drizzle's `.execute<T>()` requires `T extends Record<string, unknown>`.
  // `SearchHit` has the right shape but TS won't infer the index signature
  // implicitly; we use a wider row alias for the call site and shape the
  // result back to `SearchHit` on the way out.
  type SearchHitRow = SearchHit & Record<string, unknown>;
  const result = await db.execute<SearchHitRow>(query);
  // neon-http returns `{ rows: T[] }`; drizzle's `.execute<T>()` resolves to
  // the same shape. Defensively support either an array or a `{ rows }`
  // wrapper.
  if (Array.isArray(result)) return result as SearchHit[];
  const maybeRows = (result as { rows?: unknown }).rows;
  if (Array.isArray(maybeRows)) return maybeRows as SearchHit[];
  throw new Error('[search] searchSite: unexpected db.execute() result shape');
}
