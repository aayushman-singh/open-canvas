// src/password/middleware.ts
//
// `requireUnlock` — the public-host gate sitting in front of every
// password-protected site. Mounted by the main thread in `src/routes/public.ts`
// just before the snapshot-serve branch:
//
//   const gateResponse = await requireUnlock(c, c.env, db(c.env), siteRow);
//   if (gateResponse) return gateResponse;
//
// Behaviour:
//
//   1. If the site row's `passwordEnabled` is false → return `null` (continue
//      to snapshot serve).
//   2. If the request is the unlock POST itself (`/__rev01/unlock`) → return
//      `null` so the dedicated router handles it without the gate
//      intercepting itself. Other `/__rev01/*` visitor endpoints are still
//      gated.
//   3. Read the per-site cookie. If valid (signature good, exp > now,
//      hashEpoch >= site.passwordSetAt.getTime()) → return `null`
//      (continue).
//   4. Otherwise render the gate HTML and return it as a 401 response.
//
// The middleware never calls the rate limiter — that's the unlock route's
// job. Repeatedly hitting the gate (no POST, just GET) does NOT consume
// rate-limit budget; we only count failed POSTs.

import { type Context } from 'hono';
import { readUnlockCookieFromHeader, verifyUnlockCookie } from './cookie.js';
import { renderGateHtml } from './gate.js';
import { appOrigin, type HostConfigEnv } from '../host-config.js';

export interface PasswordProtectedSite {
  /** Site row id (UUID). Used for the cookie name and JWT payload. */
  id: string;
  /** Site display name for the gate heading. */
  name: string;
  /** Whether the password gate is currently switched on. */
  passwordEnabled: boolean;
  /** Stored PBKDF2 hash. Never read by middleware — passed to unlock route. */
  passwordHash: string | null;
  /** Rotation marker compared against the cookie's `hashEpoch`. */
  passwordSetAt: Date | null;
}

export type RequireUnlockEnv = HostConfigEnv & {
  /** HS256 cookie signing secret. Worker secret per wrangler.toml. */
  UNLOCK_SIGNING_SECRET: string;
};

const UNLOCK_PATH = '/__rev01/unlock';

// Anchored cookie regex: matches `oc-theme=light` or `oc-theme=dark` only
// when the pair sits at the start of the header or after a `; ` separator.
// The alternation pins the captured value to the closed alphabet
// `light|dark` — anything else returns undefined without touching the gate.
// Mirrors readThemeCookie in src/ui/theme.ts; duplicated here so the gate
// package keeps its zero-dependency surface.
const THEME_COOKIE_RE = /(?:^|;\s*)oc-theme=(light|dark)(?:;|$)/;

function readGateTheme(cookieHeader: string | null): 'light' | 'dark' | undefined {
  if (!cookieHeader) return undefined;
  const match = THEME_COOKIE_RE.exec(cookieHeader);
  return match ? (match[1] as 'light' | 'dark') : undefined;
}

/**
 * Check the unlock cookie for `site` against the incoming request.
 *
 *   - Returns `null` when the request should proceed (gate disabled, valid
 *     cookie, or the request targets the reserved unlock route).
 *   - Returns a `Response` when the request must be intercepted with the
 *     gate HTML (401 status).
 *
 * The middleware swallows nothing — it throws on shape errors (invalid env,
 * missing site fields). The caller in `src/routes/public.ts` lets those
 * exceptions bubble; the main app's error path turns them into 500s.
 */
export async function requireUnlock(
  c: Context,
  env: RequireUnlockEnv,
  site: PasswordProtectedSite,
): Promise<Response | null> {
  if (!site.passwordEnabled) return null;

  // Defensive: a site with `passwordEnabled=true` but no hash / no
  // `passwordSetAt` is a DB inconsistency. We refuse to gate without a hash
  // (would be unrecoverable — no password could ever satisfy the gate) and
  // refuse without `passwordSetAt` (no rotation marker for the cookie).
  // Failing loudly here surfaces the row drift to the Owner via the
  // standard error path; a silent "let traffic through" would defeat the
  // entire feature.
  if (site.passwordHash === null || site.passwordHash.length === 0) {
    throw new Error(`requireUnlock: site ${site.id} has passwordEnabled=true but no passwordHash`);
  }
  if (site.passwordSetAt === null) {
    throw new Error(`requireUnlock: site ${site.id} has passwordEnabled=true but no passwordSetAt`);
  }
  if (typeof env.UNLOCK_SIGNING_SECRET !== 'string' || env.UNLOCK_SIGNING_SECRET.length === 0) {
    throw new Error('requireUnlock: env.UNLOCK_SIGNING_SECRET is missing');
  }

  const requestUrl = new URL(c.req.url);

  // Bypass only the unlock route. Search, forms, and other visitor-facing
  // subsystem paths carry published-site content and must remain behind the
  // password gate.
  if (requestUrl.pathname === UNLOCK_PATH) {
    return null;
  }

  const cookieHeader = c.req.header('cookie') ?? null;
  const cookieValue = readUnlockCookieFromHeader(cookieHeader, site.id);
  if (cookieValue.length > 0) {
    const payload = await verifyUnlockCookie(env.UNLOCK_SIGNING_SECRET, cookieValue, {
      siteId: site.id,
      currentPasswordSetAt: site.passwordSetAt,
    });
    if (payload !== null) return null;
  }

  // No valid cookie — render the gate. The "retry"/"ratelimited" query
  // params are set by the unlock handler when it redirects back after a
  // failed attempt; we surface them via the gate's inline error blocks.
  const showError = requestUrl.searchParams.get('retry') === '1';
  const showRateLimit = requestUrl.searchParams.get('ratelimited') === '1';

  // The redirect-back target: the original path the Visitor wanted. We
  // include the search string but DROP any retry/ratelimited markers so the
  // post-success redirect doesn't echo the error state.
  const filteredSearch = new URLSearchParams();
  for (const [key, value] of requestUrl.searchParams.entries()) {
    if (key === 'retry' || key === 'ratelimited') continue;
    filteredSearch.append(key, value);
  }
  const filteredQs = filteredSearch.toString();
  const redirectPath =
    filteredQs.length > 0 ? `${requestUrl.pathname}?${filteredQs}` : requestUrl.pathname;

  const gateTheme = readGateTheme(cookieHeader);
  const html = renderGateHtml({
    redirect: redirectPath,
    showError,
    showRateLimit,
    siteName: site.name,
    appOrigin: appOrigin(env),
    ...(gateTheme ? { theme: gateTheme } : {}),
  });

  return new Response(html, {
    status: 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Cache headers prevent intermediate caches (and the browser) from
      // serving a stale gate after the cookie lands.
      'cache-control': 'no-store',
      // The gate must NOT be framed by another site — defence against
      // click-jacking on the password input.
      'x-frame-options': 'DENY',
    },
  });
}
