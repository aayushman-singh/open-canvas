// src/auth/edit-token.ts
//
// HMAC-SHA256 JWT for cross-subdomain on-site editor auth. The main domain
// signs a short-lived token after Clerk auth; the token is set as a cookie
// scoped to the configured apex (`APP_DOMAIN`) so published-site subdomains
// can read it. The token carries the Owner's identity (clerkUserId,
// customerId) and the site it was issued for, letting the /__api/* proxy and
// the /?edit handler verify ownership without a Clerk session cookie on the
// subdomain.

import { cookieDomain, publicHostSuffix, type HostConfigEnv } from '../host-config';
import { signJWT, verifyJWT } from './jwt';

export interface EditTokenPayload {
  siteId: string;
  customerId: string;
  clerkUserId: string;
  iat: number;
  exp: number;
}

const TTL_SECONDS = 14400; // 4 hours

function hasEditTokenShape(value: Record<string, unknown>): boolean {
  return (
    typeof value.siteId === 'string' &&
    typeof value.customerId === 'string' &&
    typeof value.clerkUserId === 'string' &&
    typeof value.iat === 'number' &&
    typeof value.exp === 'number' &&
    Number.isFinite(value.iat) &&
    Number.isFinite(value.exp)
  );
}

export async function signEditToken(
  payload: Omit<EditTokenPayload, 'iat' | 'exp'>,
  secret: string,
  ttl: number = TTL_SECONDS,
): Promise<string> {
  return signJWT(payload, secret, ttl);
}

export async function verifyEditToken(
  token: string | undefined | null,
  secret: string,
): Promise<EditTokenPayload | null> {
  const result = await verifyJWT(token, secret);
  if (!result.ok) return null;
  if (!hasEditTokenShape(result.payload)) return null;
  return result.payload as unknown as EditTokenPayload;
}

export const EDIT_TOKEN_COOKIE = '__rev01_edit';
export const EDIT_TOKEN_MAX_AGE = TTL_SECONDS;

// The cookie scope depends on which host issues it. On any host under the
// configured apex (the popup runs on the apex, the editor runs on a
// subdomain) the cookie must be domain-scoped so every sibling subdomain can
// read it. On a custom domain there is no shared parent — the cookie must be
// host-scoped or the browser rejects it. A previous refresh path issued
// host-scoped on every host and silently broke cross-subdomain editing; this
// helper is the single source of truth so that bug cannot regress per-site.

export function buildEditTokenCookieHeader(
  env: HostConfigEnv,
  token: string,
  requestHost: string,
): string {
  const apex = cookieDomain(env);
  const suffix = publicHostSuffix(env);
  const host = requestHost.toLowerCase();
  const onApex = host === apex || host.endsWith(suffix);
  const parts = [
    `${EDIT_TOKEN_COOKIE}=${token}`,
    ...(onApex ? [`Domain=${apex}`] : []),
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${EDIT_TOKEN_MAX_AGE}`,
  ];
  return parts.join('; ');
}
