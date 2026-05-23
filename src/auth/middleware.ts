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
  // wrangler dev's routes-based URL synthesis is in effect. Defaults to
  // http://127.0.0.1:8787 when not set.
  DEV_PUBLIC_HOST?: string;
};

export type ClerkAuthVariables = {
  auth: AuthState;
  user: User | null;
  clerk: ReturnType<typeof createClerkClient>;
};

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
export function resolveClerkKeys(env: ClerkBindings): {
  publishableKey: string;
  secretKey: string;
} {
  const testPub = env.CLERK_TEST_PUBLISHABLE_KEY;
  const testSec = env.CLERK_TEST_SECRET_KEY;
  if (
    typeof testPub === 'string' &&
    testPub.length > 0 &&
    typeof testSec === 'string' &&
    testSec.length > 0
  ) {
    return { publishableKey: testPub, secretKey: testSec };
  }
  return { publishableKey: env.CLERK_PUBLISHABLE_KEY, secretKey: env.CLERK_SECRET_KEY };
}

export function clerkAuth() {
  return createMiddleware<{
    Bindings: ClerkBindings;
    Variables: ClerkAuthVariables;
  }>(async (c, next) => {
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
    const usingTestKeys = keys.publishableKey === c.env.CLERK_TEST_PUBLISHABLE_KEY;
    let requestForClerk: Request = c.req.raw;
    if (usingTestKeys) {
      const localOrigin = c.env.DEV_PUBLIC_HOST ?? 'http://127.0.0.1:8787';
      const original = new URL(c.req.url);
      const rebuilt = new URL(original.pathname + original.search, localOrigin);
      // Rebuild with the local origin AND override Origin/Referer headers so
      // Clerk's session-refresh path (which validates azp against the request
      // origin header, not just the request URL) accepts the cookie tokens
      // issued for localhost. Without this override the refresh fails with
      // `refresh_request_origin_azp_mismatch` once the short-lived dev JWT
      // expires (~60s).
      const headers = new Headers(c.req.raw.headers);
      headers.set('host', new URL(localOrigin).host);
      headers.set('origin', localOrigin);
      const existingReferer = headers.get('referer');
      if (existingReferer) {
        try {
          const refererPath = new URL(existingReferer).pathname;
          headers.set('referer', new URL(refererPath, localOrigin).toString());
        } catch {
          headers.delete('referer');
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
