// src/custom-domain/route.ts
//
// Hono router mounted by the main thread at `/api/sites/:siteId/domains`.
// See SUBSYSTEM.md for the cron + dashboard refresh story.
//
// Endpoints:
//   POST   /                       — register a new hostname.
//   GET    /                       — list this site's hostnames with status.
//   DELETE /:hostname              — remove a hostname.
//
// Every endpoint is Clerk-gated; the request must resolve to a customer row
// that owns the site identified by `:siteId`. The handlers fan out to the
// register / poll / delete primitives, which are pure functions over deps
// and inputs so they can be smoke-tested without the route layer.

import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { createCfHostnamesClient } from './cf-api.js';
import { deleteCustomDomain } from './delete.js';
import { buildPollDepsFromEnv, pollOneById } from './poll.js';
import { registerCustomDomain } from './register.js';
import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import { db } from '../db/client.js';
import { customDomain, customer, site } from '../db/schema.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  CF_API_TOKEN: string;
  CF_ZONE_ID: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const router = new Hono<Env>();

router.use('*', clerkAuth());
router.use('*', requireAuth());

async function resolveCustomerId(c: Context<Env>): Promise<string | null> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('custom-domain route reached without an authenticated user');
  }
  const database = db(c.env);
  const rows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

function cfClientFor(env: Bindings) {
  return createCfHostnamesClient({
    apiToken: env.CF_API_TOKEN,
    zoneId: env.CF_ZONE_ID,
  });
}

router.post('/', async (c) => {
  const customerId = await resolveCustomerId(c);
  if (!customerId) {
    return c.json({ error: 'no customer row for current user' }, 409);
  }
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  let body: { hostname?: unknown } = {};
  try {
    body = await c.req.json<{ hostname?: unknown }>();
  } catch {
    return c.json({ error: 'request body must be JSON with { hostname }' }, 400);
  }
  const hostname = typeof body.hostname === 'string' ? body.hostname : '';
  const result = await registerCustomDomain(
    { db: db(c.env), cf: cfClientFor(c.env) },
    { siteId, customerId, hostname },
  );
  switch (result.status) {
    case 'created':
      return c.json({ ok: true, domain: serialiseDomain(result.row) }, 201);
    case 'site_not_found':
      return c.json({ error: 'site not found' }, 404);
    case 'invalid_hostname':
      return c.json({ error: result.reason }, 400);
    case 'already_registered':
      return c.json({ error: 'hostname is already registered' }, 409);
    case 'cf_rejected':
      return c.json(
        {
          error: 'cloudflare rejected the hostname',
          httpStatus: result.httpStatus,
          errors: result.errors,
        },
        502,
      );
  }
});

router.get('/', async (c) => {
  const customerId = await resolveCustomerId(c);
  if (!customerId) {
    return c.json({ domains: [] });
  }
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const database = db(c.env);
  // Scope by site + ownership in a single query so a typo'd siteId doesn't
  // leak rows owned by a different Owner.
  const siteRows = await database
    .select({ id: site.id })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1);
  if (!siteRows[0]) {
    return c.json({ error: 'site not found' }, 404);
  }
  // REVIEW: this queries all owned sites (limit 50), then checks if siteId is in the list. Two problems: (1) O(N) scan instead of a single `WHERE id = siteId AND customerId = customerId` query, and (2) customers with >50 sites silently bypass the ownership check for sites beyond the 50th. Combine into a single query with both conditions.
  const ownedRows = await database
    .select({ id: site.id })
    .from(site)
    .where(eq(site.customerId, customerId))
    .limit(50);
  if (!ownedRows.some((r) => r.id === siteId)) {
    return c.json({ error: 'site not found' }, 404);
  }
  const domains = await database
    .select()
    .from(customDomain)
    .where(eq(customDomain.siteId, siteId));

  // Lazy refresh: opportunistically poll any row that is NOT in a terminal
  // failure state, so the dashboard sees fresh status without waiting for
  // cron. Errors from the poll are swallowed at the per-row level inside
  // `pollOneById` / `pollOne`; we tolerate stale rows over breaking the
  // list endpoint.
  if (domains.length > 0) {
    const pollDeps = await buildPollDepsFromEnv(c.env);
    for (const row of domains) {
      if (row.status === 'failed') continue;
      try {
        await pollOneById(pollDeps, row.id);
      } catch (err) {
        console.error('[custom-domain] lazy refresh poll failed', {
          rowId: row.id,
          hostname: row.hostname,
          err,
        });
      }
    }
    // Re-read after the lazy refresh so the response reflects the polled state.
    const refreshed = await database
      .select()
      .from(customDomain)
      .where(eq(customDomain.siteId, siteId));
    return c.json({ domains: refreshed.map(serialiseDomain) });
  }

  return c.json({ domains: domains.map(serialiseDomain) });
});

router.delete('/:hostname', async (c) => {
  const customerId = await resolveCustomerId(c);
  if (!customerId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const siteId = c.req.param('siteId');
  const hostname = c.req.param('hostname');
  if (!siteId || !hostname) {
    return c.json({ error: 'site or hostname missing' }, 404);
  }
  const result = await deleteCustomDomain(
    { db: db(c.env), cf: cfClientFor(c.env) },
    { siteId, customerId, hostname },
  );
  switch (result.status) {
    case 'deleted':
      return c.json({ ok: true });
    case 'not_found':
      return c.json({ error: 'domain not found' }, 404);
    case 'cf_rejected':
      return c.json(
        {
          error: 'cloudflare rejected the delete',
          httpStatus: result.httpStatus,
          errors: result.errors,
        },
        502,
      );
  }
});

function serialiseDomain(row: {
  id: string;
  siteId: string;
  hostname: string;
  cfHostnameId: string;
  status: string;
  verificationRecord: Record<string, unknown>;
  certIssuedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    siteId: row.siteId,
    hostname: row.hostname,
    cfHostnameId: row.cfHostnameId,
    status: row.status,
    verificationRecord: row.verificationRecord,
    certIssuedAt: row.certIssuedAt ? row.certIssuedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export default router;
