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
import { signEditToken, buildEditTokenCookieHeader } from '../../auth/edit-token';
import { db, type Db } from '../../db/client';
import { customer, customDomain, site } from '../../db/schema';

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
const STATE_RE = /^[A-Za-z0-9._~-]{16,256}$/;

const onSiteEditRoute = new Hono<Env>();

onSiteEditRoute.use('*', clerkAuth());
onSiteEditRoute.use('*', requireAuth());

function parseReturnOrigin(returnOrigin: string | undefined): URL | null {
  if (!returnOrigin) return null;
  let parsed: URL;
  try {
    parsed = new URL(returnOrigin);
  } catch {
    return null;
  }
  if (parsed.origin !== returnOrigin) return null;
  if (parsed.protocol !== 'https:') return null;
  return parsed;
}

export async function isAuthorizedOnSiteEditReturnOrigin(
  database: Db,
  siteId: string,
  subdomain: string,
  returnOrigin: string | undefined,
): Promise<boolean> {
  const parsed = parseReturnOrigin(returnOrigin);
  if (!parsed) return false;

  if (parsed.hostname === `${subdomain}.rev01.aayushman.dev`) {
    return true;
  }

  const rows = await database
    .select({ id: customDomain.id })
    .from(customDomain)
    .where(
      and(
        eq(customDomain.siteId, siteId),
        eq(customDomain.hostname, parsed.hostname.toLowerCase()),
        eq(customDomain.status, 'active'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

onSiteEditRoute.get('/', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('on-site-edit reached without authenticated user');
  }

  const siteId = c.req.query('siteId');
  if (!siteId || !SITE_ID_RE.test(siteId)) {
    return c.text('missing or invalid siteId', 400);
  }
  const returnOrigin = c.req.query('returnOrigin');
  const state = c.req.query('state');
  if (!state || !STATE_RE.test(state)) {
    return c.text('missing or invalid state', 400);
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
  if (
    !(await isAuthorizedOnSiteEditReturnOrigin(
      database,
      siteId,
      siteRow[0].subdomain,
      returnOrigin,
    ))
  ) {
    return c.text('invalid returnOrigin', 400);
  }

  const token = await signEditToken(
    { siteId, customerId, clerkUserId: auth.userId },
    c.env.UNLOCK_SIGNING_SECRET,
  );

  const cookieValue = buildEditTokenCookieHeader(token, new URL(c.req.url).host);

  const siteIdJson = JSON.stringify(siteId);
  const tokenJson = JSON.stringify(token);
  const stateJson = JSON.stringify(state);
  const returnOriginJson = JSON.stringify(returnOrigin);

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
        { type: "rev01:edit-ready", siteId: ${siteIdJson}, token: ${tokenJson}, state: ${stateJson} },
        ${returnOriginJson}
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
