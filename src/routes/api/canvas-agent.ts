// src/routes/api/canvas-agent.ts
//
// HTTP endpoints for the Canvas AI flow (T7). Two routes:
//
//   POST /api/canvas-agent/sites/:siteId/preview
//     Owner-gated. Loads the site, calls Gemini with the constrained tool
//     definitions, translates tool calls into CanvasAgentOps, dry-runs them
//     through `applyCanvasAgentOp`, revalidates with `validateEditableSite`,
//     verifies any referenced asset ids belong to the site, and returns
//     `{ previewId, ops, previewState }`. The endpoint NEVER mutates the
//     stored editableState.
//
//   POST /api/canvas-agent/sites/:siteId/apply
//     Owner-gated. Accepts `{ ops }` and re-applies the entire sequence from
//     scratch against the freshly loaded editableState. It does not trust
//     the previewState the caller may have seen — apply revalidates and
//     re-checks asset ownership. On success it writes the new editableState
//     and returns `{ ok: true, editableState }`.
//
// Failure handling follows the repo policy: missing GEMINI_API_KEY → loud
// 500, validation failure → 400 with the full error list, unknown tool name
// or unknown asset → 400 with the bad value in the message body. No silent
// fallbacks.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { GeminiAdapter } from '../../agent/llm-gemini';
import type { LlmAssistantToolCall, LlmMessage, LlmTool } from '../../agent/llm';
import { CANVAS_AGENT_TOOLS } from '../../agent/canvas-tools';
import { applyCanvasAgentOp, type CanvasAgentOp } from '../../agent/canvas-ops';
import { translateToolCall, parseApplyOp, isRecord } from '../../agent/tool-parsers';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { collectReferencedAssetIds, findAssetReferenceErrors } from '../../assets/site-assets';
import {
  type EditableSite,
  type StyleKit,
} from '../../canvas/schema';
import { validateEditableSite } from '../../canvas/validate';
import { db } from '../../db/client';
import { customer, ownerAsset, site } from '../../db/schema';
import { broadcastEditableStateReplaced } from './canvas';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
  // Apply writes to `editable_state` must broadcast `editable-state-replaced`
  // to SiteRoom; otherwise a connected editor's autosave will encode its
  // stale Y.Doc back to Postgres and silently revert the agent's write.
  // Mirror of the binding canvas.ts uses for the same reason (canvas.ts:127).
  SITE_ROOM: DurableObjectNamespace;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const CANVAS_AGENT_MODEL = 'gemini-2.5-pro';

const canvasAgentApi = new Hono<Env>();

canvasAgentApi.use('*', clerkAuth());
canvasAgentApi.use('*', requireAuth());

interface OwnedSiteRow {
  id: string;
  customerId: string;
  styleKit: StyleKit;
  editableState: EditableSite;
}

async function loadOwnedSite(c: Context<Env>, siteId: string): Promise<OwnedSiteRow | null> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('canvas-agent api reached without an authenticated user');
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
  return {
    id: row.id,
    customerId,
    styleKit: row.styleKit,
    editableState: row.editableState,
  };
}

// ---------------------------------------------------------------------------
// Shared apply-the-ops pipeline. Returns either a new editableState or a
// structured error the route maps onto a 400.
// ---------------------------------------------------------------------------

type PipelineResult =
  | { ok: true; next: EditableSite }
  | { ok: false; status: 400; error: string; errors?: string[] };

async function runOpsPipeline(
  c: Context<Env>,
  row: OwnedSiteRow,
  ops: CanvasAgentOp[],
): Promise<PipelineResult> {
  // Apply each op in order. Catch loudly — applyCanvasAgentOp throws on
  // unknown elements / unknown recipes / bad shapes.
  let next: EditableSite = row.editableState;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!op) continue;
    try {
      next = applyCanvasAgentOp(next, op);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, error: `op[${String(i)}] failed: ${message}` };
    }
  }

  // Revalidate the whole result. Apply does not validate; the caller MUST.
  const validation = validateEditableSite(next);
  if (!validation.valid) {
    return {
      ok: false,
      status: 400,
      error: 'preview state failed validation',
      errors: validation.errors,
    };
  }

  // Verify every media asset reference in the resulting state belongs to
  // this Owner and matches the media element's expected kind. Per ADR 0004
  // the asset root is the Owner, not the site — so two sites under the
  // same Owner can share assets. The scoping below honours that.
  const referencedAssetIds = collectReferencedAssetIds(next);
  if (referencedAssetIds.size > 0) {
    const database = db(c.env);
    const rows = await database
      .select({ id: ownerAsset.id, kind: ownerAsset.kind })
      .from(ownerAsset)
      .where(
        and(
          eq(ownerAsset.customerId, row.customerId),
          inArray(ownerAsset.id, [...referencedAssetIds]),
        ),
      );
    const referenceErrors = findAssetReferenceErrors(next, rows);
    const missing = referenceErrors.filter((error) => error.reason === 'missing');
    if (missing.length > 0) {
      return {
        ok: false,
        status: 400,
        error: `canvas agent references unknown asset id(s): ${missing.map((error) => error.assetId).join(', ')}`,
      };
    }
    const mismatched = referenceErrors.filter((error) => error.reason === 'kind-mismatch');
    if (mismatched.length > 0) {
      return {
        ok: false,
        status: 400,
        error: `canvas agent asset kind mismatch: ${mismatched
          .map(
            (error) =>
              `${error.assetId} expected ${error.expectedKind} but row is ${error.actualKind}`,
          )
          .join('; ')}`,
      };
    }
  }
  return { ok: true, next };
}

// ---------------------------------------------------------------------------
// System prompt for the preview LLM call. We list every section + every
// element with its id and type so the model can reference them by id when
// it picks a tool call. Keep the prompt short and structural — the LLM does
// the creative work, the prompt nails down the canvas shape.
// ---------------------------------------------------------------------------

function buildSystemPrompt(state: EditableSite): string {
  const lines: string[] = [];
  lines.push('You are an editing assistant for the rev01 canvas site builder.');
  lines.push(
    'Use only the supplied tools. Do NOT invent asset ids, element ids, section ids, or page ids; pick from the existing ones below.',
  );
  lines.push(`Current style kit: ${state.styleKit}.`);

  // Enumerate header
  if (state.header) {
    lines.push(`Header section ${state.header.id} (name=${JSON.stringify(state.header.name)}, height=${String(state.header.height)}):`);
    for (const element of state.header.elements) {
      lines.push(`  - element ${element.id} type=${element.type}`);
    }
  }

  // Enumerate pages and sections
  for (const page of state.pages) {
    lines.push(
      `Page id: ${page.id} (slug=${page.slug}, title=${JSON.stringify(page.title)}, width=${String(page.width)}).`,
    );
    for (const section of page.sections) {
      lines.push(
        `Section ${section.id} (recipe=${section.recipeId}, name=${JSON.stringify(section.name)}, height=${String(section.height)}):`,
      );
      for (const element of section.elements) {
        lines.push(`  - element ${element.id} type=${element.type}`);
      }
    }
  }

  // Enumerate footer
  if (state.footer) {
    lines.push(`Footer section ${state.footer.id} (name=${JSON.stringify(state.footer.name)}, height=${String(state.footer.height)}):`);
    for (const element of state.footer.elements) {
      lines.push(`  - element ${element.id} type=${element.type}`);
    }
  }

  lines.push('');
  lines.push('Tools:');
  lines.push('  rewriteText — rewrite text element content. content must be InlineRun[] (never a plain string).');
  lines.push('  replaceMedia — swap a media element to an existing uploaded asset.');
  lines.push('  designSection — create a new section from a semantic layout tree (stack/grid/split nodes with element leaves).');
  lines.push('  updateElement — change properties of an existing element. Pass elementType matching the actual type.');
  lines.push('  deleteElement — remove an element from its section.');
  lines.push('  addElement — add a new element to a section. Auto-placed below existing content unless box is specified.');
  lines.push('  updateSection — change section name, height, background effect, or entrance animation.');
  lines.push('  deleteSection — remove a section. Can delete header/footer (removes site-wide). Cannot delete the last section on a page.');
  lines.push('  moveSection — move a body section. Pass afterSectionId (empty string = move to top). Cannot move header/footer.');
  lines.push('  duplicateSection — clone a body section with new IDs.');
  lines.push('  addPage — create a new page with title and slug.');
  lines.push('  updatePage — update page title, slug, SEO description, noIndex, locale, and other metadata.');
  lines.push('  deletePage — remove a page. Cannot delete the last page.');
  lines.push('  setStyleKit — switch to a built-in style kit (charcoal, orange-editorial, blue-saas, green-organic).');
  lines.push("  setSiteConfig — set visitorTheme ('light' | 'dark' | 'toggleable'), defaultLocale, or siteNoIndex.");

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// POST /sites/:siteId/preview
// ---------------------------------------------------------------------------

canvasAgentApi.post('/sites/:siteId/preview', async (c) => {
  const siteId = c.req.param('siteId');
  const row = await loadOwnedSite(c, siteId);
  if (!row) return c.json({ error: 'site not found' }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (!isRecord(body) || typeof body.prompt !== 'string' || body.prompt.length === 0) {
    return c.json({ error: 'body must be { prompt: string }' }, 400);
  }

  const apiKey = c.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    return c.json({ error: 'GEMINI_API_KEY not configured' }, 503);
  }

  const messages: LlmMessage[] = [{ role: 'user', content: body.prompt }];
  const tools: LlmTool[] = CANVAS_AGENT_TOOLS;
  const adapter = new GeminiAdapter({ apiKey });

  // Drain the stream into a flat list of tool calls. The preview path doesn't
  // need the LLM to think across multiple turns — every op the LLM emits in
  // one call gets dry-run together. If the model returns text only and no
  // tool calls, we surface that as a no-op preview (the editor can decide
  // whether to show the text or just dismiss).
  const toolCalls: LlmAssistantToolCall[] = [];
  let assistantText = '';
  try {
    for await (const chunk of adapter.chatWithTools(messages, {
      model: CANVAS_AGENT_MODEL,
      tools,
      systemInstruction: buildSystemPrompt(row.editableState),
      temperature: 0.2,
    })) {
      if (chunk.type === 'text') {
        assistantText += chunk.text;
      } else if (chunk.type === 'tool_call') {
        toolCalls.push({ id: chunk.id, name: chunk.name, arguments: chunk.arguments });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `LLM call failed: ${message}` }, 500);
  }

  // Translate each tool call into a CanvasAgentOp.
  const ops: CanvasAgentOp[] = [];
  for (const call of toolCalls) {
    const parsed = translateToolCall(call);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, 400);
    }
    ops.push(parsed.op);
  }

  // No tool calls — surface the model's text response so the editor can show
  // it. previewState mirrors current editableState (no changes).
  if (ops.length === 0) {
    return c.json({
      previewId: crypto.randomUUID(),
      ops: [],
      previewState: row.editableState,
      text: assistantText,
    });
  }

  const pipeline = await runOpsPipeline(c, row, ops);
  if (!pipeline.ok) {
    return c.json(
      pipeline.errors
        ? { error: pipeline.error, errors: pipeline.errors }
        : { error: pipeline.error },
      pipeline.status,
    );
  }

  return c.json({
    previewId: crypto.randomUUID(),
    ops,
    previewState: pipeline.next,
    text: assistantText,
  });
});

// ---------------------------------------------------------------------------
// POST /sites/:siteId/apply
// ---------------------------------------------------------------------------

canvasAgentApi.post('/sites/:siteId/apply', async (c) => {
  const siteId = c.req.param('siteId');
  const row = await loadOwnedSite(c, siteId);
  if (!row) return c.json({ error: 'site not found' }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  // Accept three wire shapes:
  //
  //   (1) `{ ops: [{ kind, ...payload }, ...] }`  — canonical CanvasAgentOp shape.
  //   (2) `{ ops: [{ tool, params }, ...] }`      — legacy LLM-tool-call shape;
  //                                                  translated via translateToolCall.
  //   (3) `{ tool, params }`                       — legacy single tool call as
  //                                                  the whole body; wrapped + translated.
  //
  // Shapes (2) and (3) are byte-equivalent to a canonical op produced by the
  // same translator the preview path uses (`translateToolCall`), so accepting
  // them is shape coercion at a boundary, not a degraded fallback. An unknown
  // tool name from shape (2)/(3) still fails loud with the translator's error.
  let opsCandidate: unknown[];
  if (isRecord(body) && Array.isArray(body.ops)) {
    opsCandidate = body.ops;
  } else if (isRecord(body) && typeof body.tool === 'string') {
    opsCandidate = [body];
  } else {
    return c.json({ error: 'body must be { ops: CanvasAgentOp[] }' }, 400);
  }

  // Slug→id lookup used to normalise legacy deletePage payloads. Pass-8
  // retest showed the LLM and the chat client both sometimes emit
  // `params: { pageSlug: 'customers' }` instead of `params: { pageId:
  // 'page-wf-customers' }`. The tool schema says pageId is required;
  // tightening the model prompt would not catch every flake. Resolving
  // here means the apply layer keeps its single canonical shape while
  // the wire boundary tolerates either field.
  const slugToPageId = new Map<string, string>();
  for (const page of row.editableState.pages) {
    if (typeof page.slug === 'string' && page.slug.length > 0) {
      slugToPageId.set(page.slug, page.id);
    }
  }
  function normalisePageRef(candidate: unknown): unknown {
    if (!isRecord(candidate)) return candidate;
    // Canonical shape with a stray pageSlug instead of pageId.
    if (
      candidate.kind === 'deletePage' &&
      typeof (candidate as { pageSlug?: unknown }).pageSlug === 'string' &&
      typeof (candidate as { pageId?: unknown }).pageId !== 'string'
    ) {
      const slug = (candidate as { pageSlug: string }).pageSlug;
      const resolved = slugToPageId.get(slug);
      if (resolved) {
        const next = { ...candidate, pageId: resolved };
        delete (next as { pageSlug?: unknown }).pageSlug;
        return next;
      }
    }
    // Legacy tool shape with params.pageSlug.
    if (
      candidate.tool === 'deletePage' &&
      isRecord(candidate.params) &&
      typeof (candidate.params as { pageSlug?: unknown }).pageSlug === 'string' &&
      typeof (candidate.params as { pageId?: unknown }).pageId !== 'string'
    ) {
      const slug = (candidate.params as { pageSlug: string }).pageSlug;
      const resolved = slugToPageId.get(slug);
      if (resolved) {
        const nextParams = { ...candidate.params, pageId: resolved };
        delete (nextParams as { pageSlug?: unknown }).pageSlug;
        return { ...candidate, params: nextParams };
      }
    }
    return candidate;
  }

  const ops: CanvasAgentOp[] = [];
  for (let i = 0; i < opsCandidate.length; i++) {
    const candidate = normalisePageRef(opsCandidate[i]);
    const isLegacyToolShape =
      isRecord(candidate) &&
      typeof candidate.tool === 'string' &&
      candidate.kind === undefined;
    const parsed = isLegacyToolShape
      ? translateToolCall({
          id: '',
          name: (candidate as { tool: string }).tool,
          arguments: isRecord((candidate as { params?: unknown }).params)
            ? ((candidate as { params: Record<string, unknown> }).params)
            : {},
        })
      : parseApplyOp(candidate, row.styleKit);
    if (!parsed.ok) {
      return c.json({ error: `ops[${String(i)}]: ${parsed.error}` }, 400);
    }
    ops.push(parsed.op);
  }

  const pipeline = await runOpsPipeline(c, row, ops);
  if (!pipeline.ok) {
    return c.json(
      pipeline.errors
        ? { error: pipeline.error, errors: pipeline.errors }
        : { error: pipeline.error },
      pipeline.status,
    );
  }

  const database = db(c.env);
  await database
    .update(site)
    .set({
      editableState: pipeline.next,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, row.id), eq(site.customerId, row.customerId)));

  // Without this broadcast, a connected editor's autosave path would encode
  // its hot Y.Doc back into editableState and silently revert the agent's
  // apply — visible to the Owner as a chat-driven edit that vanishes after
  // the next keystroke. Same contract as the canvas.ts PATCH broadcasts.
  try {
    await broadcastEditableStateReplaced(c.env, row.id, pipeline.next);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[canvas-agent/apply] editable-state-replaced broadcast failed', {
      siteId: row.id,
      err,
    });
    return c.json({ error: `apply saved but broadcast failed: ${message}` }, 502);
  }

  return c.json({ ok: true, editableState: pipeline.next });
});

export default canvasAgentApi;
