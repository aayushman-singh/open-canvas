// src/routes/api/collections.ts
//
// ADR 0063 Decision 11 — POST /api/sites/:siteId/collections.
//
// Backend for the "+ New Collection" wizard surfaced from the editor's Pages
// sidebar. The Owner clicks "+ New Collection"; this endpoint:
//
//   1. Resolves the slug. If the request body omits `slug`, defaults to
//      `'blog'`; if `'blog'` is taken in this site, falls back to
//      `'collection-1'`, `'collection-2'`, ... up to `collection-99`. A
//      custom slug supplied by the Owner is used verbatim — no fallback;
//      collisions surface as 409 so the Owner sees they picked a taken slug.
//   2. Builds the index page + template page + two seed entries via
//      `scaffoldCollection` (pure). Returns 409 on slug/id collisions.
//   3. Persists everything in one atomic batch (drizzle `db.batch([...])`,
//      neon-http transaction primitive). The batch contains:
//        - UPDATE site SET editableState  (append the two new pages)
//        - INSERT INTO collection_entry   (both seed rows in one VALUES)
//      If any statement fails (DB constraint, network drop, etc.) the whole
//      batch rolls back per the neon-http transaction contract — no
//      half-built blog.
//   4. Returns 201 with the resolved slug and the index page id so the
//      editor can switch its active page to the freshly-minted index.
//
// Mirrors the transaction pattern in `routes/api/sites.ts` POST /api/sites
// (site row + seed entries in one batch — see sites.ts:643-654). The
// neon-http drizzle driver wraps `.batch([...])` in a single Postgres
// transaction; failure of any statement aborts the whole batch.
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
import {
  resolveAvailableSlug,
  scaffoldCollection,
  WIZARD_DEFAULT_SLUG,
} from '../../canvas/collections-scaffold.js';
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

// POST / — create a new collection (index + template pages + two seed entries).
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
    // An empty/absent body is allowed and means "default slug" — the
    // wizard surfaces the resolved slug back in the response so the editor
    // knows what was actually created. A non-empty body that fails to
    // parse is treated as an empty body rather than rejected outright:
    // the wizard's happy path supplies a slug, but tolerating a missing
    // body keeps the contract narrow (one optional field).
    raw = {};
  }
  if (raw === null || typeof raw !== 'object') {
    return c.json({ error: 'request body must be a JSON object with optional { slug }' }, 400);
  }
  const requestedSlug = (raw as Record<string, unknown>).slug;
  if (requestedSlug !== undefined && typeof requestedSlug !== 'string') {
    return c.json({ error: 'slug must be a string when provided' }, 400);
  }

  // ADR 0063 dec 11 §a — slug resolution. Empty or omitted slug =
  // WIZARD_DEFAULT_SLUG with fallback walk. Custom slug = verbatim, no
  // fallback (collisions caught by scaffoldCollection below).
  const slugForResolution =
    requestedSlug === undefined || requestedSlug.length === 0
      ? WIZARD_DEFAULT_SLUG
      : requestedSlug;
  const resolved = resolveAvailableSlug(access.site.editableState.pages, slugForResolution);
  if (!resolved.ok) {
    // Pool-exhausted: blog + collection-1..99 are all taken on this site.
    // Fail loud per ADR 0063 "Failure modes (loud)".
    return c.json({ error: resolved.error, step: 'slug-pool-exhausted' }, 409);
  }

  const scaffold = scaffoldCollection(access.site.editableState, resolved.slug);
  if (!scaffold.ok) {
    return c.json({ error: scaffold.error, step: scaffold.step }, 409);
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

  // Both seed rows ship in a single INSERT statement (one VALUES list).
  // Combined with the batch wrapper around siteUpdate + entryInsert, the
  // whole flow runs in one Postgres transaction: page persistence and both
  // entry inserts succeed or roll back together (ADR 0063 dec 11 §f).
  const seedRows = scaffold.seedEntries.map((entry) => ({
    siteId,
    collectionSlug: entry.collectionSlug,
    slug: entry.slug,
    title: entry.title,
    excerpt: entry.excerpt,
    body: entry.body,
    publishedDate: entry.publishedDate,
    author: entry.author,
    category: entry.category,
    tags: entry.tags,
    ogImageAssetId: entry.ogImageAssetId,
    status: entry.status,
  }));
  const entryInsert = database.insert(collectionEntry).values(seedRows);

  try {
    await database.batch([siteUpdate, entryInsert]);
  } catch (err) {
    // Loud failure per CLAUDE.md no-fallbacks rule. We do NOT retry, do
    // NOT partial-commit, do NOT swap in defaults — the batch rolled back
    // by neon-http's transaction contract, so DB state is unchanged from
    // before this call. Surface the failing layer so the editor's toast
    // names what broke.
    console.error('collections_scaffold_batch_failed', {
      siteId,
      slug: resolved.slug,
      seedCount: seedRows.length,
      err,
    });
    return c.json(
      {
        error:
          'failed to provision collection: ' +
          (err instanceof Error ? err.message : 'unknown'),
        step: 'db-transaction',
      },
      500,
    );
  }

  return c.json(
    {
      collectionSlug: resolved.slug,
      indexPageId: scaffold.newPages[0].id,
      templatePageId: scaffold.newPages[1].id,
      seededEntrySlugs: scaffold.seedEntries.map((e) => e.slug),
      redirectTo: `/dashboard/sites/${siteId}/entries?collection=${encodeURIComponent(
        resolved.slug,
      )}`,
    },
    201,
  );
});

export default collectionsRoute;
