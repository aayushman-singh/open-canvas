// src/auth/edit-token.ts
//
// HMAC-SHA256 JWT for cross-subdomain on-site editor auth. The main domain
// signs a short-lived token after Clerk auth; the token is set as a cookie
// scoped to .rev01.aayushman.dev so published-site subdomains can read it.
// The token carries the Owner's identity (clerkUserId, customerId) and the
// site it was issued for, letting the /__api/* proxy and /__edit handler
// verify ownership without a Clerk session cookie on the subdomain.

export interface EditTokenPayload {
  siteId: string;
  customerId: string;
  clerkUserId: string;
  iat: number;
  exp: number;
}

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;
const TTL_SECONDS = 14400; // 4 hours

function base64UrlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALGORITHM,
    false,
    ['sign', 'verify'],
  );
}

export async function signEditToken(
  payload: Omit<EditTokenPayload, 'iat' | 'exp'>,
  secret: string,
  ttl: number = TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: EditTokenPayload = { ...payload, iat: now, exp: now + ttl };
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(full)));
  const data = `${header}.${body}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(sig)}`;
}

export async function verifyEditToken(
  token: string | undefined | null,
  secret: string,
): Promise<EditTokenPayload | null> {
  if (typeof token !== 'string' || token.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const data = `${parts[0]}.${parts[1]}`;
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(parts[2]!);
  } catch {
    return null;
  }

  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    new TextEncoder().encode(data),
  );
  if (!valid) return null;

  let payload: EditTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]!)));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (
    typeof payload.siteId !== 'string' ||
    typeof payload.customerId !== 'string' ||
    typeof payload.clerkUserId !== 'string'
  ) {
    return null;
  }

  return payload;
}

export const EDIT_TOKEN_COOKIE = '__rev01_edit';
export const EDIT_TOKEN_MAX_AGE = TTL_SECONDS;
