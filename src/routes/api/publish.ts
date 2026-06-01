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
import { customer, ownerAsset, site, siteSearchEntry, siteSnapshot } from '../../db/schema';
// Post-publish side effects that are part of the published-site contract:
// version timeline capture, OG-image pre-rendering, and search indexing.
import { captureOnPublish } from '../../version/capture';
import { onPublishGenerateOg } from '../../og-image/on-publish';
import { runAudit } from '../../a11y/audit';
import { rebuildSearchIndex } from '../../search/indexer';
import { injectInteractiveRuntime } from '../../interactive/inject';
import { appDomain, type HostConfigEnv } from '../../host-config';
import { siteCollaborator } from '../../db/schema';
import { isNotNull } from 'drizzle-orm';
import { buildSiteNotif } from '../../notifications/constructors';
import { writeNotification } from '../../notifications/writer';
import type { PublishEventPayload, PublishOutcome } from '../../notifications/kinds';

type Bindings = HostConfigEnv & {
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
  // ADR 0043 publish_event notif fan-out can send email via src/email/send.ts;
  // the writer requires this in env.
  RESEND_API_KEY: string;
};

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

// ADR 0043 publish_event helper. Best-effort fan-out — the underlying publish
// outcome (whether the site row updated or not) is already determined by the
// time this is called; a notif write failure logs but does not flip the
// caller's response. Fires for succeeded (every commit) and for failed
// post-commit (runPublishedSideEffects threw after the row UPDATE landed).
// Pre-commit failures (validation, audit, asset checks) do not emit a notif —
// the Owner sees the structured error response in the editor and onlookers
// did not perceive a publish attempt.
async function emitPublishNotif(params: {
  database: Db;
  env: Bindings;
  siteId: string;
  siteName: string;
  outcome: PublishOutcome;
  publishedVersion: number | null;
  failureReason: string | null;
  actorCustomerId: string;
  actorDisplayName: string;
}): Promise<void> {
  try {
    const collabRows = await params.database
      .select({ customerId: siteCollaborator.customerId })
      .from(siteCollaborator)
      .where(
        and(
          eq(siteCollaborator.siteId, params.siteId),
          isNotNull(siteCollaborator.acceptedAt),
        ),
      );
    const recipientIds = Array.from(
      new Set<string>([params.actorCustomerId, ...collabRows.map((r) => r.customerId)]),
    );
    const payload: PublishEventPayload = {
      siteId: params.siteId,
      siteName: params.siteName,
      outcome: params.outcome,
      publishedVersion: params.publishedVersion,
      failureReason: params.failureReason,
      actorCustomerId: params.actorCustomerId,
      actorDisplayName: params.actorDisplayName,
      occurredAt: new Date().toISOString(),
    };
    await writeNotification(
      { db: params.database, env: params.env },
      buildSiteNotif('publish_event', params.siteId, payload, recipientIds),
    );
  } catch (err) {
    console.error('[publish] publish_event notif write failed', {
      siteId: params.siteId,
      outcome: params.outcome,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    });
  }
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
      console.log(`[publish-step] end ${step}`, JSON.stringify({ siteId, durationMs, totalMs }));
    },
    summary() {
      return {
        totalMs: Math.round((performance.now() - start) * 100) / 100,
        steps,
      };
    },
  };
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
    // Pass the raw error so console.error renders the full stack — describeError
    // returns only the message, which is what we surface to the JSON response.
    console.error('[publish] published side effects failed; restoring previous published state', {
      siteId: args.siteId,
      failedVersion: args.snapshot.version,
      previousVersion: args.previous.version,
      error,
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
        sideEffectError: error,
        rollbackError,
      });
      throw new Error(
        `published side effects failed and rollback failed: sideEffect=${sideEffectFailure}; rollback=${rollbackFailure}`,
      );
    }
    console.error('[publish] published side effects failed; restored previous published state', {
      siteId: args.siteId,
      failedVersion: args.snapshot.version,
      previousVersion: args.previous.version,
      error,
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
    .select({ id: customer.id, displayName: customer.displayName, email: customer.email })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  timeline.end('db.customerLookup');
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return attachTimings(c.json({ error: 'site not found' }, 404));
  }
  const actorDisplayName =
    customerRow[0]?.displayName ?? customerRow[0]?.email ?? 'A teammate';

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
    return attachTimings(
      c.json({ error: 'editable state invalid', errors: validation.errors }, 400),
    );
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
    broadcastPayload = buildPublishBroadcastPayload(
      snapshot,
      row.id,
      requireTurnstileSiteKey(c.env),
    );
  } catch (renderErr) {
    timeline.end('buildPublishBroadcastPayload');
    const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
    console.error('[publish] render failed:', msg);
    return attachTimings(c.json({ error: 'render failed', detail: msg }, 500));
  }
  timeline.end('buildPublishBroadcastPayload');

  // Publish is all-or-nothing: generated OG images, snapshots, search index,
  // and live broadcast are part of the external publish contract. Pre-update
  // failures throw before the published row moves; post-update failures restore
  // the prior published state before surfacing the error.
  timeline.begin('onPublishGenerateOg');
  try {
    await onPublishGenerateOg(row.id, snapshot, c.env, database, row.name);
  } catch (error) {
    timeline.end('onPublishGenerateOg');
    console.error('[publish] OG generation failed before publish row update', {
      siteId: row.id,
      version: snapshot.version,
      error,
    });
    return attachTimings(
      c.json({ error: 'publish OG generation failed', detail: describeError(error) }, 500),
    );
  }
  timeline.end('onPublishGenerateOg');

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

  timeline.begin('runPublishedSideEffects');
  try {
    await runPublishedSideEffects({
      database,
      env: c.env,
      siteId: row.id,
      customerId,
      snapshot,
      broadcastPayload,
      previous: {
        snapshot: row.publishedSnapshot ?? null,
        version: row.publishedVersion,
      },
    });
  } catch (error) {
    timeline.end('runPublishedSideEffects');
    // ADR 0043: publish_event failed. The row UPDATE already landed, so this
    // is a post-commit side-effect failure. Notif fan-out before responding.
    await emitPublishNotif({
      database,
      env: c.env,
      siteId: row.id,
      siteName: row.name,
      outcome: 'failed',
      publishedVersion: snapshot.version,
      failureReason: describeError(error),
      actorCustomerId: customerId,
      actorDisplayName,
    });
    return attachTimings(
      c.json({ error: 'publish side effects failed', detail: describeError(error) }, 500),
    );
  }
  timeline.end('runPublishedSideEffects');

  // ADR 0043: publish_event succeeded. Fan-out to owner + accepted
  // collaborators. Best-effort; failures do not block the response.
  await emitPublishNotif({
    database,
    env: c.env,
    siteId: row.id,
    siteName: row.name,
    outcome: 'succeeded',
    publishedVersion: snapshot.version,
    failureReason: null,
    actorCustomerId: customerId,
    actorDisplayName,
  });

  return attachTimings(
    c.json({
      ok: true,
      version: snapshot.version,
      publicUrl: `https://${row.subdomain}.${appDomain(c.env)}/`,
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
