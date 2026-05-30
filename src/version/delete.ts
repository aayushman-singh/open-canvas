// src/version/delete.ts
//
// Delete primitive — removes a single snapshot row from `site_snapshot`.
//
// Boundaries:
//
//   - The snapshot must belong to the supplied `ownedSiteId`. The route
//     layer establishes ownership; we re-verify the (id, siteId) tuple at
//     the SQL level so a forged `snapshotId` from a different Owner's site
//     cannot be deleted via this code path.
//
//   - We REFUSE to delete the snapshot that backs the site's current
//     published version. That row is the source of truth for the public
//     URL's served HTML; deleting it would orphan the version-badge state
//     and leave the site claiming "vN published" with no captured bytes to
//     prove it. Owners who want to retire a published version must publish
//     a newer one first — that demotes the old `publish` snapshot to a
//     plain history row, at which point this primitive will happily delete
//     it.
//
// Atomicity: a plain DELETE WHERE id = $1 AND site_id = $2 is point-in-time
// atomic from the row's perspective; the FK from `site_snapshot.siteId`
// is `ON DELETE CASCADE` only in the other direction (deleting a site
// cascades to its snapshots). Deleting one snapshot row is a no-cascade
// operation — nothing else references it.

import { and, eq } from 'drizzle-orm';

import type { Db } from '../db/client.js';
import { site, siteSnapshot } from '../db/schema.js';

export interface DeleteResult {
  deleted: true;
}

export class DeleteError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'DeleteError';
  }
}

/**
 * Delete a single snapshot row.
 *
 * - 404 when the snapshot does not exist or belongs to a different site.
 * - 409 when the snapshot is the row backing the site's currently
 *   published version (reason === 'publish' AND publishedVersion ===
 *   site.publishedVersion). The Owner must publish a newer version before
 *   the row can be retired.
 */
export async function deleteSnapshot(
  ownedSiteId: string,
  snapshotId: string,
  db: Db,
): Promise<DeleteResult> {
  // Load both the snapshot row and the site's current publishedVersion in
  // two reads. We need the snapshot row to know its reason/publishedVersion
  // and the site row to compare against — the comparison is the whole
  // point of the 409 guard.
  const snapshotRows = await db
    .select({
      id: siteSnapshot.id,
      siteId: siteSnapshot.siteId,
      reason: siteSnapshot.reason,
      publishedVersion: siteSnapshot.publishedVersion,
    })
    .from(siteSnapshot)
    .where(and(eq(siteSnapshot.id, snapshotId), eq(siteSnapshot.siteId, ownedSiteId)))
    .limit(1);
  const snapshotRow = snapshotRows[0];
  if (!snapshotRow) {
    throw new DeleteError('snapshot not found', 404);
  }

  if (snapshotRow.reason === 'publish' && snapshotRow.publishedVersion !== null) {
    const siteRows = await db
      .select({ publishedVersion: site.publishedVersion })
      .from(site)
      .where(eq(site.id, ownedSiteId))
      .limit(1);
    const siteRow = siteRows[0];
    if (!siteRow) {
      // The site disappeared between the route's ownership check and
      // this read. Surface as 404 rather than 500 — the snapshot is
      // effectively unreachable to the caller either way.
      throw new DeleteError('snapshot not found', 404);
    }
    if (siteRow.publishedVersion === snapshotRow.publishedVersion) {
      throw new DeleteError('cannot delete the current published version', 409);
    }
  }

  await db
    .delete(siteSnapshot)
    .where(and(eq(siteSnapshot.id, snapshotId), eq(siteSnapshot.siteId, ownedSiteId)));

  return { deleted: true };
}
