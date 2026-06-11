// src/canvas/library-section-import.ts
//
// Pure util for cloning a library section into a target site. Generalises
// the seed-only `importSectionIntoSite` to handle arbitrary Owner Assets
// referenced via an AssetManifestEntry[] snapshot.
//
// ID regeneration shares `rolePrefix` + `newId` with section-import.ts via
// `./util/id.js`. Asset transfer creates new ownerAsset rows for the target
// Owner pointing to the same R2 content-hash (per ADR 0004).

import type { CanvasSection } from './schema.js';
import type { AssetManifestEntry } from '../db/schema.js';
import { newId, rolePrefix } from './util/id.js';

export interface LibraryImportInput {
  targetCustomerId: string;
  sourceSection: CanvasSection;
  assetManifest: AssetManifestEntry[];
  existingAssetsByHash: Map<string, string>;
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

export type LibraryImportResult =
  | { ok: true; section: CanvasSection; newAssetRows: ImportedAssetRow[] }
  | { ok: false; errors: string[] };

export function importLibrarySectionIntoSite(input: LibraryImportInput): LibraryImportResult {
  const { targetCustomerId, sourceSection, assetManifest, existingAssetsByHash } = input;
  const cloned = structuredClone(sourceSection);
  // Imported sections become body sections in the target site; `role` is
  // reserved for the single site-wide header/footer pair and would mark the
  // imported clone as a second header/footer.
  delete cloned.role;
  // anchorId is a page-scoped in-page-link target (ADR 0050 dec 2: unique
  // within a rendered page) meaningful only in the SOURCE page's nav graph.
  // A freshly imported body section has nothing pointing at it in the target,
  // so carrying the source value only risks a duplicate-anchor collision that
  // fails validateEditableSite ("imported section produced invalid state").
  // Strip it like role; the Owner re-assigns an anchor via the inspector.
  delete cloned.anchorId;
  const errors: string[] = [];

  for (const element of cloned.elements) {
    element.id = newId(rolePrefix(element.id));
    delete element.anchorId;
  }
  cloned.id = newId(`sec-${cloned.recipeId}`);

  const manifestByAssetId = new Map<string, AssetManifestEntry>();
  for (const entry of assetManifest) {
    manifestByAssetId.set(entry.assetId, entry);
  }

  const assetIdMap = new Map<string, string>();
  const newAssetRows: ImportedAssetRow[] = [];
  const targetAssetsByHash = new Map(existingAssetsByHash);

  // Same coverage rationale as src/canvas/section-import.ts: the save-path
  // validator walks every asset reference the schema can carry (carousel
  // slides, nav logoAssetId, elementStyle.backgroundImageAssetId, and the
  // section-level backgroundVideoAssetId), not just media.assetId — every
  // reference must be in `assetIdMap` or the next save rejects the imported
  // section.
  function recordRef(ref: string): void {
    if (assetIdMap.has(ref)) return;
    const manifest = manifestByAssetId.get(ref);
    if (!manifest) {
      errors.push(`asset ${ref} not found in asset manifest`);
      return;
    }
    const existing = targetAssetsByHash.get(manifest.contentHash);
    if (existing) {
      assetIdMap.set(ref, existing);
      return;
    }
    const freshId = crypto.randomUUID();
    assetIdMap.set(ref, freshId);
    targetAssetsByHash.set(manifest.contentHash, freshId);
    newAssetRows.push({
      id: freshId,
      customerId: targetCustomerId,
      contentHash: manifest.contentHash,
      r2Key: manifest.r2Key,
      mediaType: manifest.mediaType,
      kind: manifest.kind,
      alt: manifest.alt,
      width: manifest.width,
      height: manifest.height,
      byteSize: manifest.byteSize,
    });
  }

  if (cloned.backgroundVideoAssetId !== undefined) {
    recordRef(cloned.backgroundVideoAssetId);
  }
  for (const element of cloned.elements) {
    if (element.elementStyle !== undefined && element.elementStyle.backgroundImageAssetId !== undefined) {
      recordRef(element.elementStyle.backgroundImageAssetId);
    }
    if (element.type === 'media') {
      recordRef(element.assetId);
      if (element.mediaKind === 'video' && element.posterAssetId !== undefined) {
        recordRef(element.posterAssetId);
      }
    } else if (element.type === 'nav') {
      if (element.logoAssetId !== undefined) recordRef(element.logoAssetId);
    } else if (element.type === 'carousel') {
      for (const slide of element.slides) {
        recordRef(slide.assetId);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  if (cloned.backgroundVideoAssetId !== undefined) {
    const mapped = assetIdMap.get(cloned.backgroundVideoAssetId);
    if (mapped) cloned.backgroundVideoAssetId = mapped;
  }
  for (const element of cloned.elements) {
    if (element.elementStyle !== undefined && element.elementStyle.backgroundImageAssetId !== undefined) {
      const mapped = assetIdMap.get(element.elementStyle.backgroundImageAssetId);
      if (mapped) element.elementStyle.backgroundImageAssetId = mapped;
    }
    if (element.type === 'media') {
      const mapped = assetIdMap.get(element.assetId);
      if (mapped) element.assetId = mapped;
      if (element.mediaKind === 'video' && element.posterAssetId !== undefined) {
        const posterMapped = assetIdMap.get(element.posterAssetId);
        if (posterMapped) element.posterAssetId = posterMapped;
      }
    } else if (element.type === 'nav') {
      if (element.logoAssetId !== undefined) {
        const mapped = assetIdMap.get(element.logoAssetId);
        if (mapped) element.logoAssetId = mapped;
      }
    } else if (element.type === 'carousel') {
      for (const slide of element.slides) {
        const mapped = assetIdMap.get(slide.assetId);
        if (mapped) slide.assetId = mapped;
      }
    }
  }

  return { ok: true, section: cloned, newAssetRows };
}
