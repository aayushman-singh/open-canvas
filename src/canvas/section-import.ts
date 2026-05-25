// src/canvas/section-import.ts
//
// Pure util for cloning a CanvasSection into a target site: regenerates all
// IDs, walks media elements to collect seed-asset references, materialises
// each raw SEED_ASSET_REGISTRY entry into an ownerAsset row scoped to the
// target Owner (id = seed-<customerId>-<rawSeedId>), and rewrites every
// assetId and posterAssetId on the cloned section to point at the
// materialised ids.
//
// Dedup: a raw seed id appearing in N elements produces exactly 1 row, and
// rows whose target id is already in `existingAssetIds` are omitted from
// newAssetRows (the element refs are still rewritten so they resolve).
//
// Re-rooted per ADR 0004: section-import now keys materialised seed asset
// ids by `customerId` rather than `siteId`. Two sites under the same Owner
// share the materialised asset id; the canvas state's MediaElement.assetId
// resolves through the Owner Asset table regardless of which site owns the
// site.
//
// Fail loud: an element whose assetId is not in SEED_ASSET_REGISTRY produces
// `{ ok: false, errors }`. No silent skip. No fallback bytes.

import { contentHashToR2Key, extFromMediaType } from '../assets/hash.js';
import { SEED_ASSET_REGISTRY } from './seed-assets.js';
import type { CanvasSection } from './schema.js';

export interface ImportSectionInput {
  /**
   * The Owner the cloned section's assets are rooted under (per ADR 0004).
   * Previously this was the target site id; the parameter is renamed to
   * make the re-rooting loud at every caller.
   */
  targetCustomerId: string;
  sourceSection: CanvasSection;
  existingAssetIds: Set<string>;
}

export interface ImportedAssetRow {
  id: string;
  customerId: string;
  contentHash: string;
  r2Key: string;
  mediaType: string;
  kind: 'image' | 'video';
  alt: string;
  width: number | null;
  height: number | null;
  byteSize: number;
}

export type ImportSectionResult =
  | { ok: true; section: CanvasSection; newAssetRows: ImportedAssetRow[] }
  | { ok: false; errors: string[] };

function rolePrefix(originalId: string): string {
  const lastDash = originalId.lastIndexOf('-');
  if (lastDash <= 0) return originalId || 'el';
  const tail = originalId.slice(lastDash + 1);
  if (/^[a-f0-9]{8}$/i.test(tail)) return originalId.slice(0, lastDash);
  return originalId;
}

function newId(prefix: string): string {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${prefix}-${random}`;
}

function materialisedAssetId(targetCustomerId: string, rawSeedId: string): string {
  return `seed-${targetCustomerId}-${rawSeedId}`;
}

export function importSectionIntoSite(input: ImportSectionInput): ImportSectionResult {
  const { targetCustomerId, sourceSection, existingAssetIds } = input;
  const cloned = structuredClone(sourceSection);
  delete cloned.role;
  const errors: string[] = [];

  for (const element of cloned.elements) {
    element.id = newId(rolePrefix(element.id));
  }

  const recipeSlug = cloned.recipeId;
  cloned.id = newId(`sec-${recipeSlug}`);

  const assetIdMap = new Map<string, string>();
  for (const element of cloned.elements) {
    if (element.type !== 'media') continue;
    const media = element;
    const seed = SEED_ASSET_REGISTRY[media.assetId];
    if (!seed) {
      errors.push(`unknown seed asset id: ${media.assetId}`);
    } else if (!assetIdMap.has(media.assetId)) {
      assetIdMap.set(media.assetId, materialisedAssetId(targetCustomerId, media.assetId));
    }
    if (media.posterAssetId !== undefined) {
      const posterSeed = SEED_ASSET_REGISTRY[media.posterAssetId];
      if (!posterSeed) {
        errors.push(`unknown seed poster asset id: ${media.posterAssetId}`);
      } else if (!assetIdMap.has(media.posterAssetId)) {
        assetIdMap.set(
          media.posterAssetId,
          materialisedAssetId(targetCustomerId, media.posterAssetId),
        );
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  for (const element of cloned.elements) {
    if (element.type !== 'media') continue;
    const media = element;
    media.assetId = assetIdMap.get(media.assetId)!;
    if (media.posterAssetId !== undefined) {
      media.posterAssetId = assetIdMap.get(media.posterAssetId)!;
    }
  }

  const newAssetRows: ImportedAssetRow[] = [];
  for (const [rawSeedId, materialisedId] of assetIdMap.entries()) {
    if (existingAssetIds.has(materialisedId)) continue;
    const seed = SEED_ASSET_REGISTRY[rawSeedId]!;
    newAssetRows.push({
      id: materialisedId,
      customerId: targetCustomerId,
      contentHash: seed.contentHash,
      // Recompute r2Key from contentHash + mediaType so a registry typo on
      // r2Key surfaces as a section-import error rather than a stale row
      // shipped into the DB.
      r2Key: contentHashToR2Key(seed.contentHash, extFromMediaType(seed.mediaType)),
      mediaType: seed.mediaType,
      kind: seed.kind,
      alt: seed.alt,
      width: seed.width,
      height: seed.height,
      byteSize: seed.byteSize,
    });
  }

  return { ok: true, section: cloned, newAssetRows };
}
