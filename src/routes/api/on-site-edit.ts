// src/routes/api/on-site-edit.ts
//
// GET /api/on-site-edit?siteId=<id>
//
// Popup auth endpoint for the on-site editor. Opened as a small popup window
// from the published site when the Owner clicks "Edit." The popup runs on the
// main domain (rev01.aayushman.dev) where Clerk session cookies are available.
//
// Flow:
//   1. Clerk auth — if not signed in, requireAuth redirects to Clerk sign-in
//      (which works fine inside a popup; Clerk redirects back after sign-in).
//   2. Verify the authenticated user owns the requested site.
//   3. Sign an edit token JWT (HMAC-SHA256, 4-hour TTL).
//   4. Set the token as an httpOnly cookie scoped to .rev01.aayushman.dev
//      so all subdomains can read it.
//   5. Return a small HTML page that postMessages to the opener and closes.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { signEditToken, EDIT_TOKEN_COOKIE, EDIT_TOKEN_MAX_AGE } from '../../auth/edit-token';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  DATABASE_URL: string;
  UNLOCK_SIGNING_SECRET: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const SITE_ID_RE = /^[A-Za-z0-9-]+$/;

const onSiteEditRoute = new Hono<Env>();

onSiteEditRoute.use('*', clerkAuth());
onSiteEditRoute.use('*', requireAuth());

onSiteEditRoute.get('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('on-site-edit reached without authenticated user');
  }

  const siteId = c.req.query('siteId');
  if (!siteId || !SITE_ID_RE.test(siteId)) {
    return c.text('missing or invalid siteId', 400);
  }

  const database = db(c.env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return c.text('site not found', 404);
  }

  const siteRow = await database
    .select({ id: site.id, subdomain: site.subdomain })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  if (!siteRow[0]) {
    return c.text('site not found', 404);
  }

  const token = await signEditToken(
    { siteId, customerId, clerkUserId: auth.userId },
    c.env.UNLOCK_SIGNING_SECRET,
  );

  const cookieValue = [
    `${EDIT_TOKEN_COOKIE}=${token}`,
    'Domain=rev01.aayushman.dev',
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${EDIT_TOKEN_MAX_AGE}`,
  ].join('; ');

  const siteIdJson = JSON.stringify(siteId);

  return c.html(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>rev01 — authenticating</title>
  <style>
    body {
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: system-ui, sans-serif;
      background: #0d1117;
      color: #e6edf3;
    }
    p { opacity: 0.7; font-size: 14px; }
  </style>
</head>
<body>
  <p>Authenticated. This window will close.</p>
  <script>
    if (window.opener) {
      window.opener.postMessage(
        { type: "rev01:edit-ready", siteId: ${siteIdJson} },
        "*"
      );
    }
    setTimeout(function() { window.close(); }, 600);
  </script>
</body>
</html>`,
    200,
    { 'Set-Cookie': cookieValue },
  );
});

export default onSiteEditRoute;
