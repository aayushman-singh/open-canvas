// src/a11y/route.ts
//
// Audit-only HTTP endpoint.
//
//   GET /api/sites/:siteId/a11y
//
// Returns the full `AuditReport` for the Owner's current editableState,
// independent of publishing. The publish endpoint (`src/routes/api/publish.ts`)
// runs the audit too but ships through regardless — Owner can drill in from
// the dashboard report and fix findings on their own pace. This route is
// the read-only counterpart so the dashboard UI can render the report
// without forcing a publish attempt.
//
// Auth: Clerk-gated like every other Owner endpoint. The customer→site join
// enforces that the requesting Owner actually owns the site; missing site or
// unauthorised access both return 404 (the same "not found" the publish
// endpoint emits — we don't leak the existence of sites the Owner doesn't
// own).

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import { db } from '../db/client.js';
import { customer, site } from '../db/schema.js';
import { validateEditableSite } from '../canvas/validate.js';

import { runAudit } from './audit.js';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const a11yRoute = new Hono<Env>();
a11yRoute.use('*', clerkAuth());
a11yRoute.use('*', requireAuth());

a11yRoute.get('/:siteId/a11y', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('a11y route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) return c.json({ error: 'site not found' }, 404);

  const database = db(c.env);

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return c.json({ error: 'site not found' }, 404);

  const siteRow = await database
    .select({
      id: site.id,
      editableState: site.editableState,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = siteRow[0];
  if (!row) return c.json({ error: 'site not found' }, 404);

  // Defence in depth: a corrupted editableState shouldn't 500 — re-validate
  // and report up front so the audit doesn't run over a malformed shape and
  // get blamed for the failure.
  const validation = validateEditableSite(row.editableState);
  if (!validation.valid) {
    return c.json(
      {
        error: 'editable state invalid',
        errors: validation.errors,
      },
      400,
    );
  }

  const report = runAudit(row.editableState);
  return c.json(report);
});

export default a11yRoute;
