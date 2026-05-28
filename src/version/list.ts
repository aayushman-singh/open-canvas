// src/version/list.ts
//
// Paginated snapshot listing for the timeline UI.
//
// Pagination shape: cursor-by-`capturedAt`, newest-first. The cursor is the
// ISO-encoded `capturedAt` of the last entry on the previous page. The
// timeline UI never goes beyond a couple of pages in practice (pruning caps
// the per-site row count at ~50–60 in steady state) so a simple
// `WHERE captured_at < $cursor ORDER BY captured_at DESC LIMIT n` works.
//
// We return a narrow row shape — the timeline doesn't need the raw bytes,
// only the metadata. The preview endpoint loads the bytes by id separately.

import { and, desc, eq, lt } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { siteSnapshot } from '../db/schema.js';

export interface SnapshotListItem {
  id: string;
  capturedAt: string; // ISO string — JSON-friendly for the timeline JSON API
  reason: 'publish' | 'manual';
  label: string | null;
  publishedVersion: number | null;
}

export interface ListSnapshotsOptions {
  /**
   * Maximum rows to return. Defaults to 50 — the same as the per-site cap
   * so one page is the steady-state view. Hard-capped at 200 to keep the
   * timeline JSON payload bounded.
   */
  limit?: number;
  /**
   * Optional cursor — an ISO-encoded `capturedAt` from the previous page's
   * last entry. Rows strictly older than this are returned. Newest-first
   * ordering means "next page" == "older than this".
   */
  cursor?: string;
}

export interface SnapshotListPage {
  items: SnapshotListItem[];
  /** Cursor to pass into the next call to fetch older rows, or `null` when no more. */
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * List snapshots for a site, newest-first, with cursor pagination.
 */
export async function listSnapshots(
  siteId: string,
  db: Db,
  options: ListSnapshotsOptions = {},
): Promise<SnapshotListPage> {
  const requestedLimit = options.limit ?? DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_LIMIT, requestedLimit));

  const cursorDate = options.cursor !== undefined ? new Date(options.cursor) : null;
  if (cursorDate !== null && Number.isNaN(cursorDate.getTime())) {
    throw new Error(`[version/list] invalid cursor: ${options.cursor ?? ''}`);
  }

  const whereExpr =
    cursorDate !== null
      ? and(eq(siteSnapshot.siteId, siteId), lt(siteSnapshot.capturedAt, cursorDate))
      : eq(siteSnapshot.siteId, siteId);

  // Fetch limit+1 so we can tell whether another page exists without a
  // second COUNT query. The extra row is dropped before we return.
  const rows = await db
    .select({
      id: siteSnapshot.id,
      capturedAt: siteSnapshot.capturedAt,
      reason: siteSnapshot.reason,
      label: siteSnapshot.label,
      publishedVersion: siteSnapshot.publishedVersion,
    })
    .from(siteSnapshot)
    .where(whereExpr)
    .orderBy(desc(siteSnapshot.capturedAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;

  const items: SnapshotListItem[] = trimmed.map((row) => ({
    id: row.id,
    capturedAt: row.capturedAt.toISOString(),
    reason: row.reason,
    label: row.label,
    publishedVersion: row.publishedVersion,
  }));

  const nextCursor = hasMore && items.length > 0 ? (items[items.length - 1]?.capturedAt ?? null) : null;

  return { items, nextCursor };
}
