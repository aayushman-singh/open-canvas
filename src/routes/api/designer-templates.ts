// src/routes/api/designer-templates.ts
//
// Owner + admin routes for designer-created templates.
//
// Owner routes (Clerk-gated):
//   GET    /api/designer-templates              — list global + Owner's private
//   POST   /api/designer-templates              — save site as private template
//   DELETE /api/designer-templates/:id          — delete a private template
//
// Admin routes (Clerk + requireAdmin):
//   POST   /api/admin/designer-templates        — save site as global template
//   DELETE /api/admin/designer-templates/:id    — delete a global template
//
// Preview routes (Clerk-gated, used by template picker):
//   GET    /api/designer-templates/:id/preview  — render preview HTML
//   GET    /api/designer-templates/:id/assets/:assetId — serve asset from R2

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw as rawHtml } from 'hono/html';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { requireAdmin } from '../../auth/require-admin.js';
import { canvasPublishedStyles } from '../../canvas/public-styles.js';
import { renderCanvasSnapshot } from '../../canvas/render.js';
import type { CanvasSiteState, PublishedSnapshot } from '../../canvas/schema.js';
import { validateCanvasSiteState } from '../../canvas/validate.js';
import { db } from '../../db/client.js';
import {
  customer,
  designerTemplate,
  ownerAsset,
  site,
  type AssetManifestEntry,
} from '../../db/schema.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  ADMIN_CLERK_USER_IDS?: string;
  ASSETS_BUCKET: R2Bucket;
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

function collectAssetIds(state: CanvasSiteState): Set<string> {
  const ids = new Set<string>();
  for (const page of state.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.type !== 'media') continue;
        ids.add(element.assetId);
        if (element.posterAssetId !== undefined) ids.add(element.posterAssetId);
      }
    }
  }
  return ids;
}

async function buildAssetManifest(
  database: ReturnType<typeof db>,
  customerId: string,
  state: CanvasSiteState,
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
      kind: row.kind as 'image' | 'video',
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

export interface DesignerTemplateCatalogEntry {
  source: 'designer';
  id: string;
  name: string;
  tagline: string;
  styleKit: string;
  visibility: 'global' | 'private';
}

// ---------------------------------------------------------------------------
// Owner routes
// ---------------------------------------------------------------------------

export const designerTemplatesOwner = new Hono<Env>();
designerTemplatesOwner.use('*', clerkAuth());
designerTemplatesOwner.use('*', requireAuth());

designerTemplatesOwner.get('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('designer-templates reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);

  const whereClause = customerId
    ? or(eq(designerTemplate.visibility, 'global'), eq(designerTemplate.customerId, customerId))
    : eq(designerTemplate.visibility, 'global');

  const rows = await database
    .select({
      id: designerTemplate.id,
      name: designerTemplate.name,
      tagline: designerTemplate.tagline,
      styleKit: designerTemplate.styleKit,
      visibility: designerTemplate.visibility,
    })
    .from(designerTemplate)
    .where(whereClause!);

  const entries: DesignerTemplateCatalogEntry[] = rows.map((r) => ({
    source: 'designer' as const,
    id: r.id,
    name: r.name,
    tagline: r.tagline,
    styleKit: r.styleKit,
    visibility: r.visibility as 'global' | 'private',
  }));

  return c.json({ templates: entries });
});

designerTemplatesOwner.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('designer-templates reached without auth');

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

  const validation = validateCanvasSiteState(siteState);
  if (!validation.valid) {
    return c.json({ error: 'site state invalid', details: validation.errors }, 400);
  }

  const manifest = await buildAssetManifest(database, customerId, siteState);

  const [row] = await database
    .insert(designerTemplate)
    .values({
      customerId,
      visibility: 'private',
      name: parsed.name,
      tagline: parsed.tagline ?? '',
      styleKit: siteState.styleKit,
      siteState,
      assetManifest: manifest,
    })
    .returning({ id: designerTemplate.id });

  return c.json({ ok: true, id: row!.id });
});

designerTemplatesOwner.delete('/:id', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('designer-templates reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);
  if (!customerId) return c.json({ error: 'no customer row' }, 409);

  const deleted = await database
    .delete(designerTemplate)
    .where(
      and(
        eq(designerTemplate.id, c.req.param('id')),
        eq(designerTemplate.customerId, customerId),
        eq(designerTemplate.visibility, 'private'),
      ),
    )
    .returning({ id: designerTemplate.id });

  if (deleted.length === 0) return c.json({ error: 'template not found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Preview routes (for template picker)
// ---------------------------------------------------------------------------

const previewStyles = `
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #05070c; }
  .rev01-preview-stage { width: 316.8px; min-height: 400px; margin: 0 auto; overflow: visible; }
  .rev01-preview-stage > .rev01-site { width: 1440px; transform: scale(0.22); transform-origin: top left; }
  .rev01-preview-stage .rev01-page { margin: 0; }
`;

designerTemplatesOwner.get('/:id/preview', async (c) => {
  const database = db(c.env);
  const row = await database
    .select({ siteState: designerTemplate.siteState, name: designerTemplate.name })
    .from(designerTemplate)
    .where(eq(designerTemplate.id, c.req.param('id')))
    .limit(1);
  const tmpl = row[0];
  if (!tmpl) return c.text('template not found', 404);

  const snapshot: PublishedSnapshot = {
    version: 1,
    publishedAt: new Date().toISOString(),
    styleKit: tmpl.siteState.styleKit,
    pages: tmpl.siteState.pages,
  };
  const html = renderCanvasSnapshot(
    snapshot,
    `/api/designer-templates/${c.req.param('id')}/assets`,
  );

  return c.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${tmpl.name} preview</title><style>${canvasPublishedStyles}</style><style>${previewStyles}</style></head><body><div class="rev01-preview-stage">${html}</div></body></html>`,
  );
});

designerTemplatesOwner.get('/:id/assets/:assetId', async (c) => {
  const database = db(c.env);
  const row = await database
    .select({ assetManifest: designerTemplate.assetManifest })
    .from(designerTemplate)
    .where(eq(designerTemplate.id, c.req.param('id')))
    .limit(1);
  const tmpl = row[0];
  if (!tmpl) return c.text('template not found', 404);

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

export const designerTemplatesAdmin = new Hono<Env>();
designerTemplatesAdmin.use('*', clerkAuth());
designerTemplatesAdmin.use('*', requireAuth());
designerTemplatesAdmin.use('*', requireAdmin());

designerTemplatesAdmin.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('admin designer-templates reached without auth');

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

  const validation = validateCanvasSiteState(siteState);
  if (!validation.valid) {
    return c.json({ error: 'site state invalid', details: validation.errors }, 400);
  }

  const manifest = await buildAssetManifest(database, customerId, siteState);

  const [row] = await database
    .insert(designerTemplate)
    .values({
      customerId: null,
      visibility: 'global',
      name: parsed.name,
      tagline: parsed.tagline ?? '',
      styleKit: siteState.styleKit,
      siteState,
      assetManifest: manifest,
    })
    .returning({ id: designerTemplate.id });

  return c.json({ ok: true, id: row!.id });
});

designerTemplatesAdmin.delete('/:id', async (c) => {
  const database = db(c.env);

  const deleted = await database
    .delete(designerTemplate)
    .where(
      and(
        eq(designerTemplate.id, c.req.param('id')),
        isNull(designerTemplate.customerId),
        eq(designerTemplate.visibility, 'global'),
      ),
    )
    .returning({ id: designerTemplate.id });

  if (deleted.length === 0) return c.json({ error: 'global template not found' }, 404);
  return c.json({ ok: true });
});
