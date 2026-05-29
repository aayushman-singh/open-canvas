// src/custom-domain/router.ts
//
// Public host resolver for custom hostnames. Called by `src/routes/public.ts`
// as the second arm of the public host router (the first is the wildcard
// subdomain arm under the configured apex).
//
// Contract:
//   resolveCustomDomain(hostHeader, env, db) → { siteId } | null
//
//   - Returns `{ siteId }` only when the hostname is bound to a customDomain
//     row whose status is 'active'. Pending / verifying / failed rows do NOT
//     resolve — those visitors should see a "DNS not ready" 404 from the
//     caller, never the site bytes.
//   - Returns `null` for any unknown hostname so the caller can fall through
//     to its 404 path.
//
// Cache strategy:
//   The lookup is per-request hot path on every visitor request whose Host is
//   not the app host or a subdomain Published Address. To keep the DB cost
//   bounded we use the Workers Cache API keyed on the Host header. TTL is
//   60s — long enough to amortise DB cost across a burst of visitor reqs,
//   short enough that a status flip from 'active' to 'failed' (or a DELETE)
//   propagates within a minute without a manual cache flush.
//
//   Negative cache: misses are NOT cached. A typo'd hostname would otherwise
//   stick around for 60s and block recovery once the Owner fixes the DNS.
//
// Failure mode:
//   DB errors surface as exceptions to the caller. We do NOT swallow them and
//   return null; per the user's global rules a fallback to "treat as missing"
//   would silently degrade the visitor experience.

import { eq } from 'drizzle-orm';
import { db as createDb, type Db } from '../db/client.js';
import { customDomain } from '../db/schema.js';

export interface ResolveEnv {
  DATABASE_URL: string;
}

export interface ResolveResult {
  siteId: string;
}

// 60 seconds. Coarse enough to amortise DB across visitor bursts. Short
// enough that an Owner who deletes a hostname sees the public surface drop
// within a minute without manual cache purge.
const CACHE_TTL_SECONDS = 60;

// The Workers `caches.default` API is not in `lib.dom`; we type the shape we
// rely on and let the caller pass `null` when the runtime does not provide it
// (e.g. the smoke test, which exercises the function with cache=null).
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface ResolveDeps {
  /** Drizzle DB handle. When omitted, derived from env.DATABASE_URL. */
  db?: Db;
  /** Workers cache instance. When omitted, no caching is performed. */
  cache?: CacheLike | null;
}

function cacheKey(host: string): Request {
  // Keying on a synthetic URL inside an internal-only origin avoids any
  // collision with real public URLs the worker may also be caching.
  return new Request(`https://internal-custom-domain-cache.invalid/host/${encodeURIComponent(host)}`);
}

/**
 * Resolve a Host header to the site id of an active custom domain.
 *
 * Returns `null` when:
 *   - no `customDomain` row matches the hostname, or
 *   - the matching row's status is not 'active' (visitor traffic must not
 *     leak through verifying / failed rows).
 */
export async function resolveCustomDomain(
  hostHeader: string,
  env: ResolveEnv,
  deps: ResolveDeps = {},
): Promise<ResolveResult | null> {
  if (!hostHeader || typeof hostHeader !== 'string') return null;
  // Hosts arrive lower-cased from the runtime but we normalise defensively;
  // the DB stores hostnames lower-cased (validation in `register.ts`).
  const host = hostHeader.toLowerCase();

  const cache = deps.cache ?? null;
  if (cache) {
    const cached = await cache.match(cacheKey(host));
    if (cached) {
      const text = await cached.text();
      // Empty body = sentinel for "we know it resolves to nothing". We do
      // not currently write negative cache entries (see header comment), so
      // this branch exists only for defence in depth.
      if (text.length === 0) return null;
      return { siteId: text };
    }
  }

  const database = deps.db ?? createDb(env);
  const rows = await database
    .select({ siteId: customDomain.siteId, status: customDomain.status })
    .from(customDomain)
    .where(eq(customDomain.hostname, host))
    .limit(1);
  const row = rows[0];
  // Active is the ONLY status that resolves to a site. Pending/verifying/
  // failed visitors get null → 404 from caller.
  if (!row || row.status !== 'active') {
    return null;
  }

  if (cache) {
    // Cache the positive result with a short max-age. The Workers Cache API
    // honours Cache-Control on the stored Response.
    const response = new Response(row.siteId, {
      headers: { 'cache-control': `public, max-age=${String(CACHE_TTL_SECONDS)}` },
    });
    await cache.put(cacheKey(host), response);
  }

  return { siteId: row.siteId };
}

/**
 * Wrapper that pulls the runtime cache from `caches.default` when present.
 * The public host router uses this; the smoke wires `cache: null` so the
 * test path is deterministic.
 */
export function resolveCustomDomainWithRuntimeCache(
  hostHeader: string,
  env: ResolveEnv,
): Promise<ResolveResult | null> {
  // `caches.default` is a Workers-only global. In the Bun smoke harness it
  // is undefined; we degrade to no caching there, which is exactly what we
  // want for deterministic tests.
  const runtimeCaches =
    (globalThis as { caches?: { default?: CacheLike } }).caches ?? undefined;
  const cache = runtimeCaches?.default ?? null;
  return resolveCustomDomain(hostHeader, env, { cache });
}

/**
 * Invalidate the cached entry for a host after a status change or DELETE.
 * The Workers Cache API doesn't expose an explicit delete that survives a
 * miss; we write a short-TTL Response with `max-age=0` so the next lookup
 * goes back to the DB. Callers that hold a real cache pass it; the
 * register / delete handlers wire this from `caches.default`.
 */
export async function invalidateCustomDomainCache(
  hostHeader: string,
  cache: CacheLike | null,
): Promise<void> {
  if (!cache) return;
  const host = hostHeader.toLowerCase();
  // `Cache.delete` is part of the runtime surface but not in our CacheLike
  // contract (the smoke shim doesn't implement it). Punching a max-age=0
  // entry is equivalent for our purposes: the next match returns the stale
  // entry, the Cache API discards it because it's expired, and the lookup
  // falls through to the DB.
  await cache.put(
    cacheKey(host),
    new Response('', { headers: { 'cache-control': 'public, max-age=0' } }),
  );
}
