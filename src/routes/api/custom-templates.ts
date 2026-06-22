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

import { and, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';

import { loadAccessibleSite } from '../../auth/accessible-site.js';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { requireAdmin, isAdmin } from '../../auth/require-admin.js';
import { canvasPublishedStyles } from '../../canvas/public-styles.js';
import { renderCanvasSnapshot } from '../../canvas/render.js';
import { requireTurnstileSiteKey } from '../../canvas/elements/form.js';
import type { PublishedSnapshot } from '../../canvas/schema.js';
import { injectInteractiveRuntime } from '../../interactive/inject.js';
import { validateEditableSite } from '../../canvas/validate.js';
import { db } from '../../db/client.js';
import {
  customer,
  customTemplate,
  CUSTOM_TEMPLATE_VISIBILITY,
  type CustomTemplateVisibility,
  site,
} from '../../db/schema.js';
import { canReadScopedLibraryRow, escapeHtmlText } from './library-access.js';
import { buildAssetManifest } from '../../templates/custom-template-assets.js';
import {
  listCuratedTemplates,
  ensureCuratedTemplateDraft,
  createCuratedTemplateDraft,
  publishCuratedTemplateDraft,
  unpublishCuratedTemplate,
  renameCuratedTemplate,
  duplicateCuratedTemplateDraft,
  deleteCuratedTemplate,
} from '../../templates/curated-admin.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  ADMIN_CLERK_USER_IDS?: string;
  ASSETS_BUCKET: R2Bucket;
  TURNSTILE_SITE_KEY?: string;
  TEMPLATE_ASSET_CUSTODIAN_CUSTOMER_ID?: string;
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

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

interface SaveBody {
  siteId: string;
  name: string;
  tagline: string;
  visibility: CustomTemplateVisibility;
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
  let visibility: CustomTemplateVisibility = 'private';
  if (typeof v.visibility === 'string') {
    if (!CUSTOM_TEMPLATE_VISIBILITY.includes(v.visibility as CustomTemplateVisibility)) {
      return { error: `visibility must be one of ${CUSTOM_TEMPLATE_VISIBILITY.join(', ')}` };
    }
    visibility = v.visibility as CustomTemplateVisibility;
  }
  return { siteId: v.siteId, name: v.name, tagline, visibility };
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

  if (parsed.visibility === 'global' && !isAdmin(auth.userId, c.env.ADMIN_CLERK_USER_IDS)) {
    return c.json({ error: 'community (global) templates require admin access' }, 403);
  }

  // Editor tier: a collaborator editing someone else's site can save it
  // into THEIR own private template library. The new `custom_template` row
  // is keyed to the caller's customer.id; only the SITE READ is widened —
  // the template row itself stays the caller's (private) or admin-owned
  // (global). Assets referenced by the section live on the site owner's
  // account, so the manifest builds against the site owner's customerId.
  const accessible = await loadAccessibleSite(
    database,
    auth.userId,
    parsed.siteId,
    'editor',
    customerId,
  );
  if (!accessible) return c.json({ error: 'site not found' }, 404);
  const siteState = accessible.editableState;

  const validation = validateEditableSite(siteState);
  if (!validation.valid) {
    return c.json({ error: 'site state invalid', details: validation.errors }, 400);
  }

  const manifest = await buildAssetManifest(database, accessible.customerId, siteState);

  const [row] = await database
    .insert(customTemplate)
    .values({
      customerId: parsed.visibility === 'global' ? null : customerId,
      visibility: parsed.visibility,
      name: parsed.name,
      tagline: parsed.tagline,
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
    ...tmpl.siteState,
    version: 1,
    publishedAt: new Date().toISOString(),
  };
  // Template previews have no backing site yet — forms inside a preview
  // cannot submit to a real /__opencanvas/forms/<siteId>/<formId> endpoint. Pass
  // an explicit synthetic id so the renderer's siteId check still passes and
  // any accidental form POST hits a 404 against the forms router instead of
  // a silent double-slash URL.
  const html = injectInteractiveRuntime(
    renderCanvasSnapshot(
      snapshot,
      `/api/custom-templates/${c.req.param('id')}/assets`,
      '__template-preview__',
      { turnstileSiteKey: requireTurnstileSiteKey(c.env) },
    ),
    snapshot,
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

customTemplatesAdmin.get('/', async (c) => {
  try {
    const templates = await listCuratedTemplates(db(c.env));
    return c.json({ templates });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[admin] Error in GET ${c.req.path}:`, msg, stack);
    return c.json({ error: msg }, 500);
  }
});

customTemplatesAdmin.post('/drafts', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const sourceId = typeof body.sourceId === 'string' ? body.sourceId : undefined;
    const sourceTemplateId = typeof body.sourceTemplateId === 'string' ? body.sourceTemplateId : undefined;
    const name = typeof body.name === 'string' ? body.name : '';
    const tagline = typeof body.tagline === 'string' ? body.tagline : undefined;

    const result = await createCuratedTemplateDraft(
      { database: db(c.env), env: c.env },
      {
        sourceId,
        sourceTemplateId,
        name,
        tagline,
      }
    );
    return c.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[admin] Error in POST ${c.req.path}:`, msg, stack);
    return c.json({ error: msg }, 500);
  }
});

customTemplatesAdmin.post('/:id/draft', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await ensureCuratedTemplateDraft(
      { database: db(c.env), env: c.env },
      id
    );
    return c.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[admin] Error in POST ${c.req.path} (id: ${id}):`, msg, stack);
    return c.json({ error: msg }, 500);
  }
});

customTemplatesAdmin.post('/:id/publish', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await publishCuratedTemplateDraft(
      { database: db(c.env), env: c.env },
      id
    );
    return c.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[admin] Error in POST ${c.req.path} (id: ${id}):`, msg, stack);
    return c.json({ error: msg }, 500);
  }
});

customTemplatesAdmin.post('/:id/unpublish', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await unpublishCuratedTemplate(
      { database: db(c.env) },
      id
    );
    return c.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[admin] Error in POST ${c.req.path} (id: ${id}):`, msg, stack);
    return c.json({ error: msg }, 500);
  }
});

customTemplatesAdmin.patch('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name : '';
    const tagline = typeof body.tagline === 'string' ? body.tagline : undefined;

    await renameCuratedTemplate(
      { database: db(c.env) },
      id,
      { name, tagline }
    );
    return c.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[admin] Error in PATCH ${c.req.path} (id: ${id}):`, msg, stack);
    return c.json({ error: msg }, 500);
  }
});

customTemplatesAdmin.post('/:id/duplicate', async (c) => {
  const id = c.req.param('id');
  try {
    const result = await duplicateCuratedTemplateDraft(
      { database: db(c.env), env: c.env },
      id
    );
    return c.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[admin] Error in POST ${c.req.path} (id: ${id}):`, msg, stack);
    return c.json({ error: msg }, 500);
  }
});

customTemplatesAdmin.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const confirmationName = typeof body.confirmationName === 'string' ? body.confirmationName : '';

    await deleteCuratedTemplate(
      { database: db(c.env) },
      id,
      confirmationName
    );
    return c.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[admin] Error in DELETE ${c.req.path} (id: ${id}):`, msg, stack);
    return c.json({ error: msg }, 500);
  }
});

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
      tagline: parsed.tagline,
      styleKit: siteState.styleKit,
      siteState,
      assetManifest: manifest,
    })
    .returning({ id: customTemplate.id });

  return c.json({ ok: true, id: row!.id });
});
