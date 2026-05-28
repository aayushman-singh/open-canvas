// src/auth/edit-token.ts
//
// HMAC-SHA256 JWT for cross-subdomain on-site editor auth. The main domain
// signs a short-lived token after Clerk auth; the token is set as a cookie
// scoped to .rev01.aayushman.dev so published-site subdomains can read it.
// The token carries the Owner's identity (clerkUserId, customerId) and the
// site it was issued for, letting the /__api/* proxy and /__edit handler
// verify ownership without a Clerk session cookie on the subdomain.

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
  return signJWT(payload as unknown as Record<string, unknown>, secret, ttl);
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
