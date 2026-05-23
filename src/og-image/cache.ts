// src/og-image/cache.ts
//
// R2 read-through cache for rendered OG PNGs. Keyed by the (siteId, pageSlug,
// snapshotVersion) triple — bumping `publishedVersion` produces a fresh key,
// so stale never serves. Old keys are NOT actively pruned: R2 lifecycle / a
// future sweeper job handles them. Because each key embeds a monotonically
// increasing version, name collisions are impossible.
//
// Contract:
//   - `cacheKeyFor(siteId, slug, version)` is the only place that builds the
//     R2 key string. Tests assert that path.
//   - `readCached` returns the bytes + content type, or null if absent.
//   - `writeCached` stores bytes as `image/png` with no conditional-put
//     option — version-bumped keys never overlap so unconditional is fine.

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
