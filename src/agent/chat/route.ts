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

import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { GeminiAdapter } from '../llm-gemini.js';
import { db } from '../../db/client.js';
import {
  customer,
  ownerAsset,
  site,
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

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
  REPLICATE_API_TOKEN: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const chatApi = new Hono<Env>();
chatApi.use('*', clerkAuth());
chatApi.use('*', requireAuth());

// ---------------------------------------------------------------------------
// Ownership lookup — same shape as canvas-agent route.
// ---------------------------------------------------------------------------

interface OwnedSiteRow {
  id: string;
  customerId: string;
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
  const database = db(c.env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return null;

  const siteRow = await database
    .select({
      id: site.id,
      styleKit: site.styleKit,
      editableState: site.editableState,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = siteRow[0];
  if (!row) return null;

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
    .where(eq(ownerAsset.customerId, customerId))
    .limit(200);

  return {
    id: row.id,
    customerId,
    styleKit: row.styleKit,
    editableState: row.editableState,
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

  // Load or create the session row up-front so we can emit the sessionId as
  // the first SSE event.
  const env = { DATABASE_URL: c.env.DATABASE_URL };
  let session: ChatSessionState | null = null;
  if (requestedSessionId) {
    session = await loadSession(env, requestedSessionId);
    if (!session) return c.json({ error: 'session not found' }, 404);
    if (session.siteId !== row.id || session.customerId !== row.customerId) {
      return c.json({ error: 'session belongs to another (site, customer)' }, 403);
    }
  } else {
    session = await createSession(env, row.id, row.customerId, []);
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
    session = await loadLatestOpenSession(env, row.id, row.customerId);
  } else {
    session = await loadSession(env, sessionId);
  }
  if (!session) return c.json({ error: 'session not found' }, 404);
  if (session.siteId !== row.id || session.customerId !== row.customerId) {
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
