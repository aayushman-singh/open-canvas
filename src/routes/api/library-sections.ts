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

import { and, eq, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware.js';
import { requireAuth } from '../../auth/require-auth.js';
import { requireAdmin, isAdmin } from '../../auth/require-admin.js';
import { categoryForRecipe, ORIGIN_TO_BASE_SLUG } from '../../canvas/section-library/index.js';
import type { CanvasSection, EditableSite } from '../../canvas/schema.js';
import { validateEditableSite } from '../../canvas/validate.js';
import { db } from '../../db/client.js';
import {
  customer,
  librarySection,
  LIBRARY_SECTION_VISIBILITY,
  type LibrarySectionVisibility,
  ownerAsset,
  SECTION_CATEGORIES,
  type SectionCategory,
  site,
  type AssetManifestEntry,
} from '../../db/schema.js';
import { SECTION_CATALOG, type SectionCatalogEntry } from '../../templates/section-catalog.js';
import { buildSectionThumbnailSvg } from '../../templates/section-thumbnail.js';

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
  const syntheticState: EditableSite = {
    styleKit: 'charcoal',
    pages: [{ id: 'validate-page', slug: 'home', title: 'Validate', width: 1440, sections: [section] }],
  };
  return validateEditableSite(syntheticState);
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
    if (element.mediaKind === 'video' && element.posterAssetId !== undefined) {
      assetIds.add(element.posterAssetId);
    }
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
      kind: row.kind,
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
): Promise<{ section: CanvasSection; state: EditableSite } | null> {
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
  /** ADR 0061 Decision 8 — closed-enum category drives the picker dropdown. */
  category: SectionCategory;
  /** ADR 0061 Decision 11 — searchable in the picker haystack. */
  description: string;
  /** Origin-named pool slug per Decision 5. Carried for haystack search. */
  baseSlug: string;
  /**
   * ISO timestamp the picker uses for the `Recently added` sort. Library
   * rows carry the row's `created_at`; seed rows synthesize a fixed
   * pre-deploy time so they sort below any Owner-saved row.
   */
  createdAt: string;
  templateId?: string;
  templateName?: string;
  sectionId?: string;
  librarySectionId?: string;
  /** Schematic SVG of the section's element layout. See templates/section-thumbnail.ts. */
  thumbnail: string;
}

/**
 * Sentinel pre-deploy timestamp for seed entries. Any real `created_at`
 * on a `library_section` row will sort above this, so the picker's
 * `Recently added` mode surfaces Owner-saved sections first.
 */
const SEED_CREATED_AT_SENTINEL = '1970-01-01T00:00:00.000Z';

function seedEntryToCatalog(entry: SectionCatalogEntry): LibraryCatalogEntry {
  // Origin map covers every TemplateSeed section after Phase C. The
  // extraction smoke gates this invariant at build time; a runtime miss
  // means a developer added a TemplateSeed without re-running
  // scripts/extract-section-library.ts. Fail loud per "no fallbacks".
  const originKey = `${entry.templateId}:${entry.sectionId}`;
  const mappedSlug = ORIGIN_TO_BASE_SLUG[originKey];
  if (mappedSlug === undefined) {
    throw new Error(
      `seedEntryToCatalog: origin map missing entry for ${originKey} — re-run scripts/extract-section-library.ts and commit the regenerated entries/manifest + origin-mapping`,
    );
  }
  return {
    source: 'seed',
    id: `${entry.templateId}:${entry.sectionId}`,
    name: entry.sectionName,
    recipeId: entry.recipeId,
    headingPreview: entry.headingPreview,
    visibility: 'global',
    category: categoryForRecipe(entry.recipeId),
    description: '',
    baseSlug: mappedSlug,
    createdAt: SEED_CREATED_AT_SENTINEL,
    templateId: entry.templateId,
    templateName: entry.templateName,
    sectionId: entry.sectionId,
    thumbnail: entry.thumbnail,
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
      description: librarySection.description,
      recipeId: librarySection.recipeId,
      headingPreview: librarySection.headingPreview,
      visibility: librarySection.visibility,
      sectionData: librarySection.sectionData,
      baseSlug: librarySection.baseSlug,
      category: librarySection.category,
      createdAt: librarySection.createdAt,
    })
    .from(librarySection)
    .where(whereClause);

  for (const row of rows) {
    catalog.push({
      source: 'library',
      id: row.id,
      name: row.name,
      recipeId: row.recipeId,
      headingPreview: row.headingPreview,
      visibility: row.visibility,
      category: row.category,
      description: row.description,
      baseSlug: row.baseSlug,
      createdAt: row.createdAt.toISOString(),
      librarySectionId: row.id,
      thumbnail: buildSectionThumbnailSvg(row.sectionData),
    });
  }

  return c.json({ sections: catalog });
});

interface SaveBody {
  siteId: string;
  sectionId: string;
  name: string | undefined;
  description: string;
  visibility: LibrarySectionVisibility;
  /** ADR 0061 Decision 8 — required, validated against SECTION_CATEGORIES. */
  category: SectionCategory;
  /**
   * ADR 0061 Decision 4 — when set, signals save-as-new on an existing
   * lineage. The handler resolves the parent row and bumps `version` while
   * inheriting `baseSlug`. When unset, the row is a v1 with no parent.
   */
  parentId: string | undefined;
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
  if (typeof v.category !== 'string') {
    return { error: `category is required and must be one of ${SECTION_CATEGORIES.join(', ')}` };
  }
  if (!SECTION_CATEGORIES.includes(v.category as SectionCategory)) {
    return { error: `category must be one of ${SECTION_CATEGORIES.join(', ')}` };
  }
  const name = typeof v.name === 'string' && v.name.length > 0 ? v.name : undefined;
  const description = typeof v.description === 'string' ? v.description : '';
  let visibility: LibrarySectionVisibility = 'private';
  if (typeof v.visibility === 'string') {
    if (!LIBRARY_SECTION_VISIBILITY.includes(v.visibility as LibrarySectionVisibility)) {
      return { error: `visibility must be one of ${LIBRARY_SECTION_VISIBILITY.join(', ')}` };
    }
    visibility = v.visibility as LibrarySectionVisibility;
  }
  const parentId = typeof v.parentId === 'string' && v.parentId.length > 0 ? v.parentId : undefined;
  return {
    siteId: v.siteId,
    sectionId: v.sectionId,
    name,
    description,
    visibility,
    category: v.category as SectionCategory,
    parentId,
  };
}

/**
 * ADR 0061 Decision 4 — save-as-new path.
 *
 * Looks up the parent row and derives the new row's `baseSlug` + `version`
 * from it. The scope (private vs global) is checked against the
 * `expectedVisibility` argument so an Owner cannot bump-version a global
 * section as if it were their own, and admins cannot accidentally bump a
 * private row through the admin route.
 */
interface ParentLineage {
  baseSlug: string;
  version: number;
  parentId: string;
}

async function resolveParentLineage(
  database: ReturnType<typeof db>,
  parentId: string,
  expectedVisibility: LibrarySectionVisibility,
  customerId: string | null,
): Promise<ParentLineage | { error: string; status: 403 | 404 }> {
  const rows = await database
    .select({
      id: librarySection.id,
      baseSlug: librarySection.baseSlug,
      version: librarySection.version,
      visibility: librarySection.visibility,
      customerId: librarySection.customerId,
    })
    .from(librarySection)
    .where(eq(librarySection.id, parentId))
    .limit(1);
  const parent = rows[0];
  if (!parent) return { error: 'parent section not found', status: 404 };
  if (parent.visibility !== expectedVisibility) {
    return { error: `parent visibility mismatch (parent is ${parent.visibility}, request is ${expectedVisibility})`, status: 403 };
  }
  if (expectedVisibility === 'private' && parent.customerId !== customerId) {
    return { error: 'parent section belongs to another customer', status: 403 };
  }
  return { baseSlug: parent.baseSlug, version: parent.version + 1, parentId: parent.id };
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

  if (parsed.visibility === 'global' && !isAdmin(auth.userId, c.env.ADMIN_CLERK_USER_IDS)) {
    return c.json({ error: 'community (global) sections require admin access' }, 403);
  }

  const loaded = await loadOwnedSection(database, customerId, parsed.siteId, parsed.sectionId);
  if (!loaded) return c.json({ error: 'section not found in owned site' }, 404);

  const validation = validateSectionForLibrary(loaded.section);
  if (!validation.valid) {
    return c.json({ error: 'section invalid for library', details: validation.errors }, 400);
  }

  const manifest = await buildAssetManifest(database, customerId, loaded.section);
  const heading = firstHeadingPreview(loaded.section);

  // ADR 0061 Decision 4 — save-as-new vs first-version.
  // `parentId` set: this row is v(parent.version+1) on parent.baseSlug.
  // `parentId` unset: this row is v1 with baseSlug mirroring the row id
  // (kept from Phase A — the legacy "save private section" flow).
  const newId = crypto.randomUUID();
  let lineage: { baseSlug: string; version: number; parentId: string | null };
  if (parsed.parentId !== undefined) {
    const resolved = await resolveParentLineage(database, parsed.parentId, parsed.visibility, parsed.visibility === 'private' ? customerId : null);
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
    lineage = resolved;
  } else {
    lineage = { baseSlug: newId, version: 1, parentId: null };
  }

  const [row] = await database
    .insert(librarySection)
    .values({
      id: newId,
      customerId: parsed.visibility === 'global' ? null : customerId,
      visibility: parsed.visibility,
      name: parsed.name ?? loaded.section.name,
      description: parsed.description,
      recipeId: loaded.section.recipeId,
      sectionData: loaded.section,
      assetManifest: manifest,
      headingPreview: heading.length > 0 ? heading : loaded.section.recipeId,
      baseSlug: lineage.baseSlug,
      version: lineage.version,
      parentId: lineage.parentId,
      category: parsed.category,
    })
    .returning({ id: librarySection.id });

  return c.json({ ok: true, id: row!.id });
});

/**
 * ADR 0061 Decision 4 — in-place edit for `visibility:'private'` rows.
 * Global rows are immutable through this route (the boot upsert is the
 * structural source of truth per Decision 2); admin-saved one-offs that
 * need editing go through save-as-new (POST with `parentId`).
 */
interface PutBody {
  name?: string;
  description?: string;
  category?: SectionCategory;
}

function parsePutBody(value: unknown): PutBody | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'body must be an object' };
  const v = value as Record<string, unknown>;
  const out: PutBody = {};
  if (v.name !== undefined) {
    if (typeof v.name !== 'string' || v.name.length === 0) return { error: 'name must be a non-empty string' };
    out.name = v.name;
  }
  if (v.description !== undefined) {
    if (typeof v.description !== 'string') return { error: 'description must be a string' };
    out.description = v.description;
  }
  if (v.category !== undefined) {
    if (typeof v.category !== 'string' || !SECTION_CATEGORIES.includes(v.category as SectionCategory)) {
      return { error: `category must be one of ${SECTION_CATEGORIES.join(', ')}` };
    }
    out.category = v.category as SectionCategory;
  }
  if (Object.keys(out).length === 0) return { error: 'body must include at least one of name, description, category' };
  return out;
}

librarySectionsOwner.put('/sections/:id', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) throw new Error('library sections reached without auth');

  const database = db(c.env);
  const customerId = await resolveCustomerId(database, auth.userId);
  if (!customerId) return c.json({ error: 'no customer row' }, 409);

  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = parsePutBody(raw);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  // Existence + ownership + visibility check, all in one round trip.
  const rows = await database
    .select({
      id: librarySection.id,
      visibility: librarySection.visibility,
      customerId: librarySection.customerId,
    })
    .from(librarySection)
    .where(eq(librarySection.id, c.req.param('id')))
    .limit(1);
  const row = rows[0];
  if (!row) return c.json({ error: 'section not found' }, 404);
  if (row.visibility === 'global') {
    return c.json({ error: 'global sections are immutable through this route (use POST with parentId to save-as-new)' }, 403);
  }
  if (row.customerId !== customerId) {
    return c.json({ error: 'section belongs to another customer' }, 403);
  }

  const updated = await database
    .update(librarySection)
    .set({
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      ...(parsed.category !== undefined ? { category: parsed.category } : {}),
      updatedAt: new Date(),
    })
    .where(eq(librarySection.id, row.id))
    .returning({ id: librarySection.id });

  if (updated.length === 0) return c.json({ error: 'section not found' }, 404);
  return c.json({ ok: true, id: updated[0]!.id });
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

  // Admin-promoted globals follow the same lineage rules as private rows
  // (Decision 4) — `parentId` set ⇒ bumped version on parent.baseSlug;
  // `parentId` unset ⇒ v1 with baseSlug mirroring the row id.
  const newId = crypto.randomUUID();
  let lineage: { baseSlug: string; version: number; parentId: string | null };
  if (parsed.parentId !== undefined) {
    const resolved = await resolveParentLineage(database, parsed.parentId, 'global', null);
    if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);
    lineage = resolved;
  } else {
    lineage = { baseSlug: newId, version: 1, parentId: null };
  }

  const [row] = await database
    .insert(librarySection)
    .values({
      id: newId,
      customerId: null,
      visibility: 'global',
      name: parsed.name ?? loaded.section.name,
      description: parsed.description,
      recipeId: loaded.section.recipeId,
      sectionData: loaded.section,
      assetManifest: manifest,
      headingPreview: heading.length > 0 ? heading : loaded.section.recipeId,
      baseSlug: lineage.baseSlug,
      version: lineage.version,
      parentId: lineage.parentId,
      category: parsed.category,
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
