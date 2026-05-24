import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { contentHashToR2Key, extFromMediaType } from '../../assets/hash';
import { collectReferencedAssets } from '../../assets/site-assets';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { SEED_ASSET_REGISTRY } from '../../canvas/seed-assets';
import type { CanvasSiteState, MediaKind } from '../../canvas/schema';
import { validateCanvasSiteState } from '../../canvas/validate';
import { db } from '../../db/client';
import { customer, customTemplate, ownerAsset, site } from '../../db/schema';
import { canReadScopedLibraryRow } from './library-access';
import { getTemplateSeed } from '../../templates/registry';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Reserved subdomains under *.rev01.aayushman.dev:
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
  | { ok: true; editableState: CanvasSiteState; seedRows: SeedOwnerAssetRow[] }
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
  return accept.includes('application/json');
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown };
  if (e.code === '23505') return true;
  if (typeof e.message === 'string' && e.message.includes('duplicate key value')) return true;
  if (e.cause) return isUniqueViolation(e.cause);
  return false;
}

function customerSeedAssetId(customerId: string, seedAssetId: string): string {
  return `seed-${customerId}-${seedAssetId}`;
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
  state: CanvasSiteState,
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

  for (const reference of collectReferencedAssets(editableState.pages)) {
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
    const materializedId = customerSeedAssetId(customerId, reference.assetId);
    mappedIds.set(reference.assetId, materializedId);
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

  for (const page of editableState.pages) {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.type !== 'media') continue;
        const materializedAssetId = mappedIds.get(element.assetId);
        if (!materializedAssetId) {
          return { ok: false, unknownSeedIds: [element.assetId], assetKindErrors: [] };
        }
        element.assetId = materializedAssetId;
        if (element.posterAssetId !== undefined) {
          const materializedPosterAssetId = mappedIds.get(element.posterAssetId);
          if (!materializedPosterAssetId) {
            return { ok: false, unknownSeedIds: [element.posterAssetId], assetKindErrors: [] };
          }
          element.posterAssetId = materializedPosterAssetId;
        }
      }
    }
  }

  return { ok: true, editableState, seedRows };
}

sites.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('POST /api/sites reached without an authenticated user');
  }

  const input = await parseInput(c);
  const trimmedName = input.siteName.trim();
  const derivedSubdomain = input.subdomain.trim().toLowerCase() ||
    trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63);
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
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return c.json(
      { error: 'no customer row for current user - visit /dashboard first to materialise it' },
      409,
    );
  }

  let editableState: CanvasSiteState;
  let assetRows: Array<typeof ownerAsset.$inferInsert> = [];

  const seed = getTemplateSeed(templateId);
  if (seed) {
    const preparedSeedAssets = prepareSeedAssetsForCustomer(customerId, seed.state);
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
      })
      .from(customTemplate)
      .where(eq(customTemplate.id, templateId))
      .limit(1);
    const dt = dtRow[0];
    if (!dt) {
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

    for (const page of editableState.pages) {
      for (const section of page.sections) {
        for (const element of section.elements) {
          if (element.type !== 'media') continue;
          const mapped = assetIdMap.get(element.assetId);
          if (mapped) element.assetId = mapped;
          if (element.posterAssetId !== undefined) {
            const posterMapped = assetIdMap.get(element.posterAssetId);
            if (posterMapped) element.posterAssetId = posterMapped;
          }
        }
      }
    }
    assetRows = newRows;
  }

  const validation = validateCanvasSiteState(editableState);
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
  try {
    const siteInsert = database.insert(site).values({
      id: newSiteId,
      customerId,
      name: trimmedName,
      subdomain: trimmedSubdomain,
      styleKit: editableState.styleKit,
      editableState,
      publishedSnapshot: null,
      publishedVersion: 0,
    });
    if (assetRows.length === 0) {
      await siteInsert;
    } else {
      const assetInsert = database
        .insert(ownerAsset)
        .values(assetRows)
        .onConflictDoNothing();
      await database.batch([siteInsert, assetInsert]);
    }
  } catch (err) {
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

export default sites;
