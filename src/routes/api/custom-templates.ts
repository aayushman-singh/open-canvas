// src/routes/api/custom-templates.ts
//
// Owner + admin routes for custom templates.
//
// Owner routes (Clerk-gated):
//   GET    /api/custom-templates              — list global + Owner's private
//   POST   /api/custom-templates              — save site as private template
//   DELETE /api/custom-templates/:id          — delete a private template
//
// Admin routes (Clerk + requireAdmin):
//   POST   /api/admin/custom-templates        — save site as global template
//   DELETE /api/admin/custom-templates/:id    — delete a global template
//
// Preview routes (Clerk-gated, used by template picker):
//   GET    /api/custom-templates/:id/preview  — render preview HTML
//   GET    /api/custom-templates/:id/assets/:assetId — serve asset from R2

import { and, eq, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { requireAdmin } from '../../auth/require-admin.js';
import { canvasPublishedStyles } from '../../canvas/public-styles.js';
import { renderCanvasSnapshot } from '../../canvas/render.js';
import { requireTurnstileSiteKey } from '../../canvas/elements/form.js';
import type { EditableSite, PublishedSnapshot } from '../../canvas/schema.js';
import { validateEditableSite } from '../../canvas/validate.js';
import { db } from '../../db/client.js';
import {
  customer,
  customTemplate,
  ownerAsset,
  site,
  type AssetManifestEntry,
} from '../../db/schema.js';
import { canReadScopedLibraryRow, escapeHtmlText } from './library-access.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  ADMIN_CLERK_USER_IDS?: string;
  ASSETS_BUCKET: R2Bucket;
  TURNSTILE_SITE_KEY?: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveCustomerId(
  database: ReturnType<typeof db>,
  clerkUserId: string,
): Promise<string | null> {
  const row = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUserId))
    .limit(1);
  return row[0]?.id ?? null;
}

function collectAssetIds(state: EditableSite): Set<string> {
  const ids = new Set<string>();
  for (const page of state.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.type !== 'media') continue;
        ids.add(element.assetId);
        if (element.mediaKind === 'video' && element.posterAssetId !== undefined) {
          ids.add(element.posterAssetId);
        }
      }
    }
  }
  return ids;
}

async function buildAssetManifest(
  database: ReturnType<typeof db>,
  customerId: string,
  state: EditableSite,
): Promise<AssetManifestEntry[]> {
  const assetIds = collectAssetIds(state);
  if (assetIds.size === 0) return [];

  const rows = await database
    .select({
      id: ownerAsset.id,
      contentHash: ownerAsset.contentHash,
      r2Key: ownerAsset.r2Key,
      mediaType: ownerAsset.mediaType,
      kind: ownerAsset.kind,
      alt: ownerAsset.alt,
      width: ownerAsset.width,
      height: ownerAsset.height,
      byteSize: ownerAsset.byteSize,
    })
    .from(ownerAsset)
    .where(eq(ownerAsset.customerId, customerId));

  const manifest: AssetManifestEntry[] = [];
  for (const row of rows) {
    if (!assetIds.has(row.id)) continue;
    manifest.push({
      assetId: row.id,
      contentHash: row.contentHash,
      r2Key: row.r2Key,
      mediaType: row.mediaType,
      kind: row.kind,
      alt: row.alt,
      width: row.width,
      height: row.height,
      byteSize: row.byteSize,
    });
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

interface SaveBody {
  siteId: string;
  name: string;
  tagline?: string;
}

function parseSaveBody(value: unknown): SaveBody | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'body must be an object' };
  const v = value as Record<string, unknown>;
  if (typeof v.siteId !== 'string' || v.siteId.length === 0) {
    return { error: 'siteId is required' };
  }
  if (typeof v.name !== 'string' || v.name.length === 0) {
    return { error: 'name is required' };
  }
  const tagline = typeof v.tagline === 'string' ? v.tagline : '';
  return { siteId: v.siteId, name: v.name, tagline };
}

// ---------------------------------------------------------------------------
// Catalog entry type returned by GET
// ---------------------------------------------------------------------------

export interface CustomTemplateCatalogEntry {
  source: 'custom';
  id: string;
  name: string;
  tagline: string;
  styleKit: string;
  visibility: 'global' | 'private';
}

// ---------------------------------------------------------------------------
// Owner routes
// ---------------------------------------------------------------------------

export const customTemplatesOwner = new Hono<Env>();
customTemplatesOwner.use('*', clerkAuth());
customTemplatesOwner.use('*', requireAuth());

customTemplatesOwner.get('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('custom-templates reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);

  const whereClause = customerId
    ? or(eq(customTemplate.visibility, 'global'), eq(customTemplate.customerId, customerId))
    : eq(customTemplate.visibility, 'global');

  const rows = await database
    .select({
      id: customTemplate.id,
      name: customTemplate.name,
      tagline: customTemplate.tagline,
      styleKit: customTemplate.styleKit,
      visibility: customTemplate.visibility,
    })
    .from(customTemplate)
    .where(whereClause);

  const entries: CustomTemplateCatalogEntry[] = rows.map((r) => ({
    source: 'custom',
    id: r.id,
    name: r.name,
    tagline: r.tagline,
    styleKit: r.styleKit,
    visibility: r.visibility,
  }));

  return c.json({ templates: entries });
});

customTemplatesOwner.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('custom-templates reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);
  if (!customerId) return c.json({ error: 'no customer row' }, 409);

  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = parseSaveBody(raw);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const siteRow = await database
    .select({ editableState: site.editableState })
    .from(site)
    .where(and(eq(site.id, parsed.siteId), eq(site.customerId, customerId)))
    .limit(1);
  const siteState = siteRow[0]?.editableState;
  if (!siteState) return c.json({ error: 'site not found' }, 404);

  const validation = validateEditableSite(siteState);
  if (!validation.valid) {
    return c.json({ error: 'site state invalid', details: validation.errors }, 400);
  }

  const manifest = await buildAssetManifest(database, customerId, siteState);

  const [row] = await database
    .insert(customTemplate)
    .values({
      customerId,
      visibility: 'private',
      name: parsed.name,
      tagline: parsed.tagline ?? '',
      styleKit: siteState.styleKit,
      siteState,
      assetManifest: manifest,
    })
    .returning({ id: customTemplate.id });

  return c.json({ ok: true, id: row!.id });
});

customTemplatesOwner.delete('/:id', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('custom-templates reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);
  if (!customerId) return c.json({ error: 'no customer row' }, 409);

  const deleted = await database
    .delete(customTemplate)
    .where(
      and(
        eq(customTemplate.id, c.req.param('id')),
        eq(customTemplate.customerId, customerId),
        eq(customTemplate.visibility, 'private'),
      ),
    )
    .returning({ id: customTemplate.id });

  if (deleted.length === 0) return c.json({ error: 'template not found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Preview routes (for template picker)
// ---------------------------------------------------------------------------

const previewStyles = `
  html, body { margin: 0; overflow: hidden; background: #05070c; }
`;

customTemplatesOwner.get('/:id/preview', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('custom-template preview reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);
  const row = await database
    .select({
      siteState: customTemplate.siteState,
      name: customTemplate.name,
      visibility: customTemplate.visibility,
      customerId: customTemplate.customerId,
    })
    .from(customTemplate)
    .where(eq(customTemplate.id, c.req.param('id')))
    .limit(1);
  const tmpl = row[0];
  if (!tmpl || !canReadScopedLibraryRow(tmpl, customerId)) {
    return c.text('template not found', 404);
  }

  const snapshot: PublishedSnapshot = {
    version: 1,
    publishedAt: new Date().toISOString(),
    styleKit: tmpl.siteState.styleKit,
    pages: tmpl.siteState.pages,
    ...(tmpl.siteState.header ? { header: tmpl.siteState.header } : {}),
    ...(tmpl.siteState.footer ? { footer: tmpl.siteState.footer } : {}),
    ...(tmpl.siteState.customStyleKit ? { customStyleKit: tmpl.siteState.customStyleKit } : {}),
  };
  // Template previews have no backing site yet — forms inside a preview
  // cannot submit to a real /__rev01/forms/<siteId>/<formId> endpoint. Pass
  // an explicit synthetic id so the renderer's siteId check still passes and
  // any accidental form POST hits a 404 against the forms router instead of
  // a silent double-slash URL.
  const html = renderCanvasSnapshot(
    snapshot,
    `/api/custom-templates/${c.req.param('id')}/assets`,
    '__template-preview__',
    { turnstileSiteKey: requireTurnstileSiteKey(c.env) },
  );

  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtmlText(tmpl.name)} preview</title><style>${canvasPublishedStyles}</style><style>${previewStyles}</style></head><body>${html}</body></html>`,
  );
});

customTemplatesOwner.get('/:id/assets/:assetId', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('custom-template asset route reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);
  const row = await database
    .select({
      assetManifest: customTemplate.assetManifest,
      visibility: customTemplate.visibility,
      customerId: customTemplate.customerId,
    })
    .from(customTemplate)
    .where(eq(customTemplate.id, c.req.param('id')))
    .limit(1);
  const tmpl = row[0];
  if (!tmpl || !canReadScopedLibraryRow(tmpl, customerId)) {
    return c.text('template not found', 404);
  }

  const assetId = c.req.param('assetId');
  const entry = tmpl.assetManifest.find((e) => e.assetId === assetId);
  if (!entry) return c.text('asset not found in template manifest', 404);

  const r2Object = await c.env.ASSETS_BUCKET.get(entry.r2Key);
  if (!r2Object) return c.text('asset not found in storage', 404);

  return new Response(r2Object.body, {
    headers: {
      'content-type': entry.mediaType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
});

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

export const customTemplatesAdmin = new Hono<Env>();
customTemplatesAdmin.use('*', clerkAuth());
customTemplatesAdmin.use('*', requireAuth());
customTemplatesAdmin.use('*', requireAdmin());

customTemplatesAdmin.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('admin custom-templates reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);
  if (!customerId) return c.json({ error: 'no customer row' }, 409);

  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = parseSaveBody(raw);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const siteRow = await database
    .select({ editableState: site.editableState })
    .from(site)
    .where(and(eq(site.id, parsed.siteId), eq(site.customerId, customerId)))
    .limit(1);
  const siteState = siteRow[0]?.editableState;
  if (!siteState) return c.json({ error: 'site not found' }, 404);

  const validation = validateEditableSite(siteState);
  if (!validation.valid) {
    return c.json({ error: 'site state invalid', details: validation.errors }, 400);
  }

  const manifest = await buildAssetManifest(database, customerId, siteState);

  const [row] = await database
    .insert(customTemplate)
    .values({
      customerId: null,
      visibility: 'global',
      name: parsed.name,
      tagline: parsed.tagline ?? '',
      styleKit: siteState.styleKit,
      siteState,
      assetManifest: manifest,
    })
    .returning({ id: customTemplate.id });

  return c.json({ ok: true, id: row!.id });
});

customTemplatesAdmin.delete('/:id', async (c) => {
  const database = db(c.env);

  const deleted = await database
    .delete(customTemplate)
    .where(
      and(
        eq(customTemplate.id, c.req.param('id')),
        isNull(customTemplate.customerId),
        eq(customTemplate.visibility, 'global'),
      ),
    )
    .returning({ id: customTemplate.id });

  if (deleted.length === 0) return c.json({ error: 'global template not found' }, 404);
  return c.json({ ok: true });
});
