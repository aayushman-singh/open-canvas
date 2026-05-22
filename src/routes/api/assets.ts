// src/routes/api/assets.ts
//
// Owner-scoped asset surface. Replaces the per-site /api/canvas/sites/:siteId/assets
// flow with /api/me/assets — assets belong to the Owner, not to a single Site.

import { Hono } from 'hono';
import { clerkAuth } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { requireOwnerContext, type OwnerEnv } from '../../auth/context.js';
import { db } from '../../db/client.js';
import { ownerAsset } from '../../db/schema.js';
import {
  assetResponse,
  dataUrlToOwnerAsset,
  readOwnerAsset,
} from '../../assets/owner-assets.js';

const MAX_ASSET_DATA_URL_BYTES = 1_500_000;

const assets = new Hono<OwnerEnv>();

assets.use('*', clerkAuth());
assets.use('*', requireAuth());

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

assets.get('/me/assets/:assetId', async (c) => {
  const ctx = await requireOwnerContext(c);
  if (!ctx.ok) return ctx.response;
  const row = await readOwnerAsset(db(c.env), ctx.customer.id, c.req.param('assetId'));
  if (!row) return c.json({ error: 'asset not found' }, 404);
  return assetResponse(row.mediaType, row.bytesBase64);
});

export default assets;
