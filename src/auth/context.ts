import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { db } from '../db/client.js';
import { customer, site } from '../db/schema.js';
import type { ClerkAuthVariables } from './middleware.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  REPLICATE_API_TOKEN: string;
  // SMOKE bypass — only honoured when the smoke runner sets it explicitly.
  SMOKE?: string;
};

export type OwnerEnv = { Bindings: Bindings; Variables: ClerkAuthVariables };

export type OwnerOk = { ok: true; customer: { id: string } };
export type OwnedSiteOk = {
  ok: true;
  customer: { id: string };
  site: { id: string; customerId: string };
};
export type Fail = { ok: false; response: Response };

/**
 * Resolve the authenticated Clerk user to its customer row. Returns a 401-equivalent
 * response when no auth context is present and a 403 when the user has no customer
 * row yet (sign-up flow not finished).
 *
 * The SMOKE bypass exists only for the in-process owner-asset smoke harness; it
 * requires env.SMOKE === '1' AND a header `x-smoke-customer-id`. Production paths
 * cannot reach the bypass because env.SMOKE is unset.
 */
export async function requireOwnerContext(c: Context<OwnerEnv>): Promise<OwnerOk | Fail> {
  if (c.env.SMOKE === '1') {
    const id = c.req.header('x-smoke-customer-id');
    if (id && id.length > 0) return { ok: true, customer: { id } };
  }
  const auth = c.get('auth');
  if (!auth || !auth.userId) {
    return { ok: false, response: c.json({ error: 'unauthorized' }, 401) };
  }
  const rows = await db(c.env)
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, response: c.json({ error: 'no customer record' }, 403) };
  return { ok: true, customer: row };
}

/**
 * Same as requireOwnerContext, but additionally loads the site row and verifies
 * ownership. Returns 404 when the site does not exist or does not belong to the
 * authenticated customer (the existence of a site is not leaked to non-owners).
 */
export async function requireOwnedSite(
  c: Context<OwnerEnv>,
  siteId: string,
): Promise<OwnedSiteOk | Fail> {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx;
  const rows = await db(c.env)
    .select({ id: site.id, customerId: site.customerId })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, ctx.customer.id)))
    .limit(1);
  const s = rows[0];
  if (!s) return { ok: false, response: c.json({ error: 'site not found' }, 404) };
  return { ok: true, customer: ctx.customer, site: s };
}
