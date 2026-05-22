import { and, eq, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { STYLE_KITS, type CanvasSiteState, type StyleKit } from '../../canvas/schema';
import { validateCanvasSiteState } from '../../canvas/validate';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const canvasApi = new Hono<Env>();

canvasApi.use('*', clerkAuth());
canvasApi.use('*', requireAuth());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStyleKit(value: unknown): value is StyleKit {
  return typeof value === 'string' && (STYLE_KITS as readonly string[]).includes(value);
}

async function loadOwnedSite(
  c: Context<Env>,
  siteId: string,
): Promise<
  | { found: true; customerId: string; site: { id: string; name: string; subdomain: string; styleKit: StyleKit; editableState: CanvasSiteState; publishedVersion: number } }
  | { found: false }
> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('canvas api reached without an authenticated user');
  }

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return { found: false };
  }

  const siteRow = await database
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      styleKit: site.styleKit,
      editableState: site.editableState,
      publishedVersion: site.publishedVersion,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = siteRow[0];
  if (!row) {
    return { found: false };
  }

  return { found: true, customerId, site: row };
}

canvasApi.get('/sites/:siteId', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadOwnedSite(c, siteId);
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }
  const { site: row } = result;
  return c.json({
    siteId: row.id,
    name: row.name,
    subdomain: row.subdomain,
    editableState: row.editableState,
    publishedVersion: row.publishedVersion,
  });
});

canvasApi.put('/sites/:siteId', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadOwnedSite(c, siteId);
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const body: unknown = await c.req.json();
  if (!isRecord(body)) {
    return c.json({ error: 'editable state invalid', errors: ['body must be a JSON object'] }, 400);
  }
  const editableState = body.editableState;
  const validation = validateCanvasSiteState(editableState);
  if (!validation.valid) {
    return c.json({ error: 'editable state invalid', errors: validation.errors }, 400);
  }

  const database = db(c.env);
  await database
    .update(site)
    .set({
      editableState: editableState as CanvasSiteState,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, siteId), eq(site.customerId, result.customerId)));

  return c.json({ ok: true });
});

canvasApi.post('/sites/:siteId/style-kit', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadOwnedSite(c, siteId);
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const body: unknown = await c.req.json();
  if (!isRecord(body)) {
    return c.json({ error: 'unknown style kit' }, 400);
  }
  const incoming = body.styleKit;
  if (!isStyleKit(incoming)) {
    return c.json({ error: 'unknown style kit' }, 400);
  }

  const nextState: CanvasSiteState = {
    ...result.site.editableState,
    styleKit: incoming,
  };

  const database = db(c.env);
  await database
    .update(site)
    .set({
      styleKit: incoming,
      editableState: nextState,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, siteId), eq(site.customerId, result.customerId)));

  return c.json({ ok: true, styleKit: incoming });
});

export default canvasApi;
