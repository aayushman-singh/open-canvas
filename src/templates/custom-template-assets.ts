import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { ownerAsset, type AssetManifestEntry } from '../db/schema.js';
import type { EditableSite } from '../canvas/schema.js';

export function collectAssetIds(state: EditableSite): Set<string> {
  const ids = new Set<string>();
  for (const page of state.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.type !== 'media') continue;
        ids.add(element.assetId);
        if (element.mediaKind === 'video' && element.posterAssetId !== undefined) {
          ids.add(element.posterAssetId);
        }
      }
    }
  }
  return ids;
}

export async function buildAssetManifest(
  database: Db,
  customerId: string,
  state: EditableSite,
): Promise<AssetManifestEntry[]> {
  const assetIds = collectAssetIds(state);
  if (assetIds.size === 0) return [];

  const rows = await database
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
    })
    .from(ownerAsset)
    .where(eq(ownerAsset.customerId, customerId));

  const manifest: AssetManifestEntry[] = [];
  for (const row of rows) {
    if (!assetIds.has(row.id)) continue;
    manifest.push({
      assetId: row.id,
      contentHash: row.contentHash,
      r2Key: row.r2Key,
      mediaType: row.mediaType,
      kind: row.kind,
      alt: row.alt,
      width: row.width,
      height: row.height,
      byteSize: row.byteSize,
    });
  }
  return manifest;
}
