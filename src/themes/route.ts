// src/themes/route.ts
//
// Hono router that mounts at `/api/sites/:siteId/custom-theme`. Two verbs:
//
//   PUT    — Owner authors / saves a custom theme. Body: `{ customStyleKit }`.
//            Stores the kit on the site's editable state and flips the
//            selector to `'custom'`. The full canvas validator runs at the
//            end so nothing else about the state can drift while we're at it.
//
//   DELETE — Owner resets the site to a built-in kit. Body: `{ styleKit }`.
//            Drops `customStyleKit` and sets `styleKit` to the chosen
//            built-in. Returns 400 if the chosen built-in is not in the
//            BUILT_IN_STYLE_KITS allowlist.
//
// Both endpoints reuse the Clerk-scoped ownership check the rest of the
// `/api/sites/:siteId/*` mounts use. The main thread wires this up in
// `src/index.ts` (`app.route('/api/sites/:siteId/custom-theme', themeRoute)`).

import { and, eq, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import {
  BUILT_IN_STYLE_KITS,
  pickEditableSiteBase,
  type BuiltInStyleKit,
  type EditableSite,
  type StyleKitPreset,
} from '../canvas/schema.js';
import { validateEditableSite } from '../canvas/validate.js';
import { db } from '../db/client.js';
import { customer, site } from '../db/schema.js';

import { validateStyleKitPreset } from './custom-resolve.js';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const themeRoute = new Hono<Env>();

themeRoute.use('*', clerkAuth());
themeRoute.use('*', requireAuth());

// --------------------------------------------------------------------------
// Ownership helper — same shape as the other Owner-scoped routes. Returning
// `null` from either step maps to 404 so the API never leaks the existence
// of a site to a stranger.
// --------------------------------------------------------------------------

async function resolveCustomerId(c: Context<Env>): Promise<string | null> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('themes api reached without an authenticated user');
  }
  const database = db(c.env);
  const rows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function loadOwnedSite(
  c: Context<Env>,
  siteId: string,
  customerId: string,
): Promise<{ id: string; editableState: EditableSite } | null> {
  const database = db(c.env);
  const rows = await database
    .select({ id: site.id, editableState: site.editableState })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return row;
}

// --------------------------------------------------------------------------
// PUT /:siteId/custom-theme — save a custom kit.
// --------------------------------------------------------------------------

themeRoute.put('/:siteId/custom-theme', async (c) => {
  const siteId = c.req.param('siteId');
  if (!siteId) return c.json({ error: 'siteId is required' }, 404);

  const customerId = await resolveCustomerId(c);
  if (!customerId) return c.json({ error: 'site not found' }, 404);
  const owned = await loadOwnedSite(c, siteId, customerId);
  if (!owned) return c.json({ error: 'site not found' }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'body must be JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'body must be a JSON object' }, 400);
  }
  const candidate = (body as { customStyleKit?: unknown }).customStyleKit;

  // Loud structural check — the panel JS sends a full kit, never a delta.
  try {
    validateStyleKitPreset(candidate, 'customStyleKit');
  } catch (err) {
    return c.json(
      { error: 'customStyleKit invalid', detail: err instanceof Error ? err.message : String(err) },
      400,
    );
  }

  // Merge into the persisted editable state. Cloning before mutation keeps
  // the wire-level state isolated from the in-memory drizzle row. The
  // validator runs over the merged state so any drift in another field
  // surfaces here, not at the next publish.
  // After validateStyleKitPreset, candidate is known to be a fully-formed
  // StyleKitPreset; the cast simply tightens the type. Spread order matters
  // here: the source might carry a stale customStyleKit slot, so the explicit
  // assignment after the spread wins.
  const nextState: EditableSite = {
    ...owned.editableState,
    styleKit: 'custom',
    customStyleKit: candidate as StyleKitPreset,
  };
  const validation = validateEditableSite(nextState);
  if (!validation.valid) {
    return c.json(
      { error: 'site state would be invalid after applying customStyleKit', errors: validation.errors },
      400,
    );
  }

  const database = db(c.env);
  await database
    .update(site)
    .set({
      styleKit: 'custom',
      editableState: nextState,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)));

  return c.json({ ok: true });
});

// --------------------------------------------------------------------------
// DELETE /:siteId/custom-theme — reset to a built-in kit.
// --------------------------------------------------------------------------

themeRoute.delete('/:siteId/custom-theme', async (c) => {
  const siteId = c.req.param('siteId');
  if (!siteId) return c.json({ error: 'siteId is required' }, 404);

  const customerId = await resolveCustomerId(c);
  if (!customerId) return c.json({ error: 'site not found' }, 404);
  const owned = await loadOwnedSite(c, siteId, customerId);
  if (!owned) return c.json({ error: 'site not found' }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'body must be JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'body must be a JSON object' }, 400);
  }
  const styleKitRaw = (body as { styleKit?: unknown }).styleKit;
  if (typeof styleKitRaw !== 'string' || !isBuiltInStyleKit(styleKitRaw)) {
    return c.json(
      { error: `styleKit must be one of ${BUILT_IN_STYLE_KITS.join(', ')}` },
      400,
    );
  }
  // Strip customStyleKit on reset — keeping it would mislead the OG card and
  // the publish path into thinking a custom kit is still in play. Per ADR
  // 0016 the styleKit DU is collapsed via the helper so the new branch
  // discriminator and the absence of `customStyleKit` are set together.
  const base = pickEditableSiteBase(owned.editableState);
  const nextState: EditableSite = { ...base, styleKit: styleKitRaw };
  const validation = validateEditableSite(nextState);
  if (!validation.valid) {
    return c.json(
      { error: 'site state would be invalid after reset', errors: validation.errors },
      400,
    );
  }

  const database = db(c.env);
  await database
    .update(site)
    .set({
      styleKit: styleKitRaw,
      editableState: nextState,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)));

  return c.json({ ok: true });
});

function isBuiltInStyleKit(value: string): value is BuiltInStyleKit {
  return (BUILT_IN_STYLE_KITS as readonly string[]).includes(value);
}

export default themeRoute;
