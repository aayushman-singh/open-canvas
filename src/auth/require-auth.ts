import { createMiddleware } from 'hono/factory';
import type { ClerkAuthVariables } from './middleware';

type ClerkBindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
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

export function buildSignOutUrl(publishableKey: string, redirectUrl: string): string {
  const url = new URL('/sign-out', accountPortalOrigin(publishableKey));
  url.searchParams.set('redirect_url', redirectUrl);
  return url.toString();
}

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

    const requestUrl = new URL(c.req.url);
    const signInUrl = buildSignInUrl(c.env.CLERK_PUBLISHABLE_KEY, requestUrl.toString());
    return c.redirect(signInUrl, 302);
  });
}
