// src/routes/api/collections.ts
//
// ADR 0060 F3 — POST /api/sites/:siteId/collections.
//
// Backend for the "+ New collection" wizard surfaced in the Entries
// dashboard tab. Owners pick a slug (e.g. "blog"); this endpoint:
//
//   1. Validates slug shape + collision against existing pages, page-bound
//      collections, and the materialized slugs the sample entry would
//      occupy. Pure check via `scaffoldCollection`.
//   2. Persists the two new pages onto `site.editableState.pages[]`.
//   3. Inserts a sample published `collection_entry` row so the Owner sees
//      a non-empty preview the moment they publish.
//
// Auth: Clerk + `editor` role on the site. Mounted via ownerApi so the
// edit-token surface (on-site editor) reuses the same handler. The Hono
// path here is `/`; the parent mount supplies `/sites/:siteId/collections`.

import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import {
  accessRoleMeetsRequirement,
  loadAccessibleSite,
  type AccessibleSite,
  type SiteAccessRequirement,
} from '../../auth/accessible-site.js';
import { scaffoldCollection } from '../../canvas/collections-scaffold.js';
import { db } from '../../db/client.js';
import { collectionEntry, site } from '../../db/schema.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

async function resolveAccess(
  c: Context<Env>,
  siteId: string,
  requiredRole: SiteAccessRequirement,
): Promise<
  | { ok: true; accessRole: 'owner' | 'viewer' | 'editor'; site: AccessibleSite }
  | { ok: false; response: Response }
> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('collections api reached without authenticated user');
  }
  const database = db(c.env);
  const accessible = await loadAccessibleSite(database, auth.userId, siteId, requiredRole);
  if (!accessible) {
    return { ok: false, response: c.json({ error: 'site not found' }, 404) };
  }
  if (!accessRoleMeetsRequirement(accessible.accessRole, requiredRole)) {
    return { ok: false, response: c.json({ error: 'forbidden' }, 403) };
  }
  return { ok: true, accessRole: accessible.accessRole, site: accessible };
}

export const collectionsRoute = new Hono<Env>();

collectionsRoute.use('*', clerkAuth());
collectionsRoute.use('*', requireAuth());

// POST / — create a new collection (index + template pages + sample entry).
collectionsRoute.post('/', async (c) => {
  const siteId = c.req.param('siteId');
  if (typeof siteId !== 'string' || siteId.length === 0) {
    return c.json({ error: 'siteId is required' }, 400);
  }
  const access = await resolveAccess(c, siteId, 'editor');
  if (!access.ok) return access.response;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'request body must be valid JSON' }, 400);
  }
  if (!raw || typeof raw !== 'object') {
    return c.json({ error: 'request body must be a JSON object with { slug }' }, 400);
  }
  const slug = (raw as Record<string, unknown>).slug;
  if (typeof slug !== 'string') {
    return c.json({ error: 'slug is required (string)' }, 400);
  }

  const scaffold = scaffoldCollection(access.site.editableState, slug);
  if (!scaffold.ok) {
    return c.json({ error: scaffold.error }, 409);
  }

  const nextState = {
    ...access.site.editableState,
    pages: [...access.site.editableState.pages, ...scaffold.newPages],
  };

  const database = db(c.env);
  const siteUpdate = database
    .update(site)
    .set({ editableState: nextState })
    .where(eq(site.id, siteId));
  const entryInsert = database.insert(collectionEntry).values({
    siteId,
    collectionSlug: scaffold.sampleEntry.collectionSlug,
    slug: scaffold.sampleEntry.slug,
    title: scaffold.sampleEntry.title,
    excerpt: scaffold.sampleEntry.excerpt,
    body: scaffold.sampleEntry.body,
    publishedDate: scaffold.sampleEntry.publishedDate,
    author: scaffold.sampleEntry.author,
    category: scaffold.sampleEntry.category,
    tags: scaffold.sampleEntry.tags,
    ogImageAssetId: scaffold.sampleEntry.ogImageAssetId,
    status: scaffold.sampleEntry.status,
  });
  await database.batch([siteUpdate, entryInsert]);

  return c.json(
    {
      collectionSlug: slug,
      redirectTo: `/dashboard/sites/${siteId}/entries?collection=${encodeURIComponent(slug)}`,
    },
    201,
  );
});

export default collectionsRoute;
