import { createMiddleware } from 'hono/factory';
import type { ClerkAuthVariables } from './middleware';

type ClerkBindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
};

/**
 * Returns the Clerk Account Portal sign-in URL for the instance encoded in the
 * publishable key. The publishable key has shape `pk_(test|live)_<base64>` where
 * the base64 body decodes to `<frontend-api-host>$`. The frontend API host is
 * `<slug>.clerk.<root>`; the Account Portal lives at `<slug>.<root>` — i.e. the
 * `clerk.` segment is dropped.
 */
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

  if (!frontendApi.includes('.clerk.')) {
    throw new Error(`unexpected Clerk frontend API shape: ${frontendApi}`);
  }

  const accountPortalHost = frontendApi.replace('.clerk.', '.');
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
