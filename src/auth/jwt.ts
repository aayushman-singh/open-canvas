// src/auth/jwt.ts
//
// Generic HMAC-SHA256 JWT primitive. Used by both edit-token and invite-token
// modules — each layer adds its own payload-shape check on top. Keeping the
// primitive shape-agnostic avoids the coupling that previously made every
// invite token fail verification: a stricter token's shape check was being
// run on a looser token's payload.

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;

export type JwtFailure = 'malformed' | 'bad-signature' | 'expired';

export type JwtVerifyResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: JwtFailure };

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
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), ALGORITHM, false, [
    'sign',
    'verify',
  ]);
}

export async function signJWT(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
  );
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(full)));
  const data = `${header}.${body}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${base64UrlEncode(sig)}`;
}

export async function verifyJWT(
  token: string | undefined | null,
  secret: string,
): Promise<JwtVerifyResult> {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, reason: 'malformed' };
  }

  const data = `${parts[0]}.${parts[1]}`;
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(parts[2]!);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const key = await importKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
  if (!valid) {
    return { ok: false, reason: 'bad-signature' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]!)));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (payload === null || typeof payload !== 'object') {
    return { ok: false, reason: 'malformed' };
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.exp !== 'number' || !Number.isFinite(record.exp)) {
    return { ok: false, reason: 'malformed' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (record.exp <= now) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, payload: record };
}
