// src/password/admin-route.ts
//
// Owner-facing CRUD for the password gate:
//
//   PUT    /api/sites/:siteId/password   — enable + set/change the password.
//   DELETE /api/sites/:siteId/password   — disable the gate. Leaves
//                                          `passwordSetAt` untouched so
//                                          any cookies issued under the
//                                          old password remain invalid if
//                                          the Owner later re-enables.
//
// Auth: Clerk-gated; the request must resolve to a customer row that owns
// the site by `:siteId`. Other Owners' sites 404 to avoid leaking
// existence.
//
// Mounted by the main thread at `/api/sites/:siteId/password`.

import { and, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { hashPassword } from './hash.js';
import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import { db } from '../db/client.js';
import { customer, site } from '../db/schema.js';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const router = new Hono<Env>();

router.use('*', clerkAuth());
router.use('*', requireAuth());

async function resolveCustomerId(c: Context<Env>): Promise<string | null> {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('password admin route reached without an authenticated user');
  }
  const database = db(c.env);
  const rows = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function resolveOwnedSiteId(
  c: Context<Env>,
  customerId: string,
  siteId: string,
): Promise<string | null> {
  const database = db(c.env);
  const rows = await database
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

// Validation: passwords must be a string of >=4 and <=200 chars. Lower
// bound is intentionally loose for the POC — Owners are setting a shared
// secret for a publish-gated site, not a per-user credential, so the
// usability of a memorable short phrase outweighs strict complexity rules.
// Upper bound is just to keep the PBKDF2 derivation bounded.
const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 200;

interface PutBody {
  password?: unknown;
}

router.put('/', async (c) => {
  const customerId = await resolveCustomerId(c);
  const siteId = c.req.param('siteId');
  if (!customerId || !siteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const ownedSiteId = await resolveOwnedSiteId(c, customerId, siteId);
  if (!ownedSiteId) {
    return c.json({ error: 'site not found' }, 404);
  }

  let body: PutBody;
  try {
    body = await c.req.json<PutBody>();
  } catch {
    return c.json({ error: 'request body must be JSON with { password }' }, 400);
  }
  const passwordRaw = body.password;
  if (typeof passwordRaw !== 'string') {
    return c.json({ error: 'password is required' }, 400);
  }
  const password = passwordRaw;
  if (password.length < MIN_PASSWORD_LENGTH) {
    return c.json(
      { error: `password must be at least ${String(MIN_PASSWORD_LENGTH)} characters` },
      400,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return c.json(
      { error: `password must be ${String(MAX_PASSWORD_LENGTH)} characters or fewer` },
      400,
    );
  }

  const hashed = await hashPassword(password);
  const now = new Date();
  const database = db(c.env);
  await database
    .update(site)
    .set({
      passwordEnabled: true,
      passwordHash: hashed,
      passwordSetAt: now,
      updatedAt: now,
    })
    .where(eq(site.id, ownedSiteId));

  return c.json({ ok: true, passwordEnabled: true, passwordSetAt: now.toISOString() });
});

router.delete('/', async (c) => {
  const customerId = await resolveCustomerId(c);
  const siteId = c.req.param('siteId');
  if (!customerId || !siteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const ownedSiteId = await resolveOwnedSiteId(c, customerId, siteId);
  if (!ownedSiteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const now = new Date();
  const database = db(c.env);
  // Disable flag + clear hash. We intentionally LEAVE `passwordSetAt`
  // untouched so that if the Owner re-enables later with a new password,
  // the `passwordSetAt` advance still invalidates any previously-issued
  // cookies (per the plan: "On disable, clear hash + leave passwordSetAt
  // as-is so old cookies remain invalid").
  await database
    .update(site)
    .set({
      passwordEnabled: false,
      passwordHash: null,
      updatedAt: now,
    })
    .where(eq(site.id, ownedSiteId));

  return c.json({ ok: true, passwordEnabled: false });
});

export default router;
