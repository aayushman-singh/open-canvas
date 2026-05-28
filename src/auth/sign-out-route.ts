// src/auth/sign-out-route.ts
//
// Server-side sign-out. The Clerk Account Portal does NOT expose a
// `/sign-out` page — its hosted routes are `/sign-in`, `/sign-up`, `/user`,
// etc. (https://clerk.com/docs/account-portal/getting-started). Linking the
// dashboard "Sign out" anchor at the portal `/sign-out` URL resolves to a
// 404 and leaves the session intact, which is exactly what the dashboard
// regressed to.
//
// This route does the canonical backend sign-out:
//   1. If the request carries a Clerk session, revoke it via the Backend
//      API so the session is invalid everywhere, not just on this device.
//   2. Clear every Clerk-managed cookie plus rev01's on-site editor cookie
//      on our host and shared app domain. The browser stops sending auth
//      tokens on subsequent requests.
//   3. Redirect to `/` so the user lands on the public landing page.
//
// The route accepts both GET (so a plain `<a href="/sign-out">` works) and
// POST (so callers that prefer a form submit pick the same code path).
// Both are idempotent — hitting `/sign-out` while already signed out
// still clears cookies and redirects.

import { Hono, type Context } from 'hono';

import { EDIT_TOKEN_COOKIE } from './edit-token.js';
import { clerkAuth, type ClerkAuthVariables } from './middleware.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
};

type SignOutEnv = { Bindings: Bindings; Variables: ClerkAuthVariables };

const signOutRoute = new Hono<SignOutEnv>();

// Clerk cookie names - sourced from the official docs' production /
// development instance cookies tables. Listed exhaustively so a future
// Clerk SDK update that ships a new cookie still leaves us clearing the
// known ones.
const SHARED_AUTH_COOKIE_DOMAIN = 'rev01.aayushman.dev';

export const SIGN_OUT_COOKIE_NAMES = [
  '__session',
  '__client_uat',
  '__clerk_db_jwt',
  '__clerk_handshake',
  '__clerk_handshake_nonce',
  '__refresh',
  EDIT_TOKEN_COOKIE,
] as const;

function expiredCookieHeader(name: string, secure: boolean, domain?: string): string {
  const parts = [
    `${name}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join('; ');
}

export function buildExpiredSignOutCookieHeaders(requestUrl: URL): string[] {
  const secure = requestUrl.protocol === 'https:';
  const hostname = requestUrl.hostname.toLowerCase();
  const domains: Array<string | undefined> = [undefined];
  if (
    hostname === SHARED_AUTH_COOKIE_DOMAIN ||
    hostname.endsWith(`.${SHARED_AUTH_COOKIE_DOMAIN}`)
  ) {
    domains.push(SHARED_AUTH_COOKIE_DOMAIN);
  }

  const headers: string[] = [];
  for (const name of SIGN_OUT_COOKIE_NAMES) {
    for (const domain of domains) {
      headers.push(expiredCookieHeader(name, secure, domain));
    }
  }
  return headers;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function logSignOutFailure(
  c: Context<SignOutEnv>,
  step: string,
  err: unknown,
  auth: { userId: string | null; sessionId: string | null },
): void {
  console.error('[auth/sign-out] failed', {
    step,
    userId: auth.userId,
    sessionId: auth.sessionId,
    requestUrl: c.req.url,
    error:
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { message: String(err) },
  });
}

async function handleSignOut(c: Context<SignOutEnv>) {
  const auth = c.get('auth');
  const clerk = c.get('clerk');
  if (auth.sessionId) {
    if (!clerk) {
      const err = new Error('Clerk client missing while authenticated session is present');
      logSignOutFailure(c, 'resolve Clerk client', err, auth);
      return c.text(`sign-out failed: ${err.message}`, 500);
    }
    try {
      await clerk.sessions.revokeSession(auth.sessionId);
    } catch (err) {
      logSignOutFailure(c, 'clerk.sessions.revokeSession', err, auth);
      return c.text(`sign-out failed: ${describeError(err)}`, 502);
    }
  }
  for (const header of buildExpiredSignOutCookieHeaders(new URL(c.req.url))) {
    c.header('Set-Cookie', header, { append: true });
  }
  return c.redirect('/', 302);
}

signOutRoute.use('*', clerkAuth());
signOutRoute.get('/', handleSignOut);
signOutRoute.post('/', handleSignOut);

export default signOutRoute;
