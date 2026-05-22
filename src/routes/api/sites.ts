import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { collectReferencedAssetIds } from '../../assets/site-assets';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { SEED_ASSET_REGISTRY } from '../../canvas/seed-assets';
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
export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'dashboard',
  'health',
]);

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

sites.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('POST /api/sites reached without an authenticated user');
  }

  const input = await parseInput(c);
  const trimmedName = input.siteName.trim();
  const trimmedSubdomain = input.subdomain.trim().toLowerCase();
  const templateId = input.templateId.trim() === '' ? 'starter-canvas' : input.templateId.trim();

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

  const seed = getTemplateSeed(templateId);
  if (!seed) {
    return c.json({ error: `unknown templateId: ${templateId}` }, 404);
  }

  const editableState = structuredClone(seed.state);
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

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return c.json(
      { error: 'no customer row for current user — visit /dashboard first to materialise it' },
      409,
    );
  }

  const newSiteId = crypto.randomUUID();

  // Materialise one `siteAsset` row per seed asset id referenced by the
  // template's pages. Every referenced id MUST exist in SEED_ASSET_REGISTRY
  // (the seed fixture is gated by `validateSeedFixture` at smoke time). The
  // insert runs in the SAME batch as the `site` row so site creation is
  // atomic: if either fails, neither lands.
  const referencedAssetIds = collectReferencedAssetIds(editableState.pages);
  const seedRows: Array<{
    id: string;
    siteId: string;
    mediaType: string;
    bytesBase64: string;
    kind: 'image' | 'video';
    alt: string;
  }> = [];
  const unknownSeedIds: string[] = [];
  for (const assetId of referencedAssetIds) {
    const seed = SEED_ASSET_REGISTRY[assetId];
    if (!seed) {
      unknownSeedIds.push(assetId);
      continue;
    }
    seedRows.push({
      id: assetId,
      siteId: newSiteId,
      mediaType: seed.mediaType,
      bytesBase64: seed.bytesBase64,
      kind: seed.kind,
      alt: seed.alt,
    });
  }
  if (unknownSeedIds.length > 0) {
    // Defence in depth: validateSeedFixture would have caught this in the
    // smoke. If it ever fires here the template author has shipped a fixture
    // referencing an unregistered id — fail loudly with the full list so the
    // fix is obvious.
    return c.json(
      {
        error: 'template seed references unregistered asset ids',
        unknownSeedIds,
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
