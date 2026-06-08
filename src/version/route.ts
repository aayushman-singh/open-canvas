// src/version/route.ts
//
// Hono router for version history. Mounted at
// `/api/sites/:siteId/snapshots` by the main thread.
//
// Access model: every endpoint resolves the site through
// `loadAccessibleSite`, which accepts the owner OR any accepted collaborator
// (per `siteCollaborator.acceptedAt is not null`). Tiering matches the
// snapshot semantics:
//
//   GET    /                       — list snapshots, newest-first   [viewer]
//   POST   /                       — capture a manual snapshot      [editor]
//   POST   /:snapshotId/restore    — restore a snapshot             [editor]
//   GET    /:snapshotId/preview    — render snapshot HTML           [viewer]
//   DELETE /:snapshotId             — delete a snapshot              [editor]
//
// `viewer` covers read-only snapshot inspection (history list + preview
// HTML) because viewers can already see the live site. `editor` covers
// mutating operations — snapshots are intrinsically site-scoped (the
// `site_snapshot` table has no `customer_id` column), so anyone with write
// access to the site is authoritative over its history. No owner-only
// operations exist on this surface; if/when one appears (e.g. snapshot
// retention policy change) it should pass `'owner'` explicitly.
//
// Failure semantics: `loadAccessibleSite` returns null for BOTH "site does
// not exist" AND "you do not have the required tier". The route maps that
// to 404 with `{ error: 'site not found' }` (or `'snapshot not found'` for
// per-snapshot endpoints) so the existence of a site / snapshot does not
// leak to a stranger. This matches the convention in canvas / assets /
// canvas-agent routes which also use `loadAccessibleSite` and report 404
// for the same combined condition.

import { Hono, type Context } from 'hono';

import { loadAccessibleSite, type SiteAccessRequirement } from '../auth/accessible-site.js';
import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import { db } from '../db/client.js';

import { captureManual } from './capture.js';
import { deleteSnapshot, DeleteError } from './delete.js';
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
 * Resolve the accessible site id for the calling Clerk user at the requested
 * access tier. Returns null when:
 *   - the Clerk user has no `customer` row yet (first-visit users),
 *   - the `siteId` does not exist,
 *   - the caller is neither the site owner nor an accepted collaborator,
 *   - the caller's collaborator role does not meet `requiredRole`.
 *
 * The caller maps null → 404 to avoid leaking existence to strangers (matches
 * the convention in canvas / assets / canvas-agent routes).
 *
 * Returns `site.id` (NOT the caller's `customer.id`) — the version primitives
 * only need the site identity; `site_snapshot` rows are intrinsically
 * site-scoped and carry no `customer_id` column.
 */
async function resolveAccessibleSiteId(
  c: Context<Env>,
  siteId: string,
  requiredRole: SiteAccessRequirement,
): Promise<string | null> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('version-history api reached without an authenticated user');
  }
  const database = db(c.env);
  const accessible = await loadAccessibleSite(
    database,
    auth.userId,
    siteId,
    requiredRole,
    c.get('customer')?.id,
  );
  return accessible?.id ?? null;
}

// GET / — list snapshots newest-first. Supports ?cursor=<iso> and ?limit=N.
// Viewer tier: collaborators of any role (including viewer-only seats) can
// see the version timeline of any site they're on.
versionRoute.get('/', async (c) => {
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const accessibleSiteId = await resolveAccessibleSiteId(c, siteId, 'viewer');
  if (!accessibleSiteId) {
    return c.json({ error: 'site not found' }, 404);
  }

  const database = db(c.env);
  const cursor = c.req.query('cursor');
  const limitRaw = c.req.query('limit');
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined;
  const options: Parameters<typeof listSnapshots>[2] = {};
  if (cursor !== undefined) options.cursor = cursor;
  if (limit !== undefined && Number.isFinite(limit) && limit > 0) options.limit = limit;

  try {
    const page = await listSnapshots(accessibleSiteId, database, options);
    return c.json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// POST / — manual capture. Body: { label: string }.
// Editor tier: write-capable collaborators (and the owner) can capture
// snapshots. Viewers cannot — pre-empts a viewer from inflating the
// per-site snapshot cap or stamping the timeline with their own labels.
versionRoute.post('/', async (c) => {
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const accessibleSiteId = await resolveAccessibleSiteId(c, siteId, 'editor');
  if (!accessibleSiteId) {
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

  const database = db(c.env);
  try {
    await captureManual(accessibleSiteId, label, database, c.env);
  } catch (err) {
    // Surface the real cause as JSON. The client (versions-panel.ts) parses
    // the error body via r.json() and would otherwise choke on hono's
    // default plain-text 500 "Internal Server Error" page with an opaque
    // "Unexpected token 'I'" SyntaxError.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[version/capture] manual snapshot failed', { siteId, label, err });
    return c.json({ error: `snapshot failed: ${message}` }, 500);
  }
  return c.json({ ok: true });
});

// POST /:snapshotId/restore — restore a snapshot. The restore primitive
// captures a pre-restore safety snapshot itself, so callers don't need to.
// Editor tier: writes the site's editableState, broadcasts to the SiteRoom.
versionRoute.post('/:snapshotId/restore', async (c) => {
  const siteId = c.req.param('siteId');
  const snapshotId = c.req.param('snapshotId');
  if (!siteId || !snapshotId) {
    return c.json({ error: 'snapshot not found' }, 404);
  }
  const accessibleSiteId = await resolveAccessibleSiteId(c, siteId, 'editor');
  if (!accessibleSiteId) {
    return c.json({ error: 'snapshot not found' }, 404);
  }
  const database = db(c.env);
  try {
    const result = await restoreSnapshot(accessibleSiteId, snapshotId, database, c.env);
    return c.json({ ok: true, snapshotId: result.snapshotId, broadcasted: result.broadcasted });
  } catch (err) {
    if (err instanceof RestoreError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    // Surface the real cause to the caller — they have edit rights to this
    // site and need actionable error text rather than a generic 500.
    // Without this, a bytea-decode or DB-update failure becomes an
    // inscrutable "Restore failed: Internal Server Error" in the dashboard
    // modal.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[version/restore] unexpected restore failure', { siteId, snapshotId, err });
    return c.json({ error: `restore failed: ${message}` }, 500);
  }
});

// GET /:snapshotId/preview — render a snapshot to HTML for the read-only
// view. Viewer tier: pure read.
versionRoute.get('/:snapshotId/preview', async (c) => {
  const siteId = c.req.param('siteId');
  const snapshotId = c.req.param('snapshotId');
  if (!siteId || !snapshotId) {
    return c.json({ error: 'snapshot not found' }, 404);
  }
  const accessibleSiteId = await resolveAccessibleSiteId(c, siteId, 'viewer');
  if (!accessibleSiteId) {
    return c.json({ error: 'snapshot not found' }, 404);
  }
  const database = db(c.env);
  try {
    const result = await renderSnapshotPreview(
      accessibleSiteId,
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

// DELETE /:snapshotId — delete a snapshot row. Refuses to delete the
// snapshot backing the site's current published version (see delete.ts
// for the boundary rationale).
// Editor tier: deletion is a write to the site's history. Editors already
// have the ability to capture snapshots, so deleting one (either their own
// or someone else's) is within their authority.
versionRoute.delete('/:snapshotId', async (c) => {
  const siteId = c.req.param('siteId');
  const snapshotId = c.req.param('snapshotId');
  if (!siteId || !snapshotId) {
    return c.json({ error: 'snapshot not found' }, 404);
  }
  const accessibleSiteId = await resolveAccessibleSiteId(c, siteId, 'editor');
  if (!accessibleSiteId) {
    return c.json({ error: 'snapshot not found' }, 404);
  }
  const database = db(c.env);
  try {
    await deleteSnapshot(accessibleSiteId, snapshotId, database);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof DeleteError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[version/delete] unexpected delete failure', { siteId, snapshotId, err });
    return c.json({ error: 'delete failed: ' + message }, 500);
  }
});

export default versionRoute;
