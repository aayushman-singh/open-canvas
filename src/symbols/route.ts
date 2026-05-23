// src/symbols/route.ts
//
// Hono router mounted by the main thread at `/api/sites/:siteId/symbols`.
// Endpoints (all Owner-authenticated):
//
//   GET    /                  — list every SymbolMaster on the site.
//   POST   /                  — create a master from a body-supplied
//                               { name, section } payload. Returns the new
//                               master + the updated editableState so the
//                               editor can replace its in-memory state.
//   PUT    /:id               — patch a master (`{ name?, section? }`).
//   DELETE /:id               — refuse-if-instances-exist deletion. The
//                               response carries a 409 + the list of instance
//                               locations when instances exist; the editor
//                               can then drive the "detach-all" path below.
//   POST   /:id/detach-all    — detach every instance of the given master
//                               site-wide, then DELETE the master. Returns
//                               { ok: true, detached: number }.
//
// The router is pure HTTP plumbing; it delegates every mutation to the pure
// functions in `master.ts` / `detach.ts`. The Owner is authenticated via the
// shared Clerk middleware; site ownership is checked via the customer→site
// join the rest of the canvas API uses.

import { and, eq, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import type { CanvasSection, CanvasSiteState } from '../canvas/schema.js';
import { validateCanvasSiteState } from '../canvas/validate.js';
import { db } from '../db/client.js';
import { customer, site as siteTable } from '../db/schema.js';

import { detachAllInstancesOfSymbol } from './detach.js';
import {
  createSymbolMaster,
  deleteSymbolMaster,
  findInstancesOfSymbol,
  updateSymbolMaster,
} from './master.js';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const router = new Hono<Env>();

router.use('*', clerkAuth());
router.use('*', requireAuth());

// ---------------------------------------------------------------------------
// Auth + site loading
// ---------------------------------------------------------------------------

interface LoadedSite {
  customerId: string;
  siteId: string;
  editableState: CanvasSiteState;
}

async function loadOwnedSite(
  c: Context<Env>,
  siteId: string,
): Promise<LoadedSite | null> {
  const auth = c.get('auth');
  if (!auth.userId) return null;
  const database = db(c.env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return null;
  const siteRow = await database
    .select({ id: siteTable.id, editableState: siteTable.editableState })
    .from(siteTable)
    .where(and(eq(siteTable.id, siteId), eq(siteTable.customerId, customerId)))
    .limit(1);
  const row = siteRow[0];
  if (!row) return null;
  return { customerId, siteId: row.id, editableState: row.editableState };
}

async function persistEditableState(
  c: Context<Env>,
  loaded: LoadedSite,
  next: CanvasSiteState,
): Promise<{ ok: true } | { ok: false; status: 400 | 500; body: unknown }> {
  const validation = validateCanvasSiteState(next);
  if (!validation.valid) {
    return {
      ok: false,
      status: 400,
      body: { error: 'editable state invalid', errors: validation.errors },
    };
  }
  const database = db(c.env);
  await database
    .update(siteTable)
    .set({ editableState: next, updatedAt: sql`now()` })
    .where(
      and(eq(siteTable.id, loaded.siteId), eq(siteTable.customerId, loaded.customerId)),
    );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Body shapes
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface CreateBody {
  name: string;
  section: CanvasSection;
  id?: string;
}

function parseCreateBody(body: unknown): CreateBody | { error: string } {
  if (!isRecord(body)) return { error: 'body must be a JSON object' };
  const { name, section, id } = body;
  if (typeof name !== 'string' || name.length === 0) {
    return { error: 'name is required (non-empty string)' };
  }
  if (!isRecord(section)) return { error: 'section is required (CanvasSection object)' };
  if (id !== undefined && (typeof id !== 'string' || id.length === 0)) {
    return { error: 'id, when present, must be a non-empty string' };
  }
  const out: CreateBody = { name, section: section as unknown as CanvasSection };
  if (id !== undefined) out.id = id;
  return out;
}

interface UpdateBody {
  name?: string;
  section?: CanvasSection;
}

function parseUpdateBody(body: unknown): UpdateBody | { error: string } {
  if (!isRecord(body)) return { error: 'body must be a JSON object' };
  const out: UpdateBody = {};
  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.length === 0) {
      return { error: 'name, when present, must be a non-empty string' };
    }
    out.name = body.name;
  }
  if ('section' in body) {
    if (!isRecord(body.section)) {
      return { error: 'section, when present, must be a CanvasSection object' };
    }
    out.section = body.section as unknown as CanvasSection;
  }
  if (out.name === undefined && out.section === undefined) {
    return { error: 'body must include at least one of { name, section }' };
  }
  return out;
}

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const siteId = c.req.param('siteId');
  if (!siteId) return c.json({ error: 'siteId required' }, 400);
  const loaded = await loadOwnedSite(c, siteId);
  if (!loaded) return c.json({ error: 'site not found' }, 404);
  return c.json({ symbols: loaded.editableState.symbols });
});

// ---------------------------------------------------------------------------
// POST /  — create master
// ---------------------------------------------------------------------------

router.post('/', async (c) => {
  const siteId = c.req.param('siteId');
  if (!siteId) return c.json({ error: 'siteId required' }, 400);
  const loaded = await loadOwnedSite(c, siteId);
  if (!loaded) return c.json({ error: 'site not found' }, 404);

  const parsed = parseCreateBody(await c.req.json().catch(() => null));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  // structuredClone the editableState so the in-memory caller copy never
  // sees a half-applied mutation if the persist fails downstream.
  const next: CanvasSiteState = structuredClone(loaded.editableState);
  let master;
  try {
    master = createSymbolMaster(next, parsed);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const persisted = await persistEditableState(c, loaded, next);
  if (!persisted.ok) return c.json(persisted.body, persisted.status);
  return c.json({ ok: true, master, editableState: next });
});

// ---------------------------------------------------------------------------
// PUT /:id — update master
// ---------------------------------------------------------------------------

router.put('/:id', async (c) => {
  const siteId = c.req.param('siteId');
  const symbolId = c.req.param('id');
  if (!siteId || !symbolId) {
    return c.json({ error: 'siteId and id required' }, 400);
  }
  const loaded = await loadOwnedSite(c, siteId);
  if (!loaded) return c.json({ error: 'site not found' }, 404);

  const parsed = parseUpdateBody(await c.req.json().catch(() => null));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const next: CanvasSiteState = structuredClone(loaded.editableState);
  let master;
  try {
    master = updateSymbolMaster(next, symbolId, parsed);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const persisted = await persistEditableState(c, loaded, next);
  if (!persisted.ok) return c.json(persisted.body, persisted.status);
  return c.json({ ok: true, master, editableState: next });
});

// ---------------------------------------------------------------------------
// DELETE /:id — refuse if instances exist
// ---------------------------------------------------------------------------

router.delete('/:id', async (c) => {
  const siteId = c.req.param('siteId');
  const symbolId = c.req.param('id');
  if (!siteId || !symbolId) {
    return c.json({ error: 'siteId and id required' }, 400);
  }
  const loaded = await loadOwnedSite(c, siteId);
  if (!loaded) return c.json({ error: 'site not found' }, 404);

  const next: CanvasSiteState = structuredClone(loaded.editableState);
  // Pre-check so we can surface the list of blockers in the 409 body (the
  // delete helper throws with the same info but the editor wants structured
  // data, not a stringified error).
  const blockers = findInstancesOfSymbol(next, symbolId);
  if (blockers.length > 0) {
    return c.json(
      {
        error: 'symbol has active instances',
        instances: blockers.map((loc) => ({
          pageId: loc.pageId,
          sectionId: loc.sectionId,
          elementId: loc.element.id,
        })),
      },
      409,
    );
  }
  try {
    deleteSymbolMaster(next, symbolId);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const persisted = await persistEditableState(c, loaded, next);
  if (!persisted.ok) return c.json(persisted.body, persisted.status);
  return c.json({ ok: true, editableState: next });
});

// ---------------------------------------------------------------------------
// POST /:id/detach-all — detach every instance, then delete the master.
// ---------------------------------------------------------------------------

router.post('/:id/detach-all', async (c) => {
  const siteId = c.req.param('siteId');
  const symbolId = c.req.param('id');
  if (!siteId || !symbolId) {
    return c.json({ error: 'siteId and id required' }, 400);
  }
  const loaded = await loadOwnedSite(c, siteId);
  if (!loaded) return c.json({ error: 'site not found' }, 404);

  const next: CanvasSiteState = structuredClone(loaded.editableState);
  let detachedSections;
  try {
    detachedSections = detachAllInstancesOfSymbol(next, symbolId);
    deleteSymbolMaster(next, symbolId);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const persisted = await persistEditableState(c, loaded, next);
  if (!persisted.ok) return c.json(persisted.body, persisted.status);
  return c.json({
    ok: true,
    detached: detachedSections.length,
    editableState: next,
  });
});

export default router;
