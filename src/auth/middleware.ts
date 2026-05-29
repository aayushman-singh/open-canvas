import { createClerkClient, type User } from '@clerk/backend';
import { eq } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { resolveCustomDomainWithRuntimeCache } from '../custom-domain/router';
import { db } from '../db/client';
import { site } from '../db/schema';
import {
  authorizedParties,
  cookieName,
  publicHostSuffix,
  resolveDevPublicOrigin,
  type HostConfigEnv,
} from '../host-config';
import { upsertCustomerFromClerk } from './customer-upsert';
import { verifyEditToken } from './edit-token';

export type AuthState = {
  userId: string | null;
  sessionId: string | null;
  getToken: ((options?: { template?: string }) => Promise<string | null>) | null;
};

// Minimal env shape for picking a Clerk key pair. Leaf callers
// (`resolveClerkKeys`, `usesTestClerkKeys`) read only the four `CLERK_*`
// fields; widening the parameter to the full `ClerkBindings` (which spreads
// `HostConfigEnv`) would force every route file that just wants a key pair
// to inject APP_DOMAIN/AUTHORIZED_PARTIES/EMAIL_FROM into its local
// `Bindings`. The narrower type keeps host config out of the call signature.
export type ClerkKeyEnv = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
};

type ClerkBindings = HostConfigEnv &
  ClerkKeyEnv;

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

// Accepted origins, public-host suffix, and the dev-public-origin override
// all derive from env (`AUTHORIZED_PARTIES`, `APP_DOMAIN`, `DEV_PUBLIC_HOST`)
// via `src/host-config.ts` per ADR 0013. Local constants used to mirror these
// values; that scattered-hardcode pattern is what ADR 0013 names.

// Picks the publishable/secret key pair to use. Live keys
// (CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY) are the default; the test pair
// is preferred whenever it is populated.
//
// Selection trigger is presence-of-test-keys, not request hostname, because
// wrangler dev rewrites c.req.url to the worker's prod custom-domain pattern
// (e.g. the configured apex) regardless of the local listening address, so a
// hostname check fires false for real localhost traffic. The CLERK_TEST_*
// secrets are populated in the local .env only and are NEVER added to the
// prod worker secret set, so their presence reliably signals "this is a dev
// environment".
export function resolveClerkKeys(env: ClerkKeyEnv): ClerkKeyPair {
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

function usesTestClerkKeys(env: ClerkKeyEnv, keys: ClerkKeyPair): boolean {
  return (
    keys.publishableKey === env.CLERK_TEST_PUBLISHABLE_KEY &&
    keys.secretKey === env.CLERK_TEST_SECRET_KEY
  );
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
  env: ClerkKeyEnv & HostConfigEnv,
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

// Wrangler dev rewrites both `c.req.url` AND the Host header to match the
// worker's [[routes]] pattern (the configured apex origin) even when the
// browser hit localhost. That breaks Clerk's handshake: Clerk validates
// the handshake JWT against the request's origin, sees the prod host instead
// of localhost, and rejects the session forever.
//
// Workaround: when running with the test Clerk app (whose handshake JWT was
// issued for the local host), rebuild a Request with the local origin AND
// Origin/Referer headers so Clerk's session-refresh path (which validates
// azp against the request origin header, not just the request URL) accepts
// the cookie tokens issued for localhost. Without this override the refresh
// fails with `refresh_request_origin_azp_mismatch` once the short-lived dev
// JWT expires (~60s).
//
// The original request's body is intentionally NOT forwarded into the
// rebuilt Request. clerk.authenticateRequest() validates cookies, headers,
// and URL — never the body — so omitting it costs nothing on the Clerk
// side. Forwarding `c.req.raw.body` here transfers ownership of the
// underlying ReadableStream per the Fetch spec, which locks the original
// stream; downstream handlers that call c.req.json() then read an empty
// body. The auth path must leave the request's body intact for the
// handler.
export function rebuildRequestForLocalDevClerk(rawReq: Request, localOrigin: string): Request {
  const localOriginUrl = new URL(localOrigin);
  const original = new URL(rawReq.url);
  const rebuilt = new URL(original.pathname + original.search, localOrigin);
  const headers = new Headers(rawReq.headers);
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
  return new Request(rebuilt.toString(), {
    method: rawReq.method,
    headers,
    redirect: rawReq.redirect,
  });
}

export function clerkAuth() {
  return createMiddleware<{
    // DATABASE_URL is required because upsertCustomerFromClerk runs on every
    // authenticated request to keep the local customer row in sync.
    Bindings: ClerkBindings & { DATABASE_URL: string };
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

    const usingTestKeys = usesTestClerkKeys(c.env, keys);
    const requestForClerk: Request = usingTestKeys
      ? rebuildRequestForLocalDevClerk(c.req.raw, resolveDevPublicOrigin(c.env))
      : c.req.raw;

    const requestState = await clerk.authenticateRequest(requestForClerk, {
      authorizedParties: authorizedParties(c.env),
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

    // Forward any Clerk-* headers Clerk attached to the response. Set-Cookie
    // headers are forwarded individually via getSetCookie() because
    // Headers.entries() merges them into one comma-separated value, which
    // corrupts cookies and breaks Clerk's session-token refresh cycle.
    for (const [key, value] of requestState.headers.entries()) {
      if (key === 'set-cookie') continue;
      c.header(key, value, { append: true });
    }
    const getSetCookie = (requestState.headers as Headers & { getSetCookie(): string[] })
      .getSetCookie.bind(requestState.headers);
    for (const cookie of getSetCookie()) {
      c.header('set-cookie', cookie, { append: true });
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

    // Sync the local customer row on every authenticated request. Previously
    // this lived only in three dashboard handlers (index, profile, settings),
    // so a fresh Clerk sign-up that hit any other route first wedged at
    // requireOwnerContext (no customer row -> 403 forever). Centralising it
    // here removes that latent lockout. The dashboard callers still upsert
    // themselves for their email-return value; those calls are now redundant
    // and can be replaced with a context read in a follow-up.
    await upsertCustomerFromClerk(db(c.env), user);

    await next();
  });
}

// Middleware for /__api/* routes on published-site subdomains. Validates the
// edit-token cookie (set by the /api/on-site-edit popup; name derived from
// `cookieName.edit(env)` per ADR 0017) and populates the same
// auth / user / clerk context variables that clerkAuth() would, so
// downstream handlers (canvasApi, publishApi, etc.) work unchanged.
type EditTokenBindings = ClerkBindings & { UNLOCK_SIGNING_SECRET: string };

function extractPublishedSubdomain(env: HostConfigEnv, host: string): string | null {
  const suffix = publicHostSuffix(env);
  if (!host.endsWith(suffix)) return null;
  const prefix = host.slice(0, host.length - suffix.length);
  if (prefix.length === 0 || prefix.includes('.')) return null;
  return prefix;
}

export function extractEditApiRouteSiteId(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i] === 'sites') {
      return parts[i + 1] ?? null;
    }
  }
  return null;
}

export async function resolveEditHostSiteId(
  env: EditTokenBindings & { DATABASE_URL: string },
  hostHeader: string,
): Promise<string | null> {
  const host = hostHeader.toLowerCase();
  const subdomain = extractPublishedSubdomain(env, host);
  if (subdomain !== null) {
    const rows = await db(env)
      .select({ id: site.id })
      .from(site)
      .where(eq(site.subdomain, subdomain))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  const custom = await resolveCustomDomainWithRuntimeCache(host, env);
  return custom?.siteId ?? null;
}

export function editTokenAuth() {
  return createMiddleware<{
    Bindings: EditTokenBindings & { DATABASE_URL: string };
    Variables: ClerkAuthVariables;
  }>(async (c, next) => {
    const token = getCookie(c, cookieName.edit(c.env));
    const payload = await verifyEditToken(token, c.env.UNLOCK_SIGNING_SECRET);
    if (!payload) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const expectedSiteId = await resolveEditHostSiteId(c.env, new URL(c.req.url).host);
    if (!expectedSiteId || payload.siteId !== expectedSiteId) {
      return c.json({ error: 'edit token does not match published host' }, 403);
    }

    const requestedSiteId = extractEditApiRouteSiteId(c.req.path);
    if (requestedSiteId !== null && requestedSiteId !== payload.siteId) {
      return c.json({ error: 'edit token does not match requested site' }, 403);
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
