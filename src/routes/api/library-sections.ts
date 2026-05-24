// src/routes/api/library-sections.ts
//
// Owner + admin routes for the section library.
//
// Owner routes (all Clerk-gated):
//   GET    /api/library/sections           — list global + Owner's private sections
//   POST   /api/library/sections           — save a section from an owned site
//   DELETE /api/library/sections/:id       — delete a private library section
//
// Admin routes (Clerk + requireAdmin):
//   POST   /api/admin/library/sections     — save a section as global
//   DELETE /api/admin/library/sections/:id — delete a global library section

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { requireAdmin } from '../../auth/require-admin.js';
import type { CanvasSection, CanvasSiteState } from '../../canvas/schema.js';
import { validateCanvasSiteState } from '../../canvas/validate.js';
import { db } from '../../db/client.js';
import {
  customer,
  librarySection,
  ownerAsset,
  site,
  type AssetManifestEntry,
} from '../../db/schema.js';
import { SECTION_CATALOG, type SectionCatalogEntry } from '../../templates/section-catalog.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  ADMIN_CLERK_USER_IDS?: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstHeadingPreview(section: CanvasSection): string {
  for (const element of section.elements) {
    if (element.type !== 'text') continue;
    if (element.role !== 'heading') continue;
    const plain = element.content.map((run) => run.text).join('');
    if (plain.trim().length === 0) continue;
    return plain.length > 80 ? `${plain.slice(0, 77)}…` : plain;
  }
  return '';
}

function validateSectionForLibrary(section: CanvasSection): { valid: true } | { valid: false; errors: string[] } {
  if (section.elements.length > 200) {
    return { valid: false, errors: ['section exceeds 200 elements'] };
  }
  const jsonSize = JSON.stringify(section).length;
  if (jsonSize > 102_400) {
    return { valid: false, errors: ['section JSON exceeds 100KB'] };
  }
  const syntheticState: CanvasSiteState = {
    styleKit: 'charcoal',
    symbols: [],
    pages: [{ id: 'validate-page', slug: 'home', title: 'Validate', width: 1440, sections: [section] }],
  };
  return validateCanvasSiteState(syntheticState);
}

async function buildAssetManifest(
  database: ReturnType<typeof db>,
  customerId: string,
  section: CanvasSection,
): Promise<AssetManifestEntry[]> {
  const assetIds = new Set<string>();
  for (const element of section.elements) {
    if (element.type !== 'media') continue;
    assetIds.add(element.assetId);
    if (element.posterAssetId !== undefined) assetIds.add(element.posterAssetId);
  }
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

async function loadOwnedSection(
  database: ReturnType<typeof db>,
  customerId: string,
  siteId: string,
  sectionId: string,
): Promise<{ section: CanvasSection; state: CanvasSiteState } | null> {
  const siteRow = await database
    .select({ editableState: site.editableState })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const state = siteRow[0]?.editableState;
  if (!state) return null;
  const page = state.pages[0];
  if (!page) return null;
  const section = page.sections.find((s) => s.id === sectionId);
  if (!section) return null;
  return { section, state };
}

// ---------------------------------------------------------------------------
// Catalog response type (merged seed + library sections)
// ---------------------------------------------------------------------------

export interface LibraryCatalogEntry {
  source: 'seed' | 'library';
  id: string;
  name: string;
  recipeId: string;
  headingPreview: string;
  visibility: 'global' | 'private';
  templateId?: string;
  templateName?: string;
  librarySectionId?: string;
}

function seedEntryToCatalog(entry: SectionCatalogEntry): LibraryCatalogEntry {
  return {
    source: 'seed',
    id: `${entry.templateId}:${entry.sectionId}`,
    name: entry.sectionName,
    recipeId: entry.recipeId,
    headingPreview: entry.headingPreview,
    visibility: 'global',
    templateId: entry.templateId,
    templateName: entry.templateName,
  };
}

// ---------------------------------------------------------------------------
// Owner routes
// ---------------------------------------------------------------------------

export const librarySectionsOwner = new Hono<Env>();
librarySectionsOwner.use('*', clerkAuth());
librarySectionsOwner.use('*', requireAuth());

librarySectionsOwner.get('/sections', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('library sections reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);

  const catalog: LibraryCatalogEntry[] = SECTION_CATALOG.map(seedEntryToCatalog);

  const whereClause = customerId
    ? or(eq(librarySection.visibility, 'global'), eq(librarySection.customerId, customerId))
    : eq(librarySection.visibility, 'global');

  const rows = await database
    .select({
      id: librarySection.id,
      name: librarySection.name,
      recipeId: librarySection.recipeId,
      headingPreview: librarySection.headingPreview,
      visibility: librarySection.visibility,
    })
    .from(librarySection)
    .where(whereClause!);

  for (const row of rows) {
    catalog.push({
      source: 'library',
      id: row.id,
      name: row.name,
      recipeId: row.recipeId,
      headingPreview: row.headingPreview,
      visibility: row.visibility as 'global' | 'private',
      librarySectionId: row.id,
    });
  }

  return c.json({ sections: catalog });
});

interface SaveBody {
  siteId: string;
  sectionId: string;
  name: string | undefined;
}

function parseSaveBody(value: unknown): SaveBody | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'body must be an object' };
  const v = value as Record<string, unknown>;
  if (typeof v.siteId !== 'string' || v.siteId.length === 0) {
    return { error: 'siteId is required' };
  }
  if (typeof v.sectionId !== 'string' || v.sectionId.length === 0) {
    return { error: 'sectionId is required' };
  }
  const name = typeof v.name === 'string' && v.name.length > 0 ? v.name : undefined;
  return { siteId: v.siteId, sectionId: v.sectionId, name };
}

librarySectionsOwner.post('/sections', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('library sections reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);
  if (!customerId) return c.json({ error: 'no customer row' }, 409);

  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = parseSaveBody(raw);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const loaded = await loadOwnedSection(database, customerId, parsed.siteId, parsed.sectionId);
  if (!loaded) return c.json({ error: 'section not found in owned site' }, 404);

  const validation = validateSectionForLibrary(loaded.section);
  if (!validation.valid) {
    return c.json({ error: 'section invalid for library', details: validation.errors }, 400);
  }

  const manifest = await buildAssetManifest(database, customerId, loaded.section);
  const heading = firstHeadingPreview(loaded.section);

  const [row] = await database
    .insert(librarySection)
    .values({
      customerId,
      visibility: 'private',
      name: parsed.name ?? loaded.section.name,
      recipeId: loaded.section.recipeId,
      sectionData: loaded.section,
      assetManifest: manifest,
      headingPreview: heading.length > 0 ? heading : loaded.section.recipeId,
    })
    .returning({ id: librarySection.id });

  return c.json({ ok: true, id: row!.id });
});

librarySectionsOwner.delete('/sections/:id', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('library sections reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);
  if (!customerId) return c.json({ error: 'no customer row' }, 409);

  const deleted = await database
    .delete(librarySection)
    .where(
      and(
        eq(librarySection.id, c.req.param('id')),
        eq(librarySection.customerId, customerId),
        eq(librarySection.visibility, 'private'),
      ),
    )
    .returning({ id: librarySection.id });

  if (deleted.length === 0) return c.json({ error: 'section not found' }, 404);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

export const librarySectionsAdmin = new Hono<Env>();
librarySectionsAdmin.use('*', clerkAuth());
librarySectionsAdmin.use('*', requireAuth());
librarySectionsAdmin.use('*', requireAdmin());

librarySectionsAdmin.post('/sections', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('admin library sections reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);
  if (!customerId) return c.json({ error: 'no customer row' }, 409);

  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = parseSaveBody(raw);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const loaded = await loadOwnedSection(database, customerId, parsed.siteId, parsed.sectionId);
  if (!loaded) return c.json({ error: 'section not found in owned site' }, 404);

  const validation = validateSectionForLibrary(loaded.section);
  if (!validation.valid) {
    return c.json({ error: 'section invalid for library', details: validation.errors }, 400);
  }

  const manifest = await buildAssetManifest(database, customerId, loaded.section);
  const heading = firstHeadingPreview(loaded.section);

  const [row] = await database
    .insert(librarySection)
    .values({
      customerId: null,
      visibility: 'global',
      name: parsed.name ?? loaded.section.name,
      recipeId: loaded.section.recipeId,
      sectionData: loaded.section,
      assetManifest: manifest,
      headingPreview: heading.length > 0 ? heading : loaded.section.recipeId,
    })
    .returning({ id: librarySection.id });

  return c.json({ ok: true, id: row!.id });
});

librarySectionsAdmin.delete('/sections/:id', async (c) => {
  const database = db(c.env);

  const deleted = await database
    .delete(librarySection)
    .where(
      and(
        eq(librarySection.id, c.req.param('id')),
        isNull(librarySection.customerId),
        eq(librarySection.visibility, 'global'),
      ),
    )
    .returning({ id: librarySection.id });

  if (deleted.length === 0) return c.json({ error: 'global section not found' }, 404);
  return c.json({ ok: true });
});
