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
//   2. Clear every Clerk-managed cookie on our domain (`__session`,
//      `__client_uat`, `__clerk_db_jwt`, `__clerk_handshake`, plus
//      visitor-side counterparts). The browser stops sending session
//      tokens on subsequent requests.
//   3. Redirect to `/` so the user lands on the public landing page.
//
// The route accepts both GET (so a plain `<a href="/sign-out">` works) and
// POST (so callers that prefer a form submit pick the same code path).
// Both are idempotent — hitting `/sign-out` while already signed out
// still clears cookies and redirects.

import { Hono, type Context } from 'hono';
import { deleteCookie } from 'hono/cookie';

import { clerkAuth, type ClerkAuthVariables } from './middleware.js';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
};

type SignOutEnv = { Bindings: Bindings; Variables: ClerkAuthVariables };

const signOutRoute = new Hono<SignOutEnv>();

// Clerk cookie names — sourced from the official docs' "production /
// development instance cookies" tables. Listed exhaustively so a future
// Clerk SDK update that ships a new cookie still leaves us clearing the
// known ones; absent cookies are silently ignored by deleteCookie.
const CLERK_COOKIES = [
  '__session',
  '__client_uat',
  '__clerk_db_jwt',
  '__clerk_handshake',
  '__clerk_handshake_nonce',
  '__refresh',
] as const;

async function handleSignOut(c: Context<SignOutEnv>) {
  const auth = c.get('auth');
  const clerk = c.get('clerk');
  if (auth.sessionId && clerk) {
    try {
      await clerk.sessions.revokeSession(auth.sessionId);
    } catch (err) {
      // Revocation failure is not fatal — we still want to clear cookies and
      // log the user out locally. Logging the failure keeps the failure
      // visible without breaking the sign-out UX.
      console.error('[auth/sign-out] revokeSession failed', err);
    }
  }
  for (const name of CLERK_COOKIES) {
    deleteCookie(c, name, { path: '/' });
  }
  return c.redirect('/', 302);
}

signOutRoute.use('*', clerkAuth());
signOutRoute.get('/', handleSignOut);
signOutRoute.post('/', handleSignOut);

export default signOutRoute;
