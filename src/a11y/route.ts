// src/a11y/route.ts
//
// Audit-only HTTP endpoint.
//
//   GET /api/sites/:siteId/a11y
//
// Returns the full `AuditReport` for the caller's current editableState,
// independent of publishing. The publish endpoint (`src/routes/api/publish.ts`)
// runs the audit too but ships through regardless — the caller can drill in
// from the dashboard report and fix findings on their own pace. This route is
// the read-only counterpart so the dashboard UI can render the report
// without forcing a publish attempt.
//
// Access: Clerk-gated; the caller must reach the site at the `viewer` tier
// via `loadAccessibleSite` (owner OR any accepted collaborator). The audit
// is a pure read of the site's editableState — collaborators reviewing the
// site should see the same a11y report owners see. Missing site or
// unauthorised access both return 404 (the same "not found" the publish
// endpoint emits — we don't leak the existence of sites the caller can't
// see).

import { Hono } from 'hono';

import { loadAccessibleSite } from '../auth/accessible-site.js';
import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware.js';
import { requireAuth } from '../auth/require-auth.js';
import { db } from '../db/client.js';
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
  const accessible = await loadAccessibleSite(
    database,
    auth.userId,
    siteId,
    'viewer',
    c.get('customer')?.id,
  );
  if (!accessible) return c.json({ error: 'site not found' }, 404);

  // Defence in depth: a corrupted editableState shouldn't 500 — re-validate
  // and report up front so the audit doesn't run over a malformed shape and
  // get blamed for the failure.
  const validation = validateEditableSite(accessible.editableState);
  if (!validation.valid) {
    return c.json(
      {
        error: 'editable state invalid',
        errors: validation.errors,
      },
      400,
    );
  }

  const report = runAudit(accessible.editableState);
  return c.json(report);
});

export default a11yRoute;
