import { createMiddleware } from 'hono/factory';
import { resolveAuthRedirectUrl, resolveClerkKeys, type ClerkAuthVariables } from './middleware';
import type { HostConfigEnv } from '../host-config';

type ClerkBindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
};

// Derives the Account Portal origin from the publishable key.
//
// pk_test_: frontend host shape is `<slug>.clerk.accounts.dev` — portal is at
// `<slug>.accounts.dev` (drop the `.clerk.` segment).
//
// pk_live_: frontend host shape is `clerk.<root>` (Clerk's CNAME on your zone)
// — portal is at `accounts.<root>` (swap the `clerk.` prefix for `accounts.`).
function accountPortalOrigin(publishableKey: string): string {
  const marker = publishableKey.startsWith('pk_test_')
    ? 'pk_test_'
    : publishableKey.startsWith('pk_live_')
      ? 'pk_live_'
      : null;

  if (!marker) {
    throw new Error(`unrecognised Clerk publishable key prefix: ${publishableKey.slice(0, 8)}`);
  }

  const encoded = publishableKey.slice(marker.length);
  const decoded = atob(encoded);
  const frontendApi = decoded.endsWith('$') ? decoded.slice(0, -1) : decoded;

  let accountPortalHost: string;
  if (frontendApi.startsWith('clerk.')) {
    accountPortalHost = 'accounts.' + frontendApi.slice('clerk.'.length);
  } else if (frontendApi.includes('.clerk.')) {
    accountPortalHost = frontendApi.replace('.clerk.', '.');
  } else {
    throw new Error(`unexpected Clerk frontend API shape: ${frontendApi}`);
  }

  return `https://${accountPortalHost}`;
}

export function buildSignInUrl(publishableKey: string, redirectUrl: string): string {
  const url = new URL('/sign-in', accountPortalOrigin(publishableKey));
  url.searchParams.set('redirect_url', redirectUrl);
  return url.toString();
}

// NOTE: sign-out used to construct a `<portal>/sign-out` URL, but Clerk's
// hosted Account Portal does not expose that path (the portal serves only
// /sign-in, /sign-up, /user, /organization, /create-organization,
// /unauthorized-sign-in). Linking to the non-existent `/sign-out` page
// resolved to 404 and left the session intact. Sign-out is now handled by
// the worker-local route in `src/auth/sign-out-route.ts`, which revokes
// the session via the Clerk Backend API and clears the cookies.

export function requireAuth() {
  return createMiddleware<{
    Bindings: ClerkBindings;
    Variables: ClerkAuthVariables;
  }>(async (c, next) => {
    const auth = c.get('auth');
    if (auth.userId) {
      await next();
      return;
    }

    // API requests get JSON 401 — never a cross-origin redirect to Clerk's
    // hosted sign-in. Browser fetch() with credentials cannot follow such a
    // redirect (CORS preflight fails), so a 302 here silently breaks the
    // editor's save/publish flow when Clerk rotates the session mid-edit.
    // Pages still redirect so an Owner who navigated stale tab lands on
    // sign-in instead of seeing raw JSON.
    const requestUrl = new URL(c.req.url);
    const isApiRequest =
      requestUrl.pathname.startsWith('/api/') ||
      (c.req.header('accept') ?? '').includes('application/json');
    if (isApiRequest) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const { publishableKey } = resolveClerkKeys(c.env);
    const signInUrl = buildSignInUrl(publishableKey, resolveAuthRedirectUrl(c.env, c.req.url));
    return c.redirect(signInUrl, 302);
  });
}
