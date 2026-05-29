// src/og-image/cache.ts
//
// R2 read-through cache for rendered OG PNGs. Two key shapes coexist:
//
//   1. Version-keyed `og/{siteId}/{pageSlug}.v{version}.png` — the original
//      shape the OG-serving route reads. Embedding the version means the
//      route URL stays version-addressed and pre-existing cached PNGs from
//      earlier publishes keep resolving.
//
//   2. Content-hash-keyed `og/c/{contentHash}.png` — a memo. The on-publish
//      hook computes a deterministic hash of every input that affects the
//      rendered SVG (siteName, page title/description, first section, style
//      preset). When a republish produces an unchanged hash, the hook can
//      copy bytes from the memo to the new version-key and skip the
//      Satori+resvg pipeline entirely — the expensive part is CPU, and the
//      Workers CPU budget is what 1102 trips on under concurrent load.
//
// Both key shapes resolve to `image/png` bytes. The memo is shared across
// sites — content-hash is global — so if two sites happen to render an
// identical OG card they share R2 storage.

import type { R2Client } from '../assets/r2-client.js';

export const OG_CONTENT_TYPE = 'image/png';

/**
 * R2 key for a per-version OG render. Embedding the version in the key
 * means a fresh publish carves a new namespace; old renders linger but are
 * never read because the route always uses the current published version.
 */
export function cacheKeyFor(siteId: string, pageSlug: string, version: number): string {
  // The route stamps `version` from the published-snapshot row. Negative or
  // fractional values would be a bug upstream; we encode the integer
  // verbatim and let the caller's input validation guard the shape.
  return `og/${siteId}/${pageSlug}.v${String(version)}.png`;
}

export interface CachedOg {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Read a cached OG render. Returns null on miss (the route then renders +
 * `writeCached`s + serves). `head` is NOT enough on the read path: it
 * confirms presence but not bytes — we still want the bytes downstream.
 *
 * The smoke + route can also call `headCached` separately when they want
 * to assert presence without paying for the body download.
 */
export async function readCached(
  r2: R2Client,
  siteId: string,
  pageSlug: string,
  version: number,
): Promise<CachedOg | null> {
  const key = cacheKeyFor(siteId, pageSlug, version);
  const obj = await r2.get(key);
  if (obj === null) return null;
  const buf = await obj.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const contentType = obj.httpMetadata?.contentType ?? OG_CONTENT_TYPE;
  return { bytes, contentType };
}

/**
 * Presence probe — true when the key exists, false otherwise. Lighter than
 * `readCached` and useful for the pre-render hook to skip work when a
 * previous run already produced bytes for this version.
 */
export async function headCached(
  r2: R2Client,
  siteId: string,
  pageSlug: string,
  version: number,
): Promise<boolean> {
  const key = cacheKeyFor(siteId, pageSlug, version);
  return (await r2.head(key)) !== null;
}

/**
 * Write bytes to the cache key. Unconditional — version-bumped keys never
 * collide with prior content, so an `onlyIf` guard would only add latency.
 */
export async function writeCached(
  r2: R2Client,
  siteId: string,
  pageSlug: string,
  version: number,
  bytes: Uint8Array,
): Promise<void> {
  const key = cacheKeyFor(siteId, pageSlug, version);
  await r2.put(key, bytes, OG_CONTENT_TYPE);
}

// ---------------------------------------------------------------------------
// Content-hash memo cache. The on-publish hook uses this to skip Satori+resvg
// when the per-page render inputs are unchanged from a prior render anywhere
// in the bucket. The memo is read-once / write-once per content hash.
// ---------------------------------------------------------------------------

/**
 * R2 key for a content-hash memo. The hash MUST be lowercase hex; the
 * regex is enforced at the boundary so a bad hash never silently writes to
 * a malformed key.
 */
export function contentCacheKeyFor(contentHash: string): string {
  if (!/^[0-9a-f]{32,64}$/.test(contentHash)) {
    throw new Error(
      `contentCacheKeyFor: contentHash must be 32-64 lowercase hex chars, got ${contentHash}`,
    );
  }
  return `og/c/${contentHash}.png`;
}

/**
 * Fetch the memoed bytes for a content hash. Returns null on miss; the caller
 * then renders fresh + `writeContentCached`s. The hot-path optimisation in
 * `onPublishGenerateOg` is to skip rendering on hit.
 */
export async function readContentCached(
  r2: R2Client,
  contentHash: string,
): Promise<CachedOg | null> {
  const key = contentCacheKeyFor(contentHash);
  const obj = await r2.get(key);
  if (obj === null) return null;
  const buf = await obj.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const contentType = obj.httpMetadata?.contentType ?? OG_CONTENT_TYPE;
  return { bytes, contentType };
}

/**
 * Write bytes to a content-hash memo key. Unconditional — content-hash keys
 * are by definition collision-free for the same inputs, so racing concurrent
 * writes produce the same bytes.
 */
export async function writeContentCached(
  r2: R2Client,
  contentHash: string,
  bytes: Uint8Array,
): Promise<void> {
  const key = contentCacheKeyFor(contentHash);
  await r2.put(key, bytes, OG_CONTENT_TYPE);
}
