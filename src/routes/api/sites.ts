import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { collectReferencedAssets } from '../../assets/site-assets';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { SEED_ASSET_REGISTRY } from '../../canvas/seed-assets';
import type { CanvasSiteState, MediaKind } from '../../canvas/schema';
import { validateCanvasSiteState } from '../../canvas/validate';
import { db } from '../../db/client';
import { customer, site, siteAsset } from '../../db/schema';
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

export interface SeedSiteAssetRow {
  id: string;
  siteId: string;
  mediaType: string;
  bytesBase64: string;
  kind: MediaKind;
  alt: string;
}

type PreparedSeedAssets =
  | { ok: true; editableState: CanvasSiteState; seedRows: SeedSiteAssetRow[] }
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

function siteSeedAssetId(siteId: string, seedAssetId: string): string {
  return `seed-${siteId}-${seedAssetId}`;
}

export function prepareSeedAssetsForSite(
  siteId: string,
  state: CanvasSiteState,
): PreparedSeedAssets {
  const editableState = structuredClone(state);
  const mappedIds = new Map<string, string>();
  const seedRows: SeedSiteAssetRow[] = [];
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
    const materializedId = siteSeedAssetId(siteId, reference.assetId);
    mappedIds.set(reference.assetId, materializedId);
    seedRows.push({
      id: materializedId,
      siteId,
      mediaType: seed.mediaType,
      bytesBase64: seed.bytesBase64,
      kind: seed.kind,
      alt: seed.alt,
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
  const trimmedSubdomain = input.subdomain.trim().toLowerCase();
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

  const seed = getTemplateSeed(templateId);
  if (!seed) {
    return c.json({ error: `unknown templateId: ${templateId}` }, 404);
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

  const newSiteId = crypto.randomUUID();
  const preparedSeedAssets = prepareSeedAssetsForSite(newSiteId, seed.state);
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
  const { editableState, seedRows } = preparedSeedAssets;
  const validation = validateCanvasSiteState(editableState);
  if (!validation.valid) {
    return c.json(
      {
        error: 'template seed failed canvas validation',
        details: validation.errors,
      },
      500,
    );
  }

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
    if (seedRows.length === 0) {
      await siteInsert;
    } else {
      const assetInsert = database.insert(siteAsset).values(seedRows);
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
