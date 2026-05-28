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
//   6. Rebuild search, capture timeline, and POST to SITE_ROOM/broadcast
//      keyed by the site id. Broadcast errors throw so the route never reports
//      success while open visitor tabs missed the update; post-update failures
//      restore the prior published state before surfacing.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  collectReferencedAssetIds,
  collectUnfilledAssetReferences,
  findAssetReferenceErrors,
} from '../../assets/site-assets';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { resolvePrimaryPage, snapshotForPageSlug } from '../../canvas/page-routing';
import { renderCanvasSnapshot } from '../../canvas/render';
import { requireTurnstileSiteKey } from '../../canvas/elements/form';
import type { PublishedSnapshot } from '../../canvas/schema';
import { validateCanvasSiteState, validatePublishedSnapshot } from '../../canvas/validate';
import { db, type Db } from '../../db/client';
import { customer, ownerAsset, site, siteSearchEntry, siteSnapshot } from '../../db/schema';
// Post-publish side effects that are part of the published-site contract:
// version timeline capture, OG-image pre-rendering, and search indexing.
import { captureOnPublish } from '../../version/capture';
import { onPublishGenerateOg } from '../../og-image/on-publish';
import { runAudit } from '../../a11y/audit';
import { rebuildSearchIndex } from '../../search/indexer';
import { injectInteractiveRuntime } from '../../interactive/inject';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  SITE_ROOM: DurableObjectNamespace;
  // OG image pre-render writes generated images to R2 during publish.
  ASSETS_BUCKET: R2Bucket;
  // Satori/resvg wasm module slot used by the OG rasteriser.
  OG_RESVG_WASM?: WebAssembly.Module;
  // Cloudflare Turnstile public site key — required at the render boundary
  // when any page in the snapshot contains a form element.
  TURNSTILE_SITE_KEY?: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const publishApi = new Hono<Env>();

interface PublishBroadcastPayload {
  version: number;
  html: string;
  htmlBySlug: Record<string, string>;
  defaultSlug: string;
}

interface PreviousPublishState {
  snapshot: PublishedSnapshot | null;
  version: number;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

async function restorePreviousPublishState(args: {
  database: Db;
  siteId: string;
  customerId: string;
  previous: PreviousPublishState;
  failedVersion: number;
}): Promise<void> {
  const rollbackErrors: string[] = [];

  try {
    const restoredRows = await args.database
      .update(site)
      .set({
        publishedSnapshot: args.previous.snapshot,
        publishedVersion: args.previous.version,
        updatedAt: sql`now()`,
      })
      .where(and(eq(site.id, args.siteId), eq(site.customerId, args.customerId)))
      .returning({ id: site.id });
    if (restoredRows.length === 0) {
      throw new Error(`site ${args.siteId} disappeared before publish rollback`);
    }
  } catch (error) {
    rollbackErrors.push(`site row: ${describeError(error)}`);
  }

  try {
    if (args.previous.snapshot) {
      await rebuildSearchIndex(args.siteId, args.previous.snapshot, args.database);
    } else {
      await args.database.delete(siteSearchEntry).where(eq(siteSearchEntry.siteId, args.siteId));
    }
  } catch (error) {
    rollbackErrors.push(`search index: ${describeError(error)}`);
  }

  try {
    await args.database
      .delete(siteSnapshot)
      .where(
        and(
          eq(siteSnapshot.siteId, args.siteId),
          eq(siteSnapshot.reason, 'publish'),
          eq(siteSnapshot.publishedVersion, args.failedVersion),
        ),
      );
  } catch (error) {
    rollbackErrors.push(`version snapshot: ${describeError(error)}`);
  }

  if (rollbackErrors.length > 0) {
    throw new Error(
      `[publish] rollback failed for site ${args.siteId}: ${rollbackErrors.join('; ')}`,
    );
  }
}

async function runPublishedSideEffects(args: {
  database: Db;
  env: Bindings;
  siteId: string;
  customerId: string;
  snapshot: PublishedSnapshot;
  previous: PreviousPublishState;
  broadcastPayload: PublishBroadcastPayload;
}): Promise<void> {
  try {
    await rebuildSearchIndex(args.siteId, args.snapshot, args.database);
    await captureOnPublish(args.siteId, args.snapshot.version, args.database, args.env);

    const id = args.env.SITE_ROOM.idFromName(args.siteId);
    const stub = args.env.SITE_ROOM.get(id);
    const broadcastResponse = await stub.fetch('https://do.invalid/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args.broadcastPayload),
    });
    if (!broadcastResponse.ok) {
      const body = await broadcastResponse.text();
      throw new Error(`SiteRoom broadcast failed: ${String(broadcastResponse.status)} ${body}`);
    }
  } catch (error) {
    const sideEffectFailure = describeError(error);
    console.error('[publish] published side effects failed; restoring previous published state', {
      siteId: args.siteId,
      failedVersion: args.snapshot.version,
      previousVersion: args.previous.version,
      error: sideEffectFailure,
    });
    try {
      await restorePreviousPublishState({
        database: args.database,
        siteId: args.siteId,
        customerId: args.customerId,
        previous: args.previous,
        failedVersion: args.snapshot.version,
      });
    } catch (rollbackError) {
      const rollbackFailure = describeError(rollbackError);
      console.error('[publish] rollback failed after published side effects failure', {
        siteId: args.siteId,
        failedVersion: args.snapshot.version,
        previousVersion: args.previous.version,
        sideEffectFailure,
        rollbackFailure,
      });
      throw new Error(
        `published side effects failed and rollback failed: sideEffect=${sideEffectFailure}; rollback=${rollbackFailure}`,
      );
    }
    console.error('[publish] published side effects failed; restored previous published state', {
      siteId: args.siteId,
      failedVersion: args.snapshot.version,
      previousVersion: args.previous.version,
      error: sideEffectFailure,
    });
    throw new Error(
      `published side effects failed; restored previous published state: ${sideEffectFailure}`,
    );
  }
}

function renderPublishedPageHtml(
  snapshot: PublishedSnapshot,
  pageSlug: string,
  siteId: string,
  turnstileSiteKey: string,
): string {
  const pageSnapshot = snapshotForPageSlug(snapshot, pageSlug);
  const targetPage = pageSnapshot.pages[0];
  if (!targetPage) {
    throw new Error(`renderPublishedPageHtml: no page for slug ${JSON.stringify(pageSlug)}`);
  }
  return injectInteractiveRuntime(
    renderCanvasSnapshot(snapshot, '/assets', siteId, {
      renderPages: [targetPage],
      turnstileSiteKey,
    }),
    pageSnapshot,
  );
}

function buildPublishBroadcastPayload(
  snapshot: PublishedSnapshot,
  siteId: string,
  turnstileSiteKey: string,
): PublishBroadcastPayload {
  const defaultSlug = resolvePrimaryPage(snapshot).slug;
  const htmlBySlug: Record<string, string> = {};
  for (const page of snapshot.pages) {
    htmlBySlug[page.slug] = renderPublishedPageHtml(snapshot, page.slug, siteId, turnstileSiteKey);
  }
  const html = htmlBySlug[defaultSlug];
  if (html === undefined) {
    throw new Error(
      `publish broadcast missing default page html for ${JSON.stringify(defaultSlug)}`,
    );
  }
  return { version: snapshot.version, html, htmlBySlug, defaultSlug };
}

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
      publishedSnapshot: site.publishedSnapshot,
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

  // Accessibility audit gate. Blocking issues (for example missing alt text,
  // contrast < 3.0, or empty page title) stop publish with a structured 422.
  // Warnings and info-level findings do not block.
  const auditReport = runAudit(row.editableState);
  if (auditReport.blockerCount > 0) {
    return c.json(
      {
        error: 'cannot publish: accessibility blockers',
        blockers: auditReport.issues.filter((i) => i.severity === 'blocking'),
        report: auditReport,
      },
      422,
    );
  }

  const unfilledMediaSlots = collectUnfilledAssetReferences(row.editableState);
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
  const referenced = collectReferencedAssetIds(row.editableState);
  if (referenced.size > 0) {
    const referencedList = [...referenced];
    const presentRows = await database
      .select({ id: ownerAsset.id, kind: ownerAsset.kind })
      .from(ownerAsset)
      .where(and(eq(ownerAsset.customerId, customerId), inArray(ownerAsset.id, referencedList)));
    const referenceErrors = findAssetReferenceErrors(row.editableState, presentRows);
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
    ...(row.editableState.header !== undefined
      ? { header: row.editableState.header }
      : {}),
    ...(row.editableState.footer !== undefined
      ? { footer: row.editableState.footer }
      : {}),
    ...(row.editableState.customStyleKit !== undefined
      ? { customStyleKit: row.editableState.customStyleKit }
      : {}),
    ...(row.editableState.defaultLocale !== undefined
      ? { defaultLocale: row.editableState.defaultLocale }
      : {}),
    ...(row.editableState.siteNoIndex !== undefined
      ? { siteNoIndex: row.editableState.siteNoIndex }
      : {}),
    ...(row.editableState.darkModeEnabled !== undefined
      ? { darkModeEnabled: row.editableState.darkModeEnabled }
      : {}),
    ...(row.editableState.faviconAssetId !== undefined
      ? { faviconAssetId: row.editableState.faviconAssetId }
      : {}),
  };

  const snapshotValidation = validatePublishedSnapshot(snapshot);
  if (!snapshotValidation.valid) {
    // Defence in depth: editableState validated above so this should never
    // fire, but if it does the editable contract has diverged from the
    // published contract and we want to know loudly.
    return c.json({ error: 'published snapshot invalid', errors: snapshotValidation.errors }, 500);
  }

  let broadcastPayload: PublishBroadcastPayload;
  try {
    broadcastPayload = buildPublishBroadcastPayload(snapshot, row.id, requireTurnstileSiteKey(c.env));
  } catch (renderErr) {
    const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
    console.error('[publish] render failed:', msg);
    return c.json({ error: 'render failed', detail: msg }, 500);
  }

  // Publish is all-or-nothing: generated OG images, snapshots, search index,
  // and live broadcast are part of the external publish contract. Pre-update
  // failures throw before the published row moves; post-update failures restore
  // the prior published state before surfacing the error.
  await onPublishGenerateOg(row.id, snapshot, c.env, database, row.name);

  await database
    .update(site)
    .set({
      publishedSnapshot: snapshot,
      publishedVersion: snapshot.version,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, row.id), eq(site.customerId, customerId)));

  await runPublishedSideEffects({
    database,
    env: c.env,
    siteId: row.id,
    customerId,
    snapshot,
    previous: {
      snapshot: row.publishedSnapshot ?? null,
      version: row.publishedVersion,
    },
    broadcastPayload,
  });

  return c.json({
    ok: true,
    version: snapshot.version,
    publicUrl: `https://${row.subdomain}.rev01.aayushman.dev/`,
  });
});

publishApi.post('/sites/:siteId/unpublish', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('unpublish endpoint reached without an authenticated user');
  }

  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.json({ error: 'missing siteId' }, 400);
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

  const result = await database
    .update(site)
    .set({
      publishedSnapshot: null,
      publishedVersion: 0,
      updatedAt: new Date(),
    })
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .returning({ id: site.id });

  if (result.length === 0) {
    return c.json({ error: 'site not found' }, 404);
  }

  return c.json({ ok: true });
});

export default publishApi;
