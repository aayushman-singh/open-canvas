import { count, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { siteLimitError, siteLimitForPlan } from '../../billing/plan-limits';
import type { EditableSite } from '../../canvas/schema';
import { rewriteEditableSiteAssetIds } from '../../templates/seed-asset-materialization.js';
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

  // Option B — templates are DB rows. Every selectable template (built-in
  // seeds included) lives in `custom_template`; the seeds are imported there
  // by seed-bootstrap. `source_template_id` is kept only to re-inject
  // page-bound collection content (e.g. the portfolio blog) that is not
  // carried in the EditableSite itself.
  let assetRows: Array<typeof ownerAsset.$inferInsert> = [];

  const dtRow = await database
    .select({
      siteState: customTemplate.siteState,
      assetManifest: customTemplate.assetManifest,
      visibility: customTemplate.visibility,
      customerId: customTemplate.customerId,
      publicationStatus: customTemplate.publicationStatus,
      sourceTemplateId: customTemplate.sourceTemplateId,
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

  const collectionSeedId = dt.sourceTemplateId ?? templateId;
  const editableState: EditableSite = structuredClone(dt.siteState);

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
  const seedEntryDefs = TEMPLATE_SEED_ENTRIES[collectionSeedId] ?? [];
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
