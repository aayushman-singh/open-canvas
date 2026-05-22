// src/assets/owner-assets.ts
//
// Owner Asset helpers — the post-rerooting replacement for site-assets.ts.
// During the in-progress migration this file co-exists with site-assets.ts;
// site-assets.ts will eventually be deleted in Phase 7. The pure walker
// helpers are re-exported here so future callers only need to know about
// owner-assets.ts.

import { and, eq } from 'drizzle-orm';
import type { MediaKind } from '../canvas/schema.js';
import { ownerAsset } from '../db/schema.js';
import type { Db } from '../db/client.js';

export interface OwnerAssetBlob {
  kind: MediaKind;
  mediaType: string;
  bytesBase64: string;
  alt: string;
}

/**
 * Parse a base64 data URL into an OwnerAssetBlob. Fails loudly on any
 * unsupported media type or malformed data URL.
 */
export function dataUrlToOwnerAsset(input: string, alt: string): OwnerAssetBlob {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!match) throw new Error('asset data must be a base64 data URL');
  const mediaType = match[1] ?? '';
  const bytesBase64 = match[2] ?? '';
  if (mediaType.startsWith('image/')) return { kind: 'image', mediaType, bytesBase64, alt };
  if (mediaType.startsWith('video/')) return { kind: 'video', mediaType, bytesBase64, alt };
  throw new Error(`unsupported asset media type: ${mediaType}`);
}

/** Read a single Owner Asset by id and customer. Returns null if not found. */
export async function readOwnerAsset(
  database: Db,
  customerId: string,
  assetId: string,
): Promise<{ mediaType: string; bytesBase64: string; kind: MediaKind } | null> {
  const rows = await database
    .select({
      mediaType: ownerAsset.mediaType,
      bytesBase64: ownerAsset.bytesBase64,
      kind: ownerAsset.kind,
    })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.id, assetId), eq(ownerAsset.customerId, customerId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Build a binary Response for asset bytes. Caches aggressively. */
export function assetResponse(mediaType: string, bytesBase64: string): Response {
  const bytes = Uint8Array.from(atob(bytesBase64), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': mediaType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

export {
  collectReferencedAssets,
  collectReferencedAssetIds,
  findAssetReferenceErrors,
} from './site-assets.js';
export type {
  ReferencedAsset,
  AssetReferenceError,
  AssetKindRow,
} from './site-assets.js';
