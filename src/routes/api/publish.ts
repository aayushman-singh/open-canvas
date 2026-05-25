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
//   6. Render page-scoped snapshot HTML and POST it to SITE_ROOM/broadcast
//      keyed by the site id. Broadcast errors throw so the route never reports
//      success while open visitor tabs missed the update.

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
import type { PublishedSnapshot } from '../../canvas/schema';
import { validateCanvasSiteState, validatePublishedSnapshot } from '../../canvas/validate';
import { db } from '../../db/client';
import { customer, ownerAsset, site } from '../../db/schema';
// Wave 1 post-publish hooks. Per-plan contracts:
//   - Snapshot capture for the version-history timeline (#3).
//   - OG-image pre-render to R2 keyed by snapshot.version (#6).
import { captureOnPublish } from '../../version/capture';
import { onPublishGenerateOg } from '../../og-image/on-publish';
// Wave 3 pre/post-publish hooks.
//   - Pre-publish: a11y audit refuses to publish on blocking issues (#15).
//   - Post-publish: search index rebuild for the visitor-facing search (#13).
import { runAudit } from '../../a11y/audit';
import { rebuildSearchIndex } from '../../search/indexer';
import { configureSymbolInstanceRender } from '../../canvas/elements/symbol-instance';
import { injectInteractiveRuntime } from '../../interactive/inject';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  SITE_ROOM: DurableObjectNamespace;
  // Wave 1 #6 — OG image pre-render at publish writes to R2.
  ASSETS_BUCKET: R2Bucket;
  // Wave 1 #6 — Satori/resvg wasm module slot (optional; the rasteriser
  // falls back to a disk read on Bun and an on-demand fetch in Workers).
  OG_RESVG_WASM?: WebAssembly.Module;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const publishApi = new Hono<Env>();

interface PublishBroadcastPayload {
  version: number;
  html: string;
  htmlBySlug: Record<string, string>;
  defaultSlug: string;
}

function renderPublishedPageHtml(
  snapshot: PublishedSnapshot,
  pageSlug: string,
  siteId: string,
): string {
  const pageSnapshot = snapshotForPageSlug(snapshot, pageSlug);
  return injectInteractiveRuntime(
    renderCanvasSnapshot(pageSnapshot, '/assets', siteId),
    pageSnapshot,
  );
}

function buildPublishBroadcastPayload(
  snapshot: PublishedSnapshot,
  siteId: string,
): PublishBroadcastPayload {
  const defaultSlug = resolvePrimaryPage(snapshot).slug;
  const htmlBySlug: Record<string, string> = {};
  for (const page of snapshot.pages) {
    htmlBySlug[page.slug] = renderPublishedPageHtml(snapshot, page.slug, siteId);
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

  // Wave 3 #15 — accessibility audit gate. Blocks publish when blocking issues
  // exist (e.g. missing alt text, contrast < 3.0, empty page title). Warnings
  // and info-level findings do NOT block. 422 is the structured failure code.
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
    ...(row.editableState.customStyleKit !== undefined
      ? { customStyleKit: row.editableState.customStyleKit }
      : {}),
    symbols: row.editableState.symbols,
    ...(row.editableState.defaultLocale !== undefined
      ? { defaultLocale: row.editableState.defaultLocale }
      : {}),
    ...(row.editableState.siteNoIndex !== undefined
      ? { siteNoIndex: row.editableState.siteNoIndex }
      : {}),
    ...(row.editableState.darkModeEnabled !== undefined
      ? { darkModeEnabled: row.editableState.darkModeEnabled }
      : {}),
  };

  const snapshotValidation = validatePublishedSnapshot(snapshot);
  if (!snapshotValidation.valid) {
    // Defence in depth: editableState validated above so this should never
    // fire, but if it does the editable contract has diverged from the
    // published contract and we want to know loudly.
    return c.json({ error: 'published snapshot invalid', errors: snapshotValidation.errors }, 500);
  }

  configureSymbolInstanceRender({ symbols: snapshot.symbols ?? [] });

  let broadcastPayload: PublishBroadcastPayload;
  try {
    broadcastPayload = buildPublishBroadcastPayload(snapshot, row.id);
  } catch (renderErr) {
    const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
    console.error('[publish] render failed:', msg);
    return c.json({ error: 'render failed', detail: msg }, 500);
  }

  try {
    await onPublishGenerateOg(row.id, snapshot, c.env, database, row.name);
  } catch (ogErr) {
    const msg = ogErr instanceof Error ? ogErr.message : String(ogErr);
    console.error('[publish] OG generation failed (non-blocking):', msg);
  }

  await database
    .update(site)
    .set({
      publishedSnapshot: snapshot,
      publishedVersion: snapshot.version,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, row.id), eq(site.customerId, customerId)));

  try {
    await captureOnPublish(row.id, snapshot.version, database, c.env);
  } catch (captureErr) {
    const msg = captureErr instanceof Error ? captureErr.message : String(captureErr);
    console.error('[publish] snapshot capture failed (non-blocking):', msg);
  }

  try {
    await rebuildSearchIndex(row.id, snapshot, database);
  } catch (indexErr) {
    const msg = indexErr instanceof Error ? indexErr.message : String(indexErr);
    console.error('[publish] search index rebuild failed (non-blocking):', msg);
  }

  const id = c.env.SITE_ROOM.idFromName(row.id);
  const stub = c.env.SITE_ROOM.get(id);
  const broadcastResponse = await stub.fetch('https://do.invalid/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(broadcastPayload),
  });
  if (!broadcastResponse.ok) {
    const body = await broadcastResponse.text();
    const message = `SiteRoom broadcast failed: ${String(broadcastResponse.status)} ${body}`;
    console.error(`[publish] ${message}`);
    throw new Error(message);
  }

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
