// src/routes/api/slot-history.ts
//
// Slot History endpoints — per-MediaElement MRU record of every Owner Asset
// ever applied to that element. Editor-only (never read by visitors).
// See ADR 0004 decision 4 and the Slot History entry in CONTEXT.md.

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { clerkAuth } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { requireOwnedSite, type OwnerEnv } from '../../auth/context';
import { db } from '../../db/client';
import { ownerAsset, slotHistory } from '../../db/schema';

const slotHistoryApi = new Hono<OwnerEnv>();

const realRequireAuth = requireAuth();

// Auth middleware — scoped to slot-history paths (not '*') so it does not
// intercept sibling routers that share the /api mount point.
//
// SMOKE bypass runs before clerkAuth so the Clerk SDK never reads (and
// consumes) the request body when the smoke harness is driving requests.
// Production paths cannot reach the bypass because env.SMOKE is unset.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const applyAuth: any = async (c: any, next: () => Promise<void>): Promise<Response | void> => {
  if (c.env.SMOKE === '1') {
    if ((c.req.header('x-smoke-customer-id') ?? '').length > 0) {
      await next();
      return;
    }
    return c.json({ error: 'unauthorized' }, 401);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return clerkAuth()(c as any, async () => { await realRequireAuth(c as any, next); });
};

slotHistoryApi.use('/sites/:siteId/elements/:elementId/history', applyAuth);
slotHistoryApi.use('/sites/:siteId/elements/:elementId/history/:assetId', applyAuth);

// GET — list last N history entries newest-first.
slotHistoryApi.get('/sites/:siteId/elements/:elementId/history', async (c) => {
  const ctx = await requireOwnedSite(c, c.req.param('siteId'));
  if (!ctx.ok) return ctx.response;

  const rawLimit = Number(c.req.query('limit') ?? '4');
  const limit = Math.max(1, Math.min(20, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 4));

  const rows = await db(c.env)
    .select({
      assetId: slotHistory.assetId,
      lastUsedAt: slotHistory.lastUsedAt,
      kind: ownerAsset.kind,
      mediaType: ownerAsset.mediaType,
      alt: ownerAsset.alt,
    })
    .from(slotHistory)
    .innerJoin(ownerAsset, eq(ownerAsset.id, slotHistory.assetId))
    .where(
      and(eq(slotHistory.siteId, ctx.site.id), eq(slotHistory.elementId, c.req.param('elementId'))),
    )
    .orderBy(desc(slotHistory.lastUsedAt))
    .limit(limit);

  return c.json({ entries: rows });
});

// PUT — MRU upsert on (siteId, elementId, assetId). Also bumps owner_asset.last_used_at.
slotHistoryApi.put('/sites/:siteId/elements/:elementId/history/:assetId', async (c) => {
  const ctx = await requireOwnedSite(c, c.req.param('siteId'));
  if (!ctx.ok) return ctx.response;
  const assetId = c.req.param('assetId');
  const elementId = c.req.param('elementId');

  // Refuse to record history for an asset the owner does not own.
  const ownership = await db(c.env)
    .select({ id: ownerAsset.id })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.id, assetId), eq(ownerAsset.customerId, ctx.customer.id)))
    .limit(1);
  if (ownership.length === 0) return c.json({ error: 'asset not owned' }, 403);

  const now = new Date();
  const database = db(c.env);

  // neon-http does not provide ACID transactions. Two best-effort writes; if the
  // slot_history upsert succeeds but the owner_asset bump fails, the gallery
  // sort lags by one tick, which is acceptable. A failure in the first write
  // surfaces as 500 and the second never runs.
  await database
    .insert(slotHistory)
    .values({ siteId: ctx.site.id, elementId, assetId, lastUsedAt: now })
    .onConflictDoUpdate({
      target: [slotHistory.siteId, slotHistory.elementId, slotHistory.assetId],
      set: { lastUsedAt: now },
    });
  await database
    .update(ownerAsset)
    .set({ lastUsedAt: now })
    .where(eq(ownerAsset.id, assetId));

  return c.json({ ok: true });
});

// DELETE — purge all history rows for one element. Used when the element is
// removed from the editable state.
slotHistoryApi.delete('/sites/:siteId/elements/:elementId/history', async (c) => {
  const ctx = await requireOwnedSite(c, c.req.param('siteId'));
  if (!ctx.ok) return ctx.response;
  await db(c.env)
    .delete(slotHistory)
    .where(
      and(eq(slotHistory.siteId, ctx.site.id), eq(slotHistory.elementId, c.req.param('elementId'))),
    );
  return c.json({ ok: true });
});

export default slotHistoryApi;
