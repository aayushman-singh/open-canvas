// src/seo/sitemap/route.ts
//
// Wishlist #22 — Public-host router for `GET /sitemap.xml` and
// `GET /robots.txt`. Mounted on the public host by the main thread (see the
// agent-report mount lines).
//
// Lifecycle:
//   1. Resolve the site row from the Host header. We accept either the
//      `*.rev01.aayushman.dev` subdomain shape OR a custom domain bound via
//      Wave 1 #5. Resolution duplicates the helpers in `src/routes/public.ts`
//      rather than importing from them — the public router does not export
//      its host-resolution primitives, and Wave 3 #13's search route set the
//      precedent that the brief explicitly allows the duplication so long as
//      it is documented.
//
//      Documented duplication:
//        - `extractSubdomain(host)` mirrors the same-named helper in
//          `src/routes/public.ts` and `src/search/route.ts`. Same shape,
//          same nested-subdomain reject. Any change to the public host
//          suffix MUST be mirrored across all three sites; the constant
//          `PUBLIC_HOST_SUFFIX` is defined locally for the same reason.
//        - `loadPublicSnapshotBySubdomain` mirrors `loadPublicSite` from
//          public.ts but projects only the columns we need:
//          (`id`, `subdomain`, `publishedSnapshot`). We do NOT read the
//          password-gate columns — sitemap + robots are public crawler-
//          facing endpoints, so the password gate doesn't apply (the
//          gate is for visitor-facing HTML pages).
//        - Custom-domain resolution delegates to the shared
//          `resolveCustomDomainWithRuntimeCache` so no duplication is
//          incurred on that arm.
//
//   2. Validate the snapshot is present. A site that has been created but
//      never published surfaces a 404 — the same status the renderer arm
//      uses ("site not yet published"). Crawlers will retry later.
//
//   3. Hand off to `buildSitemapXml` or `buildRobotsTxt`. Set the
//      Content-Type (`application/xml` / `text/plain`) and a 1-hour
//      `Cache-Control` per the brief. The snapshot version is baked into
//      sitemap `<loc>` URLs as a fragment so cached values bust cleanly on
//      republish even without an explicit purge.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ClerkAuthVariables } from '../../auth/middleware.js';
import type { PublishedSnapshot } from '../../canvas/schema.js';
import { db } from '../../db/client.js';
import { site } from '../../db/schema.js';
import { resolveCustomDomainWithRuntimeCache } from '../../custom-domain/router.js';
import { buildSitemapXml } from './build.js';
import { buildRobotsTxt } from './robots.js';

interface Bindings {
  DATABASE_URL: string;
  // Wave 1 #5 — custom-domain resolver reads the CF binding to look up the
  // host row when the host isn't a subdomain Published Address.
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const router = new Hono<Env>();

// ---------------------------------------------------------------------------
// Host resolution — duplicated from `src/routes/public.ts` (and mirrored in
// `src/search/route.ts`). Keep behaviour byte-identical: any change to public
// host shape must be propagated across all three sites.
// ---------------------------------------------------------------------------

const PUBLIC_HOST_SUFFIX = '.rev01.aayushman.dev';

const CACHE_CONTROL_PUBLIC_1H = 'public, max-age=3600';

function extractSubdomain(host: string): string | null {
  if (!host.endsWith(PUBLIC_HOST_SUFFIX)) return null;
  const prefix = host.slice(0, host.length - PUBLIC_HOST_SUFFIX.length);
  if (prefix.length === 0) return null;
  if (prefix.includes('.')) return null;
  return prefix;
}

interface ResolvedSite {
  id: string;
  subdomain: string;
  publishedSnapshot: PublishedSnapshot | null;
}

async function loadPublicSnapshotBySubdomain(
  env: Bindings,
  subdomain: string,
): Promise<ResolvedSite | null> {
  const database = db(env);
  const rows = await database
    .select({
      id: site.id,
      subdomain: site.subdomain,
      publishedSnapshot: site.publishedSnapshot,
    })
    .from(site)
    .where(eq(site.subdomain, subdomain))
    .limit(1);
  return rows[0] ?? null;
}

async function loadPublicSnapshotById(
  env: Bindings,
  siteId: string,
): Promise<ResolvedSite | null> {
  const database = db(env);
  const rows = await database
    .select({
      id: site.id,
      subdomain: site.subdomain,
      publishedSnapshot: site.publishedSnapshot,
    })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1);
  return rows[0] ?? null;
}

async function resolveSiteForHost(env: Bindings, host: string): Promise<ResolvedSite | null> {
  if (host.endsWith(PUBLIC_HOST_SUFFIX)) {
    const subdomain = extractSubdomain(host);
    if (subdomain === null) return null;
    return await loadPublicSnapshotBySubdomain(env, subdomain);
  }
  const custom = await resolveCustomDomainWithRuntimeCache(host, env);
  if (!custom) return null;
  return await loadPublicSnapshotById(env, custom.siteId);
}

// ---------------------------------------------------------------------------
// Pure response builders — exported so the smoke can exercise the wire
// contract (Content-Type, Cache-Control, status) without hitting the DB.
// The route handlers below resolve the snapshot then defer to these.
// ---------------------------------------------------------------------------

/**
 * Build the `Response` for `GET /sitemap.xml` given an already-resolved
 * Published Snapshot. Bytes-identical to what the route handler returns when
 * the snapshot lookup succeeds.
 */
export function buildSitemapResponse(
  snapshot: PublishedSnapshot,
  host: string,
  protocol: 'https' | 'http',
): Response {
  const xml = buildSitemapXml(snapshot, { host, protocol });
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': CACHE_CONTROL_PUBLIC_1H,
    },
  });
}

/**
 * Build the `Response` for `GET /robots.txt` given an already-resolved
 * Published Snapshot and the visitor-facing host. The `Sitemap:` directive
 * points back at the same host so the crawler's next hop lands here.
 */
export function buildRobotsResponse(
  snapshot: PublishedSnapshot,
  host: string,
  protocol: 'https' | 'http',
): Response {
  const publishedAddress = `${protocol}://${host}`;
  const body = buildRobotsTxt(snapshot, publishedAddress);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': CACHE_CONTROL_PUBLIC_1H,
    },
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

router.get('/sitemap.xml', async (c) => {
  const requestUrl = new URL(c.req.url);
  const host = requestUrl.host;
  const resolved = await resolveSiteForHost(c.env, host);
  if (!resolved) {
    return c.text('site not found', 404);
  }
  if (!resolved.publishedSnapshot) {
    return c.text('site not yet published', 404);
  }
  const protocol = requestUrl.protocol === 'http:' ? 'http' : 'https';
  return buildSitemapResponse(resolved.publishedSnapshot, host, protocol);
});

router.get('/robots.txt', async (c) => {
  const requestUrl = new URL(c.req.url);
  const host = requestUrl.host;
  const resolved = await resolveSiteForHost(c.env, host);
  if (!resolved) {
    return c.text('site not found', 404);
  }
  if (!resolved.publishedSnapshot) {
    return c.text('site not yet published', 404);
  }
  const protocol = requestUrl.protocol === 'http:' ? 'http' : 'https';
  return buildRobotsResponse(resolved.publishedSnapshot, host, protocol);
});

export default router;
