import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { db } from '../../db/client';
import { customer, page, site, type NewPage } from '../../db/schema';
import { getTemplate } from '../../templates/registry';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const sites = new Hono<Env>();

sites.use('*', requireAuth());

interface CreateInput {
  templateId: string;
  siteName: string;
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
    };
  }
  const form = await c.req.parseBody();
  return {
    templateId: asString(form.templateId),
    siteName: asString(form.siteName),
  };
}

function wantsJson(c: Context<Env>): boolean {
  const accept = c.req.header('accept') ?? '';
  return accept.includes('application/json');
}

sites.post('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('POST /api/sites reached without an authenticated user');
  }

  const input = await parseInput(c);
  const trimmedName = input.siteName.trim();

  if (!input.templateId) {
    return c.json({ error: 'templateId is required' }, 400);
  }
  if (trimmedName.length === 0) {
    return c.json({ error: 'siteName is required' }, 400);
  }
  if (trimmedName.length > 80) {
    return c.json({ error: 'siteName must be 80 characters or fewer' }, 400);
  }

  const descriptor = getTemplate(input.templateId);
  if (!descriptor) {
    return c.json({ error: `unknown templateId: ${input.templateId}` }, 404);
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

  // Pre-generate the site id client-side so the site insert and the page inserts
  // can ship together in one db.batch() — neon-http executes a batch as a single
  // transaction, so partial failure rolls back, but it cannot consume RETURNING
  // values from earlier statements in the same batch.
  const newSiteId = crypto.randomUUID();
  const pageRows: NewPage[] = descriptor.pages.map((p, i) => ({
    siteId: newSiteId,
    slug: p.slug,
    title: p.title,
    doc: structuredClone(p.doc),
    position: i,
  }));

  await database.batch([
    database.insert(site).values({
      id: newSiteId,
      customerId,
      name: trimmedName,
      templateId: input.templateId,
      tokens: descriptor.tokens,
    }),
    database.insert(page).values(pageRows),
  ]);

  if (wantsJson(c)) {
    return c.json({ siteId: newSiteId }, 201);
  }
  return c.redirect('/dashboard', 302);
});

export default sites;
