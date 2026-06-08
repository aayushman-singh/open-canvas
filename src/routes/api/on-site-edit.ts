// src/routes/api/on-site-edit.ts
//
// GET /api/on-site-edit?siteId=<id>
//
// Popup auth endpoint for the on-site editor. Opened as a small popup window
// from the published site when the Owner clicks "Edit." The popup runs on the
// configured app apex where Clerk session cookies are available.
//
// Flow:
//   1. Clerk auth — if not signed in, requireAuth redirects to Clerk sign-in
//      (which works fine inside a popup; Clerk redirects back after sign-in).
//   2. Verify the authenticated user can edit the requested site.
//   3. Sign an edit token JWT (HMAC-SHA256, 4-hour TTL).
//   4. Set the token as an httpOnly cookie scoped to the configured apex so
//      all subdomains can read it.
//   5. Return a small HTML page that postMessages to the opener and closes.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { loadAccessibleSite } from '../../auth/accessible-site';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { signEditToken, buildEditTokenCookieHeader } from '../../auth/edit-token';
import { db, type Db } from '../../db/client';
import { customer, customDomain } from '../../db/schema';
import { appDomain, type HostConfigEnv } from '../../host-config';
import { SITE_ID_RE } from '../../canvas/validate';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  DATABASE_URL: string;
  UNLOCK_SIGNING_SECRET: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

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
  env: HostConfigEnv,
  database: Db,
  siteId: string,
  subdomain: string,
  returnOrigin: string | undefined,
): Promise<boolean> {
  const parsed = parseReturnOrigin(returnOrigin);
  if (!parsed) return false;

  if (parsed.hostname === `${subdomain}.${appDomain(env)}`) {
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
  // Resolve the caller's customer.id up-front so we can both seed
  // `loadAccessibleSite`'s lookup optimisation and sign the edit token with
  // the CALLER's customer.id (not the site owner's). A collaborator
  // editing someone else's site gets an edit token bound to their own
  // customer row — same identity Clerk middleware would resolve on every
  // subsequent /__api/* request. The token's `siteId` plus the host check
  // in `editTokenAuth()` is what binds the token to a specific site; the
  // customer field is informational and used by routes that key per-caller
  // state (e.g. chat_session rows).
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return c.text('site not found', 404);
  }

  // Editor tier: collaborators with write access can pop the on-site editor
  // open exactly like the site owner. Viewers cannot — the edit-token flow
  // exists to MUTATE editableState, so read-only roles have no business
  // here. Returning null falls through to 404 to avoid leaking the site's
  // existence.
  const accessible = await loadAccessibleSite(
    database,
    auth.userId,
    siteId,
    'editor',
    customerId,
  );
  if (!accessible) {
    return c.text('site not found', 404);
  }
  if (
    !(await isAuthorizedOnSiteEditReturnOrigin(
      c.env,
      database,
      siteId,
      accessible.subdomain,
      returnOrigin,
    ))
  ) {
    return c.text('invalid returnOrigin', 400);
  }

  const token = await signEditToken(
    { siteId, customerId, clerkUserId: auth.userId },
    c.env.UNLOCK_SIGNING_SECRET,
  );

  const cookieValue = buildEditTokenCookieHeader(c.env, token, new URL(c.req.url).host);

  return c.html(
    renderPopupCloseDocument({ siteId, token, state, returnOrigin }),
    200,
    { 'Set-Cookie': cookieValue },
  );
});

interface PopupCloseDocumentInput {
  siteId: string;
  token: string;
  state: string;
  returnOrigin: string | undefined;
}

// Renders the popup-close page returned to the on-site editor popup.
// postMessage is targeted at the caller-verified returnOrigin (never '*') so the
// edit-ready event cannot leak to a malicious opener after the popup navigates.
function renderPopupCloseDocument(input: PopupCloseDocumentInput): string {
  const siteIdJson = JSON.stringify(input.siteId);
  const tokenJson = JSON.stringify(input.token);
  const stateJson = JSON.stringify(input.state);
  const returnOriginJson = JSON.stringify(input.returnOrigin);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Open Canvas — authenticating</title>
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
        { type: "opencanvas:edit-ready", siteId: ${siteIdJson}, token: ${tokenJson}, state: ${stateJson} },
        ${returnOriginJson}
      );
    }
    setTimeout(function() { window.close(); }, 600);
  </script>
</body>
</html>`;
}

export default onSiteEditRoute;
