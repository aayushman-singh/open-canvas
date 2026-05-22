import { and, eq, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { assetResponse, dataUrlToAsset } from '../../assets/site-assets';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { STYLE_KITS, type CanvasSiteState, type StyleKit } from '../../canvas/schema';
import { validateCanvasSiteState } from '../../canvas/validate';
import { db } from '../../db/client';
import { customer, site, siteAsset } from '../../db/schema';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  REPLICATE_API_TOKEN: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const canvasApi = new Hono<Env>();

canvasApi.use('*', clerkAuth());
canvasApi.use('*', requireAuth());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStyleKit(value: unknown): value is StyleKit {
  return typeof value === 'string' && (STYLE_KITS as readonly string[]).includes(value);
}

async function loadOwnedSite(
  c: Context<Env>,
  siteId: string,
): Promise<
  | { found: true; customerId: string; site: { id: string; name: string; subdomain: string; styleKit: StyleKit; editableState: CanvasSiteState; publishedVersion: number } }
  | { found: false }
> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('canvas api reached without an authenticated user');
  }

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return { found: false };
  }

  const siteRow = await database
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      styleKit: site.styleKit,
      editableState: site.editableState,
      publishedVersion: site.publishedVersion,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = siteRow[0];
  if (!row) {
    return { found: false };
  }

  return { found: true, customerId, site: row };
}

canvasApi.get('/sites/:siteId', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadOwnedSite(c, siteId);
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }
  const { site: row } = result;
  return c.json({
    siteId: row.id,
    name: row.name,
    subdomain: row.subdomain,
    editableState: row.editableState,
    publishedVersion: row.publishedVersion,
  });
});

canvasApi.put('/sites/:siteId', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadOwnedSite(c, siteId);
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const body: unknown = await c.req.json();
  if (!isRecord(body)) {
    return c.json({ error: 'editable state invalid', errors: ['body must be a JSON object'] }, 400);
  }
  const editableState = body.editableState;
  // Single-page POC guardrail: reject multi-page payloads loudly before
  // dropping into the full validator. The validator still runs below as the
  // comprehensive check — this pre-check is an additional defence so the
  // wire-level error is specific even when the rest of the state is broken.
  if (
    !isRecord(editableState) ||
    !Array.isArray(editableState.pages) ||
    editableState.pages.length !== 1
  ) {
    return c.json(
      {
        error: 'editable state invalid',
        errors: [
          'state.pages must contain exactly one canvas page (POC enforces single-page sites)',
        ],
      },
      400,
    );
  }
  const validation = validateCanvasSiteState(editableState);
  if (!validation.valid) {
    return c.json({ error: 'editable state invalid', errors: validation.errors }, 400);
  }

  const database = db(c.env);
  await database
    .update(site)
    .set({
      editableState: editableState as unknown as CanvasSiteState,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, siteId), eq(site.customerId, result.customerId)));

  return c.json({ ok: true });
});

// Maximum payload size for owner asset uploads. The base64 data URL itself
// must not exceed this — atob inflates by ~4/3 so a 2 MB base64 payload
// decodes to ~1.5 MB binary. Past this point we 413 loudly; no silent
// truncation. T9 may move large assets to R2.
const MAX_ASSET_DATA_URL_BYTES = 2 * 1024 * 1024;

interface UploadAssetInput {
  dataUrl: string;
  alt: string;
}

function parseUploadInput(body: unknown): UploadAssetInput | { error: string } {
  if (!isRecord(body)) return { error: 'request body must be a JSON object' };
  const { dataUrl, alt } = body;
  if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
    return { error: 'dataUrl is required (base64 data URL)' };
  }
  if (typeof alt !== 'string') {
    return { error: 'alt is required (string; "" is acceptable)' };
  }
  return { dataUrl, alt };
}

canvasApi.post('/sites/:siteId/assets', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadOwnedSite(c, siteId);
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const body: unknown = await c.req.json();
  const parsed = parseUploadInput(body);
  if ('error' in parsed) {
    return c.json({ error: parsed.error }, 400);
  }

  // Refuse oversized payloads up front — atob would happily decode them, but
  // we don't want to land >1.5 MB binary into Postgres for a POC and we don't
  // silently truncate.
  if (parsed.dataUrl.length > MAX_ASSET_DATA_URL_BYTES) {
    return c.json({ error: 'asset too large' }, 413);
  }

  let blob;
  try {
    blob = dataUrlToAsset(parsed.dataUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }

  // Always generate a fresh asset id. Seed asset ids are NEVER overwritten —
  // an Owner who wants to replace seed media uploads a new asset and points
  // their MediaElement.assetId at the new id.
  const newAssetId = `up-${crypto.randomUUID()}`;

  const database = db(c.env);
  await database.insert(siteAsset).values({
    id: newAssetId,
    siteId: result.site.id,
    mediaType: blob.mediaType,
    bytesBase64: blob.bytesBase64,
    kind: blob.kind,
    alt: parsed.alt,
  });

  return c.json({
    assetId: newAssetId,
    kind: blob.kind,
    mediaType: blob.mediaType,
  });
});

interface GenerateAssetInput {
  prompt: string;
  alt: string;
  boxW: number;
  boxH: number;
}

function parseGenerateInput(body: unknown): GenerateAssetInput | { error: string } {
  if (!isRecord(body)) return { error: 'request body must be a JSON object' };
  const { prompt, alt, boxW, boxH } = body;
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return { error: 'prompt is required (non-empty string)' };
  }
  if (typeof alt !== 'string') {
    return { error: 'alt is required (string; "" is acceptable)' };
  }
  if (typeof boxW !== 'number' || !Number.isFinite(boxW) || boxW <= 0) {
    return { error: 'boxW is required (positive finite number)' };
  }
  if (typeof boxH !== 'number' || !Number.isFinite(boxH) || boxH <= 0) {
    return { error: 'boxH is required (positive finite number)' };
  }
  return { prompt, alt, boxW, boxH };
}

// flux-schnell `aspect_ratio` only accepts a fixed preset set. Anything else
// is rejected by the model server. The slot's exact w/h ratio is snapped to
// the preset whose log-ratio is closest, so 2:1 and 1:2 are treated as equally
// far from 1:1.
const FLUX_ASPECT_PRESETS = [
  { label: '1:1', value: 1 },
  { label: '16:9', value: 16 / 9 },
  { label: '21:9', value: 21 / 9 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '4:5', value: 4 / 5 },
  { label: '5:4', value: 5 / 4 },
  { label: '3:4', value: 3 / 4 },
  { label: '4:3', value: 4 / 3 },
  { label: '9:16', value: 9 / 16 },
  { label: '9:21', value: 9 / 21 },
] as const;

function snapToFluxAspectRatio(boxW: number, boxH: number): string {
  const target = boxW / boxH;
  let bestLabel: string = FLUX_ASPECT_PRESETS[0].label;
  let bestDiff = Math.abs(Math.log(FLUX_ASPECT_PRESETS[0].value / target));
  for (const preset of FLUX_ASPECT_PRESETS) {
    const diff = Math.abs(Math.log(preset.value / target));
    if (diff < bestDiff) {
      bestLabel = preset.label;
      bestDiff = diff;
    }
  }
  return bestLabel;
}

interface ReplicatePrediction {
  id: string;
  status: string;
  output: unknown;
  error: unknown;
  logs: unknown;
}

// Owner-driven Site Asset generation via Replicate's flux-schnell. Synchronous
// wait (Replicate's `Prefer: wait`, max 60s) — flux-schnell typically returns
// in ~2-5s. Output is fetched and stored as base64 in `site_asset`, matching
// the upload flow so downstream code (renderer, publish guard, public asset
// route) treats generated and uploaded assets identically.
//
// No fallback path: if Replicate fails, the prediction does not succeed, or
// the output is unrecognised, we throw with full context.
async function generateImageViaReplicate(
  token: string,
  prompt: string,
  aspectRatio: string,
): Promise<{ bytesBase64: string; mediaType: string }> {
  const replicateResponse = await fetch(
    'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({ input: { prompt, aspect_ratio: aspectRatio } }),
    },
  );
  if (!replicateResponse.ok) {
    const text = await replicateResponse.text();
    throw new Error(
      `replicate prediction request failed: status=${String(replicateResponse.status)} body=${text}`,
    );
  }
  const prediction: ReplicatePrediction = await replicateResponse.json();
  if (prediction.status !== 'succeeded') {
    throw new Error(
      `replicate prediction not succeeded: status=${prediction.status} id=${prediction.id} error=${JSON.stringify(prediction.error)} logs=${JSON.stringify(prediction.logs)}`,
    );
  }
  const output = prediction.output;
  const outputUrl =
    typeof output === 'string'
      ? output
      : Array.isArray(output) && typeof output[0] === 'string'
        ? output[0]
        : null;
  if (!outputUrl) {
    throw new Error(`replicate prediction output unrecognised: ${JSON.stringify(output)}`);
  }
  const imageResponse = await fetch(outputUrl);
  if (!imageResponse.ok) {
    throw new Error(
      `replicate output fetch failed: status=${String(imageResponse.status)} url=${outputUrl}`,
    );
  }
  const mediaType = imageResponse.headers.get('content-type') ?? 'image/webp';
  if (!mediaType.startsWith('image/')) {
    throw new Error(`replicate output media type not an image: ${mediaType}`);
  }
  const buffer = new Uint8Array(await imageResponse.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i] as number);
  }
  const bytesBase64 = btoa(binary);
  return { bytesBase64, mediaType };
}

canvasApi.post('/sites/:siteId/assets/generate', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadOwnedSite(c, siteId);
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const body: unknown = await c.req.json();
  const parsed = parseGenerateInput(body);
  if ('error' in parsed) {
    return c.json({ error: parsed.error }, 400);
  }

  const token = c.env.REPLICATE_API_TOKEN;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('REPLICATE_API_TOKEN binding is missing');
  }

  const aspectRatio = snapToFluxAspectRatio(parsed.boxW, parsed.boxH);
  const image = await generateImageViaReplicate(token, parsed.prompt, aspectRatio);

  // Mirror the upload-path limit so generated assets cannot bypass the
  // per-asset size budget that protects Postgres rows.
  const dataUrlLength =
    `data:${image.mediaType};base64,`.length + image.bytesBase64.length;
  if (dataUrlLength > MAX_ASSET_DATA_URL_BYTES) {
    return c.json({ error: 'generated asset too large' }, 413);
  }

  const newAssetId = `gen-${crypto.randomUUID()}`;

  const database = db(c.env);
  await database.insert(siteAsset).values({
    id: newAssetId,
    siteId: result.site.id,
    mediaType: image.mediaType,
    bytesBase64: image.bytesBase64,
    kind: 'image',
    alt: parsed.alt,
  });

  return c.json({
    assetId: newAssetId,
    kind: 'image' as const,
    mediaType: image.mediaType,
  });
});

canvasApi.get('/sites/:siteId/assets/:assetId', async (c) => {
  const siteId = c.req.param('siteId');
  const assetId = c.req.param('assetId');
  const result = await loadOwnedSite(c, siteId);
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const database = db(c.env);
  const rows = await database
    .select({
      mediaType: siteAsset.mediaType,
      bytesBase64: siteAsset.bytesBase64,
    })
    .from(siteAsset)
    .where(and(eq(siteAsset.id, assetId), eq(siteAsset.siteId, result.site.id)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: 'asset not found' }, 404);
  }
  return assetResponse(row.mediaType, row.bytesBase64);
});

canvasApi.post('/sites/:siteId/style-kit', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadOwnedSite(c, siteId);
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const body: unknown = await c.req.json();
  if (!isRecord(body)) {
    return c.json({ error: 'unknown style kit' }, 400);
  }
  const incoming = body.styleKit;
  if (!isStyleKit(incoming)) {
    return c.json({ error: 'unknown style kit' }, 400);
  }

  const nextState: CanvasSiteState = {
    ...result.site.editableState,
    styleKit: incoming,
  };

  const database = db(c.env);
  await database
    .update(site)
    .set({
      styleKit: incoming,
      editableState: nextState,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, siteId), eq(site.customerId, result.customerId)));

  return c.json({ ok: true, styleKit: incoming });
});

export default canvasApi;
