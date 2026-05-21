// POST /api/agent/edit — agent driver endpoint.
//
// Auth-gates via Clerk, verifies ownership (page -> site -> customer ->
// clerk user), loads the current page.doc, runs the orchestrator with the
// GeminiAdapter, and streams agent events back to the browser as NDJSON
// (Content-Type: application/x-ndjson).
//
// Each tool_call event from the orchestrator is applied by hitting the
// PageDocument DO at /__agent/apply with X-Agent-Secret. The DO then
// applies the op at clientID = 1 and broadcasts the resulting Yjs update
// to every connected WebSocket — including the editor in the browser tab
// that triggered the agent in the first place.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { db } from '../../db/client';
import { customer, page, site } from '../../db/schema';
import { GeminiAdapter } from '../../agent/llm-gemini';
import { runAgent, type AgentEvent } from '../../agent/orchestrator';
import type { DocOp } from '../../agent/ops';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
  AGENT_RPC_SECRET: string;
  PAGE_DO: DurableObjectNamespace;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const agent = new Hono<Env>();

agent.use('*', clerkAuth());

interface EditBody {
  pageId?: string;
  message?: string;
}

agent.post('/edit', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    return c.text('unauthorized', 401);
  }

  let body: EditBody;
  try {
    body = await c.req.json<EditBody>();
  } catch {
    return c.text('invalid json', 400);
  }
  const pageId = body.pageId;
  const message = body.message;
  if (!pageId || !message) {
    return c.text('missing pageId or message', 400);
  }

  // Ownership chain.
  const database = db(c.env);
  const rows = await database
    .select({ doc: page.doc })
    .from(page)
    .innerJoin(site, eq(site.id, page.siteId))
    .innerJoin(customer, eq(customer.id, site.customerId))
    .where(and(eq(page.id, pageId), eq(customer.clerkUserId, auth.userId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return c.text('page not found or not owned by current user', 404);
  }

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.text('GEMINI_API_KEY not configured', 500);
  }
  const agentSecret = c.env.AGENT_RPC_SECRET;
  if (!agentSecret) {
    return c.text('AGENT_RPC_SECRET not configured', 500);
  }

  const currentDoc = row.doc;
  const llm = new GeminiAdapter({ apiKey });
  const doStub = c.env.PAGE_DO.get(c.env.PAGE_DO.idFromName(pageId));

  const applyOp = async (op: DocOp): Promise<void> => {
    const res = await doStub.fetch('https://do.invalid/__agent/apply', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-secret': agentSecret,
      },
      body: JSON.stringify({ pageId, op }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DO __agent/apply failed: ${String(res.status)} ${text}`);
    }
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const writeEvent = (event: AgentEvent): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        for await (const event of runAgent({
          pageId,
          message,
          currentDoc,
          applyOp,
          llm,
        })) {
          writeEvent(event);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeEvent({ type: 'error', message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache, no-transform',
      'x-content-type-options': 'nosniff',
    },
  });
});

export default agent;
