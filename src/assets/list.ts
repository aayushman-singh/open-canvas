// src/assets/list.ts
//
// GET /api/owner/assets — Owner's full gallery. Per ADR 0004 decision 1,
// the gallery is "every Owner Asset, ordered by last use". The "last use"
// signal lives in `slot_history.used_at`; the gallery uses MAX(used_at) per
// ownerAsset.id, falling back to ownerAsset.created_at for assets that have
// never been slotted yet (e.g. just uploaded, not applied).

import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { ownerAsset, slotHistory } from '../db/schema.js';

export interface OwnerAssetGalleryEntry {
  id: string;
  contentHash: string;
  r2Key: string;
  mediaType: string;
  kind: 'image' | 'video';
  alt: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listOwnerAssets(
  db: Db,
  customerId: string,
): Promise<OwnerAssetGalleryEntry[]> {
  // Left join to slot_history (aggregated to MAX(used_at) per asset) so
  // never-used assets still appear with `lastUsedAt = null`. The order-by
  // sorts by `COALESCE(max_used_at, created_at) DESC` — the most recent
  // touch wins, whether that touch was a slot apply or just the upload.
  const lastUsedSubquery = db
    .select({
      ownerAssetId: slotHistory.ownerAssetId,
      maxUsedAt: sql<Date>`max(${slotHistory.usedAt})`.as('max_used_at'),
    })
    .from(slotHistory)
    .groupBy(slotHistory.ownerAssetId)
    .as('last_used');

  const rows = await db
    .select({
      id: ownerAsset.id,
      contentHash: ownerAsset.contentHash,
      r2Key: ownerAsset.r2Key,
      mediaType: ownerAsset.mediaType,
      kind: ownerAsset.kind,
      alt: ownerAsset.alt,
      width: ownerAsset.width,
      height: ownerAsset.height,
      byteSize: ownerAsset.byteSize,
      createdAt: ownerAsset.createdAt,
      lastUsedAt: lastUsedSubquery.maxUsedAt,
    })
    .from(ownerAsset)
    .leftJoin(lastUsedSubquery, eq(lastUsedSubquery.ownerAssetId, ownerAsset.id))
    .where(eq(ownerAsset.customerId, customerId))
    .orderBy(desc(sql`coalesce(${lastUsedSubquery.maxUsedAt}, ${ownerAsset.createdAt})`));

  return rows.map((row) => ({
    id: row.id,
    contentHash: row.contentHash,
    r2Key: row.r2Key,
    mediaType: row.mediaType,
    kind: row.kind,
    alt: row.alt,
    width: row.width,
    height: row.height,
    byteSize: row.byteSize,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  }));
}
