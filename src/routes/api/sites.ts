import { count, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { contentHashToR2Key, extFromMediaType } from '../../assets/hash';
import { collectReferencedAssets, isAssetSubstitutionToken } from '../../assets/site-assets';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { siteLimitError, siteLimitForPlan } from '../../billing/plan-limits';
import { SEED_ASSET_REGISTRY } from '../../canvas/seed-assets';
import type { CanvasElement, CanvasSection, EditableSite, MediaKind } from '../../canvas/schema';
import { validateEditableSite } from '../../canvas/validate';
import { db } from '../../db/client';
import {
  collectionEntry,
  customer,
  customTemplate,
  ownerAsset,
  site,
  type BillingPlan,
} from '../../db/schema';
import { canReadScopedLibraryRow } from './library-access';
import { getTemplateSeed, instantiateTemplate } from '../../templates/registry';
import { TEMPLATE_SEED_ENTRIES } from '../../templates/portfolio-seed-entries';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Reserved subdomains under the configured apex:
// - www/api/app/admin: standard reservations.
// - dashboard/health: overlap with the app's own routes.
export const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'dashboard', 'health']);

type ValidSubdomain = { valid: true };
type InvalidSubdomain = { valid: false; error: string };

// Row shape inserted into `owner_asset` when materialising a Template Seed
// for a new site. After ADR 0004 the asset root is the Owner, not the site
// — the materialised id is keyed on `customerId` so two sites under the
// same Owner share the same seed asset rows.
export interface SeedOwnerAssetRow {
  id: string;
  customerId: string;
  contentHash: string;
  r2Key: string;
  mediaType: string;
  kind: MediaKind;
  alt: string;
  width: number | null;
  height: number | null;
  byteSize: number;
}

type PreparedSeedAssets =
  | { ok: true; editableState: EditableSite; seedRows: SeedOwnerAssetRow[] }
  | {
      ok: false;
      unknownSeedIds: string[];
      assetKindErrors: Array<{ assetId: string; expectedKind: MediaKind; actualKind: MediaKind }>;
    };

export function validateSubdomain(value: string): ValidSubdomain | InvalidSubdomain {
  if (value.length === 0) {
    return { valid: false, error: 'subdomain is required' };
  }
  if (value.length < 2 || value.length > 63) {
    return { valid: false, error: 'subdomain must be 2..63 characters' };
  }
  if (!SUBDOMAIN_RE.test(value)) {
    return {
      valid: false,
      error:
        'subdomain must contain only lowercase letters, numbers, and hyphens, not starting or ending with a hyphen',
    };
  }
  if (RESERVED_SUBDOMAINS.has(value)) {
    return { valid: false, error: 'subdomain is reserved' };
  }
  return { valid: true };
}

const sites = new Hono<Env>();

sites.use('*', clerkAuth());
sites.use('*', requireAuth());

interface CreateInput {
  templateId: string;
  siteName: string;
  subdomain: string;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function parseInput(c: Context<Env>): Promise<CreateInput> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body: unknown = await c.req.json();
    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return {
      templateId: asString(record.templateId),
      siteName: asString(record.siteName),
      subdomain: asString(record.subdomain),
    };
  }
  const form = await c.req.parseBody();
  return {
    templateId: asString(form.templateId),
    siteName: asString(form.siteName),
    subdomain: asString(form.subdomain),
  };
}

function wantsJson(c: Context<Env>): boolean {
  const accept = c.req.header('accept') ?? '';
  const contentType = c.req.header('content-type') ?? '';
  return accept.includes('application/json') || contentType.includes('application/json');
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === '23505') return true;
  if (typeof e.message === 'string' && e.message.includes('duplicate key value')) return true;
  if (e.cause) return isUniqueViolation(e.cause);
  return false;
}

export function isSiteLimitViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (
    e.code === '23514' &&
    typeof e.message === 'string' &&
    e.message.includes('site limit exceeded')
  ) {
    return true;
  }
  if (e.cause) return isSiteLimitViolation(e.cause);
  return false;
}

function siteLimitResponse(c: Context<Env>, plan: BillingPlan) {
  if (siteLimitForPlan(plan) === null) {
    return null;
  }
  const error = siteLimitError(plan);
  if (wantsJson(c)) {
    return c.json({ error }, 403);
  }
  return c.redirect('/dashboard/templates', 303);
}

function customerSeedAssetId(customerId: string, seedAssetId: string): string {
  return `seed-${customerId}-${seedAssetId}`;
}

type AssetIdResolution = string | { missing: string };
type AssetIdResolver = (assetId: string, path: string) => AssetIdResolution;

function rewriteElementAssetIds(
  element: CanvasElement,
  elementPath: string,
  resolveAssetId: AssetIdResolver,
): string | null {
  // Codex review pass 3 finding 1 — every leaf that calls `resolveAssetId`
  // must first skip pre-substitution placeholder tokens (e.g.
  // `{{ogImageAssetId}}`). Pass 1 F4 added customTemplate recursion to
  // this walk; pass 2 F1 filtered tokens out of `collectReferencedAssets`
  // so `mappedIds` never contains them. Without the matching skip here,
  // the rewrite walk reaches `materializeAssetId({{ogImageAssetId}})`,
  // finds no mapping (correctly), and reports `missing` — breaking site
  // creation from any Template Seed whose Collection's customTemplate
  // carries the seeded default card. The check runs at each leaf so the
  // walk preserves the literal token verbatim — substitution happens at
  // publish time inside the materializer, not at site-creation rewrite.
  const esBgImage = element.elementStyle?.backgroundImageAssetId;
  if (
    typeof esBgImage === 'string' &&
    esBgImage.length > 0 &&
    !isAssetSubstitutionToken(esBgImage)
  ) {
    const mapped = resolveAssetId(esBgImage, `${elementPath}.elementStyle.backgroundImageAssetId`);
    if (typeof mapped !== 'string') return mapped.missing;
    element.elementStyle = { ...element.elementStyle, backgroundImageAssetId: mapped };
  }

  if (element.type === 'media') {
    if (!isAssetSubstitutionToken(element.assetId)) {
      const mapped = resolveAssetId(element.assetId, `${elementPath}.assetId`);
      if (typeof mapped !== 'string') return mapped.missing;
      element.assetId = mapped;
    }
    if (
      element.mediaKind === 'video' &&
      element.posterAssetId !== undefined &&
      !isAssetSubstitutionToken(element.posterAssetId)
    ) {
      const posterMapped = resolveAssetId(element.posterAssetId, `${elementPath}.posterAssetId`);
      if (typeof posterMapped !== 'string') return posterMapped.missing;
      element.posterAssetId = posterMapped;
    }
    return null;
  }

  if (
    element.type === 'nav' &&
    typeof element.logoAssetId === 'string' &&
    element.logoAssetId.length > 0 &&
    !isAssetSubstitutionToken(element.logoAssetId)
  ) {
    const mapped = resolveAssetId(element.logoAssetId, `${elementPath}.logoAssetId`);
    if (typeof mapped !== 'string') return mapped.missing;
    element.logoAssetId = mapped;
    return null;
  }

  if (element.type === 'carousel') {
    for (let slideIdx = 0; slideIdx < element.slides.length; slideIdx++) {
      const slide = element.slides[slideIdx];
      if (!slide) continue;
      if (isAssetSubstitutionToken(slide.assetId)) continue;
      const mapped = resolveAssetId(
        slide.assetId,
        `${elementPath}.slides[${String(slideIdx)}].assetId`,
      );
      if (typeof mapped !== 'string') return mapped.missing;
      slide.assetId = mapped;
    }
    return null;
  }

  if (element.type === 'tabs') {
    for (let tabIdx = 0; tabIdx < element.tabs.length; tabIdx++) {
      const tab = element.tabs[tabIdx];
      if (!tab) continue;
      for (let childIdx = 0; childIdx < tab.elements.length; childIdx++) {
        const child = tab.elements[childIdx];
        if (!child) continue;
        const missing = rewriteElementAssetIds(
          child,
          `${elementPath}.tabs[${String(tabIdx)}].elements[${String(childIdx)}]`,
          resolveAssetId,
        );
        if (missing !== null) return missing;
      }
    }
    return null;
  }

  if (element.type === 'collection') {
    // ADR 0063 dec 6 — per-entry instances live in `entries` (materializer
    // output). Walk them so asset-id rewrites on import touch every nested
    // media reference.
    const collectionEntries = element.entries ?? [];
    for (let entryIdx = 0; entryIdx < collectionEntries.length; entryIdx++) {
      const entry = collectionEntries[entryIdx];
      if (!entry) continue;
      for (let childIdx = 0; childIdx < entry.length; childIdx++) {
        const child = entry[childIdx];
        if (!child) continue;
        const missing = rewriteElementAssetIds(
          child,
          `${elementPath}.entries[${String(entryIdx)}][${String(childIdx)}]`,
          resolveAssetId,
        );
        if (missing !== null) return missing;
      }
    }
    // ADR 0065 D2 + codex review pass 1 — `customTemplate` carries author-
    // authored template children that may bind to fixed assetIds. Asset-id
    // rewrite on import / clone must touch them too, mirroring the
    // `entries` walk above; otherwise a cloned site arrives with stale
    // upstream asset ids inside its custom card template.
    const customTemplate = element.customTemplate ?? [];
    for (let childIdx = 0; childIdx < customTemplate.length; childIdx++) {
      const child = customTemplate[childIdx];
      if (!child) continue;
      const missing = rewriteElementAssetIds(
        child,
        `${elementPath}.customTemplate[${String(childIdx)}]`,
        resolveAssetId,
      );
      if (missing !== null) return missing;
    }
  }

  return null;
}

function rewriteSectionAssetIds(
  section: CanvasSection | undefined,
  sectionPath: string,
  resolveAssetId: AssetIdResolver,
): string | null {
  if (!section) return null;
  if (
    typeof section.backgroundVideoAssetId === 'string' &&
    section.backgroundVideoAssetId.length > 0
  ) {
    const mapped = resolveAssetId(
      section.backgroundVideoAssetId,
      `${sectionPath}.backgroundVideoAssetId`,
    );
    if (typeof mapped !== 'string') return mapped.missing;
    section.backgroundVideoAssetId = mapped;
  }
  for (let elementIdx = 0; elementIdx < section.elements.length; elementIdx++) {
    const element = section.elements[elementIdx];
    if (!element) continue;
    const missing = rewriteElementAssetIds(
      element,
      `${sectionPath}.elements[${String(elementIdx)}]`,
      resolveAssetId,
    );
    if (missing !== null) return missing;
  }
  return null;
}

function rewriteEditableSiteAssetIds(
  editableState: EditableSite,
  resolveAssetId: AssetIdResolver,
): string | null {
  for (const [pageIdx, page] of editableState.pages.entries()) {
    const pagePath = `pages[${String(pageIdx)}]`;
    if (typeof page.ogImageAssetId === 'string' && page.ogImageAssetId.length > 0) {
      const mapped = resolveAssetId(page.ogImageAssetId, `${pagePath}.ogImageAssetId`);
      if (typeof mapped !== 'string') return mapped.missing;
      page.ogImageAssetId = mapped;
    }
    for (const [sectionIdx, section] of page.sections.entries()) {
      const missing = rewriteSectionAssetIds(
        section,
        `${pagePath}.sections[${String(sectionIdx)}]`,
        resolveAssetId,
      );
      if (missing !== null) return missing;
    }
  }
  let missing = rewriteSectionAssetIds(editableState.header, 'header', resolveAssetId);
  if (missing !== null) return missing;
  missing = rewriteSectionAssetIds(editableState.footer, 'footer', resolveAssetId);
  if (missing !== null) return missing;
  if (typeof editableState.faviconAssetId === 'string' && editableState.faviconAssetId.length > 0) {
    const mapped = resolveAssetId(editableState.faviconAssetId, 'faviconAssetId');
    if (typeof mapped !== 'string') return mapped.missing;
    editableState.faviconAssetId = mapped;
  }
  return null;
}

/**
 * Materialise the Owner Asset rows a new site needs from a Template Seed.
 *
 * Re-rooted per ADR 0004: the materialised asset id is now keyed on
 * `customerId`, not `siteId`. Two sites under the same Owner share the
 * materialised seed rows; deleting one site does NOT cascade-drop the
 * shared Owner Asset. The function still rewrites the editable state's
 * MediaElement.assetId references to point at the materialised ids.
 */
export function prepareSeedAssetsForCustomer(
  customerId: string,
  state: EditableSite,
  /**
   * Existing (contentHash → ownerAsset.id) for this customer. When a seed's
   * contentHash already maps to an existing asset row, the canvas state is
   * rewritten to reference that existing id instead of materialising a new
   * `seed-{customerId}-{seedId}` row. Required for correctness under the
   * `owner_asset_customer_content_hash_unique` constraint — without this map,
   * the insert would silently no-op on conflict and the canvas state would
   * point at an id that doesn't exist.
   *
   * Pass an empty Map when the caller has no existing assets for this
   * customer (e.g. first site).
   */
  existingByHash: Map<string, string>,
): PreparedSeedAssets {
  const editableState = structuredClone(state);
  const mappedIds = new Map<string, string>();
  const seedRows: SeedOwnerAssetRow[] = [];
  const unknownSeedIds = new Set<string>();
  const assetKindErrors: Array<{
    assetId: string;
    expectedKind: MediaKind;
    actualKind: MediaKind;
  }> = [];

  for (const reference of collectReferencedAssets(editableState)) {
    const seed = SEED_ASSET_REGISTRY[reference.assetId];
    if (!seed) {
      unknownSeedIds.add(reference.assetId);
      continue;
    }
    if (seed.kind !== reference.expectedKind) {
      assetKindErrors.push({
        assetId: reference.assetId,
        expectedKind: reference.expectedKind,
        actualKind: seed.kind,
      });
      continue;
    }
    if (mappedIds.has(reference.assetId)) continue;
    const existingId = existingByHash.get(seed.contentHash);
    if (existingId !== undefined) {
      mappedIds.set(reference.assetId, existingId);
      continue;
    }
    const materializedId = customerSeedAssetId(customerId, reference.assetId);
    mappedIds.set(reference.assetId, materializedId);
    existingByHash.set(seed.contentHash, materializedId);
    seedRows.push({
      id: materializedId,
      customerId,
      contentHash: seed.contentHash,
      r2Key: contentHashToR2Key(seed.contentHash, extFromMediaType(seed.mediaType)),
      mediaType: seed.mediaType,
      kind: seed.kind,
      alt: seed.alt,
      width: seed.width,
      height: seed.height,
      byteSize: seed.byteSize,
    });
  }

  if (unknownSeedIds.size > 0 || assetKindErrors.length > 0) {
    return { ok: false, unknownSeedIds: [...unknownSeedIds], assetKindErrors };
  }

  function materializeAssetId(assetId: string, path: string): string | { missing: string } {
    const materializedAssetId = mappedIds.get(assetId);
    if (!materializedAssetId) {
      console.error(`[site-seed] missing materialized asset for ${path}: ${assetId}`);
      return { missing: assetId };
    }
    return materializedAssetId;
  }

  const missing = rewriteEditableSiteAssetIds(editableState, materializeAssetId);
  if (missing !== null) return { ok: false, unknownSeedIds: [missing], assetKindErrors: [] };

  return { ok: true, editableState, seedRows };
}

sites.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('POST /api/sites reached without an authenticated user');
  }

  const input = await parseInput(c);
  const trimmedName = input.siteName.trim();
  const derivedSubdomain =
    input.subdomain.trim().toLowerCase() ||
    trimmedName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 63);
  const trimmedSubdomain = derivedSubdomain;
  const templateId = input.templateId.trim();

  if (trimmedName.length === 0) {
    return c.json({ error: 'siteName is required' }, 400);
  }
  if (trimmedName.length > 80) {
    return c.json({ error: 'siteName must be 80 characters or fewer' }, 400);
  }

  const subdomainCheck = validateSubdomain(trimmedSubdomain);
  if (!subdomainCheck.valid) {
    return c.json({ error: subdomainCheck.error }, 400);
  }
  if (templateId.length === 0) {
    return c.json({ error: 'templateId is required' }, 400);
  }

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id, plan: customer.plan })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerRecord = customerRow[0];
  if (!customerRecord) {
    return c.json(
      { error: 'no customer row for current user - visit /dashboard first to materialise it' },
      409,
    );
  }
  const customerId = customerRecord.id;
  const customerPlan = customerRecord.plan ?? 'free';
  const siteLimit = siteLimitForPlan(customerPlan);

  if (siteLimit !== null) {
    const siteCountRows = await database
      .select({ value: count() })
      .from(site)
      .where(eq(site.customerId, customerId));
    const siteCount = siteCountRows[0]?.value ?? 0;
    if (siteCount >= siteLimit) {
      const response = siteLimitResponse(c, customerPlan);
      if (response) return response;
    }
  }

  let editableState: EditableSite;
  let assetRows: Array<typeof ownerAsset.$inferInsert> = [];

  const seed = getTemplateSeed(templateId);
  if (seed) {
    // Pre-fetch the customer's existing asset (contentHash → id) so the seed
    // materialiser can reuse rows under the `(customer_id, content_hash)`
    // unique constraint instead of generating a fresh id and getting silently
    // skipped on insert.
    const existingAssets = await database
      .select({ id: ownerAsset.id, contentHash: ownerAsset.contentHash })
      .from(ownerAsset)
      .where(eq(ownerAsset.customerId, customerId));
    const existingByHash = new Map(existingAssets.map((r) => [r.contentHash, r.id]));
    // ADR 0061 Phase D — materialise the TemplateSeed composition to an
    // EditableSite once, then feed both the asset-manifest pass and
    // editableState assignment from the same instance.
    const seedState = instantiateTemplate(seed.id);
    const preparedSeedAssets = prepareSeedAssetsForCustomer(customerId, seedState, existingByHash);
    if (!preparedSeedAssets.ok) {
      return c.json(
        {
          error: 'template seed references invalid asset ids',
          unknownSeedIds: preparedSeedAssets.unknownSeedIds,
          assetKindErrors: preparedSeedAssets.assetKindErrors,
        },
        500,
      );
    }
    editableState = preparedSeedAssets.editableState;
    assetRows = preparedSeedAssets.seedRows;
  } else {
    const dtRow = await database
      .select({
        siteState: customTemplate.siteState,
        assetManifest: customTemplate.assetManifest,
        visibility: customTemplate.visibility,
        customerId: customTemplate.customerId,
        publicationStatus: customTemplate.publicationStatus,
      })
      .from(customTemplate)
      .where(eq(customTemplate.id, templateId))
      .limit(1);
    const dt = dtRow[0];
    if (!dt) {
      return c.json({ error: `unknown templateId: ${templateId}` }, 404);
    }
    if (dt.visibility === 'global' && dt.publicationStatus !== 'published') {
      return c.json({ error: `unknown templateId: ${templateId}` }, 404);
    }
    if (!canReadScopedLibraryRow(dt, customerId)) {
      return c.json({ error: `unknown templateId: ${templateId}` }, 404);
    }

    editableState = structuredClone(dt.siteState);

    const existingAssets = await database
      .select({ id: ownerAsset.id, contentHash: ownerAsset.contentHash })
      .from(ownerAsset)
      .where(eq(ownerAsset.customerId, customerId));
    const existingByHash = new Map(existingAssets.map((r) => [r.contentHash, r.id]));

    const assetIdMap = new Map<string, string>();
    const newRows: Array<typeof ownerAsset.$inferInsert> = [];

    for (const entry of dt.assetManifest) {
      if (assetIdMap.has(entry.assetId)) continue;
      const existing = existingByHash.get(entry.contentHash);
      if (existing) {
        assetIdMap.set(entry.assetId, existing);
      } else {
        const freshId = crypto.randomUUID();
        assetIdMap.set(entry.assetId, freshId);
        existingByHash.set(entry.contentHash, freshId);
        newRows.push({
          id: freshId,
          customerId,
          contentHash: entry.contentHash,
          r2Key: entry.r2Key,
          mediaType: entry.mediaType,
          kind: entry.kind,
          alt: entry.alt,
          width: entry.width,
          height: entry.height,
          byteSize: entry.byteSize,
        });
      }
    }

    const missingTemplateAsset = rewriteEditableSiteAssetIds(editableState, (assetId, path) => {
      if (assetId === '' || assetId === '__placeholder__') return assetId;
      const mapped = assetIdMap.get(assetId);
      if (mapped === undefined) {
        console.error(`[custom-template] missing cloned asset for ${path}: ${assetId}`);
        return { missing: assetId };
      }
      return mapped;
    });
    if (missingTemplateAsset !== null) {
      return c.json(
        {
          error: 'custom template references asset ids missing from its manifest',
          unknownAssetIds: [missingTemplateAsset],
        },
        500,
      );
    }
    assetRows = newRows;
  }

  const validation = validateEditableSite(editableState);
  if (!validation.valid) {
    return c.json(
      {
        error: 'template failed canvas validation',
        details: validation.errors,
      },
      500,
    );
  }

  const newSiteId = crypto.randomUUID();
  const seedEntryDefs = TEMPLATE_SEED_ENTRIES[templateId] ?? [];
  const seedEntryRows = seedEntryDefs.map((entry) => ({
    siteId: newSiteId,
    collectionSlug: entry.collectionSlug,
    slug: entry.slug,
    title: entry.title,
    excerpt: entry.excerpt,
    body: entry.body,
    publishedDate: entry.publishedDate,
    author: entry.author,
    category: entry.category,
    tags: entry.tags,
    ogImageAssetId: entry.ogImageAssetId,
    status: entry.status,
  }));
  try {
    const siteRow = {
      id: newSiteId,
      customerId,
      name: trimmedName,
      subdomain: trimmedSubdomain,
      styleKit: editableState.styleKit,
      editableState,
      publishedSnapshot: null,
      publishedVersion: 0,
    };
    if (assetRows.length === 0 && seedEntryRows.length === 0) {
      await database.insert(site).values(siteRow);
    } else {
      // postgres-js drizzle has no `.batch()`; use a real transaction so the
      // site + its assets / seed entries land atomically.
      await database.transaction(async (tx) => {
        await tx.insert(site).values(siteRow);
        if (assetRows.length > 0) {
          await tx.insert(ownerAsset).values(assetRows).onConflictDoNothing();
        }
        if (seedEntryRows.length > 0) {
          await tx.insert(collectionEntry).values(seedEntryRows);
        }
      });
    }
  } catch (err) {
    if (isSiteLimitViolation(err)) {
      const response = siteLimitResponse(c, customerPlan);
      if (response) return response;
      console.error('site_limit_drift', { customerId, plan: customerPlan, err });
      throw err;
    }
    if (isUniqueViolation(err)) {
      return c.json({ error: 'subdomain is already taken' }, 409);
    }
    throw err;
  }

  if (wantsJson(c)) {
    return c.json({ siteId: newSiteId }, 201);
  }
  return c.redirect('/dashboard', 302);
});

// DELETE /api/sites/:siteId
//
// Owner-scoped, irreversible removal of a single site. Schema has
// `onDelete: 'cascade'` on every site-rooted FK (page / site_snapshot /
// site_collaborator / site_search_entry / site_font / form_submission /
// custom_domain / site_addon / chat_session / slot_history), so a single
// row delete drops the entire site graph. Owner Assets are owner-rooted
// (ADR 0004) and survive — they may still be referenced by other sites.
//
// 404 (not 403) on a site the caller does not own, to avoid leaking the
// existence of other owners' site ids.
sites.delete('/:siteId', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('DELETE /api/sites/:siteId reached without an authenticated user');
  }

  const siteId = c.req.param('siteId');
  if (typeof siteId !== 'string' || siteId.length === 0) {
    return c.json({ error: 'siteId is required' }, 400);
  }

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerRecord = customerRow[0];
  if (!customerRecord) {
    return c.json({ error: 'no customer row for current user' }, 409);
  }

  const targetRow = await database
    .select({ id: site.id, customerId: site.customerId })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1);
  const target = targetRow[0];
  if (!target || target.customerId !== customerRecord.id) {
    return c.json({ error: 'site not found' }, 404);
  }

  const deleted = await database.delete(site).where(eq(site.id, siteId)).returning({ id: site.id });
  if (deleted.length === 0) {
    return c.json({ error: 'site not found' }, 404);
  }

  if (wantsJson(c)) {
    return c.json({ deleted: true, siteId }, 200);
  }
  return c.redirect('/dashboard', 303);
});

export default sites;
