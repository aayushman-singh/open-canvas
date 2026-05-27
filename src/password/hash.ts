// src/password/hash.ts
//
// PBKDF2-SHA-256 password hash + verify for the visitor unlock gate. The hash
// is stored in `site.passwordHash` as a single self-describing string in the
// shape `pbkdf2-sha256$<iter>$<salt-b64>$<hash-b64>`, so a future parameter
// rotation (different iter count, different hash algo) can be detected and
// migrated transparently without a separate columns.
//
// Why PBKDF2: it's the only password-hashing primitive Cloudflare Workers'
// Web Crypto exposes (`crypto.subtle.deriveBits`). bcrypt / argon2 are not
// available in the Workers runtime without bundling a WASM module, which
// would balloon the worker bundle and add boot latency for every Visitor
// request that hits the gate. PBKDF2 at 100_000 iter / SHA-256 / 32-byte
// hash is acceptable for the POC threat model — Visitors gain access via a
// shared password the Owner set, and rate-limiting at the edge (5 failed
// attempts/min/IP) blunts online attacks. Offline attacks against a stolen
// `passwordHash` are slower than bcrypt but still cost millions of GPU-hours
// per password at realistic password complexity.
//
// All-or-nothing failure: every function in this module throws on shape
// errors. No silent fallbacks, no `null` returns that callers might forget
// to check. The middleware that calls `verifyPassword` either gets `true`,
// `false`, or an exception — never a "verification skipped" state.

const ALGO = 'pbkdf2-sha256';
const ITERATIONS = 100_000;
const SALT_BYTES = 32;
const HASH_BYTES = 32;

/**
 * Hash a plaintext password with PBKDF2-SHA-256.
 *
 * Returns the self-describing encoded string ready for direct insertion into
 * `site.passwordHash`. The salt is freshly random per call — calling this
 * twice with the same password yields two different hashes (which is the
 * point: identical hashes across sites would leak password reuse).
 */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string') {
    throw new TypeError(`hashPassword: plain must be a string, got ${typeof plain}`);
  }
  if (plain.length === 0) {
    throw new Error('hashPassword: empty password is not allowed');
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveBits(plain, salt, ITERATIONS, HASH_BYTES);
  return encodeHash(ITERATIONS, salt, hash);
}

/**
 * Verify a plaintext password against an encoded `pbkdf2-sha256$...` hash.
 *
 * Returns `true` on match, `false` on mismatch. Throws on a malformed encoded
 * string — a corrupt `passwordHash` column means the DB row is broken and
 * the Owner needs to know; silently returning `false` would lock the Owner
 * out of their own site without an actionable error.
 */
export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  if (typeof plain !== 'string') {
    throw new TypeError(`verifyPassword: plain must be a string, got ${typeof plain}`);
  }
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new Error('verifyPassword: encoded hash must be a non-empty string');
  }
  const parsed = decodeHash(encoded);
  const candidate = await deriveBits(plain, parsed.salt, parsed.iterations, parsed.hash.length);
  return timingSafeEqual(candidate, parsed.hash);
}

interface ParsedHash {
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

function encodeHash(iterations: number, salt: Uint8Array, hash: Uint8Array): string {
  return `${ALGO}$${String(iterations)}$${toB64(salt)}$${toB64(hash)}`;
}

function decodeHash(encoded: string): ParsedHash {
  const parts = encoded.split('$');
  if (parts.length !== 4) {
    throw new Error(`verifyPassword: encoded hash has ${String(parts.length)} parts, expected 4`);
  }
  const [algo, iterRaw, saltB64, hashB64] = parts;
  if (algo !== ALGO) {
    throw new Error(`verifyPassword: unsupported algo '${String(algo)}', expected '${ALGO}'`);
  }
  if (typeof iterRaw !== 'string' || typeof saltB64 !== 'string' || typeof hashB64 !== 'string') {
    throw new Error('verifyPassword: encoded hash parts must all be strings');
  }
  const iterations = Number.parseInt(iterRaw, 10);
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(`verifyPassword: iter count '${iterRaw}' is not a positive integer`);
  }
  const salt = fromB64(saltB64);
  const hash = fromB64(hashB64);
  if (salt.length === 0) {
    throw new Error('verifyPassword: salt decoded to zero bytes');
  }
  if (hash.length === 0) {
    throw new Error('verifyPassword: hash decoded to zero bytes');
  }
  return { iterations, salt, hash };
}

async function deriveBits(
  plain: string,
  salt: Uint8Array,
  iterations: number,
  hashBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(plain),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    hashBytes * 8,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function toB64(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i += 1) {
    str += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(str);
}

function fromB64(b64: string): Uint8Array {
  const str = atob(b64);
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    out[i] = str.charCodeAt(i);
  }
  return out;
}
