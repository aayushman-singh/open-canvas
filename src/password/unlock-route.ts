// src/password/unlock-route.ts
//
// POST /__rev01/unlock — mounted on the **public host** path by the main
// thread. Verifies the submitted password against the site row's stored
// hash, sets the unlock cookie, and 303-redirects back to the path the
// gate captured.
//
// Flow:
//   1. Resolve the site row by Host header (wildcard subdomain or active
//      custom domain).
//   2. Parse the form body for `password` + `redirect`.
//   3. Check rate-limit BEFORE verifying. A wrong password triggers the
//      same budget as no password at all — the limiter doesn't care about
//      payload, only attempt counts per IP.
//   4. Verify the password against `site.passwordHash`. On mismatch, 303
//      back to `redirect?retry=1`. On match, sign a cookie and 303 to
//      `redirect`.
//
// The route is mounted at `/__rev01/unlock` so the middleware's
// `/__rev01/*` bypass lets it through even on a protected site.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  buildUnlockCookieHeader,
  signUnlockCookie,
} from './cookie.js';
import { sanitiseRedirect } from './gate.js';
import { verifyPassword } from './hash.js';
import {
  type RateLimiter,
  DurableObjectRateLimiter,
  InProcessRateLimiter,
  type FormRateLimiterDoNamespace,
} from './rate-limit.js';
import { resolveCustomDomainWithRuntimeCache } from '../custom-domain/router.js';
import { db } from '../db/client.js';
import { site } from '../db/schema.js';

interface Bindings {
  DATABASE_URL: string;
  UNLOCK_SIGNING_SECRET: string;
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  /**
   * Shared FormRateLimiter DO (see `src/forms/`). Optional at the type level
   * because the DO body may not have landed; the route falls back to an
   * in-process limiter when missing. Production deploys ALWAYS have the
   * binding (declared in wrangler.toml).
   */
  FORM_RATE_LIMITER?: FormRateLimiterDoNamespace;
}

type Env = { Bindings: Bindings };

const router = new Hono<Env>();

// ---------------------------------------------------------------------------
// Site lookup
// ---------------------------------------------------------------------------
//
// The unlock POST arrives on the Visitor's host (`*.rev01.aayushman.dev` or
// a custom domain — see `src/custom-domain/`). We resolve the site row by
// the same rules `src/routes/public.ts` uses for the snapshot path.

const PUBLIC_HOST_SUFFIX = '.rev01.aayushman.dev';

interface SiteRow {
  id: string;
  name: string;
  passwordEnabled: boolean;
  passwordHash: string | null;
  passwordSetAt: Date | null;
}

async function loadSiteBySubdomain(
  env: Bindings,
  subdomain: string,
): Promise<SiteRow | null> {
  const database = db(env);
  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      passwordEnabled: site.passwordEnabled,
      passwordHash: site.passwordHash,
      passwordSetAt: site.passwordSetAt,
    })
    .from(site)
    .where(eq(site.subdomain, subdomain))
    .limit(1);
  return rows[0] ?? null;
}

async function loadSiteById(env: Bindings, siteId: string): Promise<SiteRow | null> {
  const database = db(env);
  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      passwordEnabled: site.passwordEnabled,
      passwordHash: site.passwordHash,
      passwordSetAt: site.passwordSetAt,
    })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1);
  return rows[0] ?? null;
}

function extractSubdomain(host: string): string | null {
  if (!host.endsWith(PUBLIC_HOST_SUFFIX)) return null;
  const prefix = host.slice(0, host.length - PUBLIC_HOST_SUFFIX.length);
  if (prefix.length === 0) return null;
  if (prefix.includes('.')) return null;
  return prefix;
}

async function resolveSiteForHost(env: Bindings, host: string): Promise<SiteRow | null> {
  const subdomain = extractSubdomain(host);
  if (subdomain) {
    return loadSiteBySubdomain(env, subdomain);
  }
  const customDomainHit = await resolveCustomDomainWithRuntimeCache(host, env);
  if (customDomainHit) {
    return loadSiteById(env, customDomainHit.siteId);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rate limiter selection
// ---------------------------------------------------------------------------
//
// Prefer the production DO when bound; fall back to a per-isolate in-memory
// limiter otherwise. Per-isolate is NOT enough for prod (concurrent isolates
// each maintain their own counter), but it keeps local dev usable when the
// FormRateLimiter DO from #7 is still throwing-stub.

// Module-singleton fallback so a sequence of unlock POSTs in the same isolate
// share counters. Reset per cold start; acceptable for dev. Production uses
// the DO when bound.
const moduleFallback = new InProcessRateLimiter();

function pickLimiter(env: Bindings): RateLimiter {
  if (env.FORM_RATE_LIMITER) {
    return new DurableObjectRateLimiter(env.FORM_RATE_LIMITER);
  }
  return moduleFallback;
}

// ---------------------------------------------------------------------------
// IP extraction
// ---------------------------------------------------------------------------
//
// Cloudflare passes the visitor IP in `CF-Connecting-IP`. Behind any other
// proxy we'd consult `X-Forwarded-For`, but on the Workers runtime the
// CF-Connecting-IP header is the canonical signal (CF strips spoofed
// versions before invoking the Worker). When neither is present (smoke /
// dev tests) we fall back to a fixed sentinel — that's only acceptable
// because dev doesn't face real attack traffic.

function extractIp(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf && cf.length > 0) return cf;
  const xff = request.headers.get('x-forwarded-for');
  if (xff && xff.length > 0) {
    // Take the leftmost entry — the original client per RFC 7239 §5.2.
    const first = xff.split(',')[0];
    if (first) return first.trim();
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

router.post('/', async (c) => {
  const requestUrl = new URL(c.req.url);
  const host = requestUrl.host;
  const siteRow = await resolveSiteForHost(c.env, host);
  if (!siteRow) {
    return c.text('site not found', 404);
  }
  if (!siteRow.passwordEnabled || siteRow.passwordHash === null || siteRow.passwordSetAt === null) {
    // Site has no gate. Treat the POST as a no-op redirect to the root —
    // pretending the gate still exists by 401-ing would leak the on/off
    // state to a probing attacker. Same path the gate would have taken on
    // success, so the Visitor lands on the homepage either way.
    return c.redirect('/', 303);
  }

  // Parse form body. Hono's `parseBody` handles both
  // `application/x-www-form-urlencoded` and `multipart/form-data`; the gate
  // submits the former.
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch {
    return c.text('invalid form body', 400);
  }
  const passwordValue = form['password'];
  const redirectValue = form['redirect'];
  const password = typeof passwordValue === 'string' ? passwordValue : '';
  const redirectRaw = typeof redirectValue === 'string' ? redirectValue : '/';
  const redirect = sanitiseRedirect(redirectRaw);

  // Rate-limit check. We record the attempt BEFORE the password compare so
  // a steady stream of attempts can't be hidden inside the verify latency.
  const limiter = pickLimiter(c.env);
  const ipKey = extractIp(c.req.raw);
  const rateResult = await limiter.checkAndRecord({
    ipKey,
    kind: 'password-unlock',
  });
  if (!rateResult.allowed) {
    const retrySeconds = rateResult.retryAfterMs
      ? Math.max(1, Math.ceil((rateResult.retryAfterMs - Date.now()) / 1000))
      : 60;
    // Redirect back to the requested path with the ratelimited marker so
    // the gate shows the "wait a minute" copy. A bare 429 JSON would look
    // broken to a Visitor who's only ever seen the gate.
    return new Response(null, {
      status: 303,
      headers: {
        location: `${redirect}?ratelimited=1`,
        'retry-after': String(retrySeconds),
      },
    });
  }

  // Empty password is treated as "wrong password" rather than a 400 — the
  // form's `required` attribute should prevent empty submits, but the
  // server treats a malformed client as a failed attempt either way.
  let ok = false;
  if (password.length > 0) {
    ok = await verifyPassword(password, siteRow.passwordHash);
  }
  if (!ok) {
    return new Response(null, {
      status: 303,
      headers: {
        location: `${redirect}?retry=1`,
      },
    });
  }

  // Success: sign the cookie and 303 back to the requested path.
  const token = await signUnlockCookie(c.env.UNLOCK_SIGNING_SECRET, {
    siteId: siteRow.id,
    passwordSetAt: siteRow.passwordSetAt,
  });
  // Localhost dev runs over plain HTTP; Chrome silently drops `Secure`
  // cookies on http://. Detect that and drop the flag in dev.
  const secure = requestUrl.protocol === 'https:';
  const cookieHeader = buildUnlockCookieHeader({
    siteId: siteRow.id,
    value: token,
    secure,
  });

  return new Response(null, {
    status: 303,
    headers: {
      location: redirect,
      'set-cookie': cookieHeader,
    },
  });
});

export default router;
