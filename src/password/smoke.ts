// src/password/smoke.ts
//
// `bun run password:smoke` — exercises the password-gate primitives without
// touching the DB or the Workers runtime. Each function under test is a
// pure function (or accepts an injected dependency); the smoke wires
// fixtures and asserts the outcome.
//
// Coverage (per the plan's smoke section):
//
//   1. Hash + verify round-trip works; bad password rejected; tampered
//      hash throws.
//   2. Cookie signed correctly; tampered cookie rejected; alg-confusion
//      rejected; expired cookie rejected; rotated `hashEpoch` rejected.
//   3. `requireUnlock`:
//        a. Site without passwordEnabled → null.
//        b. Site with password + no cookie → 401 + gate body.
//        c. Site with valid cookie → null.
//        d. Site with stale-hashEpoch cookie → 401 (rotation invalidation).
//        e. Unlock path /__rev01/unlock → null (bypass).
//        f. Visitor subsystem path /__rev01/search → 401 (still gated).
//   4. Rate-limit: 6th failed attempt inside 60s gets 429.
//
// Hermetic, no network, no DB.

import {
  buildUnlockCookieHeader,
  readUnlockCookieFromHeader,
  signUnlockCookie,
  unlockCookieName,
  verifyUnlockCookie,
} from './cookie.js';
import { renderGateHtml, sanitiseRedirect } from './gate.js';
import { hashPassword, verifyPassword } from './hash.js';
import { requireUnlock, type PasswordProtectedSite, type RequireUnlockEnv } from './middleware.js';
import { InProcessRateLimiter } from './rate-limit.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[password:smoke] ${message}`);
}

async function assertThrowsAsync(fn: () => Promise<unknown>, message: string): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

// ---------------------------------------------------------------------------
// 1. Hash + verify
// ---------------------------------------------------------------------------

async function runHashSuite(): Promise<void> {
  const password = 'correct horse battery staple';
  const hash = await hashPassword(password);
  assert(typeof hash === 'string' && hash.length > 0, 'hashPassword returned non-string');
  assert(
    hash.startsWith('pbkdf2-sha256$100000$'),
    `hash should start with pbkdf2-sha256$100000$ — got ${hash.slice(0, 40)}`,
  );
  // Hash includes salt; two calls with the same input MUST diverge.
  const hash2 = await hashPassword(password);
  assert(hash !== hash2, 'two hashes of the same password should differ via salt');

  // Round-trip.
  assert(await verifyPassword(password, hash), 'verify should return true for the right password');
  assert(await verifyPassword(password, hash2), 'second hash should verify too');
  assert(!(await verifyPassword('wrong', hash)), 'verify should return false for the wrong password');

  // Empty password: hashing rejects.
  await assertThrowsAsync(() => hashPassword(''), 'hashing empty password should throw');

  // Tampered hash throws.
  const tampered = hash.replace('pbkdf2-sha256$', 'sha512$');
  await assertThrowsAsync(
    () => verifyPassword(password, tampered),
    'verify should throw on unsupported algo',
  );
  await assertThrowsAsync(
    () => verifyPassword(password, 'not a hash'),
    'verify should throw on malformed hash',
  );
}

// ---------------------------------------------------------------------------
// 2. Cookie sign + verify
// ---------------------------------------------------------------------------

async function runCookieSuite(): Promise<void> {
  const secret = 'test-secret-please-rotate-in-prod';
  const siteId = 'site-1';
  const passwordSetAt = new Date('2026-05-23T12:00:00Z');

  const token = await signUnlockCookie(secret, { siteId, passwordSetAt });
  assert(token.split('.').length === 3, 'JWT must have 3 dot-separated segments');

  const payload = await verifyUnlockCookie(secret, token, {
    siteId,
    currentPasswordSetAt: passwordSetAt,
  });
  assert(payload !== null, 'fresh cookie should verify');
  assert(payload?.siteId === siteId, 'payload siteId mismatch');
  assert(payload?.hashEpoch === passwordSetAt.getTime(), 'hashEpoch should match passwordSetAt');

  // Wrong secret → null.
  const wrongSecret = await verifyUnlockCookie('different', token, {
    siteId,
    currentPasswordSetAt: passwordSetAt,
  });
  assert(wrongSecret === null, 'wrong secret should reject');

  // Cross-site → null.
  const wrongSite = await verifyUnlockCookie(secret, token, {
    siteId: 'site-2',
    currentPasswordSetAt: passwordSetAt,
  });
  assert(wrongSite === null, 'mismatched siteId should reject');

  // Tampered signature → null.
  const segments = token.split('.');
  const lastSeg = segments[2] ?? '';
  const tamperedSig = `${segments[0] ?? ''}.${segments[1] ?? ''}.${lastSeg.slice(0, -1)}X`;
  const tampered = await verifyUnlockCookie(secret, tamperedSig, {
    siteId,
    currentPasswordSetAt: passwordSetAt,
  });
  assert(tampered === null, 'tampered signature should reject');

  // Alg confusion: pass a token with `alg:none` header.
  const noneHeader = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const fakeToken = `${noneHeader}.${segments[1] ?? ''}.`;
  const algConfusion = await verifyUnlockCookie(secret, fakeToken, {
    siteId,
    currentPasswordSetAt: passwordSetAt,
  });
  assert(algConfusion === null, 'alg:none must be rejected');

  // Expired: simulate by signing with a short TTL and verifying past exp.
  const shortToken = await signUnlockCookie(secret, {
    siteId,
    passwordSetAt,
    ttlSeconds: 60,
    nowMs: 1_000_000,
  });
  const expired = await verifyUnlockCookie(secret, shortToken, {
    siteId,
    currentPasswordSetAt: passwordSetAt,
    nowMs: 1_000_000 + 61_000,
  });
  assert(expired === null, 'cookie past exp should reject');
  // Within window still verifies.
  const withinWindow = await verifyUnlockCookie(secret, shortToken, {
    siteId,
    currentPasswordSetAt: passwordSetAt,
    nowMs: 1_000_000 + 30_000,
  });
  assert(withinWindow !== null, 'cookie within ttl should verify');

  // Rotation: cookie issued before passwordSetAt advanced → reject.
  const oldPwSet = new Date('2026-05-23T11:00:00Z');
  const oldToken = await signUnlockCookie(secret, { siteId, passwordSetAt: oldPwSet });
  const afterRotation = await verifyUnlockCookie(secret, oldToken, {
    siteId,
    // Current password set marker is later than the cookie's hashEpoch.
    currentPasswordSetAt: new Date('2026-05-23T12:00:00Z'),
  });
  assert(afterRotation === null, 'cookie predating current passwordSetAt should reject');

  // Cookie header round-trip.
  const headerValue = buildUnlockCookieHeader({ siteId, value: token });
  assert(headerValue.includes(`${unlockCookieName(siteId)}=${token}`), 'cookie header missing value');
  assert(headerValue.includes('HttpOnly'), 'cookie header missing HttpOnly');
  assert(headerValue.includes('SameSite=Lax'), 'cookie header missing SameSite=Lax');
  assert(headerValue.includes('Secure'), 'cookie header missing Secure by default');

  // Read back from a Cookie header string.
  const requestCookieHeader = `other=foo; ${unlockCookieName(siteId)}=${token}; tail=bar`;
  const readBack = readUnlockCookieFromHeader(requestCookieHeader, siteId);
  assert(readBack === token, 'readUnlockCookieFromHeader should extract the token');
  const missing = readUnlockCookieFromHeader('foo=bar', siteId);
  assert(missing === '', 'absent cookie should read as empty string');
}

// ---------------------------------------------------------------------------
// 3. requireUnlock
// ---------------------------------------------------------------------------

interface FakeContext {
  req: {
    url: string;
    raw: Request;
    header(name: string): string | undefined;
  };
}

function makeContext(url: string, cookieHeader: string | null): FakeContext {
  const headers = new Headers();
  if (cookieHeader) headers.set('cookie', cookieHeader);
  const raw = new Request(url, { headers });
  return {
    req: {
      url,
      raw,
      header(name: string): string | undefined {
        return raw.headers.get(name) ?? undefined;
      },
    },
  };
}

async function runMiddlewareSuite(): Promise<void> {
  const secret = 'middleware-test-secret';
  const env: RequireUnlockEnv = { UNLOCK_SIGNING_SECRET: secret };
  const passwordSetAt = new Date('2026-05-23T12:00:00Z');
  const hash = await hashPassword('letmein');
  const protectedSite: PasswordProtectedSite = {
    id: 'site-mw',
    name: 'Acme',
    passwordEnabled: true,
    passwordHash: hash,
    passwordSetAt,
  };
  const openSite: PasswordProtectedSite = {
    id: 'site-open',
    name: 'Open',
    passwordEnabled: false,
    passwordHash: null,
    passwordSetAt: null,
  };

  // (a) Disabled gate → null.
  const cOpen = makeContext('https://x.rev01.aayushman.dev/about', null);
  const r1 = await requireUnlock(cOpen as never, env, openSite);
  assert(r1 === null, 'disabled site should return null');

  // (b) Enabled, no cookie → 401 gate body.
  const cNoCookie = makeContext('https://x.rev01.aayushman.dev/about', null);
  const r2 = await requireUnlock(cNoCookie as never, env, protectedSite);
  assert(r2 !== null, 'protected site without cookie should return a response');
  assert(r2.status === 401, `expected 401 gate response, got ${String(r2.status)}`);
  const body = await r2.text();
  assert(body.includes('password required'), 'gate body missing title marker');
  assert(body.includes('action="/__rev01/unlock"'), 'gate body missing form action');
  assert(body.includes('value="/about"'), 'gate body missing redirect hidden value');

  // (c) Valid cookie → null.
  const token = await signUnlockCookie(secret, {
    siteId: protectedSite.id,
    passwordSetAt,
  });
  const cookieHeader = `${unlockCookieName(protectedSite.id)}=${token}`;
  const cWithCookie = makeContext('https://x.rev01.aayushman.dev/about', cookieHeader);
  const r3 = await requireUnlock(cWithCookie as never, env, protectedSite);
  assert(r3 === null, 'valid cookie should pass through');

  // (d) Stale-hashEpoch cookie → 401.
  const staleToken = await signUnlockCookie(secret, {
    siteId: protectedSite.id,
    passwordSetAt: new Date('2026-05-23T11:00:00Z'),
  });
  const staleCookie = `${unlockCookieName(protectedSite.id)}=${staleToken}`;
  const cStale = makeContext('https://x.rev01.aayushman.dev/about', staleCookie);
  const r4 = await requireUnlock(cStale as never, env, protectedSite);
  assert(r4 !== null, 'stale-hashEpoch cookie should be rejected');
  assert(r4.status === 401, 'stale cookie response should be 401');

  // (e) Unlock path bypasses the gate so the unlock POST can land.
  const cReserved = makeContext('https://x.rev01.aayushman.dev/__rev01/unlock', null);
  const r5 = await requireUnlock(cReserved as never, env, protectedSite);
  assert(r5 === null, 'unlock path must bypass the gate');

  // (f) Visitor subsystem paths are still visitor traffic and must stay
  // behind the password gate. Search results and form submissions would
  // otherwise leak protected-site state.
  const cSearch = makeContext('https://x.rev01.aayushman.dev/__rev01/search?q=secret', null);
  const rSearch = await requireUnlock(cSearch as never, env, protectedSite);
  assert(rSearch !== null, 'protected visitor search must be gated without a cookie');
  assert(rSearch.status === 401, 'protected visitor search gate response should be 401');

  // (g) Retry + ratelimited markers surface in the rendered gate.
  const cRetry = makeContext(
    'https://x.rev01.aayushman.dev/about?retry=1',
    null,
  );
  const r6 = await requireUnlock(cRetry as never, env, protectedSite);
  assert(r6 !== null, 'retry path still renders gate');
  const retryBody = await r6.text();
  assert(retryBody.includes('That password was incorrect'), 'retry gate missing error block');
  // The redirect hidden field should NOT echo retry=1 (so a success POST doesn't bake it in).
  assert(
    retryBody.includes('value="/about"'),
    'retry gate should strip retry marker from redirect input',
  );

  const cRl = makeContext('https://x.rev01.aayushman.dev/about?ratelimited=1', null);
  const r7 = await requireUnlock(cRl as never, env, protectedSite);
  assert(r7 !== null, 'ratelimited path still renders gate');
  const rlBody = await r7.text();
  assert(rlBody.includes('Too many attempts'), 'ratelimited gate missing wait copy');

  // (h) Drift detection: passwordEnabled=true with null hash MUST throw.
  await assertThrowsAsync(
    () =>
      requireUnlock(cNoCookie as never, env, {
        ...protectedSite,
        passwordHash: null,
      }),
    'requireUnlock should refuse to gate without a hash',
  );
  await assertThrowsAsync(
    () =>
      requireUnlock(cNoCookie as never, env, {
        ...protectedSite,
        passwordSetAt: null,
      }),
    'requireUnlock should refuse to gate without a passwordSetAt',
  );
}

// ---------------------------------------------------------------------------
// 4. Rate limit
// ---------------------------------------------------------------------------

async function runRateLimitSuite(): Promise<void> {
  // Deterministic clock so the sliding window is exact.
  let now = 1_700_000_000_000;
  const limiter = new InProcessRateLimiter(() => now);

  // 5 attempts within window — all allowed.
  for (let i = 1; i <= 5; i += 1) {
    const r = await limiter.checkAndRecord({ ipKey: '1.2.3.4', kind: 'password-unlock' });
    assert(r.allowed, `attempt #${String(i)} should be allowed`);
    now += 100; // 100ms between attempts
  }
  // 6th within window — rejected.
  const sixth = await limiter.checkAndRecord({ ipKey: '1.2.3.4', kind: 'password-unlock' });
  assert(!sixth.allowed, '6th attempt within 60s should be blocked');
  assert(sixth.retryAfterMs !== null, '6th attempt should report retryAfterMs');

  // Different IP — fresh budget.
  const otherIp = await limiter.checkAndRecord({ ipKey: '5.6.7.8', kind: 'password-unlock' });
  assert(otherIp.allowed, 'different IP should have its own budget');

  // Advance past the window — original IP recovers.
  now += 70_000;
  const after = await limiter.checkAndRecord({ ipKey: '1.2.3.4', kind: 'password-unlock' });
  assert(after.allowed, 'after window expires the budget should reset');
}

// ---------------------------------------------------------------------------
// 5. Tiny supporting suites (gate redirect sanitisation)
// ---------------------------------------------------------------------------

function runGateSanitiseSuite(): void {
  assert(sanitiseRedirect('/about') === '/about', 'plain path should pass through');
  assert(sanitiseRedirect('//evil.com') === '/', 'protocol-relative should be neutralised');
  assert(sanitiseRedirect('https://evil.com/x') === '/', 'absolute URL should be neutralised');
  assert(sanitiseRedirect('') === '/', 'empty should default to /');
  assert(sanitiseRedirect('/x?q=1') === '/x?q=1', 'querystring is preserved');
  assert(sanitiseRedirect('/x\rinjected') === '/', 'CR-injection should be neutralised');
  // The renderer html-escapes the redirect for the hidden input.
  const html = renderGateHtml({ redirect: '/safe', siteName: 'Acme & Co' });
  assert(html.includes('Acme &amp; Co'), 'site name should be HTML-escaped');
  assert(html.includes('value="/safe"'), 'redirect should land in hidden input');
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await runHashSuite();
  await runCookieSuite();
  await runMiddlewareSuite();
  await runRateLimitSuite();
  runGateSanitiseSuite();
  console.log('[password:smoke] OK');
}

await main();
