// src/password/cookie.ts
//
// HS256-signed cookie JWT for the visitor unlock gate. The cookie is set by
// the POST /__opencanvas/unlock handler after a successful password check; the
// middleware reads it on every subsequent visitor request to short-circuit
// the gate.
//
// Cookie name: `${COOKIE_NAME_PREFIX}unlock_<siteId>` derived from env via
// `cookieName.unlock(env, siteId)` per ADR 0017. Per-site scoping means a
// Visitor who unlocks site A does not get a free pass on site B even if
// both run on the same host (the wildcard subdomain under the configured
// apex shares cookies across subdomains by default — the per-site suffix
// is what segregates them).
//
// JWT payload shape:
//   {
//     siteId:    string  // the site this cookie unlocks
//     iat:       number  // unix-seconds issued-at
//     exp:       number  // unix-seconds expires-at (7d after iat)
//     hashEpoch: number  // site.passwordSetAt.getTime() at issue
//   }
//
// The `hashEpoch` field is the rotation marker: when an Owner changes the
// password, `site.passwordSetAt` advances, and every cookie whose
// `hashEpoch` is older than the current `passwordSetAt` becomes invalid.
// This is the cookie-invalidation-on-rotate requirement from the plan.
//
// HS256 was chosen over RS256 because:
//   - The signing key lives in `env.UNLOCK_SIGNING_SECRET` (a Worker secret),
//     so symmetric signing keeps the surface tiny — no keypair to manage.
//   - Verification + signing both happen inside the Worker, never a
//     third-party. There is no asymmetric trust boundary to bridge.
//
// All-or-nothing failure: `verifyUnlockCookie` returns null on any parse /
// signature / shape error. The middleware treats null as "show the gate"
// — no half-trusted fallback, no "skip verification on parse error". A
// tampered cookie is functionally identical to no cookie at all.

import { cookieName, type HostConfigEnv } from '../host-config.js';

const ALGO_HEADER = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  .replace(/=+$/, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

export interface UnlockCookiePayload {
  /** Site id the cookie unlocks. */
  siteId: string;
  /** Unix-seconds issued at. */
  iat: number;
  /** Unix-seconds expires at. */
  exp: number;
  /** `site.passwordSetAt.getTime()` at issue time. */
  hashEpoch: number;
}

export interface SignUnlockCookieInput {
  siteId: string;
  passwordSetAt: Date;
  /** Defaults to 7 days. */
  ttlSeconds?: number;
  /** Override for tests. Defaults to `Date.now()`. */
  nowMs?: number;
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Sign a fresh unlock JWT for the given site. The caller is responsible for
 * setting the resulting string as a `Set-Cookie` header — `cookieHeader`
 * below builds the full header string given the cookie value.
 */
export async function signUnlockCookie(
  secret: string,
  input: SignUnlockCookieInput,
): Promise<string> {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('signUnlockCookie: signing secret must be a non-empty string');
  }
  if (typeof input.siteId !== 'string' || input.siteId.length === 0) {
    throw new Error('signUnlockCookie: siteId must be a non-empty string');
  }
  if (!(input.passwordSetAt instanceof Date) || Number.isNaN(input.passwordSetAt.getTime())) {
    throw new Error('signUnlockCookie: passwordSetAt must be a valid Date');
  }
  const nowMs = input.nowMs ?? Date.now();
  const iat = Math.floor(nowMs / 1000);
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 60) {
    throw new Error(`signUnlockCookie: ttlSeconds must be a positive integer >= 60, got ${String(ttl)}`);
  }
  const payload: UnlockCookiePayload = {
    siteId: input.siteId,
    iat,
    exp: iat + ttl,
    hashEpoch: input.passwordSetAt.getTime(),
  };
  const payloadSegment = b64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${ALGO_HEADER}.${payloadSegment}`;
  const signature = await hmacSign(secret, signingInput);
  return `${signingInput}.${signature}`;
}

/**
 * Verify a JWT cookie string against the secret and the current rotation
 * marker. Returns the parsed payload on success, `null` on any failure mode:
 *
 *   - malformed (wrong number of segments, bad base64, bad JSON)
 *   - bad signature
 *   - missing required fields
 *   - exp < now
 *   - hashEpoch < currentPasswordSetAt.getTime() (rotated since issue)
 *
 * The middleware treats `null` as "show the gate" — no partial trust.
 */
export async function verifyUnlockCookie(
  secret: string,
  token: string,
  options: {
    siteId: string;
    currentPasswordSetAt: Date;
    /** Override for tests. Defaults to `Date.now()`. */
    nowMs?: number;
  },
): Promise<UnlockCookiePayload | null> {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('verifyUnlockCookie: signing secret must be a non-empty string');
  }
  if (typeof token !== 'string' || token.length === 0) return null;
  if (typeof options.siteId !== 'string' || options.siteId.length === 0) {
    throw new Error('verifyUnlockCookie: siteId must be a non-empty string');
  }
  if (
    !(options.currentPasswordSetAt instanceof Date) ||
    Number.isNaN(options.currentPasswordSetAt.getTime())
  ) {
    throw new Error('verifyUnlockCookie: currentPasswordSetAt must be a valid Date');
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  if (
    typeof headerSegment !== 'string' ||
    typeof payloadSegment !== 'string' ||
    typeof signatureSegment !== 'string'
  ) {
    return null;
  }

  // Sanity: header must match our exact ALGO_HEADER. We do NOT support
  // alternate alg values — accepting `alg: none` or RSXXX values is the
  // classic JWT confusion bug. Strict-equal is the cheapest correct check.
  if (headerSegment !== ALGO_HEADER) return null;

  // Recompute the signature over the signing input and compare. Constant-time
  // compare on the byte arrays.
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const expectedSignature = await hmacSign(secret, signingInput);
  if (!timingSafeStringEqual(signatureSegment, expectedSignature)) return null;

  let payload: UnlockCookiePayload;
  try {
    const payloadJson = new TextDecoder().decode(b64UrlDecode(payloadSegment));
    const raw = JSON.parse(payloadJson) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.siteId !== 'string' || obj.siteId.length === 0) return null;
    if (typeof obj.iat !== 'number' || !Number.isFinite(obj.iat)) return null;
    if (typeof obj.exp !== 'number' || !Number.isFinite(obj.exp)) return null;
    if (typeof obj.hashEpoch !== 'number' || !Number.isFinite(obj.hashEpoch)) return null;
    payload = {
      siteId: obj.siteId,
      iat: obj.iat,
      exp: obj.exp,
      hashEpoch: obj.hashEpoch,
    };
  } catch {
    return null;
  }

  // Bind to the site the middleware asked us about. A cookie minted for
  // site A must NOT unlock site B even if a misconfigured caller passes the
  // wrong one.
  if (payload.siteId !== options.siteId) return null;

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (payload.exp <= nowSeconds) return null;

  // Rotation check: hashEpoch must be >= currentPasswordSetAt.getTime().
  // Strict equality is the issue-time case; greater would only happen if the
  // DB row regressed (clock skew across writers) — we accept >= as the
  // canonical "not rotated since" check.
  if (payload.hashEpoch < options.currentPasswordSetAt.getTime()) return null;

  return payload;
}

/**
 * Build a complete `Set-Cookie` header value for the unlock JWT. The cookie
 * name embeds the siteId so per-site scoping survives the cookie-jar
 * collapse on the shared apex parent domain (see ADR 0013). The name itself
 * derives from `cookieName.unlock(env, siteId)` per ADR 0017.
 *
 * `Secure` is forced ON in production; the caller may pass `secure: false`
 * for localhost dev where Workers serves over plain HTTP and Chrome will
 * silently drop `Secure` cookies.
 */

export interface BuildCookieHeaderInput {
  siteId: string;
  value: string;
  /** Defaults to 7 days. */
  maxAgeSeconds?: number;
  /** Defaults to true; pass `false` for localhost dev. */
  secure?: boolean;
}

export function buildUnlockCookieHeader(env: HostConfigEnv, input: BuildCookieHeaderInput): string {
  const name = cookieName.unlock(env, input.siteId);
  const maxAge = input.maxAgeSeconds ?? DEFAULT_TTL_SECONDS;
  const secure = input.secure !== false;
  const parts = [
    `${name}=${input.value}`,
    'Path=/',
    `Max-Age=${String(maxAge)}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Build a `Set-Cookie` value that deletes the unlock cookie. Used by the
 * admin route when an Owner disables the password — the existing visitor
 * cookies do NOT auto-clear (Visitors keep their per-browser cookie until
 * expiry), but the Owner's preview tab can be cleared on disable.
 */
export function buildUnlockCookieClearHeader(
  env: HostConfigEnv,
  siteId: string,
  secure = true,
): string {
  const name = cookieName.unlock(env, siteId);
  const parts = [`${name}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Parse the unlock cookie value out of a request `Cookie` header. Returns the
 * empty string when the cookie is not present — the caller treats that as
 * "no cookie, show gate".
 */
export function readUnlockCookieFromHeader(
  env: HostConfigEnv,
  cookieHeader: string | null,
  siteId: string,
): string {
  if (!cookieHeader) return '';
  const name = cookieName.unlock(env, siteId);
  // Cookie header is a `; `-separated list of `name=value` pairs. We split
  // by `;` (the canonical separator) and tolerate any whitespace either side
  // of the `=` so a non-standard producer can't poison the parse.
  const segments = cookieHeader.split(';');
  for (const seg of segments) {
    const trimmed = seg.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== name) continue;
    return trimmed.slice(eq + 1).trim();
  }
  return '';
}

// ---------------------------------------------------------------------------
// HMAC + base64url helpers
// ---------------------------------------------------------------------------

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64UrlEncode(new Uint8Array(signature));
}

function b64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i += 1) {
    str += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(str).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const str = atob(b64);
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    out[i] = str.charCodeAt(i);
  }
  return out;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
