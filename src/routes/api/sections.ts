// src/routes/api/sections.ts
//
// Owner-facing endpoints for cross-template section reuse.
// - GET  /api/templates/sections — owner-only catalog from all template seeds.
// - POST /api/sites/:siteId/sections/import — clone a section from a template
//   seed into the owner's site at a chosen slot, materialising seed media.

import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { importSectionIntoSite } from '../../canvas/section-import';
import { validateCanvasSiteState } from '../../canvas/validate';
import { db } from '../../db/client';
import { customer, site, siteAsset } from '../../db/schema';
import { allTemplateSeeds } from '../../templates/registry';
import { SECTION_CATALOG } from '../../templates/section-catalog';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const sections = new Hono<Env>();

sections.use('*', clerkAuth());
sections.use('*', requireAuth());

sections.get('/templates/sections', (c) => {
  return c.json({ sections: SECTION_CATALOG });
});

interface ImportBody {
  templateId: string;
  sectionId: string;
  insertAt: number;
}

type ParsedBody = { ok: true; body: ImportBody } | { ok: false; error: string };

function parseImportBody(value: unknown): ParsedBody {
  if (!value || typeof value !== 'object') return { ok: false, error: 'body must be an object' };
  const v = value as Record<string, unknown>;
  if (typeof v.templateId !== 'string' || v.templateId.length === 0) {
    return { ok: false, error: 'templateId is required' };
  }
  if (typeof v.sectionId !== 'string' || v.sectionId.length === 0) {
    return { ok: false, error: 'sectionId is required' };
  }
  if (typeof v.insertAt !== 'number' || !Number.isInteger(v.insertAt) || v.insertAt < 0) {
    return { ok: false, error: 'insertAt must be a non-negative integer' };
  }
  return {
    ok: true,
    body: { templateId: v.templateId, sectionId: v.sectionId, insertAt: v.insertAt },
  };
}

sections.post('/sites/:siteId/sections/import', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('sections api reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = parseImportBody(raw);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }
  const { templateId, sectionId, insertAt } = parsed.body;

  const seed = allTemplateSeeds.find((t) => t.id === templateId);
  if (!seed) {
    return c.json({ error: `unknown templateId: ${templateId}` }, 404);
  }
  const sourceSection = seed.state.pages[0]?.sections.find((s) => s.id === sectionId);
  if (!sourceSection) {
    return c.json({ error: `unknown sectionId in template: ${sectionId}` }, 404);
  }

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return c.json({ error: 'no customer row for current user' }, 409);
  }

  const siteRow = await database
    .select({ id: site.id, customerId: site.customerId, editableState: site.editableState })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1);
  const siteRecord = siteRow[0];
  if (!siteRecord) {
    return c.json({ error: 'site not found' }, 404);
  }
  if (siteRecord.customerId !== customerId) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const state = siteRecord.editableState;
  const page = state.pages[0];
  if (!page) {
    return c.json({ error: 'site editable state has no page' }, 500);
  }
  if (insertAt > page.sections.length) {
    return c.json(
      { error: `insertAt ${insertAt} exceeds section count ${page.sections.length}` },
      400,
    );
  }

  const existingAssetRows = await database
    .select({ id: siteAsset.id })
    .from(siteAsset)
    .where(eq(siteAsset.siteId, siteId));
  const existingAssetIds = new Set(existingAssetRows.map((r) => r.id));

  const importResult = importSectionIntoSite({
    targetSiteId: siteId,
    sourceSection,
    existingAssetIds,
  });
  if (!importResult.ok) {
    return c.json({ error: 'section import failed', details: importResult.errors }, 500);
  }

  page.sections.splice(insertAt, 0, importResult.section);

  const validation = validateCanvasSiteState(state);
  if (!validation.valid) {
    return c.json(
      { error: 'imported section produced invalid state', details: validation.errors },
      500,
    );
  }

  const siteUpdate = database
    .update(site)
    .set({ editableState: state, updatedAt: sql`now()` })
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)));
  if (importResult.newAssetRows.length === 0) {
    await siteUpdate;
  } else {
    const assetInsert = database.insert(siteAsset).values(importResult.newAssetRows);
    await database.batch([siteUpdate, assetInsert]);
  }

  return c.json({ editableState: state });
});

export default sections;
