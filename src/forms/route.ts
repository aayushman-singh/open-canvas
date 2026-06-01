// src/forms/route.ts
//
// Hono router mounted by the main thread at `/api/forms`. Three routes:
//
//   POST /:siteId/:formElementId                — visitor submission.
//   GET  /:siteId/:formElementId/submissions    — Owner inbox list.
//   GET  /:siteId/:formElementId/export.csv     — Owner CSV export.
//
// Visitor route is UNAUTH (public site) but bot-gated via Turnstile + the
// per-IP/per-form rate limiter. Owner routes are Clerk-gated and check
// site ownership through the customer→site join.

import { and, eq, isNotNull } from 'drizzle-orm';
import { Hono, type Context } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import type { FormElement } from '../canvas/elements/form.js';
import type { CanvasPage } from '../canvas/schema.js';
import { db } from '../db/client.js';
import { customer, site as siteTable, siteCollaborator } from '../db/schema.js';
import { type HostConfigEnv } from '../host-config.js';
import type { FormRateLimiterMarker } from '../live/form-rate-limiter-client.js';
import { buildSiteNotif } from '../notifications/constructors.js';
import { writeNotification } from '../notifications/writer.js';
import type { NotificationOwnerRoomMarker } from '../notifications/owner-room.js';

import { exportFormSubmissionsCsv, listFormSubmissions } from './inbox.js';
import { handleFormSubmit, type SubmitOutcome } from './submit.js';
import { verifyTurnstile } from './turnstile.js';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  WEBHOOK_SIGNING_SECRET: string;
  FORM_RATE_LIMITER: DurableObjectNamespace<FormRateLimiterMarker>;
  RESEND_API_KEY: string;
  NOTIFICATION_OWNER_ROOM: DurableObjectNamespace<NotificationOwnerRoomMarker>;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const router = new Hono<Env>();

// ---------------------------------------------------------------------------
// Visitor route — POST /:siteId/:formElementId
// ---------------------------------------------------------------------------
//
// Public endpoint. Accepts `multipart/form-data` and
// `application/x-www-form-urlencoded` from the browser's native form submit.
// Returns a 303 redirect back to the originating page on success so the
// Visitor's URL bar reflects the success state without a follow-up XHR.

router.post('/:siteId/:formElementId', async (c) => {
  const siteId = c.req.param('siteId');
  const formElementId = c.req.param('formElementId');
  if (!siteId || !formElementId) {
    return c.json({ error: 'siteId and formElementId required' }, 400);
  }

  // Outer try/catch: Pass-8 retest hit "Internal Server Error" with no JSON
  // body. That's Workers' default 500 response when an exception escapes the
  // route handler — no triage hint reaches the operator. The wrap below
  // turns every uncaught throw into a 500 JSON body with the failing step
  // labelled. Each step (rawFields parse, turnstile, handleFormSubmit, post-
  // submit email) records its name in `phase` before doing async work, so a
  // throw fingerprints itself. The structured response stays inside the
  // "fail loud" rule — it adds detail, doesn't degrade behaviour.
  let phase = 'init';
  try {
    let rawFields: Record<string, string | string[]>;
    try {
      phase = 'parse-fields';
      rawFields = await collectFormFields(c.req.raw);
    } catch {
      return c.json({ error: 'unsupported content type; use multipart/form-data or application/x-www-form-urlencoded' }, 415);
    }
    const turnstileToken = pickStringField(rawFields, 'cf-turnstile-response', '');
    const ip = c.req.header('cf-connecting-ip') ?? null;
    const userAgent = c.req.header('user-agent') ?? '';

    phase = 'handleFormSubmit';
    const outcome = await handleFormSubmit(
    {
      db: db(c.env),
      formRateLimiter: c.env.FORM_RATE_LIMITER,
      verifyTurnstileToken: async (token, remoteIp) =>
        verifyTurnstile(c.env.TURNSTILE_SECRET, token, {
          ...(remoteIp ? { remoteIp } : {}),
        }),
      webhookSigningSecret: c.env.WEBHOOK_SIGNING_SECRET,
    },
    {
      siteId,
      formElementId,
      rawFields,
      turnstileToken,
      ip,
      userAgent,
    },
  );

  // ADR 0043 form_submission notification — path-specific posture.
  //
  // `writeNotification` is strict ("fail loud, no silent fallback") for every
  // caller. That posture is correct for admin-action routes (collaborators,
  // publish) where the actor expects the email + live push to land; a writer
  // failure there should 5xx the request so the actor retries deliberately.
  //
  // This route is the carve-out. The actor is a Visitor who has no contract
  // with the notification — their contract is "the form submission landed,"
  // which `handleFormSubmit` already satisfied above. Surfacing a writer
  // throw as a visitor-facing 500 would loop them through a resubmit, double
  // the form_submission row count, AND still leave the Owner without the
  // notif. We catch the throw and log it loudly; the operator sees the
  // failure in wrangler tail. Discoveries dossier H8 captures this trade-off
  // and points at the proper long-term fix (a retryable backfill from
  // form_submission rows when the notif row is missing) as an ADR 0043
  // follow-up rather than a posture flip here.
  if (outcome.status === 'ok') {
    phase = 'notification-fanout';
    try {
      const database = db(c.env);
      const collaboratorRows = await database
        .select({ customerId: siteCollaborator.customerId })
        .from(siteCollaborator)
        .where(
          and(eq(siteCollaborator.siteId, siteId), isNotNull(siteCollaborator.acceptedAt)),
        );
      const collaboratorIds = collaboratorRows.map((r) => r.customerId);
      const recipientIds = Array.from(
        new Set<string>([outcome.notificationContext.siteOwnerCustomerId, ...collaboratorIds]),
      );
      const spec = buildSiteNotif(
        'form_submission',
        siteId,
        {
          siteId,
          siteName: outcome.notificationContext.siteName,
          formElementId,
          formElementLabel: outcome.notificationContext.formElementLabel,
          pageSlug: outcome.notificationContext.pageSlug,
          submissionId: outcome.submissionId,
          submittedAt: outcome.notificationContext.submittedAt,
        },
        recipientIds,
      );
      await writeNotification({ db: database, env: c.env }, spec);
    } catch (err) {
      console.error('[forms/route] form_submission notif write failed', {
        siteId,
        formElementId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      });
    }
  }

    phase = 'outcomeToResponse';
    return outcomeToResponse(c, outcome, siteId, formElementId, rawFields);
  } catch (err) {
    // Loud structured 500: tells the operator which phase threw, what the
    // message was, and includes a fragment of the stack. Pass-8 retest's
    // bare "Internal Server Error" gave zero triage signal; this body
    // surfaces the actual failing step so the next iteration knows
    // whether to look at handleFormSubmit, Turnstile verification, the
    // outcome serialiser, or somewhere upstream.
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.slice(0, 1500) : undefined;
    console.error('[forms/route] form-submit uncaught throw', {
      siteId,
      formElementId,
      phase,
      message,
      stack,
    });
    return c.json(
      {
        error: 'form-submit failed',
        phase,
        detail: message,
      },
      500,
    );
  }
});

function pickStringField(
  fields: Record<string, string | string[]>,
  key: string,
  fallback: string,
): string {
  const value = fields[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return fallback;
}

async function collectFormFields(
  request: Request,
): Promise<Record<string, string | string[]>> {
  const contentType = request.headers.get('content-type') ?? '';
  // `request.formData()` handles both multipart/form-data and
  // application/x-www-form-urlencoded transparently — Workers' Request
  // implementation routes to the right parser.
  if (
    !contentType.startsWith('multipart/form-data') &&
    !contentType.startsWith('application/x-www-form-urlencoded')
  ) {
    // The route layer rejects other content types loudly. JSON POSTs to this
    // endpoint are NOT supported — the visitor's browser always uses one of
    // the form-encoded shapes.
    throw new Error(
      `[forms/route] unsupported content-type for visitor submit: ${contentType}`,
    );
  }
  const formData = await request.formData();
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    const v = typeof value === 'string' ? value : '';
    const existing = out[key];
    if (existing === undefined) {
      out[key] = v;
    } else if (Array.isArray(existing)) {
      existing.push(v);
    } else {
      out[key] = [existing, v];
    }
  }
  return out;
}

function outcomeToResponse(
  c: Context<Env>,
  outcome: SubmitOutcome,
  siteId: string,
  formElementId: string,
  rawFields: Record<string, string | string[]>,
): Response {
  const pageSlug = pickStringField(rawFields, 'pageSlug', '');
  switch (outcome.status) {
    case 'ok': {
      // 303 — see other. The Visitor's POST is converted to a GET.
      const target = `/${encodeURIComponent(pageSlug)}?form-ok=${encodeURIComponent(formElementId)}`;
      return c.redirect(target, 303);
    }
    case 'site-not-found':
    case 'form-not-found':
    case 'form-not-published':
      return c.json({ error: outcome.status }, 404);
    case 'rate-limited-ip':
      return c.json(
        {
          error: 'rate-limited',
          scope: 'ip',
          remaining: outcome.remaining,
          windowStartMs: outcome.windowStartMs,
        },
        429,
      );
    case 'rate-limited-form':
      return c.json(
        { error: 'rate-limited', scope: 'form', cap: outcome.cap, periodMs: outcome.periodMs },
        429,
      );
    case 'turnstile-failed':
      return c.json({ error: 'turnstile-failed', reason: outcome.reason }, 403);
    case 'validation-failed':
      return c.json({ error: 'validation-failed', fieldErrors: outcome.fieldErrors }, 400);
    case 'siteverify-unreachable':
      return c.json({ error: 'siteverify-unreachable', message: outcome.message }, 502);
  }
}

// ---------------------------------------------------------------------------
// Owner routes — wrapped in Clerk auth + site ownership.
// ---------------------------------------------------------------------------

const ownerRoutes = new Hono<Env>();
ownerRoutes.use('*', clerkAuth());
ownerRoutes.use('*', requireAuth());

async function ensureOwnedSite(c: Context<Env>, siteId: string): Promise<boolean> {
  const auth = c.get('auth');
  if (!auth.userId) return false;
  const database = db(c.env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return false;

  const siteRow = await database
    .select({ id: siteTable.id })
    .from(siteTable)
    .where(and(eq(siteTable.id, siteId), eq(siteTable.customerId, customerId)))
    .limit(1);
  return Boolean(siteRow[0]);
}

async function loadFormElement(
  c: Context<Env>,
  siteId: string,
  formElementId: string,
): Promise<FormElement | null> {
  const database = db(c.env);
  const rows = await database
    .select({ publishedSnapshot: siteTable.publishedSnapshot, editableState: siteTable.editableState })
    .from(siteTable)
    .where(eq(siteTable.id, siteId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Owner inbox prefers the editableState (works pre-publish) and falls
  // back to the published snapshot so an Owner who's already published
  // can still see the inbox without re-saving.
  const fromEditable = walkForForm(row.editableState, formElementId);
  if (fromEditable) return fromEditable;
  if (row.publishedSnapshot) {
    return walkForForm(row.publishedSnapshot, formElementId);
  }
  return null;
}

function walkForForm(
  source: { pages: CanvasPage[] },
  formElementId: string,
): FormElement | null {
  for (const page of source.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.type === 'form' && element.id === formElementId) {
          return element;
        }
      }
    }
  }
  return null;
}

ownerRoutes.get('/:siteId/:formElementId/submissions', async (c) => {
  const siteId = c.req.param('siteId');
  const formElementId = c.req.param('formElementId');
  if (!siteId || !formElementId) {
    return c.json({ error: 'siteId and formElementId required' }, 400);
  }
  if (!(await ensureOwnedSite(c, siteId))) {
    return c.json({ error: 'site not found' }, 404);
  }
  const cursor = c.req.query('cursor');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  const result = await listFormSubmissions(db(c.env), {
    siteId,
    formElementId,
    ...(cursor ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  return c.json({
    rows: result.rows.map((r) => ({
      ...r,
      submittedAt: r.submittedAt.toISOString(),
    })),
    nextCursor: result.nextCursor,
  });
});

ownerRoutes.get('/:siteId/:formElementId/export.csv', async (c) => {
  const siteId = c.req.param('siteId');
  const formElementId = c.req.param('formElementId');
  if (!siteId || !formElementId) {
    return c.json({ error: 'siteId and formElementId required' }, 400);
  }
  if (!(await ensureOwnedSite(c, siteId))) {
    return c.json({ error: 'site not found' }, 404);
  }
  const form = await loadFormElement(c, siteId, formElementId);
  if (!form) {
    return c.json({ error: 'form not found' }, 404);
  }
  const csv = await exportFormSubmissionsCsv(db(c.env), {
    siteId,
    formElementId,
    fields: form.fields,
  });
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="form-${formElementId}.csv"`,
    },
  });
});

router.route('/', ownerRoutes);

export default router;
