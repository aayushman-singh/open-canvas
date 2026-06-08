// src/password/admin-route.ts
//
// Editor-tier CRUD for the password gate:
//
//   PUT    /api/sites/:siteId/password   — enable + set/change the password.
//   DELETE /api/sites/:siteId/password   — disable the gate. Leaves
//                                          `passwordSetAt` untouched so
//                                          any cookies issued under the
//                                          old password remain invalid if
//                                          the password gate is later
//                                          re-enabled.
//
// Access: Clerk-gated; the request must resolve to a site the caller can
// access at the `editor` tier via `loadAccessibleSite` (site owner OR
// accepted collaborator with role `editor`). Lower-tier callers (viewers,
// strangers) and missing sites both 404 to avoid leaking existence.
//
// Why `editor` (not `owner`): the password gate is a content-protection
// affordance ("hide my unfinished site from the public") sibling to publish
// gating. Collaborators who can edit the site can already see anything
// behind the gate; letting them rotate or disable the shared secret matches
// the same authority. The gate does NOT touch billing or DNS, so widening
// here is in scope for the PR #43 sweep.
//
// Mounted by the main thread at `/api/sites/:siteId/password`.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { hashPassword } from './hash.js';
import { loadAccessibleSite } from '../auth/accessible-site.js';
import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import { db } from '../db/client.js';
import { site } from '../db/schema.js';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const router = new Hono<Env>();

router.use('*', clerkAuth());
router.use('*', requireAuth());

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
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('password admin route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const database = db(c.env);
  const accessible = await loadAccessibleSite(
    database,
    auth.userId,
    siteId,
    'editor',
    c.get('customer')?.id,
  );
  if (!accessible) {
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
  await database
    .update(site)
    .set({
      passwordEnabled: true,
      passwordHash: hashed,
      passwordSetAt: now,
      updatedAt: now,
    })
    .where(eq(site.id, accessible.id));

  return c.json({ ok: true, passwordEnabled: true, passwordSetAt: now.toISOString() });
});

router.delete('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('password admin route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.json({ error: 'site not found' }, 404);
  }
  const database = db(c.env);
  const accessible = await loadAccessibleSite(
    database,
    auth.userId,
    siteId,
    'editor',
    c.get('customer')?.id,
  );
  if (!accessible) {
    return c.json({ error: 'site not found' }, 404);
  }
  const now = new Date();
  // Disable flag + clear hash. We intentionally LEAVE `passwordSetAt`
  // untouched so that if the gate is re-enabled later with a new password,
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
    .where(eq(site.id, accessible.id));

  return c.json({ ok: true, passwordEnabled: false });
});

export default router;
