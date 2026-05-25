// src/routes/api/addons.ts
//
// Addon entitlement + site addon configuration endpoints.
// Mounted at /api/addons in the main app.
//
// Endpoints:
//   POST   /:addonId/acquire        — Grant addon entitlement to authenticated customer.
//   DELETE /:addonId/acquire        — Revoke addon entitlement from authenticated customer.
//   PUT    /sites/:siteId/:addonId  — Enable + configure a site addon.
//   GET    /sites/:siteId           — List all site addon rows for a site.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { db } from '../../db/client';
import { addonEntitlement, customer, site, siteAddon } from '../../db/schema';
import { getAddon } from '../../addons/registry';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

async function resolveCustomerId(
  env: Bindings,
  clerkUserId: string,
): Promise<string | null> {
  const database = db(env);
  const rows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0]?.id ?? null;
}

const addonsApi = new Hono<Env>();

addonsApi.use('*', clerkAuth());
addonsApi.use('*', requireAuth());

// POST /:addonId/acquire — Grant addon entitlement to the authenticated customer.
// If already owned, returns { ok: true, alreadyOwned: true }.
addonsApi.post('/:addonId/acquire', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('addons acquire endpoint reached without an authenticated user');
  }

  const addonId = c.req.param('addonId');

  const addon = getAddon(addonId);
  if (!addon) {
    return c.json({ error: 'addon not found' }, 404);
  }

  const customerId = await resolveCustomerId(c.env, auth.userId);
  if (!customerId) {
    return c.json({ error: 'customer not found' }, 404);
  }

  const database = db(c.env);

  const existing = await database
    .select({ id: addonEntitlement.id })
    .from(addonEntitlement)
    .where(
      and(
        eq(addonEntitlement.customerId, customerId),
        eq(addonEntitlement.addonId, addonId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return c.json({ ok: true, alreadyOwned: true });
  }

  await database.insert(addonEntitlement).values({
    customerId,
    addonId,
  });

  return c.json({ ok: true });
});

// DELETE /:addonId/acquire — Revoke addon entitlement from the authenticated customer.
addonsApi.delete('/:addonId/acquire', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('addons revoke endpoint reached without an authenticated user');
  }

  const addonId = c.req.param('addonId');

  const customerId = await resolveCustomerId(c.env, auth.userId);
  if (!customerId) {
    return c.json({ error: 'customer not found' }, 404);
  }

  const database = db(c.env);

  await database
    .delete(addonEntitlement)
    .where(
      and(
        eq(addonEntitlement.customerId, customerId),
        eq(addonEntitlement.addonId, addonId),
      ),
    );

  return c.json({ ok: true });
});

// PUT /sites/:siteId/:addonId — Enable + configure a site addon.
// Verifies site ownership, verifies entitlement, validates config, then upserts into siteAddon.
addonsApi.put('/sites/:siteId/:addonId', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('addons configure endpoint reached without an authenticated user');
  }

  const siteId = c.req.param('siteId');
  const addonId = c.req.param('addonId');

  const addon = getAddon(addonId);
  if (!addon) {
    return c.json({ error: 'addon not found' }, 404);
  }

  const customerId = await resolveCustomerId(c.env, auth.userId);
  if (!customerId) {
    return c.json({ error: 'site not found' }, 404);
  }

  const database = db(c.env);

  // Verify site ownership.
  const siteRow = await database
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);

  if (!siteRow[0]) {
    return c.json({ error: 'site not found' }, 404);
  }

  // Verify entitlement exists.
  const entitlementRow = await database
    .select({ id: addonEntitlement.id })
    .from(addonEntitlement)
    .where(
      and(
        eq(addonEntitlement.customerId, customerId),
        eq(addonEntitlement.addonId, addonId),
      ),
    )
    .limit(1);

  if (!entitlementRow[0]) {
    return c.json({ error: 'addon not owned' }, 403);
  }

  const body = await c.req.json<{ enabled: boolean; config: Record<string, string> }>();

  // Validate config against addon's configFields patterns.
  if (body.enabled) {
    for (const field of addon.configFields) {
      if (!field.pattern) continue;
      const value = body.config[field.key];
      if (value === undefined) continue;
      const regex = new RegExp(field.pattern);
      if (!regex.test(value)) {
        return c.json(
          {
            error: 'invalid config',
            field: field.key,
            hint: field.patternHint ?? `value must match pattern: ${field.pattern}`,
          },
          400,
        );
      }
    }
  }

  await database
    .insert(siteAddon)
    .values({
      siteId,
      addonId,
      enabled: body.enabled,
      config: body.config,
    })
    .onConflictDoUpdate({
      target: [siteAddon.siteId, siteAddon.addonId],
      set: {
        enabled: body.enabled,
        config: body.config,
        updatedAt: new Date(),
      },
    });

  return c.json({ ok: true });
});

// GET /sites/:siteId — List all site addon rows for the site.
// Verifies site ownership first.
addonsApi.get('/sites/:siteId', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('addons list endpoint reached without an authenticated user');
  }

  const siteId = c.req.param('siteId');

  const customerId = await resolveCustomerId(c.env, auth.userId);
  if (!customerId) {
    return c.json({ error: 'site not found' }, 404);
  }

  const database = db(c.env);

  // Verify site ownership.
  const siteRow = await database
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);

  if (!siteRow[0]) {
    return c.json({ error: 'site not found' }, 404);
  }

  const rows = await database
    .select()
    .from(siteAddon)
    .where(eq(siteAddon.siteId, siteId));

  return c.json({ ok: true, addons: rows });
});

export default addonsApi;
