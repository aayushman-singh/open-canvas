// src/assets/read.ts
//
// Public read path for Owner Asset bytes. Two URL shapes resolve here:
//
//   1. `/assets/:contentHash` — per ADR 0006 decision 3 (content-hashed,
//      immutable URLs). Looked up via the `content_hash` index.
//
//   2. `/assets/:assetId` — UUID asset id, the form `MediaElement.assetId`
//      carries in canvas JSON. Looked up via the primary key. This shape
//      preserves snapshot reproducibility across the asset-pipeline
//      migration (see `src/assets/MIGRATION.md`): every previously-published
//      snapshot continues to resolve unchanged.
//
// Both shapes resolve to the same `ownerAsset` row, then fetch the bytes
// from R2 by `r2Key`. The route applies cf.image transforms ONLY when the
// caller passed transform query params (`w`, `h`, `fit`, `q`); the bare
// `/assets/<addr>` URL returns the original bytes from R2 with the long
// immutable Cache-Control.

import { eq, or } from 'drizzle-orm';
import type { R2Client } from './r2-client.js';
import type { Db } from '../db/client.js';
import { ownerAsset } from '../db/schema.js';

export interface ReadAssetDeps {
  db: Db;
  r2: R2Client;
  /**
   * Optional cf.image transform performer. The Workers runtime uses
   * `fetch(url, { cf: { image: opts } })`; the smoke replaces this with a
   * stub that records the call. When null, the route serves R2 originals
   * directly and ignores transform params.
   */
  cfImageFetch?: CfImageFetcher | null;
  /**
   * Public base URL the cf.image subrequest fetches FROM. In a real Worker
   * this is the same Worker's public origin (Cloudflare's image
   * transformations require an `https://` URL that resolves back to bytes
   * the platform can read). The smoke uses an arbitrary stub value so the
   * recorded URL stays deterministic.
   */
  publicOrigin?: string;
}

export type CfImageFetcher = (
  url: string,
  options: { cf: { image: CfImageOptions } },
) => Promise<Response>;

export interface CfImageOptions {
  format?: 'auto' | 'webp' | 'avif' | 'jpeg' | 'png';
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'scale-down' | 'crop' | 'pad';
  quality?: number;
}

export interface ReadAssetRequest {
  /**
   * The path segment after `/assets/`. Treated as either a 64-hex
   * contentHash or a UUID asset id; we try both forms in one indexed query.
   */
  addr: string;
  /**
   * Parsed URL of the incoming request — drives both the lookup of the
   * transform params (`w`, `h`, `fit`, `q`) and the cf.image fetch URL.
   */
  url: URL;
}

const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;

const CACHE_CONTROL_IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Resolve the asset row and stream its bytes. The caller (route handler)
 * passes the request URL and the path's `addr` segment. Returns either a
 * fully-shaped `Response` or `null` when the addr does not resolve to a
 * known row — the route maps `null` to a 404.
 */
export async function readOwnerAsset(
  deps: ReadAssetDeps,
  req: ReadAssetRequest,
): Promise<Response | null> {
  if (req.addr.length === 0 || req.addr.includes('/')) {
    return null;
  }

  const looksLikeHash = CONTENT_HASH_RE.test(req.addr);
  // One indexed query covers both shapes — `or(eq(id), eq(content_hash))`.
  // The id PK is unique; the content_hash index is non-unique but cheap.
  const rows = await deps.db
    .select({
      id: ownerAsset.id,
      r2Key: ownerAsset.r2Key,
      mediaType: ownerAsset.mediaType,
      kind: ownerAsset.kind,
      contentHash: ownerAsset.contentHash,
    })
    .from(ownerAsset)
    .where(
      looksLikeHash
        ? or(eq(ownerAsset.id, req.addr), eq(ownerAsset.contentHash, req.addr))
        : eq(ownerAsset.id, req.addr),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const transform = parseTransformParams(req.url);

  // Video bypasses cf.image entirely per ADR 0006 decision 4; the original
  // bytes stream straight from R2 with range-request support handled by the
  // R2 binding.
  if (row.kind === 'video' || transform === null || !deps.cfImageFetch || !deps.publicOrigin) {
    const object = await deps.r2.get(row.r2Key);
    if (!object) {
      // The DB row exists but the R2 object does not. This is a referential
      // integrity break — fail loud so the operator notices.
      throw new Error(
        `readOwnerAsset: ownerAsset row ${row.id} references r2Key ${row.r2Key} but the R2 object is missing`,
      );
    }
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? row.mediaType,
        'cache-control': CACHE_CONTROL_IMMUTABLE,
      },
    });
  }

  // Build the cf.image subrequest. The URL must resolve to bytes the edge
  // can read; we point it at the same content-hash address on this Worker,
  // which the platform fetches without re-entering our transform branch
  // (subrequest URLs don't carry our transform query params).
  const fetchUrl = `${deps.publicOrigin.replace(/\/+$/, '')}/assets/${row.contentHash}`;
  const cfImageResponse = await deps.cfImageFetch(fetchUrl, {
    cf: { image: { ...transform, format: 'auto' } },
  });
  // Stream the transformed bytes through to the visitor. Cloudflare's edge
  // negotiates `Accept` for AVIF / WebP based on the request headers,
  // returning the right Content-Type — we pass it through verbatim.
  const headers = new Headers(cfImageResponse.headers);
  headers.set('cache-control', CACHE_CONTROL_IMMUTABLE);
  return new Response(cfImageResponse.body, {
    status: cfImageResponse.status,
    headers,
  });
}

function parseTransformParams(url: URL): CfImageOptions | null {
  const wRaw = url.searchParams.get('w');
  const hRaw = url.searchParams.get('h');
  const fitRaw = url.searchParams.get('fit');
  const qRaw = url.searchParams.get('q');
  if (wRaw === null && hRaw === null && fitRaw === null && qRaw === null) {
    return null;
  }
  const opts: CfImageOptions = {};
  if (wRaw !== null) {
    const w = parseInt(wRaw, 10);
    if (!Number.isFinite(w) || w <= 0 || w > 10000) {
      throw new Error(`readOwnerAsset: invalid w=${wRaw} (must be a positive integer)`);
    }
    opts.width = w;
  }
  if (hRaw !== null) {
    const h = parseInt(hRaw, 10);
    if (!Number.isFinite(h) || h <= 0 || h > 10000) {
      throw new Error(`readOwnerAsset: invalid h=${hRaw} (must be a positive integer)`);
    }
    opts.height = h;
  }
  if (fitRaw !== null) {
    if (!['cover', 'contain', 'scale-down', 'crop', 'pad'].includes(fitRaw)) {
      throw new Error(
        `readOwnerAsset: invalid fit=${fitRaw} (must be cover | contain | scale-down | crop | pad)`,
      );
    }
    opts.fit = fitRaw as NonNullable<CfImageOptions['fit']>;
  } else {
    opts.fit = 'cover';
  }
  if (qRaw !== null) {
    const q = parseInt(qRaw, 10);
    if (!Number.isFinite(q) || q < 1 || q > 100) {
      throw new Error(`readOwnerAsset: invalid q=${qRaw} (must be 1..100)`);
    }
    opts.quality = q;
  }
  return opts;
}
