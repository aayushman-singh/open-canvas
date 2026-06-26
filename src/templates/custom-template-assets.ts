import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { ownerAsset, type AssetManifestEntry } from '../db/schema.js';
import type { EditableSite } from '../canvas/schema.js';
import { rewriteEditableSiteAssetIds } from './seed-asset-materialization.js';

/**
 * Collect every asset id the EditableSite references.
 *
 * MUST stay in lock-step with the site-creation validator in
 * `routes/api/sites.ts`, which resolves asset ids through
 * `rewriteEditableSiteAssetIds`. The old implementation only walked
 * `media`-type elements in page sections (`assetId` + video poster), so it
 * silently dropped every reference that lives elsewhere — section/element
 * `backgroundImageAssetId`, `nav.logoAssetId`, carousel slides, tabs &
 * collection (`entries` / `customTemplate`) nested media, section
 * `backgroundVideoAssetId`, header/footer, page `ogImageAssetId`, and the
 * top-level `faviconAssetId`. A template that referenced an asset in any of
 * those spots (e.g. velocity-athlete's collection template study images)
 * got seeded with an incomplete `assetManifest`, and site creation then
 * rejected it with "custom template references asset ids missing from its
 * manifest".
 *
 * Driving the collection through the SAME walk the validator uses makes
 * manifest coverage equal validator coverage by construction, so the two can
 * never drift again. The resolver returns each id unchanged (a no-op rewrite
 * on a clone) and records every concrete id, skipping the empty and
 * placeholder sentinels exactly like the validator does. Substitution tokens
 * (`{{…}}`) are filtered inside the walk before the resolver is reached.
 */
export function collectAssetIds(state: EditableSite): Set<string> {
  const ids = new Set<string>();
  const clone = structuredClone(state);
  rewriteEditableSiteAssetIds(clone, (assetId) => {
    if (assetId !== '' && assetId !== '__placeholder__') ids.add(assetId);
    return assetId;
  });
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
