// src/embed/cache.ts
//
// Read-through cache for resolved embed entries. Wraps the Workers Cache API
// (`caches.default`) behind a small CacheLike contract that the smoke can
// substitute with an in-memory Map.
//
// Why a cache at all when `resolveEmbed` is a pure regex match? Two reasons:
//
//   1. The plan calls for a 24h TTL keyed on the *original URL* so a future
//      real-oEmbed path (one that actually fetches platform.twitter.com or
//      figma.com endpoints) can land here without re-architecting the call
//      sites. The interface — `resolveCached(url, deps)` — does not change.
//
//   2. Even for the regex-only path the cache acts as a "did we already
//      decide" log per published snapshot, which the smoke uses to assert
//      that the second lookup of an identical URL returns byte-identical
//      bytes without re-running the regex table. That's the contract the
//      brief asks for.
//
// Failure mode: any error from the underlying cache surfaces to the caller.
// We do NOT swallow + recompute — that would be a silent fallback (against
// the global "no fallbacks" rule). When the deps don't include a cache the
// resolver simply runs uncached; that path is the explicit "no cache" mode,
// not a quiet degradation.

import { resolveEmbed, type ResolvedEmbed } from './oembed-resolve.js';

/** 24h, per the plan's TTL. */
export const EMBED_CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Subset of the Workers `Cache` interface we depend on. The smoke shims this
 * with a `Map`-backed implementation so the test is deterministic without a
 * runtime caches global.
 */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface ResolveCachedDeps {
  /** Workers cache instance. When omitted or null, no caching is performed. */
  cache?: CacheLike | null;
}

/**
 * Synthetic key URL — keeps the embed-cache namespace disjoint from any real
 * URL the worker may also be caching. The `encodeURIComponent` is critical:
 * raw user URLs can contain '/' and '?' which would otherwise re-fragment
 * the cache key path.
 */
function cacheKey(url: string): Request {
  return new Request(`https://internal-embed-cache.invalid/url/${encodeURIComponent(url)}`);
}

/**
 * Resolve an embed URL through the cache. Returns the cached value on hit;
 * runs the regex resolver + writes to cache on miss.
 *
 * Invalid URLs (whose `resolveEmbed` answer is `provider === 'invalid'`) are
 * NOT cached — there's no benefit to remembering "this string is broken"
 * across 24 hours, and not writing them lets the smoke prove the cache
 * actually stored a positive entry.
 */
export async function resolveEmbedCached(
  url: string,
  deps: ResolveCachedDeps = {},
): Promise<ResolvedEmbed> {
  const cache = deps.cache ?? null;
  if (cache !== null) {
    const cached = await cache.match(cacheKey(url));
    if (cached) {
      const text = await cached.text();
      // The body is `JSON.stringify(ResolvedEmbed)`. A non-JSON body would
      // signal a bug in `writeCache` — fail loudly so we never silently
      // serve a corrupted entry.
      const parsed = JSON.parse(text) as ResolvedEmbed;
      return parsed;
    }
  }

  const fresh = resolveEmbed(url);

  if (cache !== null && fresh.providerName !== 'invalid') {
    const body = JSON.stringify(fresh);
    const response = new Response(body, {
      headers: {
        'cache-control': `public, max-age=${String(EMBED_CACHE_TTL_SECONDS)}`,
        'content-type': 'application/json',
      },
    });
    await cache.put(cacheKey(url), response);
  }

  return fresh;
}

/**
 * Pull the Workers runtime cache when present. The smoke harness lacks
 * `caches.default` and passes its own CacheLike explicitly; production code
 * uses this helper.
 */
export function getRuntimeEmbedCache(): CacheLike | null {
  const runtimeCaches = (globalThis as { caches?: { default?: CacheLike } }).caches ?? undefined;
  return runtimeCaches?.default ?? null;
}
