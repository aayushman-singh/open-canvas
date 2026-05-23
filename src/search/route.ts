// src/search/route.ts
//
// Wave 3 #13 — Public host router for `GET /__rev01/search?q=<q>`. Mounted on
// the public host by the main thread (see "Public-host integration shape" in
// the agent report).
//
// Lifecycle:
//   1. Resolve the site row from the Host header. We accept either the
//      `*.rev01.aayushman.dev` subdomain shape OR a custom domain bound via
//      Wave 1 #5. Resolution duplicates the helpers in
//      `src/routes/public.ts` rather than importing from it — the public
//      router does not export its host-resolution primitives, and the brief
//      explicitly allows the duplication so long as it is documented.
//
//      Documented duplication:
//        - `extractSubdomain(host)` mirrors the same-named helper in
//          `src/routes/public.ts`. Both reject nested subdomains, empty
//          prefixes, and hostnames that don't end with the public suffix.
//        - `loadSiteBySubdomain` mirrors `loadPublicSite` from public.ts.
//          We only project the columns we need (`id`) and skip the
//          password-gate / snapshot-shape columns the snapshot path reads.
//        - Custom-domain resolution delegates to the shared
//          `resolveCustomDomainWithRuntimeCache` so no duplication is
//          incurred on that arm.
//
//   2. Validate the query with `validateQuery`. Empty / over-long inputs
//      return 400 with a JSON error payload; the caller's UI surfaces the
//      reason. SQL injection attempts get the same path as any other
//      string: tokenised by `plainto_tsquery`, returning zero hits.
//
//   3. Run `searchSite(...)` with the request DB handle and return JSON
//      `{ q, hits: [{ pageSlug, elementId, snippet }] }`.
//
// The endpoint is GET so a visitor's browser can submit the search via a
// plain `<form method="get" action="/__rev01/search">`. The opt-in section
// recipe (see `box-recipe.ts`) emits exactly that shape.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ClerkAuthVariables } from '../auth/middleware.js';
import { db } from '../db/client.js';
import { site } from '../db/schema.js';
import { resolveCustomDomainWithRuntimeCache } from '../custom-domain/router.js';
import { searchSite, validateQuery } from './query.js';

interface Bindings {
  DATABASE_URL: string;
  // Wave 1 #5 — custom-domain resolver pokes at the CF binding to read the
  // host row when the host isn't a subdomain Published Address.
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const router = new Hono<Env>();

// --------------------------------------------------------------------------
// Host resolution — duplicated from `src/routes/public.ts` per the docs at
// the top of this file. Keep behaviour byte-identical: any change to public
// host shape must be mirrored here.
// --------------------------------------------------------------------------

const PUBLIC_HOST_SUFFIX = '.rev01.aayushman.dev';

function extractSubdomain(host: string): string | null {
  if (!host.endsWith(PUBLIC_HOST_SUFFIX)) return null;
  const prefix = host.slice(0, host.length - PUBLIC_HOST_SUFFIX.length);
  if (prefix.length === 0) return null;
  if (prefix.includes('.')) return null;
  return prefix;
}

async function loadSiteIdBySubdomain(
  env: Bindings,
  subdomain: string,
): Promise<string | null> {
  const database = db(env);
  const rows = await database
    .select({ id: site.id })
    .from(site)
    .where(eq(site.subdomain, subdomain))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function resolveSiteIdForHost(env: Bindings, host: string): Promise<string | null> {
  if (host.endsWith(PUBLIC_HOST_SUFFIX)) {
    const subdomain = extractSubdomain(host);
    if (subdomain === null) return null;
    return await loadSiteIdBySubdomain(env, subdomain);
  }
  const custom = await resolveCustomDomainWithRuntimeCache(host, env);
  return custom?.siteId ?? null;
}

// --------------------------------------------------------------------------
// Handler
// --------------------------------------------------------------------------

router.get('/', async (c) => {
  const host = new URL(c.req.url).host;
  const siteId = await resolveSiteIdForHost(c.env, host);
  if (!siteId) {
    return c.json({ error: 'site not found' }, 404);
  }

  const rawQ = c.req.query('q');
  const validation = validateQuery(rawQ);
  if (validation.kind === 'empty') {
    // An empty query is a UX no-op, not a failure. We return 200 with an
    // empty hits array so a search box that accidentally submits on focus
    // doesn't surface a scary error message to the visitor.
    return c.json({ q: '', hits: [] });
  }
  if (validation.kind === 'too-long') {
    return c.json(
      { error: 'query too long', maxLength: 100 },
      400,
    );
  }

  // Hand off to the FTS executor. Errors propagate as 500 — we do NOT
  // swallow DB errors into an empty response, per the user's
  // all-or-nothing rule.
  const hits = await searchSite({
    db: db(c.env),
    siteId,
    q: validation.normalized,
  });

  return c.json({ q: validation.normalized, hits });
});

export default router;
