// src/agent/chat/route.ts
//
// Hono router for the chat command surface. Two endpoints:
//
//   POST /:siteId/chat
//     Owner-gated. Accepts `{ sessionId?: string, message: string }`. Creates
//     a new chat_session row when `sessionId` is omitted, otherwise loads the
//     row and appends. Drives one orchestrator turn against the live
//     EditableSite. Streams SSE events to the response.
//
//   GET /:siteId/chat/stream?sessionId=<id>
//     Owner-gated. Streams SSE events for the already-running session. The
//     POST endpoint emits its own SSE stream as the canonical channel; this
//     GET variant exists for clients that re-attach after a disconnect.
//     Returns the current session messages as a single bulk `session` event
//     followed by `done`.
//
// The route is mounted by the main thread at `/api/sites/:siteId/chat` —
// the parent prefix carries `:siteId`. We export `default` and let the
// integrator wire it up.
//
// Failure handling follows the repo policy: every translation error, LLM
// error, or DB error fails LOUD via an SSE `error` event followed by
// `done`. The HTTP response itself stays 200 because SSE clients cannot
// see status-codes after the first byte goes out.

import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { loadAccessibleSite } from '../../auth/accessible-site.js';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { GeminiAdapter } from '../llm-gemini.js';
import { db } from '../../db/client.js';
import {
  customer,
  ownerAsset,
  siteFont,
  type SiteFont,
} from '../../db/schema.js';
import type { EditableSite, StyleKit } from '../../canvas/schema.js';
import {
  buildSystemPrompt,
  runChatTurn,
  type OrchestratorContext,
  type OwnerAssetRef,
} from './orchestrator.js';
import {
  createSession,
  loadLatestOpenSession,
  loadSession,
  saveMessages,
  type ChatSessionState,
} from './session.js';
import { SseStreamWriter } from './stream.js';
import { checkAiRateLimit, aiRateLimitRetryAfterSeconds } from '../../billing/ai-rate-limit.js';
import type { FormRateLimiterDoNamespace } from '../../password/rate-limit.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
  REPLICATE_API_TOKEN: string;
  // Shared FormRateLimiter DO — enforces the per-account AI cap (ai-agent
  // bucket) before each chat turn. Fails closed when missing.
  FORM_RATE_LIMITER: FormRateLimiterDoNamespace;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const chatApi = new Hono<Env>();
chatApi.use('*', clerkAuth());
chatApi.use('*', requireAuth());

// ---------------------------------------------------------------------------
// Access lookup — both endpoints require the caller to reach the site at
// the `editor` tier (site owner OR accepted collaborator with role
// `editor`). Viewers cannot chat with the assistant because every turn can
// emit `apply` tool-calls that mutate editableState.
//
// Two distinct customer ids matter inside a chat turn:
//
//   - `siteOwnerCustomerId` (= accessibleSite.customerId) — the owner's
//     customer.id. Used to load the asset library, which lives on the
//     OWNER's account; a collaborator chatting on someone else's site
//     references the owner's assets, not their own.
//
//   - `callerCustomerId` — the calling Clerk user's customer.id. Used to
//     scope chat sessions. Each collaborator has their own conversation
//     history per site (chat_session is per (site_id, customer_id) — see
//     `src/db/schema.ts` chatSession comment).
//
// `loadAccessibleSite` returns site state but not the caller's customer
// row; the second SELECT below resolves it. Both fail with 404 to avoid
// leaking the site's existence.
// ---------------------------------------------------------------------------

interface OwnedSiteRow {
  id: string;
  /** Caller's customer.id — scopes chat sessions per collaborator. */
  callerCustomerId: string;
  /** Site owner's customer.id — scopes the asset library load. */
  siteOwnerCustomerId: string;
  styleKit: StyleKit;
  editableState: EditableSite;
  fonts: SiteFont[];
  assets: OwnerAssetRef[];
}

async function loadOwnedSiteWithFonts(
  c: Context<Env>,
  siteId: string,
): Promise<OwnedSiteRow | null> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('chat api reached without an authenticated user');
  }
  // Pin auth.userId locally so closure capture sees a non-null type (the
  // narrowing on `auth.userId` is lost inside the inline lookup IIFE).
  const clerkUserId = auth.userId;
  const database = db(c.env);
  let callerCustomerId: string | undefined = c.get('customer')?.id;
  if (!callerCustomerId) {
    const rows = await database
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.clerkUserId, clerkUserId))
      .limit(1);
    callerCustomerId = rows[0]?.id;
  }
  if (!callerCustomerId) return null;

  const accessible = await loadAccessibleSite(
    database,
    clerkUserId,
    siteId,
    'editor',
    callerCustomerId,
  );
  if (!accessible) return null;

  const fonts = await database
    .select()
    .from(siteFont)
    .where(eq(siteFont.siteId, siteId));

  const assetRows = await database
    .select({
      id: ownerAsset.id,
      kind: ownerAsset.kind,
      alt: ownerAsset.alt,
      contentHash: ownerAsset.contentHash,
      width: ownerAsset.width,
      height: ownerAsset.height,
    })
    .from(ownerAsset)
    .where(eq(ownerAsset.customerId, accessible.customerId))
    .limit(200);

  return {
    id: accessible.id,
    callerCustomerId,
    siteOwnerCustomerId: accessible.customerId,
    styleKit: accessible.styleKit,
    editableState: accessible.editableState,
    fonts,
    assets: assetRows,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// POST /:siteId/chat — send a message; streams SSE.
// ---------------------------------------------------------------------------

chatApi.post('/:siteId/chat', async (c) => {
  const siteId = c.req.param('siteId');
  const row = await loadOwnedSiteWithFonts(c, siteId);
  if (!row) return c.json({ error: 'site not found' }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (!isRecord(body) || typeof body.message !== 'string' || body.message.length === 0) {
    return c.json(
      { error: 'body must be { message: string, sessionId?: string, selectedElementId?: string }' },
      400,
    );
  }
  const userMessage = body.message;
  const requestedSessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
  const selectedElementId =
    typeof body.selectedElementId === 'string' && body.selectedElementId.length > 0
      ? body.selectedElementId
      : undefined;

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    return c.json({ error: 'GEMINI_API_KEY not configured' }, 500);
  }

  const aiLimit = await checkAiRateLimit(
    c.env.FORM_RATE_LIMITER,
    row.callerCustomerId,
    'ai-agent',
  );
  if (!aiLimit.allowed) {
    const retryAfter = aiRateLimitRetryAfterSeconds(aiLimit);
    return c.json(
      {
        error: 'AI usage limit reached for your account. Try again later.',
        retryAfterSeconds: retryAfter,
      },
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }

  // Load or create the session row up-front so we can emit the sessionId as
  // the first SSE event. Sessions are scoped to (site, caller-customer) —
  // collaborators get their own conversation history per site, not the
  // owner's.
  const env = { DATABASE_URL: c.env.DATABASE_URL };
  let session: ChatSessionState | null = null;
  if (requestedSessionId) {
    session = await loadSession(env, requestedSessionId);
    if (!session) return c.json({ error: 'session not found' }, 404);
    if (session.siteId !== row.id || session.customerId !== row.callerCustomerId) {
      return c.json({ error: 'session belongs to another (site, customer)' }, 403);
    }
  } else {
    session = await createSession(env, row.id, row.callerCustomerId, []);
  }

  const sessionRef = session;
  return streamSSE(c, async (stream) => {
    const writer = new SseStreamWriter(stream);
    await writer.write({ kind: 'session', sessionId: sessionRef.id });

    const adapter = new GeminiAdapter({ apiKey });
    const replicateToken = c.env.REPLICATE_API_TOKEN;
    const ctx: OrchestratorContext = {
      adapter,
      state: row.editableState,
      fonts: row.fonts,
      assets: row.assets,
      ...(selectedElementId ? { selectedElementId } : {}),
      ...(typeof replicateToken === 'string' && replicateToken.length > 0
        ? { replicateToken }
        : {}),
      imageRateLimit: async () => {
        const r = await checkAiRateLimit(
          c.env.FORM_RATE_LIMITER,
          row.siteOwnerCustomerId,
          'ai-image',
        );
        return { allowed: r.allowed, retryAfterMs: r.retryAfterMs };
      },
      systemInstruction: buildSystemPrompt(row.editableState, selectedElementId),
    };

    // Capture the baseline message count BEFORE the turn so saveMessages can
    // detect a concurrent-tab race per ADR 0048 decision 4. If another tab's
    // write lands between this capture and our UPDATE, the persisted length
    // will exceed the baseline and the warn-log fires.
    const baselineMessageLength = sessionRef.messages.length;
    try {
      const result = await runChatTurn({
        session: sessionRef,
        userMessage,
        writer,
        ctx,
      });
      await saveMessages(env, sessionRef.id, result.messages, baselineMessageLength);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await writer.write({ kind: 'error', error: `chat turn failed: ${message}` });
      await writer.write({ kind: 'done', reason: 'other' });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /:siteId/chat/stream — re-attach to an existing session, replay
// history, then close. Used when the client lost the POST stream.
// ---------------------------------------------------------------------------

chatApi.get('/:siteId/chat/stream', async (c) => {
  const siteId = c.req.param('siteId');
  const row = await loadOwnedSiteWithFonts(c, siteId);
  if (!row) return c.json({ error: 'site not found' }, 404);

  const sessionId = c.req.query('sessionId');
  if (!sessionId) return c.json({ error: 'sessionId query param required' }, 400);

  const env = { DATABASE_URL: c.env.DATABASE_URL };
  let session: ChatSessionState | null;
  if (sessionId === 'latest') {
    session = await loadLatestOpenSession(env, row.id, row.callerCustomerId);
  } else {
    session = await loadSession(env, sessionId);
  }
  if (!session) return c.json({ error: 'session not found' }, 404);
  if (session.siteId !== row.id || session.customerId !== row.callerCustomerId) {
    return c.json({ error: 'session belongs to another (site, customer)' }, 403);
  }

  const sessionRef = session;
  return streamSSE(c, async (stream) => {
    const writer = new SseStreamWriter(stream);
    await writer.write({ kind: 'session', sessionId: sessionRef.id });
    for (const msg of sessionRef.messages) {
      if (msg.role === 'assistant' && msg.content.length > 0) {
        await writer.write({ kind: 'token', text: msg.content });
      }
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const call of msg.toolCalls) {
          await writer.write({
            kind: 'tool-call',
            id: call.id,
            name: call.name,
            args: call.arguments,
          });
        }
      }
    }
    await writer.write({ kind: 'done', reason: 'stop' });
  });
});

export default chatApi;
