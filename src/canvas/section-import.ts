// src/canvas/section-import.ts
//
// Pure util for cloning a CanvasSection into a target site: regenerates all
// IDs, walks media elements to collect seed-asset references, materialises
// each raw SEED_ASSET_REGISTRY entry into a siteAsset row scoped to the
// target site (id = seed-<siteId>-<rawSeedId>), and rewrites every assetId
// and posterAssetId on the cloned section to point at the materialised ids.
//
// Dedup: a raw seed id appearing in N elements produces exactly 1 row, and
// rows whose target id is already in `existingAssetIds` are omitted from
// newAssetRows (the element refs are still rewritten so they resolve).
//
// Fail loud: an element whose assetId is not in SEED_ASSET_REGISTRY produces
// `{ ok: false, errors }`. No silent skip. No fallback bytes.

import { SEED_ASSET_REGISTRY } from './seed-assets.js';
import type { CanvasSection, MediaElement } from './schema.js';

export interface ImportSectionInput {
  targetSiteId: string;
  sourceSection: CanvasSection;
  existingAssetIds: Set<string>;
}

export interface ImportedAssetRow {
  id: string;
  siteId: string;
  mediaType: string;
  bytesBase64: string;
  kind: 'image' | 'video';
  alt: string;
}

export type ImportSectionResult =
  | { ok: true; section: CanvasSection; newAssetRows: ImportedAssetRow[] }
  | { ok: false; errors: string[] };

function rolePrefix(originalId: string): string {
  const lastDash = originalId.lastIndexOf('-');
  if (lastDash <= 0) return originalId || 'el';
  const tail = originalId.slice(lastDash + 1);
  if (/^[a-z0-9]{4,}$/i.test(tail)) return originalId.slice(0, lastDash);
  return originalId;
}

function newId(prefix: string): string {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${prefix}-${random}`;
}

function materialisedAssetId(targetSiteId: string, rawSeedId: string): string {
  return `seed-${targetSiteId}-${rawSeedId}`;
}

export function importSectionIntoSite(input: ImportSectionInput): ImportSectionResult {
  const { targetSiteId, sourceSection, existingAssetIds } = input;
  const cloned = structuredClone(sourceSection) as CanvasSection;
  const errors: string[] = [];

  const idMap = new Map<string, string>();
  for (const element of cloned.elements) {
    const original = element.id;
    const fresh = newId(rolePrefix(original));
    idMap.set(original, fresh);
    element.id = fresh;
  }

  const recipeSlug = cloned.recipeId;
  cloned.id = newId(`sec-${recipeSlug}`);

  const assetIdMap = new Map<string, string>();
  for (const element of cloned.elements) {
    if (element.type !== 'media') continue;
    const media = element as MediaElement;
    const seed = SEED_ASSET_REGISTRY[media.assetId];
    if (!seed) {
      errors.push(`unknown seed asset id: ${media.assetId}`);
    } else if (!assetIdMap.has(media.assetId)) {
      assetIdMap.set(media.assetId, materialisedAssetId(targetSiteId, media.assetId));
    }
    if (media.posterAssetId !== undefined) {
      const posterSeed = SEED_ASSET_REGISTRY[media.posterAssetId];
      if (!posterSeed) {
        errors.push(`unknown seed poster asset id: ${media.posterAssetId}`);
      } else if (!assetIdMap.has(media.posterAssetId)) {
        assetIdMap.set(
          media.posterAssetId,
          materialisedAssetId(targetSiteId, media.posterAssetId),
        );
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  for (const element of cloned.elements) {
    if (element.type !== 'media') continue;
    const media = element as MediaElement;
    const remapped = assetIdMap.get(media.assetId);
    if (!remapped) {
      return { ok: false, errors: [`internal: missing remap for ${media.assetId}`] };
    }
    media.assetId = remapped;
    if (media.posterAssetId !== undefined) {
      const remappedPoster = assetIdMap.get(media.posterAssetId);
      if (!remappedPoster) {
        return { ok: false, errors: [`internal: missing remap for ${media.posterAssetId}`] };
      }
      media.posterAssetId = remappedPoster;
    }
  }

  const newAssetRows: ImportedAssetRow[] = [];
  for (const [rawSeedId, materialisedId] of assetIdMap.entries()) {
    if (existingAssetIds.has(materialisedId)) continue;
    const seed = SEED_ASSET_REGISTRY[rawSeedId]!;
    newAssetRows.push({
      id: materialisedId,
      siteId: targetSiteId,
      mediaType: seed.mediaType,
      bytesBase64: seed.bytesBase64,
      kind: seed.kind,
      alt: seed.alt,
    });
  }

  return { ok: true, section: cloned, newAssetRows };
}
