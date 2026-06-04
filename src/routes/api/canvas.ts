import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { createR2Client } from '../../assets/r2-client';
import { readOwnerAsset, type CfImageFetcher } from '../../assets/read';
import { collectReferencedAssetIds, findAssetReferenceErrors } from '../../assets/site-assets';
import { uploadOwnerAsset, UploadAssetError } from '../../assets/upload';
import { loadAccessibleSite, type SiteAccessRequirement } from '../../auth/accessible-site';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { getSeedAsset } from '../../canvas/seed-assets';
import {
  STYLE_KITS,
  type CanvasPage,
  type EditableSite,
  type StyleKit,
} from '../../canvas/schema';
import { validateEditableSite } from '../../canvas/validate';
import { db } from '../../db/client';
import { ownerAsset, site } from '../../db/schema';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  REPLICATE_API_TOKEN: string;
  ASSETS_BUCKET: R2Bucket;
  SITE_ROOM: DurableObjectNamespace;
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

type OptionalStringPatch = { present: false } | { present: true; value: string | undefined };

function optionalStringPatch(body: Record<string, unknown>, key: string): OptionalStringPatch {
  if (!(key in body)) return { present: false };
  const value = body[key];
  if (value === null) return { present: true, value: undefined };
  if (typeof value !== 'string') {
    // Per ADR 0012 dec 1, validate.ts is the only shape gate. The route
    // surfaces the raw value into the patch; validate.ts rejects non-string
    // values with a field-pathed error. The cast is honest about handing
    // the bad shape downstream rather than swallowing it here.
    return { present: true, value: value as unknown as string };
  }
  const trimmed = value.trim();
  return { present: true, value: trimmed.length > 0 ? trimmed : undefined };
}

function setOptionalPageField<K extends keyof CanvasPage>(
  page: CanvasPage,
  key: K,
  value: CanvasPage[K] | undefined,
): void {
  if (value === undefined) {
    delete page[key];
    return;
  }
  page[key] = value;
}

function patchEditablePage(
  state: EditableSite,
  pageId: string,
  patch: (page: CanvasPage) => CanvasPage,
): EditableSite | null {
  let found = false;
  const pages = state.pages.map((page) => {
    if (page.id !== pageId) return page;
    found = true;
    return patch(page);
  });
  if (!found) return null;
  return { ...state, pages };
}

async function persistEditableState(
  c: Context<Env>,
  siteId: string,
  ownerCustomerId: string,
  nextState: EditableSite,
  extraSiteFields: { styleKit?: StyleKit } = {},
): Promise<Response | null> {
  const validation = validateEditableSite(nextState);
  if (!validation.valid) {
    return c.json({ error: 'editable state invalid', errors: validation.errors }, 400);
  }

  await db(c.env)
    .update(site)
    .set({
      ...extraSiteFields,
      editableState: nextState,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, siteId), eq(site.customerId, ownerCustomerId)));
  return null;
}

/**
 * Push a freshly-saved EditableSite to the SiteRoom Durable Object so any
 * connected editors replace their in-memory Y.Doc with the new state.
 *
 * Why this exists: site-level config fields (visitorTheme, siteNoIndex,
 * faviconAssetId) are written directly to `site.editableState` by the
 * PATCH `/config` handler — they do NOT flow through the Yjs doc. A hot
 * DurableObject still holds the prior Yjs doc, and its autosave path
 * encodes that doc back into `editableState`, silently clobbering the
 * config change. The broadcast forces the DO to swap its Y.Doc to the new
 * state, so the next autosave preserves what the Owner just saved.
 *
 * Fails loud on a non-2xx response. The DB write already succeeded; the
 * caller treats broadcast failure as a 502 so the Owner sees that the
 * change may not survive an autosave from a connected editor.
 */
export async function broadcastEditableStateReplaced(
  env: { SITE_ROOM: DurableObjectNamespace },
  siteId: string,
  newState: EditableSite,
): Promise<void> {
  const id = env.SITE_ROOM.idFromName(siteId);
  const stub = env.SITE_ROOM.get(id);
  const response = await stub.fetch('https://do.invalid/broadcast', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'editable-state-replaced',
      siteId,
      newState,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `SiteRoom editable-state-replaced broadcast failed (${String(response.status)}): ${text}`,
    );
  }
}

/**
 * Resolve site access for canvas API routes and preserve the Owner customer id.
 *
 * Collaborators can read or edit according to `requiredRole`, but DB writes
 * still target the Owner's `site.customerId`. Keeping that distinction local
 * prevents privilege escalation bugs where a collaborator's customer id is
 * accidentally used as the site owner.
 */
async function loadCanvasSiteAccess(
  c: Context<Env>,
  siteId: string,
  requiredRole: SiteAccessRequirement,
): Promise<
  | {
      found: true;
      ownerCustomerId: string;
      site: {
        id: string;
        name: string;
        subdomain: string;
        styleKit: StyleKit;
        editableState: EditableSite;
        publishedVersion: number;
      };
    }
  | { found: false }
> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('canvas api reached without an authenticated user');
  }

  const database = db(c.env);
  const accessibleSite = await loadAccessibleSite(
    database,
    auth.userId,
    siteId,
    requiredRole,
    c.get('customer')?.id,
  );
  if (!accessibleSite) {
    return { found: false };
  }

  return {
    found: true,
    ownerCustomerId: accessibleSite.customerId,
    site: {
      id: accessibleSite.id,
      name: accessibleSite.name,
      subdomain: accessibleSite.subdomain,
      styleKit: accessibleSite.styleKit,
      editableState: accessibleSite.editableState,
      publishedVersion: accessibleSite.publishedVersion,
    },
  };
}

canvasApi.get('/sites/:siteId', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadCanvasSiteAccess(c, siteId, 'viewer');
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
  const result = await loadCanvasSiteAccess(c, siteId, 'editor');
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const body: unknown = await c.req.json();
  if (!isRecord(body)) {
    return c.json({ error: 'editable state invalid', errors: ['body must be a JSON object'] }, 400);
  }
  const editableState = body.editableState;
  // Shape guardrail before the full validator, so malformed wire payloads get
  // a specific error while page-count rules stay owned by validate.ts.
  if (!isRecord(editableState) || !Array.isArray(editableState.pages)) {
    return c.json(
      {
        error: 'editable state invalid',
        errors: ['editableState.pages must be an array'],
      },
      400,
    );
  }
  const validation = validateEditableSite(editableState);
  if (!validation.valid) {
    return c.json({ error: 'editable state invalid', errors: validation.errors }, 400);
  }

  const nextState = editableState as unknown as EditableSite;
  const database = db(c.env);
  const referenced = collectReferencedAssetIds(nextState);
  if (referenced.size > 0) {
    const referencedList = [...referenced];
    const presentRows = await database
      .select({ id: ownerAsset.id, kind: ownerAsset.kind })
      .from(ownerAsset)
      .where(
        and(
          eq(ownerAsset.customerId, result.ownerCustomerId),
          inArray(ownerAsset.id, referencedList),
        ),
      );
    const referenceErrors = findAssetReferenceErrors(nextState, presentRows);
    const missing = referenceErrors.filter((error) => error.reason === 'missing');
    if (missing.length > 0) {
      return c.json(
        {
          error: 'cannot save: missing assets',
          missingAssetIds: missing.map((error) => error.assetId),
        },
        400,
      );
    }
    const mismatched = referenceErrors.filter((error) => error.reason === 'kind-mismatch');
    if (mismatched.length > 0) {
      return c.json(
        {
          error: 'cannot save: asset kind mismatch',
          assetKindErrors: mismatched.map((error) => ({
            assetId: error.assetId,
            expectedKind: error.expectedKind,
            actualKind: error.actualKind,
            path: error.path,
          })),
        },
        400,
      );
    }
  }

  await database
    .update(site)
    .set({
      editableState: nextState,
      updatedAt: sql`now()`,
    })
    .where(and(eq(site.id, siteId), eq(site.customerId, result.ownerCustomerId)));

  return c.json({ ok: true });
});

// PATCH a small set of site-level config flags (siteNoIndex, darkModeEnabled).
// Lives separate from the full-state PUT above so the settings UI can flip a
// single toggle without round-tripping ~200KB of canvas state. Body keys are
// optional; only keys explicitly present in the body are written.
canvasApi.patch('/sites/:siteId/config', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadCanvasSiteAccess(c, siteId, 'editor');
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const body: unknown = await c.req.json();
  if (!isRecord(body)) {
    return c.json({ error: 'body must be a JSON object' }, 400);
  }

  // Per ADR 0012 dec 1, validate.ts is the only shape gate. The route
  // copies present-in-body fields into the next state without type-checking
  // them; persistEditableState calls validateEditableSite which rejects
  // bad shapes with field-pathed errors. The two non-validation concerns
  // that stay at this layer are PATCH semantics (faviconAssetId === null
  // or empty-string means "delete") and authorization (the favicon must
  // be an image asset the Owner owns).
  const next: EditableSite = {
    ...result.site.editableState,
    pages: result.site.editableState.pages,
  };

  if ('siteNoIndex' in body) {
    next.siteNoIndex = body.siteNoIndex as boolean;
  }
  if ('visitorTheme' in body) {
    const raw = body.visitorTheme;
    if (raw === 'light' || raw === 'dark' || raw === 'toggleable') {
      next.visitorTheme = raw;
    } else if (raw === undefined || raw === null) {
      delete next.visitorTheme;
    } else {
      return c.json(
        { error: "visitorTheme must be 'light', 'dark', or 'toggleable'" },
        400,
      );
    }
  }
  if ('faviconAssetId' in body) {
    const raw = body.faviconAssetId;
    if (raw === null || (typeof raw === 'string' && raw.trim().length === 0)) {
      delete next.faviconAssetId;
    } else if (typeof raw === 'string') {
      const assetId = raw.trim();
      const isImage = await assetIsImageForCustomer(c.env, assetId, result.ownerCustomerId);
      if (!isImage) {
        return c.json({ error: 'faviconAssetId does not match an image asset you own' }, 400);
      }
      next.faviconAssetId = assetId;
    } else {
      // Non-string, non-null value — pass through; validate.ts rejects.
      next.faviconAssetId = raw as string;
    }
  }

  const failure = await persistEditableState(c, siteId, result.ownerCustomerId, next);
  if (failure) return failure;

  // The PATCH writes site-level config straight to `editableState`. Without
  // this broadcast, a connected editor's autosave path would encode its hot
  // Y.Doc back into `editableState` and silently revert the change — visible
  // to the Owner as a config toggle that "took effect" but then disappeared
  // after publish. The broadcast is what makes the toggle stick.
  try {
    await broadcastEditableStateReplaced(c.env, siteId, next);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[canvas/config] editable-state-replaced broadcast failed', { siteId, err });
    return c.json({ error: `config saved but broadcast failed: ${message}` }, 502);
  }

  return c.json({
    ok: true,
    siteNoIndex: next.siteNoIndex ?? false,
    visitorTheme: next.visitorTheme ?? 'light',
    faviconAssetId: next.faviconAssetId ?? null,
  });
});

async function assetIsImageForCustomer(
  env: Bindings,
  assetId: string,
  customerId: string,
): Promise<boolean> {
  const database = db(env);
  const rows = await database
    .select({ id: ownerAsset.id, kind: ownerAsset.kind })
    .from(ownerAsset)
    .where(and(eq(ownerAsset.id, assetId), eq(ownerAsset.customerId, customerId)))
    .limit(1);
  const row = rows[0];
  return row?.kind === 'image';
}

canvasApi.put('/sites/:siteId/pages/:pageId/seo', async (c) => {
  const siteId = c.req.param('siteId');
  const pageId = c.req.param('pageId');
  const result = await loadCanvasSiteAccess(c, siteId, 'editor');
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const body: unknown = await c.req.json();
  if (!isRecord(body)) {
    return c.json({ error: 'request body must be a JSON object' }, 400);
  }
  // Per ADR 0012 dec 1, validate.ts is the only shape gate. The route
  // trims when the value is a string but otherwise passes through; bad
  // shapes (numbers, arrays, missing title) surface as 400s via
  // persistEditableState's validateEditableSite call.
  const title = typeof body.title === 'string' ? body.title.trim() : (body.title as string);

  const description = optionalStringPatch(body, 'description');
  const ogImageAssetId = optionalStringPatch(body, 'ogImageAssetId');
  if (
    ogImageAssetId.present &&
    ogImageAssetId.value !== undefined &&
    typeof ogImageAssetId.value === 'string'
  ) {
    const isImage = await assetIsImageForCustomer(
      c.env,
      ogImageAssetId.value,
      result.ownerCustomerId,
    );
    if (!isImage) {
      return c.json({ error: 'ogImageAssetId does not match an image asset you own' }, 400);
    }
  }
  const canonical = optionalStringPatch(body, 'canonical');
  const locale = optionalStringPatch(body, 'locale');

  const nextState = patchEditablePage(result.site.editableState, pageId, (page) => {
    const nextPage: CanvasPage = { ...page, title };
    if (description.present) setOptionalPageField(nextPage, 'description', description.value);
    if (ogImageAssetId.present)
      setOptionalPageField(nextPage, 'ogImageAssetId', ogImageAssetId.value);
    if (canonical.present) setOptionalPageField(nextPage, 'canonical', canonical.value);
    if (locale.present) setOptionalPageField(nextPage, 'locale', locale.value);
    if ('noIndex' in body) {
      if (body.noIndex === true) {
        nextPage.noIndex = true;
      } else if (body.noIndex === false || body.noIndex === null || body.noIndex === undefined) {
        delete nextPage.noIndex;
      } else {
        (nextPage as unknown as Record<string, unknown>).noIndex = body.noIndex;
      }
    }
    return nextPage;
  });
  if (nextState === null) {
    return c.json({ error: 'page not found' }, 404);
  }

  const failure = await persistEditableState(c, siteId, result.ownerCustomerId, nextState);
  if (failure) return failure;

  // SEO writes bypass the Yjs autosave path entirely (small PATCH-style
  // payloads from the SEO modal). Without a broadcast, any connected
  // editor's hot Y.Doc would encode its stale `editableState` back into
  // the DB on the next autosave, silently reverting the SEO change. See
  // PATCH /config above for the canonical justification.
  try {
    await broadcastEditableStateReplaced(c.env, siteId, nextState);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[canvas/seo] editable-state-replaced broadcast failed', { siteId, err });
    return c.json({ error: `seo saved but broadcast failed: ${message}` }, 502);
  }

  return c.json({ ok: true });
});

canvasApi.put('/sites/:siteId/pages/:pageId/metadata', async (c) => {
  const siteId = c.req.param('siteId');
  const pageId = c.req.param('pageId');
  const result = await loadCanvasSiteAccess(c, siteId, 'editor');
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const body: unknown = await c.req.json();
  if (!isRecord(body)) {
    return c.json({ error: 'request body must be a JSON object' }, 400);
  }

  // Per ADR 0012 dec 1, validate.ts is the only shape gate; the route
  // only computes PATCH presence + delegates shape checking downstream.
  const publishedDate = optionalStringPatch(body, 'publishedDate');
  const author = optionalStringPatch(body, 'author');
  const category = optionalStringPatch(body, 'category');

  let tags: { present: false } | { present: true; value: string[] | undefined };
  if (!('tags' in body) || body.tags === undefined) {
    tags = { present: false };
  } else if (body.tags === null) {
    tags = { present: true, value: undefined };
  } else if (Array.isArray(body.tags)) {
    // Best-effort string normalisation; validate.ts catches per-element
    // wrong types if the request had non-strings mixed in.
    const parsedTags: string[] = [];
    for (const rawTag of body.tags) {
      if (typeof rawTag === 'string') {
        const tag = rawTag.trim();
        if (tag.length > 0) parsedTags.push(tag);
      } else {
        // Pass through; validate.ts rejects.
        parsedTags.push(rawTag as string);
      }
    }
    tags = { present: true, value: parsedTags.length > 0 ? parsedTags : undefined };
  } else {
    // Non-array, non-null — pass through; validate.ts rejects.
    tags = { present: true, value: body.tags as unknown as string[] };
  }

  const nextState = patchEditablePage(result.site.editableState, pageId, (page) => {
    const nextPage: CanvasPage = { ...page };
    if (publishedDate.present) {
      setOptionalPageField(nextPage, 'publishedDate', publishedDate.value);
    }
    if (author.present) setOptionalPageField(nextPage, 'author', author.value);
    if (category.present) setOptionalPageField(nextPage, 'category', category.value);
    if (tags.present) setOptionalPageField(nextPage, 'tags', tags.value);
    return nextPage;
  });
  if (nextState === null) {
    return c.json({ error: 'page not found' }, 404);
  }

  const failure = await persistEditableState(c, siteId, result.ownerCustomerId, nextState);
  if (failure) return failure;

  // Metadata writes bypass the Yjs autosave path entirely. See PATCH
  // /config for the canonical justification; without this broadcast a
  // connected editor's hot Y.Doc clobbers the change on the next save.
  try {
    await broadcastEditableStateReplaced(c.env, siteId, nextState);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[canvas/metadata] editable-state-replaced broadcast failed', {
      siteId,
      err,
    });
    return c.json({ error: `metadata saved but broadcast failed: ${message}` }, 502);
  }

  return c.json({ ok: true });
});

// DEPRECATED. Maximum payload size for the legacy data-URL upload bridge.
// The editor has been migrated to the canonical multipart endpoint
// (`POST /api/owner/assets`, ADR 0004 + 0006) and no in-tree caller hits
// this route any longer. It is retained only so older deployed editor
// builds during the rollout window do not 404, and will be removed in a
// follow-up commit once the rollout window closes. Cap is 2 MB of base64;
// atob inflates by ~4/3, so the binary upper bound is ~1.5 MB. Past this
// point we 413 loudly.
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

// DEPRECATED — legacy upload bridge for the editor. Translates the
// editor's old JSON shape (`{ dataUrl, alt }`) into an Owner-rooted upload
// via the shared `uploadOwnerAsset` primitive. The editor now POSTs
// multipart directly to `/api/owner/assets` (ADR 0004 + 0006), and there
// are no remaining in-tree callers of this route. It is retained only so
// older deployed editor builds during the rollout window do not 404, and
// will be removed in a follow-up commit once the rollout window closes.
canvasApi.post('/sites/:siteId/assets', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadCanvasSiteAccess(c, siteId, 'editor');
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
        customerId: result.ownerCustomerId,
        bytes: decoded.bytes,
        mediaType: decoded.mediaType,
        alt: parsed.alt,
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

// ADR 0004 decision 2: AI generation previews are NOT Owner Assets until the
// owner applies them to a slot. This route returns the raw bytes from
// Replicate back to the browser; the browser holds them through the preview
// moment. Only on Apply does the editor POST the bytes to
// `/api/owner/assets` (multipart) and create the Owner Asset row. Discarded
// previews are gone when the tab closes. The server holds no transient asset
// state — no DB row, no R2 put — which removes the cleanup job that would
// otherwise be required.
canvasApi.post('/sites/:siteId/assets/generate', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadCanvasSiteAccess(c, siteId, 'editor');
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

  // Mirror the upload-path size budget so an oversized generation is
  // rejected loudly. The browser would also refuse to re-upload an oversize
  // payload via `/api/owner/assets`, but failing here is a clearer signal.
  if (image.bytes.byteLength > MAX_ASSET_DATA_URL_BYTES) {
    return c.json({ error: 'generated asset too large' }, 413);
  }

  // Construct from a fresh ArrayBuffer slice so Response sees a plain
  // BodyInit and not a Uint8Array view (the latter is rejected by some
  // Worker runtimes' Response constructor type contract).
  const bodyBytes = image.bytes.slice().buffer;
  return new Response(bodyBytes, {
    status: 200,
    headers: {
      'Content-Type': image.mediaType,
      'Cache-Control': 'no-store',
      'Content-Length': String(image.bytes.byteLength),
    },
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
  const result = await loadCanvasSiteAccess(c, siteId, 'viewer');
  if (!result.found) {
    return c.json({ error: 'site not found' }, 404);
  }

  const database = db(c.env);
  // The asset id may be a UUID (typical) or a content hash (when the
  // caller already speaks the ADR 0006 URL shape). Match either; require
  // Owner ownership in both branches.
  //
  // Seed-id fallback: pre-2026-06 sites still carry raw seed ids in their
  // editable_state (e.g. `seed-hero-poster-1`) because they were created
  // before `prepareSeedAssetsForCustomer` rewrote those references to the
  // `seed-{customerId}-{seedId}` form. The owner_asset row for the raw
  // seed-id doesn't exist for those Owners — but the row keyed by the
  // seed's content_hash does, because two seed ids that share bytes share
  // a row under the `(customer_id, content_hash)` unique index. When the
  // caller asks for a known seed id, translate to its content hash so the
  // existing row resolves instead of 404'ing.
  const seedAsset = getSeedAsset(assetId);
  const lookupContentHash = seedAsset?.contentHash;
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
        eq(ownerAsset.customerId, result.ownerCustomerId),
        lookupContentHash !== undefined
          ? or(
              eq(ownerAsset.id, assetId),
              eq(ownerAsset.contentHash, assetId),
              eq(ownerAsset.contentHash, lookupContentHash),
            )
          : or(eq(ownerAsset.id, assetId), eq(ownerAsset.contentHash, assetId)),
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
  try {
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
  } catch (error) {
    console.error('[canvas/assets] legacy bridge failed:', error);
    return c.json({ error: 'asset not found' }, 404);
  }
});

canvasApi.post('/sites/:siteId/style-kit', async (c) => {
  const siteId = c.req.param('siteId');
  const result = await loadCanvasSiteAccess(c, siteId, 'editor');
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

  const nextState: EditableSite = {
    ...result.site.editableState,
    styleKit: incoming,
  };

  const failure = await persistEditableState(c, siteId, result.ownerCustomerId, nextState, {
    styleKit: incoming,
  });
  if (failure) return failure;

  // Style-kit writes bypass the Yjs autosave path. See PATCH /config for
  // the canonical justification; without this broadcast a connected
  // editor's hot Y.Doc clobbers the kit swap on the next save.
  try {
    await broadcastEditableStateReplaced(c.env, siteId, nextState);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[canvas/style-kit] editable-state-replaced broadcast failed', {
      siteId,
      err,
    });
    return c.json({ error: `style kit saved but broadcast failed: ${message}` }, 502);
  }

  return c.json({ ok: true, styleKit: incoming });
});

export default canvasApi;
