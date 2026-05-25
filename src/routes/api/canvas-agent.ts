// src/routes/api/canvas-agent.ts
//
// HTTP endpoints for the Canvas AI flow (T7). Two routes:
//
//   POST /api/canvas-agent/sites/:siteId/preview
//     Owner-gated. Loads the site, calls Gemini with the constrained tool
//     definitions, translates tool calls into CanvasAgentOps, dry-runs them
//     through `applyCanvasAgentOp`, revalidates with `validateCanvasSiteState`,
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
import { generateDesignSectionImages, patchAssetIds } from '../../agent/design-section-images';
import { resolveDesignSection } from '../../canvas/layout/engine';
import type { DesignSectionInput, LayoutNode, ElementNode } from '../../canvas/layout/tree';
import { isElementNode, COLOR_TOKENS, FONT_TOKENS, GAP_TOKENS, SPLIT_RATIOS, GRID_COLUMNS } from '../../canvas/layout/tree';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { collectReferencedAssetIds, findAssetReferenceErrors } from '../../assets/site-assets';
import type { RecipeFactoryInput } from '../../canvas/recipes';
import {
  ACTION_VARIANTS,
  AGENT_RECIPE_IDS,
  BACKGROUND_EFFECTS,
  ELEMENT_TYPES,
  INLINE_MARK_TYPES,
  MEDIA_KINDS,
  MOTION_PRESETS,
  SHAPE_VARIANTS,
  SURFACE_VARIANTS,
  type AgentRecipeId,
  type BackgroundEffect,
  type CanvasSiteState,
  type InlineMark,
  type InlineRun,
  type MediaKind,
  type MotionPreset,
  type StyleKit,
} from '../../canvas/schema';
import { getStyleKitPreset } from '../../canvas/style-kits';
import { validateCanvasSiteState, isAllowedHref } from '../../canvas/validate';
import { db } from '../../db/client';
import { customer, ownerAsset, site } from '../../db/schema';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const CANVAS_AGENT_MODEL = 'gemini-2.5-pro';

const canvasAgentApi = new Hono<Env>();

canvasAgentApi.use('*', clerkAuth());
canvasAgentApi.use('*', requireAuth());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

interface OwnedSiteRow {
  id: string;
  customerId: string;
  styleKit: StyleKit;
  editableState: CanvasSiteState;
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
// Tool-call to CanvasAgentOp translation. The schemas in canvas-tools.ts are
// strict but JSON-Schema enforcement at the model side is best-effort — we
// still validate every field here before letting it near the apply step.
// ---------------------------------------------------------------------------

type ParseResult = { ok: true; op: CanvasAgentOp } | { ok: false; error: string };

function parseInlineMark(value: unknown, runIdx: number, markIdx: number): InlineMark | string {
  if (!isRecord(value)) {
    return `mark[${runIdx}][${markIdx}] must be an object`;
  }
  if (!isOneOf(value.type, INLINE_MARK_TYPES)) {
    return `mark[${runIdx}][${markIdx}].type must be one of [${INLINE_MARK_TYPES.join(', ')}] (got ${JSON.stringify(value.type)})`;
  }
  if (value.type === 'link') {
    if (typeof value.href !== 'string' || value.href.length === 0) {
      return `mark[${runIdx}][${markIdx}] is a link mark but href is missing or empty`;
    }
    if (!isAllowedHref(value.href)) {
      return `mark[${runIdx}][${markIdx}] link href ${JSON.stringify(value.href)} is not allowed`;
    }
    return { type: 'link', href: value.href };
  }
  // Other mark types have no extra fields.
  return { type: value.type };
}

function parseInlineRuns(
  value: unknown,
): { ok: true; runs: InlineRun[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'content must be an array of InlineRun objects (not a string)' };
  }
  if (value.length === 0) {
    return { ok: false, error: 'content must be a non-empty array' };
  }
  const runs: InlineRun[] = [];
  const items: unknown[] = value;
  for (let i = 0; i < items.length; i++) {
    const raw: unknown = items[i];
    if (!isRecord(raw)) {
      return { ok: false, error: `content[${String(i)}] must be an object` };
    }
    const text = raw.text;
    if (typeof text !== 'string') {
      return { ok: false, error: `content[${String(i)}].text must be a string` };
    }
    const run: InlineRun = { text };
    const rawMarks = raw.marks;
    if (rawMarks !== undefined) {
      if (!Array.isArray(rawMarks)) {
        return { ok: false, error: `content[${String(i)}].marks must be an array when present` };
      }
      const marks: InlineMark[] = [];
      const markItems: unknown[] = rawMarks;
      for (let m = 0; m < markItems.length; m++) {
        const parsed = parseInlineMark(markItems[m], i, m);
        if (typeof parsed === 'string') return { ok: false, error: parsed };
        marks.push(parsed);
      }
      run.marks = marks;
    }
    runs.push(run);
  }
  return { ok: true, runs };
}

function parseRewriteText(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'rewriteText arguments must be an object' };
  if (typeof args.elementId !== 'string' || args.elementId.length === 0) {
    return { ok: false, error: 'rewriteText.elementId must be a non-empty string' };
  }
  const parsed = parseInlineRuns(args.content);
  if (!parsed.ok) return { ok: false, error: `rewriteText.${parsed.error}` };
  return {
    ok: true,
    op: { kind: 'rewriteText', elementId: args.elementId, content: parsed.runs },
  };
}

function parseReplaceMedia(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'replaceMedia arguments must be an object' };
  if (typeof args.elementId !== 'string' || args.elementId.length === 0) {
    return { ok: false, error: 'replaceMedia.elementId must be a non-empty string' };
  }
  if (!isOneOf<MediaKind>(args.mediaKind, MEDIA_KINDS)) {
    return {
      ok: false,
      error: `replaceMedia.mediaKind must be one of [${MEDIA_KINDS.join(', ')}] (got ${JSON.stringify(args.mediaKind)})`,
    };
  }
  if (typeof args.assetId !== 'string' || args.assetId.length === 0) {
    return { ok: false, error: 'replaceMedia.assetId must be a non-empty string' };
  }
  if (typeof args.alt !== 'string') {
    return { ok: false, error: 'replaceMedia.alt must be a string' };
  }
  return {
    ok: true,
    op: {
      kind: 'replaceMedia',
      elementId: args.elementId,
      mediaKind: args.mediaKind,
      assetId: args.assetId,
      alt: args.alt,
    },
  };
}

function parseCreateSection(args: unknown, styleKit: StyleKit): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'createSection arguments must be an object' };
  if (!isOneOf<AgentRecipeId>(args.recipeId, AGENT_RECIPE_IDS)) {
    return {
      ok: false,
      error: `createSection.recipeId must be one of [${AGENT_RECIPE_IDS.join(', ')}] (got ${JSON.stringify(args.recipeId)})`,
    };
  }
  if (typeof args.brief !== 'string' || args.brief.length === 0) {
    return { ok: false, error: 'createSection.brief must be a non-empty string' };
  }
  // afterSectionId: null OR string. We accept '' as "append at end" to keep
  // the JSON-Schema simple (no null variant in our subset).
  let afterSectionId: string | null = null;
  if (typeof args.afterSectionId === 'string' && args.afterSectionId.length > 0) {
    afterSectionId = args.afterSectionId;
  }
  const assetIds: RecipeFactoryInput['assetIds'] = {};
  if (isRecord(args.assetIds)) {
    if (typeof args.assetIds.hero === 'string' && args.assetIds.hero.length > 0) {
      assetIds.hero = args.assetIds.hero;
    }
    if (Array.isArray(args.assetIds.cards)) {
      const cards: string[] = [];
      for (const id of args.assetIds.cards) {
        if (typeof id === 'string' && id.length > 0) cards.push(id);
      }
      if (cards.length > 0) assetIds.cards = cards;
    }
    if (Array.isArray(args.assetIds.gallery)) {
      const gallery: string[] = [];
      for (const id of args.assetIds.gallery) {
        if (typeof id === 'string' && id.length > 0) gallery.push(id);
      }
      if (gallery.length > 0) assetIds.gallery = gallery;
    }
  }
  return {
    ok: true,
    op: {
      kind: 'insertSection',
      afterSectionId,
      recipeId: args.recipeId,
      input: { brief: args.brief, styleKit, assetIds },
    },
  };
}

function parseLayoutTree(value: unknown, depth: number): LayoutNode | ElementNode | string {
  if (depth > 6) return 'layout tree exceeds maximum nesting depth (6)';
  if (!isRecord(value)) return 'layout node must be an object';

  if ('element' in value) {
    const el = value.element;
    if (!isRecord(el)) return 'element must be an object';
    if (!isOneOf(el.type, ['text', 'media', 'action', 'shape', 'container'] as const)) {
      return `element.type must be text|media|action|shape|container (got ${JSON.stringify(el.type)})`;
    }
    const node: ElementNode = {
      element: { type: el.type },
    };
    if (el.text !== undefined && isRecord(el.text)) {
      if (typeof el.text.content !== 'string' || el.text.content.length === 0) {
        return 'element.text.content must be a non-empty string';
      }
      node.element.text = {
        content: el.text.content,
        role: isOneOf(el.text.role, ['heading', 'body', 'label'] as const) ? el.text.role : 'body',
        color: isOneOf(el.text.color, COLOR_TOKENS) ? el.text.color : 'text',
        font: isOneOf(el.text.font, FONT_TOKENS) ? el.text.font : 'body',
        size: typeof el.text.size === 'number' ? el.text.size : 16,
      };
    }
    if (el.media !== undefined && isRecord(el.media)) {
      node.element.media = {
        imagePrompt: typeof el.media.imagePrompt === 'string' ? el.media.imagePrompt : '',
        fit: isOneOf(el.media.fit, ['cover', 'contain'] as const) ? el.media.fit : 'cover',
      };
    }
    if (el.action !== undefined && isRecord(el.action)) {
      node.element.action = {
        label: typeof el.action.label === 'string' ? el.action.label : 'Click',
        variant: isOneOf(el.action.variant, ACTION_VARIANTS) ? el.action.variant : 'solid',
        href: typeof el.action.href === 'string' ? el.action.href : '#',
      };
    }
    if (el.shape !== undefined && isRecord(el.shape)) {
      node.element.shape = {
        variant: isOneOf(el.shape.variant, SHAPE_VARIANTS) ? el.shape.variant : 'rect',
      };
    }
    if (el.container !== undefined && isRecord(el.container)) {
      node.element.container = {
        variant: isOneOf(el.container.variant, SURFACE_VARIANTS) ? el.container.variant : 'flat',
        padding: typeof el.container.padding === 'number' ? el.container.padding : 24,
      };
    }
    if (isOneOf(value.size, ['fill', 'hug'] as const)) {
      node.size = value.size;
    }
    return node;
  }

  if (!isOneOf(value.type, ['stack', 'grid', 'split'] as const)) {
    return `layout node type must be stack|grid|split (got ${JSON.stringify(value.type)})`;
  }
  if (!Array.isArray(value.children)) {
    return 'layout node must have a children array';
  }

  const children: (LayoutNode | ElementNode)[] = [];
  for (let i = 0; i < value.children.length; i++) {
    const parsed = parseLayoutTree(value.children[i], depth + 1);
    if (typeof parsed === 'string') return `children[${String(i)}]: ${parsed}`;
    children.push(parsed);
  }

  const node: LayoutNode = { type: value.type, children };
  if (isOneOf(value.direction, ['row', 'column'] as const)) node.direction = value.direction;
  if (isOneOf(value.gap, GAP_TOKENS)) node.gap = value.gap;
  if (isOneOf(value.align, ['start', 'center', 'end'] as const)) node.align = value.align;
  if (typeof value.columns === 'number' && (GRID_COLUMNS as readonly number[]).includes(value.columns)) {
    node.columns = value.columns as 2 | 3 | 4;
  }
  if (isOneOf(value.ratio, SPLIT_RATIOS)) node.ratio = value.ratio;

  return node;
}

function parseDesignSection(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'designSection arguments must be an object' };
  if (typeof args.sectionName !== 'string' || args.sectionName.length === 0) {
    return { ok: false, error: 'designSection.sectionName must be a non-empty string' };
  }
  if (args.layout === undefined || !isRecord(args.layout)) {
    return { ok: false, error: 'designSection.layout must be an object' };
  }

  const layoutParsed = parseLayoutTree(args.layout, 0);
  if (typeof layoutParsed === 'string') {
    return { ok: false, error: `designSection.layout: ${layoutParsed}` };
  }
  if ('element' in layoutParsed) {
    return { ok: false, error: 'designSection.layout root must be a layout node, not an element' };
  }

  let afterSectionId: string | null = null;
  if (typeof args.afterSectionId === 'string' && args.afterSectionId.length > 0) {
    afterSectionId = args.afterSectionId;
  }

  const input: DesignSectionInput = {
    sectionName: args.sectionName,
    layout: layoutParsed,
  };
  if (typeof args.height === 'number') input.height = args.height;
  if (isOneOf<BackgroundEffect>(args.backgroundEffect, BACKGROUND_EFFECTS)) {
    input.backgroundEffect = args.backgroundEffect;
  }
  if (isOneOf<MotionPreset>(args.entrance, MOTION_PRESETS)) {
    input.entrance = args.entrance;
  }

  return {
    ok: true,
    op: { kind: 'designSection', afterSectionId, input },
  };
}

function translateToolCall(call: LlmAssistantToolCall, styleKit: StyleKit): ParseResult {
  switch (call.name) {
    case 'rewriteText':
      return parseRewriteText(call.arguments);
    case 'replaceMedia':
      return parseReplaceMedia(call.arguments);
    case 'createSection':
      return parseCreateSection(call.arguments, styleKit);
    case 'designSection':
      return parseDesignSection(call.arguments);
    default:
      return { ok: false, error: `unknown tool name: ${call.name}` };
  }
}

// ---------------------------------------------------------------------------
// Body parsing for the apply endpoint — accepts an already-shaped op[].
// ---------------------------------------------------------------------------

function parseApplyOp(value: unknown, styleKit: StyleKit): ParseResult {
  if (!isRecord(value)) return { ok: false, error: 'op must be an object' };
  if (value.kind === 'rewriteText') return parseRewriteText(value);
  if (value.kind === 'replaceMedia') return parseReplaceMedia(value);
  if (value.kind === 'insertSection') {
    // The apply payload mirrors the LLM tool shape exactly: recipeId, brief,
    // afterSectionId, assetIds. We re-derive a RecipeFactoryInput so we never
    // trust the styleKit field from the wire — the styleKit comes from the
    // freshly-loaded site row, not from the request body.
    const flattened = {
      recipeId: value.recipeId,
      brief: isRecord(value.input) ? value.input.brief : undefined,
      afterSectionId: value.afterSectionId,
      assetIds: isRecord(value.input) ? value.input.assetIds : undefined,
    };
    return parseCreateSection(flattened, styleKit);
  }
  if (value.kind === 'designSection') {
    const flattened = {
      sectionName: isRecord(value.input) ? value.input.sectionName : undefined,
      layout: isRecord(value.input) ? value.input.layout : undefined,
      height: isRecord(value.input) ? value.input.height : undefined,
      backgroundEffect: isRecord(value.input) ? value.input.backgroundEffect : undefined,
      entrance: isRecord(value.input) ? value.input.entrance : undefined,
      afterSectionId: value.afterSectionId,
    };
    return parseDesignSection(flattened);
  }
  return { ok: false, error: `unknown op kind: ${JSON.stringify(value.kind)}` };
}

// ---------------------------------------------------------------------------
// Shared apply-the-ops pipeline. Returns either a new editableState or a
// structured error the route maps onto a 400.
// ---------------------------------------------------------------------------

type PipelineResult =
  | { ok: true; next: CanvasSiteState }
  | { ok: false; status: 400; error: string; errors?: string[] };

async function runOpsPipeline(
  c: Context<Env>,
  row: OwnedSiteRow,
  ops: CanvasAgentOp[],
): Promise<PipelineResult> {
  // Apply each op in order. Catch loudly — applyCanvasAgentOp throws on
  // unknown elements / unknown recipes / bad shapes.
  let next: CanvasSiteState = row.editableState;
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
  const validation = validateCanvasSiteState(next);
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

function buildSystemPrompt(state: CanvasSiteState): string {
  const lines: string[] = [];
  lines.push('You are an editing assistant for the rev01 canvas site builder.');
  lines.push(
    'Use only the supplied tools. Do NOT invent recipe ids, asset ids, or element ids — pick from the existing ones below.',
  );
  lines.push(`Current style kit: ${state.styleKit}.`);
  const page = state.pages[0];
  if (page) {
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
  lines.push(
    'For rewriteText: produce an array of inline runs. Each run is { "text": "...", "marks"?: [{ "type": "bold" }, ...] }. Never send a plain string.',
  );
  lines.push(
    'For replaceMedia: assetId must already exist as an uploaded asset on this site. The tool does not generate media.',
  );
  lines.push(
    `For createSection: recipeId must be one of [${AGENT_RECIPE_IDS.join(', ')}]. Send a short brief. Use this when a built-in recipe matches the Owner request — it is faster and more reliable than designSection.`,
  );
  lines.push(
    'For designSection: describe the section structure as a semantic layout tree. Use stack (column or row), grid (2-4 columns), or split (ratio 1:1, 1:2, 2:1) nodes. ' +
      'Each leaf is an element node with type + matching props (text, media, action, shape, container). ' +
      'Colors use semantic tokens (accent, text, muted, bg, panel, emphasis). Fonts use kit slots (display, body, mono). ' +
      'Containers with size="fill" become background panels spanning their parent layout node. ' +
      'Media elements carry an imagePrompt describing the image to generate.',
  );
  lines.push(
    'Example designSection layout for a pricing section: ' +
      '{ "type": "stack", "direction": "column", "align": "center", "gap": "loose", "children": [' +
      '{ "element": { "type": "text", "text": { "content": "Pricing", "role": "heading", "color": "text", "font": "display", "size": 48 } } }, ' +
      '{ "type": "grid", "columns": 3, "gap": "normal", "children": [' +
      '{ "type": "stack", "direction": "column", "gap": "tight", "children": [' +
      '{ "element": { "type": "container", "container": { "variant": "outlined", "padding": 24 } }, "size": "fill" }, ' +
      '{ "element": { "type": "text", "text": { "content": "Starter", "role": "heading", "color": "text", "font": "display", "size": 24 } } }, ' +
      '{ "element": { "type": "text", "text": { "content": "$9/mo", "role": "heading", "color": "accent", "font": "display", "size": 36 } } }, ' +
      '{ "element": { "type": "action", "action": { "label": "Get Started", "variant": "outline", "href": "#" } } }' +
      '] } ] } ] }',
  );
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
    const parsed = translateToolCall(call, row.styleKit);
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
  if (!isRecord(body) || !Array.isArray(body.ops)) {
    return c.json({ error: 'body must be { ops: CanvasAgentOp[] }' }, 400);
  }
  const ops: CanvasAgentOp[] = [];
  for (let i = 0; i < body.ops.length; i++) {
    const parsed = parseApplyOp(body.ops[i], row.styleKit);
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

  return c.json({ ok: true, editableState: pipeline.next });
});

export default canvasAgentApi;
