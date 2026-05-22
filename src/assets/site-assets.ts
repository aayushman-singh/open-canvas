// src/assets/site-assets.ts
//
// Site Asset helpers shared by:
//   - `POST /api/canvas/sites/:siteId/assets` (owner upload)        — Task 6
//   - `GET  /api/canvas/sites/:siteId/assets/:assetId` (owner peek) — Task 6
//   - `GET  /assets/:assetId` on the Public Host (visitor)          — Task 6
//   - `POST /api/publish/sites/:siteId` (publish guard)             — Task 6
//
// The helpers are pure (no I/O) so they can be reused from both the publish
// guard and the public route. The renderer's `assetBasePath` stays `/assets`;
// the new public route serves that path scoped to the current
// `publishedSnapshot.pages`.

import type { CanvasPage, MediaKind } from '../canvas/schema.js';

export interface AssetBlob {
  kind: 'image' | 'video';
  mediaType: string;
  bytesBase64: string;
}

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

/**
 * Parse a base64 data URL into an {@link AssetBlob}. Fails loudly on any
 * unsupported media type or malformed data URL — there is no silent fallback.
 *
 * Accepted shape: `data:<mediaType>;base64,<base64>`. The mediaType must
 * start with `image/` or `video/`; anything else is rejected.
 */
export function dataUrlToAsset(input: string): AssetBlob {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!match) throw new Error('asset data must be a base64 data URL');
  const mediaType = match[1] ?? '';
  const bytesBase64 = match[2] ?? '';
  if (mediaType.startsWith('image/')) {
    return { kind: 'image', mediaType, bytesBase64 };
  }
  if (mediaType.startsWith('video/')) {
    return { kind: 'video', mediaType, bytesBase64 };
  }
  throw new Error(`unsupported asset media type: ${mediaType}`);
}

/**
 * Build a binary `Response` for the given asset bytes. Used by both the
 * owner-gated preview route and the public route. Caches aggressively because
 * asset ids are content-addressed within a site (the publish endpoint
 * re-validates the referenced set on every publish, so a referenced id is
 * stable for the life of its published snapshot).
 */
export function assetResponse(mediaType: string, bytesBase64: string): Response {
  const bytes = Uint8Array.from(atob(bytesBase64), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': mediaType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

/**
 * Walk a snapshot's (or editable site's) pages and return every assetId AND
 * posterAssetId referenced by a media element. Used by:
 *   - publish guard: reject if any referenced id is missing from `siteAsset`.
 *   - public `/assets/:assetId` route: 404 if the request is for an id not
 *     in the current snapshot's reachable set.
 *
 * Returns a fresh `Set<string>` so callers can mutate it without affecting
 * the source pages.
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
