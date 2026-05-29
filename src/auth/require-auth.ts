import { createMiddleware } from 'hono/factory';
import { resolveAuthRedirectUrl, resolveClerkKeys, type ClerkAuthVariables } from './middleware';
import type { HostConfigEnv } from '../host-config';

type ClerkBindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_FRONTEND_API_URL?: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
};

// Derives the Account Portal origin.
//
// When `CLERK_FRONTEND_API_URL` is set, the frontend API host is read from
// there. Otherwise we fall back to decoding it out of the publishable key.
//
// The env override exists because the publishable key encodes the frontend
// host at issuance time — if a Clerk instance is later reconfigured to point
// at a new CNAME without re-issuing keys (e.g. domain rebrand), the decoded
// value goes stale and the redirect target points at a dead host. The env
// var lets the operator override without rotating keys.
//
// Host shapes:
//   pk_test_ → `<slug>.clerk.accounts.dev`. Portal at `<slug>.accounts.dev`
//              (drop the `.clerk.` segment).
//   pk_live_ → `clerk.<root>` (Clerk's CNAME on your zone). Portal at
//              `accounts.<root>` (swap the `clerk.` prefix for `accounts.`).
function accountPortalOrigin(publishableKey: string, frontendApiUrl?: string): string {
  let frontendApi: string;
  if (typeof frontendApiUrl === 'string' && frontendApiUrl.length > 0) {
    let parsed: URL;
    try {
      parsed = new URL(frontendApiUrl);
    } catch (error) {
      throw new Error(`CLERK_FRONTEND_API_URL is not a valid URL: ${frontendApiUrl}`, {
        cause: error,
      });
    }
    frontendApi = parsed.host;
  } else {
    const marker = publishableKey.startsWith('pk_test_')
      ? 'pk_test_'
      : publishableKey.startsWith('pk_live_')
        ? 'pk_live_'
        : null;

    if (!marker) {
      throw new Error(
        `unrecognised Clerk publishable key prefix: ${publishableKey.slice(0, 8)}`,
      );
    }

    const encoded = publishableKey.slice(marker.length);
    const decoded = atob(encoded);
    frontendApi = decoded.endsWith('$') ? decoded.slice(0, -1) : decoded;
  }

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

export function buildSignInUrl(
  publishableKey: string,
  redirectUrl: string,
  frontendApiUrl?: string,
): string {
  const url = new URL('/sign-in', accountPortalOrigin(publishableKey, frontendApiUrl));
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
    const signInUrl = buildSignInUrl(
      publishableKey,
      resolveAuthRedirectUrl(c.env, c.req.url),
      c.env.CLERK_FRONTEND_API_URL,
    );
    return c.redirect(signInUrl, 302);
  });
}
