// src/search/indexer.ts
//
// Site search indexer. Called by the main thread from
// `src/routes/api/publish.ts` immediately after the published-snapshot row
// update lands. Walks the snapshot via `extractSearchEntries`, then rebuilds
// the `site_search_entry` rows for the given siteId atomically: DELETE every
// existing row for the site, INSERT the freshly-extracted rows.
//
// Atomicity model:
//   Hyperdrive-backed postgres.js (per the recent DB migration) supports
//   stateful transactions. We wrap the DELETE + INSERT pair in a single
//   `db.transaction(async (tx) => ...)` so a concurrent reader either sees
//   the previous publish's rows OR the new publish's rows, never an empty
//   intermediate. An empty snapshot (no text-bearing elements) still issues
//   the DELETE so the previous version's index is pruned.
//
// Idempotency:
//   Re-running rebuildSearchIndex with the same snapshot produces the same
//   set of (site_id, page_slug, element_id, text, published_version) rows.
//   The synthetic `__page` element id never collides with a real element id
//   because the canvas validator rejects double-underscore element ids
//   (validator contract — see `validateEditableSite`).
//
// Failure mode:
//   Any DB error propagates to the caller. There is no fallback path that
//   leaves the index in a half-written state; the user's all-or-nothing
//   posture is enforced by letting the publish flow surface the error.

import { eq } from 'drizzle-orm';
import type { PublishedSnapshot } from '../canvas/schema.js';
import type { Db } from '../db/client.js';
import { siteSearchEntry, type NewSiteSearchEntry } from '../db/schema.js';
import { extractSearchEntries, type SearchEntryDraft } from './extract.js';

/**
 * Subset of the drizzle Db type that the indexer actually exercises. Kept
 * narrow so the smoke shim can implement just these methods.
 */
export interface IndexerDb {
  delete: Db['delete'];
  insert: Db['insert'];
  transaction: Db['transaction'];
}

/**
 * Build the New-row payloads from a snapshot. Pulled out so the smoke can
 * assert the exact rows being staged before they are sent to the (shimmed)
 * DB.
 */
export function buildSearchRows(
  siteId: string,
  snapshot: PublishedSnapshot,
): NewSiteSearchEntry[] {
  const drafts = extractSearchEntries(snapshot);
  return drafts.map((draft: SearchEntryDraft) => ({
    siteId,
    pageSlug: draft.pageSlug,
    elementId: draft.elementId,
    text: draft.text,
    publishedVersion: snapshot.version,
  }));
}

/**
 * Replace the search-entry rows for `siteId` with the entries extracted from
 * `snapshot`. The DELETE + INSERT pair is sent as a single neon-http batch so
 * a concurrent reader either sees the previous publish's rows OR the new
 * publish's rows, never an empty intermediate.
 *
 * Exported as the integration contract for `src/routes/api/publish.ts`:
 *   await rebuildSearchIndex(siteId, snapshot, db);
 */
export async function rebuildSearchIndex(
  siteId: string,
  snapshot: PublishedSnapshot,
  database: IndexerDb,
): Promise<void> {
  if (typeof siteId !== 'string' || siteId.length === 0) {
    throw new Error('[search] rebuildSearchIndex: siteId is required');
  }
  const rows = buildSearchRows(siteId, snapshot);
  if (rows.length === 0) {
    // Nothing to insert — just prune the previous rows.
    await database.delete(siteSearchEntry).where(eq(siteSearchEntry.siteId, siteId));
    return;
  }
  await database.transaction(async (tx) => {
    await tx.delete(siteSearchEntry).where(eq(siteSearchEntry.siteId, siteId));
    await tx.insert(siteSearchEntry).values(rows);
  });
}
