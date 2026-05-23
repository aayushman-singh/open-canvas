// src/routes/api/publish.ts
//
// POST /api/publish/sites/:siteId — promotes the Owner's editable Canvas Site
// State into a Published Snapshot and broadcasts the rendered HTML to every
// visitor tab currently watching the Published Address through the SiteRoom
// Durable Object.
//
// Flow:
//   1. Auth-gate via Clerk + requireAuth.
//   2. Load the site row scoped to the current Owner; missing → 404.
//   3. Re-validate the editableState. Invalid → 400 with the error list,
//      do NOT publish.
//   4. Build PublishedSnapshot { version: prev+1, publishedAt, styleKit,
//      pages } and re-validate it (defence in depth).
//   5. UPDATE the row: publishedSnapshot, publishedVersion, updatedAt.
//   6. Render snapshot HTML and POST it to SITE_ROOM/broadcast keyed by the
//      site id. Broadcast errors are logged loud but do not roll back the
//      publish — the row is already updated and the next visitor page-load
//      will read the new snapshot.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  collectReferencedAssetIds,
  collectUnfilledAssetReferences,
  findAssetReferenceErrors,
} from '../../assets/site-assets';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { renderCanvasSnapshot } from '../../canvas/render';
import type { PublishedSnapshot } from '../../canvas/schema';
import { validateCanvasSiteState, validatePublishedSnapshot } from '../../canvas/validate';
import { db } from '../../db/client';
import { customer, ownerAsset, site } from '../../db/schema';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  SITE_ROOM: DurableObjectNamespace;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const publishApi = new Hono<Env>();

publishApi.use('*', clerkAuth());
publishApi.use('*', requireAuth());

publishApi.post('/sites/:siteId', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('publish endpoint reached without an authenticated user');
  }

  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.json({ error: 'site not found' }, 404);
  }

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return c.json({ error: 'site not found' }, 404);
  }

  const siteRow = await database
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      editableState: site.editableState,
      publishedVersion: site.publishedVersion,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = siteRow[0];
  if (!row) {
    return c.json({ error: 'site not found' }, 404);
  }

  const validation = validateCanvasSiteState(row.editableState);
  if (!validation.valid) {
    return c.json({ error: 'editable state invalid', errors: validation.errors }, 400);
  }

  const unfilledMediaSlots = collectUnfilledAssetReferences(row.editableState.pages);
  if (unfilledMediaSlots.length > 0) {
    return c.json(
      {
        error: 'cannot publish: unfilled media slots',
        unfilledMediaSlots: unfilledMediaSlots.map((reference) => ({
          role: reference.role,
          path: reference.path,
          elementId: reference.mediaElementId,
        })),
      },
      400,
    );
  }

  // Asset reachability guard: every media `assetId` and `posterAssetId`
  // referenced by the editable state must exist as an `ownerAsset` row owned
  // by the current Owner and match the element's expected kind. Per ADR 0004
  // the root is the Owner, not the site — an asset uploaded against one of
  // this Owner's other sites still resolves here. No auto-fix, no
  // placeholder substitution.
  const referenced = collectReferencedAssetIds(row.editableState.pages);
  if (referenced.size > 0) {
    const referencedList = [...referenced];
    const presentRows = await database
      .select({ id: ownerAsset.id, kind: ownerAsset.kind })
      .from(ownerAsset)
      .where(and(eq(ownerAsset.customerId, customerId), inArray(ownerAsset.id, referencedList)));
    const referenceErrors = findAssetReferenceErrors(row.editableState.pages, presentRows);
    const missing = referenceErrors.filter((error) => error.reason === 'missing');
    if (missing.length > 0) {
      return c.json(
        {
          error: 'cannot publish: missing assets',
          missingAssetIds: missing.map((error) => error.assetId),
        },
        400,
      );
    }
    const mismatched = referenceErrors.filter((error) => error.reason === 'kind-mismatch');
    if (mismatched.length > 0) {
      return c.json(
        {
          error: 'cannot publish: asset kind mismatch',
          assetKindErrors: mismatched.map((error) => ({
            assetId: error.assetId,
            expectedKind: error.expectedKind,
            actualKind: error.actualKind,
            path: error.path,
          })),
        },
        400,
      );
    }
  }

  const snapshot: PublishedSnapshot = {
    version: row.publishedVersion + 1,
    publishedAt: new Date().toISOString(),
    styleKit: row.editableState.styleKit,
    pages: row.editableState.pages,
  };

  const snapshotValidation = validatePublishedSnapshot(snapshot);
  if (!snapshotValidation.valid) {
    // Defence in depth: editableState validated above so this should never
    // fire, but if it does the editable contract has diverged from the
    // published contract and we want to know loudly.
    return c.json({ error: 'published snapshot invalid', errors: snapshotValidation.errors }, 500);
  }

  await database
    .update(site)
    .set({
      publishedSnapshot: snapshot,
      publishedVersion: snapshot.version,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, row.id), eq(site.customerId, customerId)));

  const html = renderCanvasSnapshot(snapshot, '/assets');

  try {
    const id = c.env.SITE_ROOM.idFromName(row.id);
    const stub = c.env.SITE_ROOM.get(id);
    const broadcastResponse = await stub.fetch('https://do.invalid/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: snapshot.version, html }),
    });
    if (!broadcastResponse.ok) {
      console.error(
        '[publish] SiteRoom broadcast non-ok status',
        broadcastResponse.status,
        await broadcastResponse.text(),
      );
    }
  } catch (error) {
    // The publish row is already updated; visitors loading the page after
    // this point see the new snapshot. The only thing that fails here is
    // the live-update push to already-open tabs.
    console.error('[publish] SiteRoom broadcast failed', error);
  }

  return c.json({
    ok: true,
    version: snapshot.version,
    publicUrl: `https://${row.subdomain}.rev01.aayushman.dev/`,
  });
});

export default publishApi;
