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
