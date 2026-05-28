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
  const errors: string[] = [];

  for (const element of cloned.elements) {
    element.id = newId(rolePrefix(element.id));
  }
  cloned.id = newId(`sec-${cloned.recipeId}`);

  const manifestByAssetId = new Map<string, AssetManifestEntry>();
  for (const entry of assetManifest) {
    manifestByAssetId.set(entry.assetId, entry);
  }

  const assetIdMap = new Map<string, string>();
  const newAssetRows: ImportedAssetRow[] = [];
  const targetAssetsByHash = new Map(existingAssetsByHash);

  for (const element of cloned.elements) {
    if (element.type !== 'media') continue;

    const refs = [element.assetId];
    if (element.posterAssetId !== undefined) refs.push(element.posterAssetId);

    for (const ref of refs) {
      if (assetIdMap.has(ref)) continue;

      const manifest = manifestByAssetId.get(ref);
      if (!manifest) {
        errors.push(`asset ${ref} not found in asset manifest`);
        continue;
      }

      const existing = targetAssetsByHash.get(manifest.contentHash);
      if (existing) {
        assetIdMap.set(ref, existing);
      } else {
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
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  for (const element of cloned.elements) {
    if (element.type !== 'media') continue;
    const mapped = assetIdMap.get(element.assetId);
    if (mapped) element.assetId = mapped;
    if (element.posterAssetId !== undefined) {
      const posterMapped = assetIdMap.get(element.posterAssetId);
      if (posterMapped) element.posterAssetId = posterMapped;
    }
  }

  return { ok: true, section: cloned, newAssetRows };
}
