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
import { newId, rolePrefix } from './util/id.js';

export interface ImportSectionInput {
  /**
   * The Owner the cloned section's assets are rooted under (per ADR 0004).
   * Previously this was the target site id; the parameter is renamed to
   * make the re-rooting loud at every caller.
   */
  targetCustomerId: string;
  sourceSection: CanvasSection;
  existingAssetIds: Set<string>;
  /**
   * Existing (contentHash → ownerAsset.id) for the target Owner. When a seed's
   * contentHash already maps to an existing asset, the cloned section's
   * media element references are rewritten to point at that existing id and
   * no new row is queued. Required for correctness under the
   * `owner_asset_customer_content_hash_unique` constraint — without this map
   * the insert would silently no-op on conflict and the canvas state would
   * reference an id that doesn't exist.
   */
  existingByHash: Map<string, string>;
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

function materialisedAssetId(targetCustomerId: string, rawSeedId: string): string {
  return `seed-${targetCustomerId}-${rawSeedId}`;
}

export function importSectionIntoSite(input: ImportSectionInput): ImportSectionResult {
  const { targetCustomerId, sourceSection, existingAssetIds, existingByHash } = input;
  const cloned = structuredClone(sourceSection);
  // Imported sections become body sections in the target site; `role` is
  // reserved for the single site-wide header/footer pair and would mark the
  // imported clone as a second header/footer.
  delete cloned.role;
  const errors: string[] = [];

  for (const element of cloned.elements) {
    element.id = newId(rolePrefix(element.id));
  }

  const recipeSlug = cloned.recipeId;
  cloned.id = newId(`sec-${recipeSlug}`);

  // Pick the target id for each raw seed asset id referenced in the section.
  // Resolution order: existing row for this Owner with the same contentHash
  // (reuse), else the deterministic materialised id for this Owner (queue a
  // new row). Tracking `existingByHash` as we resolve lets the same seed
  // referenced twice in one section resolve to the same target id, and a
  // section that imports two different raw seed ids backed by the same bytes
  // collapse to a single new row.
  const assetIdMap = new Map<string, string>();
  function resolveTargetId(rawSeedId: string): string | null {
    const cached = assetIdMap.get(rawSeedId);
    if (cached !== undefined) return cached;
    const seed = SEED_ASSET_REGISTRY[rawSeedId];
    if (!seed) return null;
    const existing = existingByHash.get(seed.contentHash);
    if (existing !== undefined) {
      assetIdMap.set(rawSeedId, existing);
      return existing;
    }
    const fresh = materialisedAssetId(targetCustomerId, rawSeedId);
    assetIdMap.set(rawSeedId, fresh);
    existingByHash.set(seed.contentHash, fresh);
    return fresh;
  }

  for (const element of cloned.elements) {
    if (element.type !== 'media') continue;
    const media = element;
    if (resolveTargetId(media.assetId) === null) {
      errors.push(`unknown seed asset id: ${media.assetId}`);
    }
    if (media.posterAssetId !== undefined && resolveTargetId(media.posterAssetId) === null) {
      errors.push(`unknown seed poster asset id: ${media.posterAssetId}`);
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
  const seenRowIds = new Set<string>();
  for (const [rawSeedId, materialisedId] of assetIdMap.entries()) {
    if (existingAssetIds.has(materialisedId)) continue;
    if (seenRowIds.has(materialisedId)) continue;
    seenRowIds.add(materialisedId);
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
