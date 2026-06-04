import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { customer, BILLING_PLANS, type BillingPlan } from '../../db/schema';
import {
  clerkAuth,
  getClerkUser,
  invalidateCustomerCache,
  type ClerkAuthVariables,
} from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  DEV_PUBLIC_HOST?: string;
  DATABASE_URL: string;
};

const profileApi = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

profileApi.use('*', clerkAuth());
profileApi.use('*', requireAuth());

profileApi.get('/', async (c) => {
  // c.get('customer') is the row clerkAuth() already loaded — no redundant
  // SELECT. The Clerk User is fetched lazily because the hot path skips it.
  const customerRow = c.get('customer');
  if (!customerRow) return c.json({ error: 'customer not found' }, 404);
  const user = await getClerkUser(c);
  return c.json({
    id: customerRow.id,
    email: customerRow.email,
    displayName: customerRow.displayName,
    bio: customerRow.bio,
    timezone: customerRow.timezone,
    plan: customerRow.plan,
    createdAt: customerRow.createdAt,
    clerkImageUrl: user?.imageUrl ?? null,
    clerkFirstName: user?.firstName ?? null,
    clerkLastName: user?.lastName ?? null,
  });
});

profileApi.patch('/', async (c) => {
  const auth = c.get('auth');
  let body: {
    displayName?: string;
    bio?: string;
    timezone?: string;
    plan?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'request body must be valid JSON' }, 400);
  }

  const updates: Record<string, unknown> = { updatedAt: sql`now()` };

  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string' || body.displayName.length > 100) {
      return c.json({ error: 'displayName must be a string under 100 characters' }, 400);
    }
    updates.displayName = body.displayName || null;
  }

  if (body.bio !== undefined) {
    if (typeof body.bio !== 'string' || body.bio.length > 500) {
      return c.json({ error: 'bio must be a string under 500 characters' }, 400);
    }
    updates.bio = body.bio || null;
  }

  if (body.timezone !== undefined) {
    if (typeof body.timezone !== 'string' || body.timezone.length > 80) {
      return c.json({ error: 'timezone must be a string under 80 characters' }, 400);
    }
    updates.timezone = body.timezone || 'UTC';
  }

  if (body.plan !== undefined) {
    if (!BILLING_PLANS.includes(body.plan as BillingPlan)) {
      return c.json({ error: `plan must be one of: ${BILLING_PLANS.join(', ')}` }, 400);
    }
    updates.plan = body.plan;
  }

  const database = db(c.env);
  const updatedRows = await database
    .update(customer)
    .set(updates)
    .where(eq(customer.clerkUserId, auth.userId!))
    .returning({ id: customer.id });

  if (!updatedRows[0]) {
    return c.json({ error: 'customer not found' }, 404);
  }

  // Drop the module-scope cache entry so the next request reads the fresh
  // row from Neon instead of the pre-mutation copy.
  invalidateCustomerCache(c.env.DATABASE_URL, auth.userId!);

  return c.json({ ok: true });
});

export default profileApi;
