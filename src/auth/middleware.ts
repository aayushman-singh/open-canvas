import { createClerkClient, type User } from '@clerk/backend';
import { createMiddleware } from 'hono/factory';

export type AuthState = {
  userId: string | null;
  sessionId: string | null;
  getToken: ((options?: { template?: string }) => Promise<string | null>) | null;
};

type ClerkBindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  // Optional dev-only keys for a Clerk Test app. When the request host is
  // localhost / 127.0.0.1, we prefer these so the Clerk handshake builds a
  // working dev portal URL (test apps accept localhost; live apps don't).
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  // Optional override for the dev origin used to rebuild request URLs when
  // wrangler dev's routes-based URL synthesis is in effect. When omitted,
  // local development uses http://127.0.0.1:8787.
  DEV_PUBLIC_HOST?: string;
};

export type ClerkAuthVariables = {
  auth: AuthState;
  user: User | null;
  clerk: ReturnType<typeof createClerkClient>;
};

type ClerkKeyPair = {
  publishableKey: string;
  secretKey: string;
};

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

const AUTHORIZED_PARTIES = [
  'http://localhost:8787',
  'http://127.0.0.1:8787',
  'https://rev01.aayushman.dev',
];

// Picks the publishable/secret key pair to use. Live keys
// (CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY) are the default; the test pair
// is preferred whenever it is populated.
//
// Selection trigger is presence-of-test-keys, not request hostname, because
// wrangler dev rewrites c.req.url to the worker's prod custom-domain pattern
// (e.g. https://rev01.aayushman.dev/) regardless of the local listening
// address, so a hostname check fires false for real localhost traffic. The
// CLERK_TEST_* secrets are populated in the local .env only and are NEVER
// added to the prod worker secret set, so their presence reliably signals
// "this is a dev environment".
export function resolveClerkKeys(env: ClerkBindings): ClerkKeyPair {
  const testPub = env.CLERK_TEST_PUBLISHABLE_KEY;
  const testSec = env.CLERK_TEST_SECRET_KEY;
  const hasTestPub = isNonEmptyString(testPub);
  const hasTestSec = isNonEmptyString(testSec);

  if (testPub === '' || testSec === '') {
    throw new Error(
      'CLERK_TEST_PUBLISHABLE_KEY and CLERK_TEST_SECRET_KEY must be non-empty when set',
    );
  }

  if (hasTestPub !== hasTestSec) {
    throw new Error(
      'CLERK_TEST_PUBLISHABLE_KEY and CLERK_TEST_SECRET_KEY must be configured together',
    );
  }

  if (hasTestPub && hasTestSec) {
    return { publishableKey: testPub, secretKey: testSec };
  }

  if (!isNonEmptyString(env.CLERK_PUBLISHABLE_KEY) || !isNonEmptyString(env.CLERK_SECRET_KEY)) {
    throw new Error('CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are required');
  }

  return { publishableKey: env.CLERK_PUBLISHABLE_KEY, secretKey: env.CLERK_SECRET_KEY };
}

function usesTestClerkKeys(env: ClerkBindings, keys: ClerkKeyPair): boolean {
  return (
    keys.publishableKey === env.CLERK_TEST_PUBLISHABLE_KEY &&
    keys.secretKey === env.CLERK_TEST_SECRET_KEY
  );
}

function resolveDevPublicOrigin(env: ClerkBindings): string {
  if (env.DEV_PUBLIC_HOST === '') {
    throw new Error('DEV_PUBLIC_HOST must be a non-empty origin when set');
  }

  const origin = env.DEV_PUBLIC_HOST ?? 'http://127.0.0.1:8787';
  let url: URL;
  try {
    url = new URL(origin);
  } catch (error) {
    throw new Error(`DEV_PUBLIC_HOST must be a valid origin: ${origin}`, { cause: error });
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`DEV_PUBLIC_HOST must be an origin without path, query, or hash: ${origin}`);
  }

  return url.origin;
}

function resolveRedirectPath(source: URL, overridePath: string | undefined): string {
  if (overridePath === undefined) {
    return `${source.pathname}${source.search}`;
  }

  if (!overridePath.startsWith('/')) {
    throw new Error(`auth redirect override path must be root-relative: ${overridePath}`);
  }

  return overridePath;
}

export function resolveAuthRedirectUrl(
  env: ClerkBindings,
  requestUrl: string,
  overridePath?: string,
): string {
  const source = new URL(requestUrl);
  const keys = resolveClerkKeys(env);
  const path = resolveRedirectPath(source, overridePath);

  if (usesTestClerkKeys(env, keys)) {
    return new URL(path, resolveDevPublicOrigin(env)).toString();
  }

  if (overridePath !== undefined) {
    return new URL(overridePath, source).toString();
  }

  return source.toString();
}

export function clerkAuth() {
  return createMiddleware<{
    Bindings: ClerkBindings;
    Variables: ClerkAuthVariables;
  }>(async (c, next) => {
    // If a prior middleware (e.g. editTokenAuth) already resolved the Owner's
    // identity, skip the Clerk handshake entirely. This lets /__api/* routes
    // reuse the same sub-app handlers without a Clerk session cookie.
    try {
      const existing = c.get('auth');
      if (existing && existing.userId) {
        await next();
        return;
      }
    } catch {
      // c.get('auth') throws if the variable was never set — continue to Clerk.
    }

    const keys = resolveClerkKeys(c.env);
    const clerk = createClerkClient({
      publishableKey: keys.publishableKey,
      secretKey: keys.secretKey,
    });
    c.set('clerk', clerk);

    // Wrangler dev rewrites both `c.req.url` AND the Host header to match the
    // worker's [[routes]] pattern (e.g. https://rev01.aayushman.dev/) even
    // when the browser hit localhost. That breaks Clerk's handshake: Clerk
    // validates the handshake JWT against the request's origin, sees the
    // prod host instead of localhost, and rejects the session forever.
    //
    // Workaround: when running with the test Clerk app (whose handshake JWT
    // was issued for the local host), rewrite the request URL to the
    // localhost origin so Clerk validates against what the browser actually
    // saw. The `DEV_PUBLIC_HOST` env var lets the operator override the
    // origin if the local dev port/host differs from the default.
    const usingTestKeys = usesTestClerkKeys(c.env, keys);
    let requestForClerk: Request = c.req.raw;
    if (usingTestKeys) {
      const localOrigin = resolveDevPublicOrigin(c.env);
      const localOriginUrl = new URL(localOrigin);
      const original = new URL(c.req.url);
      const rebuilt = new URL(original.pathname + original.search, localOrigin);
      // Rebuild with the local origin AND override Origin/Referer headers so
      // Clerk's session-refresh path (which validates azp against the request
      // origin header, not just the request URL) accepts the cookie tokens
      // issued for localhost. Without this override the refresh fails with
      // `refresh_request_origin_azp_mismatch` once the short-lived dev JWT
      // expires (~60s).
      const headers = new Headers(c.req.raw.headers);
      headers.set('host', localOriginUrl.host);
      headers.set('origin', localOrigin);
      const existingReferer = headers.get('referer');
      if (existingReferer) {
        try {
          const refererUrl = new URL(existingReferer);
          headers.set(
            'referer',
            new URL(`${refererUrl.pathname}${refererUrl.search}`, localOrigin).toString(),
          );
        } catch (error) {
          throw new Error(`failed to rewrite Clerk referer header: ${existingReferer}`, {
            cause: error,
          });
        }
      }
      requestForClerk = new Request(rebuilt.toString(), {
        method: c.req.raw.method,
        headers,
        body: c.req.raw.body,
        redirect: c.req.raw.redirect,
        // @ts-expect-error duplex required by Cloudflare Workers when body present
        duplex: c.req.raw.body ? 'half' : undefined,
      });
    }

    const requestState = await clerk.authenticateRequest(requestForClerk, {
      authorizedParties: AUTHORIZED_PARTIES,
    });

    // Clerk's hosted account portal hands off the session via a handshake
    // round-trip. When status === 'handshake', Clerk wants the user redirected
    // back to itself to complete cookie setup; we must return its response
    // verbatim (Location + Set-Cookie). Skipping this step breaks sign-in:
    // requireAuth keeps redirecting to /sign-in because the session cookie
    // never lands on the parent domain.
    if (requestState.status === 'handshake') {
      const location = requestState.headers.get('location');
      const status = location ? 307 : 200;
      return new Response(null, { status, headers: requestState.headers });
    }

    // Forward any Set-Cookie / Clerk-* headers Clerk attached to the response
    // (used by the SDK to refresh the session cookie when it's nearing expiry).
    for (const [key, value] of requestState.headers.entries()) {
      c.header(key, value, { append: true });
    }

    if (!requestState.isAuthenticated) {
      c.set('auth', { userId: null, sessionId: null, getToken: null });
      c.set('user', null);
      await next();
      return;
    }

    const auth = requestState.toAuth();
    c.set('auth', {
      userId: auth.userId,
      sessionId: auth.sessionId,
      getToken: auth.getToken,
    });

    const user = await clerk.users.getUser(auth.userId);
    c.set('user', user);

    await next();
  });
}

// Middleware for /__api/* routes on published-site subdomains. Validates the
// __rev01_edit cookie (set by the /api/on-site-edit popup) and populates the
// same auth / user / clerk context variables that clerkAuth() would, so
// downstream handlers (canvasApi, publishApi, etc.) work unchanged.
import { getCookie } from 'hono/cookie';
import { verifyEditToken, EDIT_TOKEN_COOKIE } from './edit-token';

type EditTokenBindings = ClerkBindings & { UNLOCK_SIGNING_SECRET: string };

export function editTokenAuth() {
  return createMiddleware<{
    Bindings: EditTokenBindings;
    Variables: ClerkAuthVariables;
  }>(async (c, next) => {
    const token = getCookie(c, EDIT_TOKEN_COOKIE);
    const payload = await verifyEditToken(token, c.env.UNLOCK_SIGNING_SECRET);
    if (!payload) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const keys = resolveClerkKeys(c.env);
    const clerk = createClerkClient({
      publishableKey: keys.publishableKey,
      secretKey: keys.secretKey,
    });

    c.set('clerk', clerk);
    c.set('auth', {
      userId: payload.clerkUserId,
      sessionId: null,
      getToken: null,
    });
    c.set('user', null);

    await next();
  });
}
