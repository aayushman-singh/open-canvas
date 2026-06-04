// ADR 0060 Stream A — REST API for CMS-style collection entries.
//
// Mounted by `src/index.ts` at `/api/sites/:siteId/entries`. The Hono router
// here uses paths relative to that mount, so `/` is the list/create endpoint
// and `/:entryId` is the per-entry endpoint.
//
// All endpoints require Clerk auth via `clerkAuth()` + `requireAuth()`. Site
// access is gated through `loadAccessibleSite` — owner and accepted
// collaborators with at least `viewer` role can list/read; `editor` is
// required for create/update/delete. We do not leak the existence of sites
// the caller cannot reach: every "not found / not allowed" path returns 404.
//
// Body validation is hand-rolled (the project does not ship zod). Each
// validator returns `{ ok: true, value }` or `{ ok: false, error }`; bad
// bodies become 400 with a JSON `error` message. Slug-collision conflicts
// (the `(site_id, collection_slug, slug)` unique index) become 409.

import { and, desc, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import {
  accessRoleMeetsRequirement,
  loadAccessibleSite,
  type AccessibleSite,
  type SiteAccessRequirement,
} from '../../auth/accessible-site.js';
import type { CanvasPage } from '../../canvas/schema.js';
import { db } from '../../db/client.js';
import {
  COLLECTION_ENTRY_STATUSES,
  collectionEntry,
  type CollectionEntry,
  type CollectionEntryStatus,
  type NewCollectionEntry,
} from '../../db/schema.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

// Slug rule per the ADR contract — lowercase letters, digits, hyphen, 1..80
// chars. The same rule applies to `collectionSlug` on create (so url paths
// are predictable) and to `slug` on every write.
export const ENTRY_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80 && ENTRY_SLUG_RE.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isStatus(value: unknown): value is CollectionEntryStatus {
  return (
    typeof value === 'string' &&
    (COLLECTION_ENTRY_STATUSES as readonly string[]).includes(value)
  );
}

type ParseOk<T> = { ok: true; value: T };
type ParseErr = { ok: false; error: string };
type ParseResult<T> = ParseOk<T> | ParseErr;

export interface CreateEntryInput {
  collectionSlug: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  publishedDate: string;
  author: string;
  category: string;
  tags: string[];
  ogImageAssetId: string | null;
  status: CollectionEntryStatus;
}

export function parseCreateEntryBody(raw: unknown): ParseResult<CreateEntryInput> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const r = raw as Record<string, unknown>;

  if (!isValidSlug(r.collectionSlug)) {
    return {
      ok: false,
      error: 'collectionSlug must be 1..80 lowercase letters, digits, or dashes',
    };
  }
  if (!isValidSlug(r.slug)) {
    return { ok: false, error: 'slug must be 1..80 lowercase letters, digits, or dashes' };
  }
  if (typeof r.title !== 'string' || r.title.trim().length === 0) {
    return { ok: false, error: 'title is required' };
  }
  if (r.title.length > 200) {
    return { ok: false, error: 'title must be 200 characters or fewer' };
  }
  if (typeof r.publishedDate !== 'string' || r.publishedDate.length === 0) {
    return { ok: false, error: 'publishedDate is required (ISO date string)' };
  }
  // Be liberal in what we accept (full ISO timestamp is fine), strict in
  // that it must at least parse to a real instant.
  if (Number.isNaN(Date.parse(r.publishedDate))) {
    return { ok: false, error: 'publishedDate must be a valid ISO date string' };
  }

  const excerpt = typeof r.excerpt === 'string' ? r.excerpt : '';
  const body = typeof r.body === 'string' ? r.body : '';
  const author = typeof r.author === 'string' ? r.author : '';
  const category = typeof r.category === 'string' ? r.category : '';

  let tags: string[] = [];
  if (r.tags !== undefined && r.tags !== null) {
    if (!isStringArray(r.tags)) {
      return { ok: false, error: 'tags must be an array of strings' };
    }
    tags = r.tags;
  }

  let ogImageAssetId: string | null = null;
  if (r.ogImageAssetId !== undefined && r.ogImageAssetId !== null) {
    if (typeof r.ogImageAssetId !== 'string' || r.ogImageAssetId.length === 0) {
      return { ok: false, error: 'ogImageAssetId must be a non-empty string when provided' };
    }
    ogImageAssetId = r.ogImageAssetId;
  }

  let status: CollectionEntryStatus = 'draft';
  if (r.status !== undefined && r.status !== null) {
    if (!isStatus(r.status)) {
      return {
        ok: false,
        error: `status must be one of: ${COLLECTION_ENTRY_STATUSES.join(', ')}`,
      };
    }
    status = r.status;
  }

  return {
    ok: true,
    value: {
      collectionSlug: r.collectionSlug,
      slug: r.slug,
      title: r.title,
      excerpt,
      body,
      publishedDate: r.publishedDate,
      author,
      category,
      tags,
      ogImageAssetId,
      status,
    },
  };
}

export type UpdateEntryPatch = Partial<Omit<CreateEntryInput, 'collectionSlug'>>;

// PATCH is partial — every field is optional, but the ones that ARE present
// must pass the same validation as on create. `collectionSlug` is immutable
// once an entry is created (moving entries between collections would change
// their slug-collision domain and would require additional re-checks; out of
// scope for Stream A).
export function parseUpdateEntryBody(raw: unknown): ParseResult<UpdateEntryPatch> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const r = raw as Record<string, unknown>;
  const patch: UpdateEntryPatch = {};

  if ('collectionSlug' in r) {
    return { ok: false, error: 'collectionSlug cannot be changed after creation' };
  }

  if ('slug' in r) {
    if (!isValidSlug(r.slug)) {
      return { ok: false, error: 'slug must be 1..80 lowercase letters, digits, or dashes' };
    }
    patch.slug = r.slug;
  }
  if ('title' in r) {
    if (typeof r.title !== 'string' || r.title.trim().length === 0) {
      return { ok: false, error: 'title must be a non-empty string when provided' };
    }
    if (r.title.length > 200) {
      return { ok: false, error: 'title must be 200 characters or fewer' };
    }
    patch.title = r.title;
  }
  if ('excerpt' in r) {
    if (typeof r.excerpt !== 'string') {
      return { ok: false, error: 'excerpt must be a string when provided' };
    }
    patch.excerpt = r.excerpt;
  }
  if ('body' in r) {
    if (typeof r.body !== 'string') {
      return { ok: false, error: 'body must be a string when provided' };
    }
    patch.body = r.body;
  }
  if ('publishedDate' in r) {
    if (typeof r.publishedDate !== 'string' || Number.isNaN(Date.parse(r.publishedDate))) {
      return { ok: false, error: 'publishedDate must be a valid ISO date string when provided' };
    }
    patch.publishedDate = r.publishedDate;
  }
  if ('author' in r) {
    if (typeof r.author !== 'string') {
      return { ok: false, error: 'author must be a string when provided' };
    }
    patch.author = r.author;
  }
  if ('category' in r) {
    if (typeof r.category !== 'string') {
      return { ok: false, error: 'category must be a string when provided' };
    }
    patch.category = r.category;
  }
  if ('tags' in r) {
    if (!isStringArray(r.tags)) {
      return { ok: false, error: 'tags must be an array of strings when provided' };
    }
    patch.tags = r.tags;
  }
  if ('ogImageAssetId' in r) {
    if (r.ogImageAssetId === null) {
      patch.ogImageAssetId = null;
    } else if (typeof r.ogImageAssetId === 'string' && r.ogImageAssetId.length > 0) {
      patch.ogImageAssetId = r.ogImageAssetId;
    } else {
      return {
        ok: false,
        error: 'ogImageAssetId must be a non-empty string or null when provided',
      };
    }
  }
  if ('status' in r) {
    if (!isStatus(r.status)) {
      return {
        ok: false,
        error: `status must be one of: ${COLLECTION_ENTRY_STATUSES.join(', ')}`,
      };
    }
    patch.status = r.status;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'at least one field must be provided' };
  }

  return { ok: true, value: patch };
}

// ADR 0060 Pass 3 — pre-check that an entry's materialized slug
// (`<collectionSlug>/<entrySlug>`) does not collide with an existing
// static page in the site's editable state. The materializer expands
// `collection-item-template` pages into one page per entry at the same
// slug shape; if the Owner has authored a normal page at that path the
// validator would catch it post-materialization with a generic
// "duplicate page slug" error at publish time. Checking here means the
// Owner finds out the moment they write the entry, not at publish.
//
// Pure: takes a snapshot of pages, returns the conflicting page (or
// null). The smoke covers it without needing a live DB.
//
// Edge case: a `collection-item-template` page for the SAME collection
// IS the template the materializer expands. It does not ship as a real
// static page at `<collectionSlug>/<entrySlug>` — so it is not a real
// collision. We skip it explicitly.
export function findConflictingSitePage(
  pages: readonly CanvasPage[],
  collectionSlug: string,
  entrySlug: string,
): CanvasPage | null {
  const materializedSlug = `${collectionSlug}/${entrySlug}`;
  for (const page of pages) {
    if (page.slug !== materializedSlug) continue;
    if (
      page.pageKind === 'collection-item-template' &&
      page.collectionSlug === collectionSlug
    ) {
      // This is the template page itself; not a static page. Skip.
      continue;
    }
    return page;
  }
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === '23505') return true;
  if (typeof e.message === 'string' && e.message.includes('duplicate key value')) return true;
  if (e.cause) return isUniqueViolation(e.cause);
  return false;
}

// Resolve the site-access role for the calling Clerk user against `siteId`.
// Returns the role and the loaded site on success; on failure short-circuits
// the handler with 404 so we do not leak the existence of sites the caller
// cannot reach. The full site (incl. `editableState`) flows back so handlers
// that need to walk `pages[]` (slug-collision pre-check) do not have to
// reload it.
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
    throw new Error('entries api reached without authenticated user');
  }
  const database = db(c.env);
  const accessible = await loadAccessibleSite(database, auth.userId, siteId, requiredRole);
  if (!accessible) {
    return { ok: false, response: c.json({ error: 'site not found' }, 404) };
  }
  // Defensive: loadAccessibleSite already gates on requiredRole; this check
  // makes the access guarantee explicit at the call site.
  if (!accessRoleMeetsRequirement(accessible.accessRole, requiredRole)) {
    return { ok: false, response: c.json({ error: 'forbidden' }, 403) };
  }
  return { ok: true, accessRole: accessible.accessRole, site: accessible };
}

const entriesRoute = new Hono<Env>();

entriesRoute.use('*', clerkAuth());
entriesRoute.use('*', requireAuth());

// GET /  — list entries for the site, optionally filtered by ?collection=
entriesRoute.get('/', async (c) => {
  const siteId = c.req.param('siteId');
  if (typeof siteId !== 'string' || siteId.length === 0) {
    return c.json({ error: 'siteId is required' }, 400);
  }
  const access = await resolveAccess(c, siteId, 'viewer');
  if (!access.ok) return access.response;

  const collection = c.req.query('collection');
  const database = db(c.env);
  const where =
    typeof collection === 'string' && collection.length > 0
      ? and(eq(collectionEntry.siteId, siteId), eq(collectionEntry.collectionSlug, collection))
      : eq(collectionEntry.siteId, siteId);

  const rows: CollectionEntry[] = await database
    .select()
    .from(collectionEntry)
    .where(where)
    .orderBy(desc(collectionEntry.publishedDate));

  return c.json({ entries: rows });
});

// POST / — create a new entry. 201 on success, 409 on (site, collection,
// slug) collision, 400 on bad body.
entriesRoute.post('/', async (c) => {
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
  const parsed = parseCreateEntryBody(raw);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }

  // ADR 0060 Pass 3 — fail loud at create time when the entry's
  // materialized slug would collide with an existing static page in the
  // site. Without this the Owner would only find out at publish, after
  // writing the entry and clicking publish — the post-materialization
  // validator surfaces a generic duplicate-slug error from publish, with
  // no traceback to the entry that caused it.
  const conflict = findConflictingSitePage(
    access.site.editableState.pages,
    parsed.value.collectionSlug,
    parsed.value.slug,
  );
  if (conflict !== null) {
    return c.json(
      {
        error: 'slug conflicts with existing site page',
        conflictingPageSlug: conflict.slug,
        conflictingPageTitle: conflict.title,
      },
      409,
    );
  }

  const database = db(c.env);
  const newRow: NewCollectionEntry = {
    siteId,
    collectionSlug: parsed.value.collectionSlug,
    slug: parsed.value.slug,
    title: parsed.value.title,
    excerpt: parsed.value.excerpt,
    body: parsed.value.body,
    publishedDate: parsed.value.publishedDate,
    author: parsed.value.author,
    category: parsed.value.category,
    tags: parsed.value.tags,
    ogImageAssetId: parsed.value.ogImageAssetId,
    status: parsed.value.status,
  };

  try {
    const inserted = await database.insert(collectionEntry).values(newRow).returning();
    const row = inserted[0];
    if (!row) {
      return c.json({ error: 'failed to create entry' }, 500);
    }
    return c.json({ entry: row }, 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json(
        {
          error: 'an entry with this slug already exists in this collection',
        },
        409,
      );
    }
    throw err;
  }
});

// GET /:entryId — fetch one entry. 404 if it doesn't belong to the site.
entriesRoute.get('/:entryId', async (c) => {
  const siteId = c.req.param('siteId');
  const entryId = c.req.param('entryId');
  if (typeof siteId !== 'string' || siteId.length === 0) {
    return c.json({ error: 'siteId is required' }, 400);
  }
  if (typeof entryId !== 'string' || entryId.length === 0) {
    return c.json({ error: 'entryId is required' }, 400);
  }
  const access = await resolveAccess(c, siteId, 'viewer');
  if (!access.ok) return access.response;

  const database = db(c.env);
  const rows = await database
    .select()
    .from(collectionEntry)
    .where(and(eq(collectionEntry.id, entryId), eq(collectionEntry.siteId, siteId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: 'entry not found' }, 404);
  }
  return c.json({ entry: row });
});

// PATCH /:entryId — partial update. 404 if not on this site; 409 on slug
// collision when `slug` is in the patch; 400 on bad body.
entriesRoute.patch('/:entryId', async (c) => {
  const siteId = c.req.param('siteId');
  const entryId = c.req.param('entryId');
  if (typeof siteId !== 'string' || siteId.length === 0) {
    return c.json({ error: 'siteId is required' }, 400);
  }
  if (typeof entryId !== 'string' || entryId.length === 0) {
    return c.json({ error: 'entryId is required' }, 400);
  }
  const access = await resolveAccess(c, siteId, 'editor');
  if (!access.ok) return access.response;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'request body must be valid JSON' }, 400);
  }
  const parsed = parseUpdateEntryBody(raw);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }

  const database = db(c.env);

  // ADR 0060 Pass 3 — when the patch changes `slug`, pre-check the
  // collision against the site's editable pages. We need the existing
  // row's `collectionSlug` (immutable) to know which materialized path
  // the entry expands to; we also need its current slug so a PATCH that
  // touches other fields without changing slug skips the check
  // entirely. Same-slug PATCH (or a PATCH that omits slug) must not
  // self-collide.
  if (parsed.value.slug !== undefined) {
    const existingRows = await database
      .select({
        slug: collectionEntry.slug,
        collectionSlug: collectionEntry.collectionSlug,
      })
      .from(collectionEntry)
      .where(and(eq(collectionEntry.id, entryId), eq(collectionEntry.siteId, siteId)))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      return c.json({ error: 'entry not found' }, 404);
    }
    if (parsed.value.slug !== existing.slug) {
      const conflict = findConflictingSitePage(
        access.site.editableState.pages,
        existing.collectionSlug,
        parsed.value.slug,
      );
      if (conflict !== null) {
        return c.json(
          {
            error: 'slug conflicts with existing site page',
            conflictingPageSlug: conflict.slug,
            conflictingPageTitle: conflict.title,
          },
          409,
        );
      }
    }
  }

  // Existence + ownership check is part of the WHERE clause on UPDATE; we
  // can rely on the unique (site_id, id) primary-key + FK to surface 404
  // when `returning()` comes back empty.
  try {
    const updated = await database
      .update(collectionEntry)
      .set({ ...parsed.value, updatedAt: new Date() })
      .where(and(eq(collectionEntry.id, entryId), eq(collectionEntry.siteId, siteId)))
      .returning();
    const row = updated[0];
    if (!row) {
      return c.json({ error: 'entry not found' }, 404);
    }
    return c.json({ entry: row });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return c.json(
        { error: 'an entry with this slug already exists in this collection' },
        409,
      );
    }
    throw err;
  }
});

// DELETE /:entryId — 204 on success, 404 if not on this site.
entriesRoute.delete('/:entryId', async (c) => {
  const siteId = c.req.param('siteId');
  const entryId = c.req.param('entryId');
  if (typeof siteId !== 'string' || siteId.length === 0) {
    return c.json({ error: 'siteId is required' }, 400);
  }
  if (typeof entryId !== 'string' || entryId.length === 0) {
    return c.json({ error: 'entryId is required' }, 400);
  }
  const access = await resolveAccess(c, siteId, 'editor');
  if (!access.ok) return access.response;

  const database = db(c.env);
  const deleted = await database
    .delete(collectionEntry)
    .where(and(eq(collectionEntry.id, entryId), eq(collectionEntry.siteId, siteId)))
    .returning({ id: collectionEntry.id });
  if (deleted.length === 0) {
    return c.json({ error: 'entry not found' }, 404);
  }
  return c.body(null, 204);
});

export { entriesRoute };
export default entriesRoute;
