import { and, eq, or, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { createR2Client } from '../../assets/r2-client';
import { readOwnerAsset, type CfImageFetcher } from '../../assets/read';
import { uploadOwnerAsset, UploadAssetError } from '../../assets/upload';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { STYLE_KITS, type CanvasSiteState, type StyleKit } from '../../canvas/schema';
import { validateCanvasSiteState } from '../../canvas/validate';
import { db } from '../../db/client';
import { customer, ownerAsset, site } from '../../db/schema';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  REPLICATE_API_TOKEN: string;
  ASSETS_BUCKET: R2Bucket;
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

// Maximum payload size for the legacy data-URL upload bridge. The bridge
// exists so the editor's existing JSON-shaped POST keeps working after the
// asset re-root (ADR 0004 + 0006); the canonical new path is
// `POST /api/owner/assets` (multipart, Owner-rooted). Per the original
// constraint we cap at 2 MB of base64; atob inflates by ~4/3, so the binary
// upper bound is ~1.5 MB. Past this point we 413 loudly.
const MAX_ASSET_DATA_URL_BYTES = 2 * 1024 * 1024;

interface DataUrlUploadInput {
  dataUrl: string;
  alt: string;
}

function parseUploadInput(body: unknown): DataUrlUploadInput | { error: string } {
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

interface DecodedDataUrl {
  mediaType: string;
  bytes: Uint8Array;
}

function decodeDataUrl(input: string): DecodedDataUrl {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!match) throw new Error('asset data must be a base64 data URL');
  const mediaType = match[1] ?? '';
  const base64 = match[2] ?? '';
  if (!mediaType.startsWith('image/') && !mediaType.startsWith('video/')) {
    throw new Error(`unsupported asset media type: ${mediaType}`);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mediaType, bytes };
}

// Legacy upload bridge for the editor. Translates the editor's JSON shape
// (`{ dataUrl, alt }`) into an Owner-rooted upload via the shared
// `uploadOwnerAsset` primitive. Wave-1 consumers should migrate to
// `POST /api/owner/assets` (multipart); this bridge keeps the editor green
// during the cutover.
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
  if (parsed.dataUrl.length > MAX_ASSET_DATA_URL_BYTES) {
    return c.json({ error: 'asset too large' }, 413);
  }
  let decoded: DecodedDataUrl;
  try {
    decoded = decodeDataUrl(parsed.dataUrl);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const database = db(c.env);
  const r2 = createR2Client(c.env.ASSETS_BUCKET);
  try {
    const uploaded = await uploadOwnerAsset(
      { db: database, r2 },
      {
        customerId: result.customerId,
        bytes: decoded.bytes,
        mediaType: decoded.mediaType,
        alt: parsed.alt,
        siteId: result.site.id,
      },
    );
    return c.json({
      assetId: uploaded.id,
      kind: uploaded.kind,
      mediaType: uploaded.mediaType,
    });
  } catch (err) {
    if (err instanceof UploadAssetError) {
      return c.json({ error: err.message }, err.status as 400);
    }
    throw err;
  }
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

// Owner-driven Owner Asset generation via Replicate's flux-schnell.
// Synchronous wait (Replicate's `Prefer: wait`, max 60s) — flux-schnell
// typically returns in ~2-5s. Output bytes are uploaded through the shared
// `uploadOwnerAsset` primitive so generated and uploaded assets land in the
// same Owner-rooted ownerAsset table and the same R2 dedup behaviour
// applies.
//
// No fallback path: if Replicate fails, the prediction does not succeed, or
// the output is unrecognised, we throw with full context.
async function generateImageViaReplicate(
  token: string,
  prompt: string,
  aspectRatio: string,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
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
  return { bytes: buffer, mediaType };
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

  // Mirror the upload-path size budget; an oversized generation is rejected
  // before we touch R2 or the DB.
  if (image.bytes.byteLength > MAX_ASSET_DATA_URL_BYTES) {
    return c.json({ error: 'generated asset too large' }, 413);
  }

  const database = db(c.env);
  const r2 = createR2Client(c.env.ASSETS_BUCKET);
  const uploaded = await uploadOwnerAsset(
    { db: database, r2 },
    {
      customerId: result.customerId,
      bytes: image.bytes,
      mediaType: image.mediaType,
      alt: parsed.alt,
      siteId: result.site.id,
    },
  );
  return c.json({
    assetId: uploaded.id,
    kind: uploaded.kind,
    mediaType: uploaded.mediaType,
  });
});

// Owner-gated preview endpoint. The editor uses this for editable-state
// previews of media the Owner has uploaded but not yet published. The
// resolution is scoped to the current Owner (not the site) so the editor
// can fetch any of the Owner's assets even when they were originally
// uploaded against a different site under the same Owner.
canvasApi.get('/sites/:siteId/assets/:assetId', async (c) => {
  const siteId = c.req.param('siteId');
  const assetId = c.req.param('assetId');
  const result = await loadOwnedSite(c, siteId);
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const database = db(c.env);
  // The asset id may be a UUID (typical) or a content hash (when the
  // caller already speaks the ADR 0006 URL shape). Match either; require
  // Owner ownership in both branches.
  const rows = await database
    .select({
      id: ownerAsset.id,
      r2Key: ownerAsset.r2Key,
      mediaType: ownerAsset.mediaType,
      kind: ownerAsset.kind,
      contentHash: ownerAsset.contentHash,
    })
    .from(ownerAsset)
    .where(
      and(
        eq(ownerAsset.customerId, result.customerId),
        or(eq(ownerAsset.id, assetId), eq(ownerAsset.contentHash, assetId)),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: 'asset not found' }, 404);
  }
  // Reuse the public readOwnerAsset helper for transform handling; we pass
  // a one-row select shim so the lookup is skipped.
  const shimDb = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([row]) }),
      }),
    }),
  } as unknown as typeof database;
  const r2 = createR2Client(c.env.ASSETS_BUCKET);
  const cfImageFetch: CfImageFetcher | null =
    typeof fetch === 'function' ? (url, options) => fetch(url, options as RequestInit) : null;
  const requestUrl = new URL(c.req.url);
  const response = await readOwnerAsset(
    {
      db: shimDb,
      r2,
      cfImageFetch,
      publicOrigin: `${requestUrl.protocol}//${requestUrl.host}`,
    },
    { addr: assetId, url: requestUrl },
  );
  if (!response) {
    return c.json({ error: 'asset not found' }, 404);
  }
  return response;
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
