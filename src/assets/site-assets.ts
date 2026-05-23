// src/assets/site-assets.ts
//
// Reference-walking helpers shared by the publish guard, the canvas-agent
// pipeline, and the public read route. The legacy file once carried a
// data-URL parser and a base64-response builder; both are gone now that
// ADR 0006 moved Owner Asset bytes out of Postgres into R2.
//
// The helpers below are pure (no I/O), so they can be reused from any
// consumer that needs to know "which assets does this Canvas state
// reference, and do those references match the materialised row set".

import type { CanvasPage, MediaKind } from '../canvas/schema.js';

export interface ReferencedAsset {
  assetId: string;
  expectedKind: MediaKind;
  role: 'asset' | 'poster';
  path: string;
  mediaElementId: string;
}

export interface AssetKindRow {
  id: string;
  kind: MediaKind;
}

export interface AssetReferenceError extends ReferencedAsset {
  reason: 'missing' | 'kind-mismatch';
  actualKind?: MediaKind;
}

export interface UnfilledAssetReference {
  role: 'asset' | 'poster';
  path: string;
  mediaElementId: string;
}

/**
 * Walk a snapshot's (or editable site's) pages and return every assetId AND
 * posterAssetId referenced by a media element. Used by:
 *   - publish guard: reject if any referenced id is missing from `ownerAsset`.
 *   - public `/assets/:assetId` route: 404 if the request is for an id not
 *     in the current snapshot's reachable set.
 *
 * Returns a fresh array so callers can mutate it without affecting the
 * source pages.
 */
export function collectReferencedAssets(pages: CanvasPage[]): ReferencedAsset[] {
  const out: ReferencedAsset[] = [];
  for (const [pageIdx, page] of pages.entries()) {
    for (const [sectionIdx, section] of page.sections.entries()) {
      for (const [elementIdx, element] of section.elements.entries()) {
        if (element.type !== 'media') continue;
        if (typeof element.assetId === 'string' && element.assetId.length > 0) {
          out.push({
            assetId: element.assetId,
            expectedKind: element.mediaKind,
            role: 'asset',
            path: `pages[${String(pageIdx)}].sections[${String(sectionIdx)}].elements[${String(elementIdx)}].assetId`,
            mediaElementId: element.id,
          });
        }
        if (typeof element.posterAssetId === 'string' && element.posterAssetId.length > 0) {
          out.push({
            assetId: element.posterAssetId,
            expectedKind: 'image',
            role: 'poster',
            path: `pages[${String(pageIdx)}].sections[${String(sectionIdx)}].elements[${String(elementIdx)}].posterAssetId`,
            mediaElementId: element.id,
          });
        }
      }
    }
  }
  return out;
}

export function collectReferencedAssetIds(pages: CanvasPage[]): Set<string> {
  return new Set(collectReferencedAssets(pages).map((ref) => ref.assetId));
}

export function collectUnfilledAssetReferences(pages: CanvasPage[]): UnfilledAssetReference[] {
  const out: UnfilledAssetReference[] = [];
  for (const [pageIdx, page] of pages.entries()) {
    for (const [sectionIdx, section] of page.sections.entries()) {
      for (const [elementIdx, element] of section.elements.entries()) {
        if (element.type !== 'media') continue;
        if (element.assetId === '') {
          out.push({
            role: 'asset',
            path: `pages[${String(pageIdx)}].sections[${String(sectionIdx)}].elements[${String(elementIdx)}].assetId`,
            mediaElementId: element.id,
          });
        }
        if (element.posterAssetId === '') {
          out.push({
            role: 'poster',
            path: `pages[${String(pageIdx)}].sections[${String(sectionIdx)}].elements[${String(elementIdx)}].posterAssetId`,
            mediaElementId: element.id,
          });
        }
      }
    }
  }
  return out;
}

export function findAssetReferenceErrors(
  pages: CanvasPage[],
  assets: AssetKindRow[],
): AssetReferenceError[] {
  const kindsById = new Map(assets.map((asset) => [asset.id, asset.kind]));
  const errors: AssetReferenceError[] = [];
  for (const reference of collectReferencedAssets(pages)) {
    const actualKind = kindsById.get(reference.assetId);
    if (!actualKind) {
      errors.push({ ...reference, reason: 'missing' });
      continue;
    }
    if (actualKind !== reference.expectedKind) {
      errors.push({ ...reference, reason: 'kind-mismatch', actualKind });
    }
  }
  return errors;
}
