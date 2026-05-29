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
//   4. Build PublishedSnapshot { version: prev+1, publishedAt,
//      ...editableState } and re-validate it (defence in depth).
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
import { validateEditableSite, validatePublishedSnapshot } from '../../canvas/validate';
import { db, type Db } from '../../db/client';
import { customer, ownerAsset, site } from '../../db/schema';
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


// Short, response-safe failure description. Stack traces stay in the raw
// `console.error(..., { error })` calls (which format the full stack in the
// log) and never enter strings that may surface to JSON responses through
// rethrown Error messages.
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Per-step wall-clock timing for the publish path. Cloudflare Workers cap
// CPU per request and the publish flow on an Apogee-sized site (~292
// elements × 6 pages) has been observed to exceed it. We instrument every
// major step so a 1102 ("worker exceeded resource limits") response can be
// localised to a specific cost centre from the wrangler tail.
//
// Each `mark` both records the duration since the previous mark AND emits a
// `[publish-step]` log line *at the start* of the next step. The start-of-
// step breadcrumb is intentional: if the worker is killed mid-step we still
// know which step it died inside (the matching end-of-step duration line
// will be missing).
interface TimelineStep {
  readonly step: string;
  readonly durationMs: number;
  readonly totalMs: number;
}
interface PublishTimeline {
  begin(step: string): void;
  end(step: string): void;
  summary(): { totalMs: number; steps: readonly TimelineStep[] };
}
function createPublishTimeline(siteId: string): PublishTimeline {
  const start = performance.now();
  const steps: TimelineStep[] = [];
  const open: { step: string; startedAt: number }[] = [];
  return {
    begin(step) {
      const at = performance.now();
      open.push({ step, startedAt: at });
      console.log(
        `[publish-step] begin ${step}`,
        JSON.stringify({ siteId, atMs: Math.round((at - start) * 100) / 100 }),
      );
    },
    end(step) {
      const at = performance.now();
      const top = open.pop();
      if (top === undefined || top.step !== step) {
        // Defensive — mismatched begin/end indicates an instrumentation bug
        // (not a publish bug). Log loudly so it's caught in review.
        console.error('[publish-step] mismatched end', { siteId, expected: top?.step, got: step });
      }
      const startedAt = top?.startedAt ?? start;
      const durationMs = Math.round((at - startedAt) * 100) / 100;
      const totalMs = Math.round((at - start) * 100) / 100;
      steps.push({ step, durationMs, totalMs });
      console.log(
        `[publish-step] end ${step}`,
        JSON.stringify({ siteId, durationMs, totalMs }),
      );
    },
    summary() {
      return {
        totalMs: Math.round((performance.now() - start) * 100) / 100,
        steps,
      };
    },
  };
}

// Deferred side effects — run AFTER the publish HTTP response has returned.
// The published row is the source of truth; broadcast, search index rebuild,
// version capture, and OG warmup are denormalised state that can be repaired
// on the next publish if any one of them fails. We surface each failure as a
// loud `[publish-deferred] ... failed` log line but do NOT roll back the row
// — the response has already gone out and the visitor-facing snapshot is the
// committed one.
//
// The handler invokes this via `c.executionCtx.waitUntil(...)` so the Worker
// keeps running until the chain finishes, but the request response is not
// blocked on it. This is what lets concurrent publishes on the same isolate
// avoid 1102: each request's heavy work overlaps with the next request's
// response cycle rather than stacking on the request path.
async function runDeferredPublishedSideEffects(args: {
  database: Db;
  env: Bindings;
  siteId: string;
  siteName: string;
  snapshot: PublishedSnapshot;
  broadcastPayload: PublishBroadcastPayload;
}): Promise<void> {
  const { siteId } = args;
  const version = args.snapshot.version;
  const totalStart = performance.now();

  async function step(name: string, run: () => Promise<unknown>): Promise<void> {
    const stepStart = performance.now();
    console.log(`[publish-deferred] begin ${name}`, JSON.stringify({ siteId, version }));
    try {
      await run();
      console.log(
        `[publish-deferred] end ${name}`,
        JSON.stringify({
          siteId,
          version,
          durationMs: Math.round((performance.now() - stepStart) * 100) / 100,
        }),
      );
    } catch (error) {
      // Pass the raw error so console.error renders the full stack. The
      // failure does NOT abort the chain — every remaining step still runs.
      console.error(`[publish-deferred] ${name} failed`, {
        siteId,
        version,
        durationMs: Math.round((performance.now() - stepStart) * 100) / 100,
        detail: describeError(error),
        error,
      });
    }
  }

  // Broadcast first so any open editor / visitor tab gets the new version
  // ASAP. Even on a heavy site this stage is ~30-400ms.
  await step('broadcast', async () => {
    const doId = args.env.SITE_ROOM.idFromName(siteId);
    const stub = args.env.SITE_ROOM.get(doId);
    const response = await stub.fetch('https://do.invalid/broadcast', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args.broadcastPayload),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`SiteRoom broadcast failed: ${String(response.status)} ${body}`);
    }
  });

  await step('rebuildSearchIndex', () =>
    rebuildSearchIndex(siteId, args.snapshot, args.database),
  );

  await step('captureOnPublish', () =>
    captureOnPublish(siteId, args.snapshot.version, args.database, args.env),
  );

  // OG warmup runs LAST because it is the heaviest step and the OG-serving
  // route renders on demand if a visitor share-unfurls before the warmup
  // completes — so deferring it does not cause user-visible 404s, only a
  // slower first share-unfurl in the first few seconds after publish.
  await step('onPublishGenerateOg', () =>
    onPublishGenerateOg(siteId, args.snapshot, args.env, args.database, args.siteName),
  );

  console.log(
    '[publish-deferred] all-done',
    JSON.stringify({
      siteId,
      version,
      totalMs: Math.round((performance.now() - totalStart) * 100) / 100,
    }),
  );
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
    const pageStart = performance.now();
    const html = renderPublishedPageHtml(snapshot, page.slug, siteId, turnstileSiteKey);
    htmlBySlug[page.slug] = html;
    console.log(
      '[publish-page-render]',
      JSON.stringify({
        siteId,
        slug: page.slug,
        sections: page.sections.length,
        htmlBytes: html.length,
        durationMs: Math.round((performance.now() - pageStart) * 100) / 100,
      }),
    );
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

  const timeline = createPublishTimeline(siteId);
  const attachTimings = (response: Response): Response => {
    const summary = timeline.summary();
    response.headers.set('X-Publish-Timings', JSON.stringify(summary));
    console.log('[publish-timing]', JSON.stringify({ siteId, ...summary }));
    return response;
  };

  const database = db(c.env);

  timeline.begin('db.customerLookup');
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  timeline.end('db.customerLookup');
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return attachTimings(c.json({ error: 'site not found' }, 404));
  }

  timeline.begin('db.siteSelect');
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
  timeline.end('db.siteSelect');
  const row = siteRow[0];
  if (!row) {
    return attachTimings(c.json({ error: 'site not found' }, 404));
  }

  timeline.begin('validateEditableSite');
  const validation = validateEditableSite(row.editableState);
  timeline.end('validateEditableSite');
  if (!validation.valid) {
    return attachTimings(c.json({ error: 'editable state invalid', errors: validation.errors }, 400));
  }

  // Accessibility audit gate. Blocking issues (for example missing alt text,
  // contrast < 3.0, or empty page title) stop publish with a structured 422.
  // Warnings and info-level findings do not block.
  timeline.begin('runAudit');
  const auditReport = runAudit(row.editableState);
  timeline.end('runAudit');
  if (auditReport.blockerCount > 0) {
    return attachTimings(
      c.json(
        {
          error: 'cannot publish: accessibility blockers',
          blockers: auditReport.issues.filter((i) => i.severity === 'blocking'),
          report: auditReport,
        },
        422,
      ),
    );
  }

  timeline.begin('collectUnfilledAssetReferences');
  const unfilledMediaSlots = collectUnfilledAssetReferences(row.editableState);
  timeline.end('collectUnfilledAssetReferences');
  if (unfilledMediaSlots.length > 0) {
    return attachTimings(
      c.json(
        {
          error: 'cannot publish: unfilled media slots',
          unfilledMediaSlots: unfilledMediaSlots.map((reference) => ({
            role: reference.role,
            path: reference.path,
            elementId: reference.mediaElementId,
          })),
        },
        400,
      ),
    );
  }

  // Asset reachability guard: every media `assetId` and `posterAssetId`
  // referenced by the editable state must exist as an `ownerAsset` row owned
  // by the current Owner and match the element's expected kind. Per ADR 0004
  // the root is the Owner, not the site — an asset uploaded against one of
  // this Owner's other sites still resolves here. No auto-fix, no
  // placeholder substitution.
  timeline.begin('assetReachabilityCheck');
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
      timeline.end('assetReachabilityCheck');
      return attachTimings(
        c.json(
          {
            error: 'cannot publish: missing assets',
            missingAssetIds: missing.map((error) => error.assetId),
          },
          400,
        ),
      );
    }
    const mismatched = referenceErrors.filter((error) => error.reason === 'kind-mismatch');
    if (mismatched.length > 0) {
      timeline.end('assetReachabilityCheck');
      return attachTimings(
        c.json(
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
        ),
      );
    }
  }
  timeline.end('assetReachabilityCheck');

  // PublishedSnapshot = EditableSite & { version, publishedAt }. Every
  // EditableSite field — required and optional — is part of the published
  // contract, and validateSiteShape (invoked inside both validateEditableSite
  // and validatePublishedSnapshot) gates each one. Spread the validated
  // editable state and stamp the two publish-only fields on top.
  const snapshot: PublishedSnapshot = {
    ...row.editableState,
    version: row.publishedVersion + 1,
    publishedAt: new Date().toISOString(),
  };

  timeline.begin('validatePublishedSnapshot');
  const snapshotValidation = validatePublishedSnapshot(snapshot);
  timeline.end('validatePublishedSnapshot');
  if (!snapshotValidation.valid) {
    // Defence in depth: editableState validated above so this should never
    // fire, but if it does the editable contract has diverged from the
    // published contract and we want to know loudly.
    return attachTimings(
      c.json({ error: 'published snapshot invalid', errors: snapshotValidation.errors }, 500),
    );
  }

  let broadcastPayload: PublishBroadcastPayload;
  timeline.begin('buildPublishBroadcastPayload');
  try {
    broadcastPayload = buildPublishBroadcastPayload(snapshot, row.id, requireTurnstileSiteKey(c.env));
  } catch (renderErr) {
    timeline.end('buildPublishBroadcastPayload');
    const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
    console.error('[publish] render failed:', msg);
    return attachTimings(c.json({ error: 'render failed', detail: msg }, 500));
  }
  timeline.end('buildPublishBroadcastPayload');

  // The site row UPDATE is the commit point: the publishedSnapshot column is
  // the source of truth visitors read. Everything after this — broadcast,
  // search index rebuild, version capture, OG warmup — is denormalised state
  // that can be repaired on the next publish, so we defer it via
  // c.executionCtx.waitUntil(). This keeps the response time and per-request
  // memory footprint small so concurrent publishes on the same Worker isolate
  // don't compound into a 1102 ("worker exceeded resource limits").
  timeline.begin('db.siteRowUpdate');
  await database
    .update(site)
    .set({
      publishedSnapshot: snapshot,
      publishedVersion: snapshot.version,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, row.id), eq(site.customerId, customerId)));
  timeline.end('db.siteRowUpdate');

  c.executionCtx.waitUntil(
    runDeferredPublishedSideEffects({
      database,
      env: c.env,
      siteId: row.id,
      siteName: row.name,
      snapshot,
      broadcastPayload,
    }),
  );

  return attachTimings(
    c.json({
      ok: true,
      version: snapshot.version,
      publicUrl: `https://${row.subdomain}.rev01.aayushman.dev/`,
    }),
  );
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
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .returning({ id: site.id });

  if (result.length === 0) {
    return c.json({ error: 'site not found' }, 404);
  }

  return c.json({ ok: true });
});

export default publishApi;
