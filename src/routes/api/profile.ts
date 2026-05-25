import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { customer } from '../../db/schema';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
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
  const auth = c.get('auth');
  const database = db(c.env);

  const rows = await database
    .select({
      id: customer.id,
      email: customer.email,
      displayName: customer.displayName,
      bio: customer.bio,
      timezone: customer.timezone,
      createdAt: customer.createdAt,
    })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId!))
    .limit(1);

  if (!rows[0]) {
    return c.json({ error: 'customer not found' }, 404);
  }

  const user = c.get('user');
  return c.json({
    ...rows[0],
    clerkImageUrl: user?.imageUrl ?? null,
    clerkFirstName: user?.firstName ?? null,
    clerkLastName: user?.lastName ?? null,
  });
});

profileApi.patch('/', async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json<{
    displayName?: string;
    bio?: string;
    timezone?: string;
  }>();

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

  const database = db(c.env);
  const updatedRows = await database
    .update(customer)
    .set(updates)
    .where(eq(customer.clerkUserId, auth.userId!))
    .returning({ id: customer.id });

  if (!updatedRows[0]) {
    return c.json({ error: 'customer not found' }, 404);
  }

  return c.json({ ok: true });
});

export default profileApi;
