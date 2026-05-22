// src/routes/api/assets.ts
//
// Owner-scoped asset surface. Replaces the per-site /api/canvas/sites/:siteId/assets
// flow with /api/me/assets — assets belong to the Owner, not to a single Site.

import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { clerkAuth } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { requireOwnerContext, type OwnerEnv } from '../../auth/context.js';
import { db } from '../../db/client.js';
import { ownerAsset } from '../../db/schema.js';
import {
  assetResponse,
  dataUrlToOwnerAsset,
  findAssetUsage,
  generateImageViaReplicate,
  MAX_ASSET_DATA_URL_BYTES,
  readOwnerAsset,
  snapToFluxAspectRatio,
} from '../../assets/owner-assets.js';

const assets = new Hono<OwnerEnv>();

const realRequireAuth = requireAuth();

// SMOKE bypass runs before clerkAuth so the Clerk SDK never reads (and
// consumes) the request body when the smoke harness is driving requests.
// Production paths cannot reach the bypass because env.SMOKE is unset.
assets.use('*', async (c, next) => {
  if (c.env.SMOKE === '1') {
    if ((c.req.header('x-smoke-customer-id') ?? '').length > 0) {
      await next();
      return;
    }
    // SMOKE=1 but no customer-id header → 401. Do not run Clerk auth at all
    // (no valid session exists in the smoke environment anyway).
    return c.json({ error: 'unauthorized' }, 401);
  }
  // Non-smoke path: standard Clerk auth gate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-explicit-any
  return clerkAuth()(c as any, async () => { await realRequireAuth(c as any, next); });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface UploadInput {
  dataUrl: string;
  alt: string;
}

function parseUploadInput(body: unknown): UploadInput | { error: string } {
  if (!isRecord(body)) return { error: 'request body must be a JSON object' };
  const { dataUrl, alt } = body;
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
    return { error: 'dataUrl is required (non-empty base64 data URL)' };
  }
  if (typeof alt !== 'string') return { error: 'alt is required (string; "" is acceptable)' };
  return { dataUrl, alt };
}

assets.post('/me/assets', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;

  const body: unknown = await c.req.json();
  const parsed = parseUploadInput(body);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  if (parsed.dataUrl.length > MAX_ASSET_DATA_URL_BYTES) {
    return c.json({ error: 'asset too large' }, 413);
  }

  let blob;
  try {
    blob = dataUrlToOwnerAsset(parsed.dataUrl, parsed.alt);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const id = `up-${crypto.randomUUID()}`;
  await db(c.env).insert(ownerAsset).values({
    id,
    customerId: ctx.customer.id,
    mediaType: blob.mediaType,
    bytesBase64: blob.bytesBase64,
    kind: blob.kind,
    alt: blob.alt,
  });
  return c.json({ assetId: id, kind: blob.kind, mediaType: blob.mediaType });
});

// GET /me/assets — gallery list. Most-recently-used first.
assets.get('/me/assets', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;

  const kindFilter = c.req.query('kind');
  const rawLimit = Number(c.req.query('limit') ?? '200');
  const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 200));

  const whereClause =
    kindFilter === 'image' || kindFilter === 'video'
      ? and(eq(ownerAsset.customerId, ctx.customer.id), eq(ownerAsset.kind, kindFilter))
      : eq(ownerAsset.customerId, ctx.customer.id);

  const entries = await db(c.env)
    .select({
      assetId: ownerAsset.id,
      kind: ownerAsset.kind,
      mediaType: ownerAsset.mediaType,
      alt: ownerAsset.alt,
      lastUsedAt: ownerAsset.lastUsedAt,
      createdAt: ownerAsset.createdAt,
    })
    .from(ownerAsset)
    .where(whereClause)
    .orderBy(desc(ownerAsset.lastUsedAt))
    .limit(limit);
  return c.json({ entries });
});

// GET /me/assets/:assetId/usage — cascade-impact probe for the delete modal.
assets.get('/me/assets/:assetId/usage', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;
  const usage = await findAssetUsage(db(c.env), ctx.customer.id, c.req.param('assetId'));
  return c.json({ usage });
});

assets.get('/me/assets/:assetId', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;
  const row = await readOwnerAsset(db(c.env), ctx.customer.id, c.req.param('assetId'));
  if (!row) return c.json({ error: 'asset not found' }, 404);
  return assetResponse(row.mediaType, row.bytesBase64);
});

interface GenerateInput {
  prompt: string;
  alt: string;
  boxW: number;
  boxH: number;
}

function parseGenerateInput(body: unknown): GenerateInput | { error: string } {
  if (!isRecord(body)) return { error: 'request body must be a JSON object' };
  const { prompt, alt, boxW, boxH } = body;
  if (typeof prompt !== 'string' || prompt.trim().length === 0)
    return { error: 'prompt is required (non-empty string)' };
  if (typeof alt !== 'string')
    return { error: 'alt is required (string; "" is acceptable)' };
  if (typeof boxW !== 'number' || !Number.isFinite(boxW) || boxW <= 0)
    return { error: 'boxW is required (positive finite number)' };
  if (typeof boxH !== 'number' || !Number.isFinite(boxH) || boxH <= 0)
    return { error: 'boxH is required (positive finite number)' };
  return { prompt, alt, boxW, boxH };
}

assets.post('/me/assets/generate', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;

  const body: unknown = await c.req.json();
  const parsed = parseGenerateInput(body);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const token = c.env.REPLICATE_API_TOKEN;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('REPLICATE_API_TOKEN binding is missing');
  }

  const aspectRatio = snapToFluxAspectRatio(parsed.boxW, parsed.boxH);
  const image = await generateImageViaReplicate(token, parsed.prompt, aspectRatio);

  const dataUrlLength = `data:${image.mediaType};base64,`.length + image.bytesBase64.length;
  if (dataUrlLength > MAX_ASSET_DATA_URL_BYTES) {
    return c.json({ error: 'generated asset too large' }, 413);
  }

  // KEY DIFFERENCE FROM THE OLD ROUTE: no insert. Bytes return to the client;
  // the browser POSTs them back to /me/assets on Apply.
  return c.json({
    kind: 'image' as const,
    mediaType: image.mediaType,
    bytesBase64: image.bytesBase64,
    alt: parsed.alt,
  });
});

export default assets;
