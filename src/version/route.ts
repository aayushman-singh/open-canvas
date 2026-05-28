// src/version/route.ts
//
// Hono router for version history — Wave 1 #3. Mounted at
// `/api/sites/:siteId/snapshots` by the main thread (see SUBSYSTEM.md).
//
// Endpoints (all Owner-scoped via Clerk + the customer→site ownership
// check in `resolveOwnedSiteId`):
//
//   GET    /                       — list snapshots, newest-first
//   POST   /                       — capture a manual snapshot (label required)
//   POST   /:snapshotId/restore    — restore a snapshot (with safety capture)
//   GET    /:snapshotId/preview    — render snapshot HTML for the read-only view

import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import { db } from '../db/client.js';
import { customer, site } from '../db/schema.js';

import { captureManual } from './capture.js';
import { listSnapshots } from './list.js';
import { renderSnapshotPreview, PreviewRenderError } from './preview-render.js';
import { requireTurnstileSiteKey } from '../canvas/elements/form.js';
import { restoreSnapshot, RestoreError } from './restore.js';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  SITE_ROOM: DurableObjectNamespace;
  TURNSTILE_SITE_KEY?: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const versionRoute = new Hono<Env>();

versionRoute.use('*', clerkAuth());
versionRoute.use('*', requireAuth());

/**
 * Resolve the current Owner's customer id from the Clerk-authenticated user.
 * Returns null when the customer row is not yet materialised (first-visit
 * users haven't hit `/dashboard` yet) — the routes below map that to 404
 * so version-history endpoints never leak the existence of a site to a
 * stranger.
 */
async function resolveCustomerId(c: Context<Env>): Promise<string | null> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('version-history api reached without an authenticated user');
  }
  const database = db(c.env);
  const rows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Confirm `siteId` belongs to `customerId` and return it, or null. The
 * caller maps null → 404. Same shape as the publish route's ownership
 * guard so the failure semantics are consistent across Owner-scoped APIs.
 */
async function resolveOwnedSiteId(
  database: ReturnType<typeof db>,
  siteId: string,
  customerId: string,
): Promise<string | null> {
  const rows = await database
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

// GET / — list snapshots newest-first. Supports ?cursor=<iso> and ?limit=N.
versionRoute.get('/', async (c) => {
  const customerId = await resolveCustomerId(c);
  const siteId = c.req.param('siteId');
  if (!customerId || !siteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const database = db(c.env);
  const ownedSiteId = await resolveOwnedSiteId(database, siteId, customerId);
  if (!ownedSiteId) {
    return c.json({ error: 'site not found' }, 404);
  }

  const cursor = c.req.query('cursor');
  const limitRaw = c.req.query('limit');
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined;
  const options: Parameters<typeof listSnapshots>[2] = {};
  if (cursor !== undefined) options.cursor = cursor;
  if (limit !== undefined && Number.isFinite(limit) && limit > 0) options.limit = limit;

  try {
    const page = await listSnapshots(ownedSiteId, database, options);
    return c.json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// POST / — manual capture. Body: { label: string }.
versionRoute.post('/', async (c) => {
  const customerId = await resolveCustomerId(c);
  const siteId = c.req.param('siteId');
  if (!customerId || !siteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const database = db(c.env);
  const ownedSiteId = await resolveOwnedSiteId(database, siteId, customerId);
  if (!ownedSiteId) {
    return c.json({ error: 'site not found' }, 404);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'request body must be JSON' }, 400);
  }
  const labelRaw = (body && typeof body === 'object' ? (body as Record<string, unknown>).label : '');
  const label = typeof labelRaw === 'string' ? labelRaw.trim() : '';
  if (label.length === 0) {
    return c.json({ error: 'label is required' }, 400);
  }
  if (label.length > 200) {
    return c.json({ error: 'label must be 200 characters or fewer' }, 400);
  }

  await captureManual(ownedSiteId, label, database, c.env);
  return c.json({ ok: true });
});

// POST /:snapshotId/restore — restore a snapshot. The restore primitive
// captures a pre-restore safety snapshot itself, so callers don't need to.
versionRoute.post('/:snapshotId/restore', async (c) => {
  const customerId = await resolveCustomerId(c);
  const siteId = c.req.param('siteId');
  const snapshotId = c.req.param('snapshotId');
  if (!customerId || !siteId || !snapshotId) {
    return c.json({ error: 'snapshot not found' }, 404);
  }
  const database = db(c.env);
  const ownedSiteId = await resolveOwnedSiteId(database, siteId, customerId);
  if (!ownedSiteId) {
    return c.json({ error: 'snapshot not found' }, 404);
  }
  try {
    const result = await restoreSnapshot(ownedSiteId, snapshotId, database, c.env);
    return c.json({ ok: true, snapshotId: result.snapshotId, broadcasted: result.broadcasted });
  } catch (err) {
    if (err instanceof RestoreError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    // Surface the real cause to the Owner — they own this site and need
    // actionable error text rather than a generic 500. Without this, a
    // bytea-decode or DB-update failure becomes an inscrutable "Restore
    // failed: Internal Server Error" in the dashboard modal.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[version/restore] unexpected restore failure', { siteId, snapshotId, err });
    return c.json({ error: `restore failed: ${message}` }, 500);
  }
});

// GET /:snapshotId/preview — render a snapshot to HTML for the read-only view.
versionRoute.get('/:snapshotId/preview', async (c) => {
  const customerId = await resolveCustomerId(c);
  const siteId = c.req.param('siteId');
  const snapshotId = c.req.param('snapshotId');
  if (!customerId || !siteId || !snapshotId) {
    return c.json({ error: 'snapshot not found' }, 404);
  }
  const database = db(c.env);
  const ownedSiteId = await resolveOwnedSiteId(database, siteId, customerId);
  if (!ownedSiteId) {
    return c.json({ error: 'snapshot not found' }, 404);
  }
  try {
    const result = await renderSnapshotPreview(
      ownedSiteId,
      snapshotId,
      database,
      '/assets',
      requireTurnstileSiteKey(c.env),
    );
    return c.json({
      ok: true,
      html: result.html,
      capturedAt: result.capturedAt.toISOString(),
      reason: result.reason,
      label: result.label,
      publishedVersion: result.publishedVersion,
    });
  } catch (err) {
    if (err instanceof PreviewRenderError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    throw err;
  }
});

export default versionRoute;
