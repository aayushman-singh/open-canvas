// src/host-config.smoke.ts
//
// Validates every accessor in `src/host-config.ts` (ADR 0013 + ADR 0018):
// happy path + every fail-loud branch. The helper is load-bearing for most of
// the auth surface after migration, so the throw branches must each have a
// proof obligation here — a future refactor that turns a throw into a silent
// fallback would have to delete one of these assertions to land.

import {
  appDomain,
  appOrigin,
  authorizedParties,
  clerkFrontendApiHost,
  cookieDomain,
  cookieName,
  cookieNamePrefix,
  emailFrom,
  publicHostSuffix,
  resolveDevPublicOrigin,
  type HostConfigEnv,
} from './host-config.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[host-config:smoke] ${message}`);
}

function expectThrow(fn: () => unknown, expectedSubstring: string, label: string): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(
      message.includes(expectedSubstring),
      `${label}: error must mention "${expectedSubstring}", got "${message}"`,
    );
    return;
  }
  throw new Error(`[host-config:smoke] ${label}: expected throw, none raised`);
}

const baseEnv: HostConfigEnv = {
  APP_DOMAIN: 'opencanvas.aayushman.dev',
  AUTHORIZED_PARTIES:
    'http://localhost:8787,http://127.0.0.1:8787,https://opencanvas.aayushman.dev',
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: 'Open Canvas <noreply@opencanvas.aayushman.dev>',
};

// ---------------------------------------------------------------------------
// appDomain
// ---------------------------------------------------------------------------

assert(appDomain(baseEnv) === 'opencanvas.aayushman.dev', 'appDomain happy path');
assert(
  appDomain({ ...baseEnv, APP_DOMAIN: 'OpenCanvas.Aayushman.Dev' }) === 'opencanvas.aayushman.dev',
  'appDomain must lowercase',
);

expectThrow(
  () => appDomain({ ...baseEnv, APP_DOMAIN: '' }),
  'APP_DOMAIN is required',
  'appDomain throws on empty',
);
expectThrow(
  () => appDomain({ ...baseEnv, APP_DOMAIN: undefined as unknown as string }),
  'APP_DOMAIN is required',
  'appDomain throws on undefined',
);
expectThrow(
  () => appDomain({ ...baseEnv, APP_DOMAIN: 'no-dot' }),
  'valid public hostname',
  'appDomain rejects bare label',
);
expectThrow(
  () => appDomain({ ...baseEnv, APP_DOMAIN: '-leading-hyphen.dev' }),
  'valid public hostname',
  'appDomain rejects leading-hyphen label',
);
expectThrow(
  () => appDomain({ ...baseEnv, APP_DOMAIN: 'trailing.-hyphen.dev' }),
  'valid public hostname',
  'appDomain rejects trailing-hyphen label',
);

// ---------------------------------------------------------------------------
// appOrigin / publicHostSuffix / cookieDomain / clerkFrontendApiHost
// ---------------------------------------------------------------------------

assert(appOrigin(baseEnv) === 'https://opencanvas.aayushman.dev', 'appOrigin builds https origin');
assert(
  publicHostSuffix(baseEnv) === '.opencanvas.aayushman.dev',
  'publicHostSuffix prefixes leading dot',
);
assert(cookieDomain(baseEnv) === 'opencanvas.aayushman.dev', 'cookieDomain equals apex');
assert(
  clerkFrontendApiHost(baseEnv) === 'clerk.opencanvas.aayushman.dev',
  'clerkFrontendApiHost prefixes "clerk."',
);

// ---------------------------------------------------------------------------
// authorizedParties
// ---------------------------------------------------------------------------

const parties = authorizedParties(baseEnv);
assert(parties.length === 3, `authorizedParties parses CSV (got ${parties.length})`);
assert(parties[0] === 'http://localhost:8787', 'authorizedParties preserves first entry');
assert(
  parties[2] === 'https://opencanvas.aayushman.dev',
  'authorizedParties preserves apex origin',
);
assert(
  authorizedParties({
    ...baseEnv,
    AUTHORIZED_PARTIES: '  https://a.example  ,  https://b.example  ',
  }).length === 2,
  'authorizedParties trims whitespace',
);
assert(
  authorizedParties({
    ...baseEnv,
    AUTHORIZED_PARTIES: 'https://slash.example/',
  })[0] === 'https://slash.example',
  'authorizedParties normalizes URL input to origin strings',
);

expectThrow(
  () => authorizedParties({ ...baseEnv, AUTHORIZED_PARTIES: '' }),
  'AUTHORIZED_PARTIES is required',
  'authorizedParties throws on empty',
);
expectThrow(
  () => authorizedParties({ ...baseEnv, AUTHORIZED_PARTIES: ',,,' }),
  'at least one origin',
  'authorizedParties throws when CSV is all commas',
);
expectThrow(
  () => authorizedParties({ ...baseEnv, AUTHORIZED_PARTIES: 'not-a-url' }),
  'not a valid URL',
  'authorizedParties throws on unparseable entry',
);
expectThrow(
  () => authorizedParties({ ...baseEnv, AUTHORIZED_PARTIES: 'ftp://x.example' }),
  'must be http(s)',
  'authorizedParties throws on non-http(s) scheme',
);
expectThrow(
  () => authorizedParties({ ...baseEnv, AUTHORIZED_PARTIES: 'https://x.example/path' }),
  'must be an origin only',
  'authorizedParties throws on entry with path',
);

// ---------------------------------------------------------------------------
// emailFrom
// ---------------------------------------------------------------------------

assert(
  emailFrom(baseEnv) === 'Open Canvas <noreply@opencanvas.aayushman.dev>',
  'emailFrom passes through display-name form',
);
assert(
  emailFrom({ ...baseEnv, EMAIL_FROM: 'hello@example.com' }) === 'hello@example.com',
  'emailFrom passes through bare addr form',
);

expectThrow(
  () => emailFrom({ ...baseEnv, EMAIL_FROM: '' }),
  'EMAIL_FROM is required',
  'emailFrom throws on empty',
);
expectThrow(
  () => emailFrom({ ...baseEnv, EMAIL_FROM: 'no-at-sign' }),
  'RFC 5322',
  'emailFrom throws on missing @',
);
expectThrow(
  () => emailFrom({ ...baseEnv, EMAIL_FROM: 'addr@no-dot' }),
  'valid public hostname',
  'emailFrom throws on bare-label domain',
);
expectThrow(
  () => emailFrom({ ...baseEnv, EMAIL_FROM: 'Open Canvas <noreply@example.com' }),
  'RFC 5322',
  'emailFrom throws on missing display-name closing bracket',
);

// ---------------------------------------------------------------------------
// cookieNamePrefix / cookieName
// ---------------------------------------------------------------------------

assert(
  cookieNamePrefix(baseEnv) === '__opencanvas_',
  'cookieNamePrefix returns the configured prefix',
);
assert(cookieName.edit(baseEnv) === '__opencanvas_edit', 'cookieName.edit composes prefix + edit');
assert(
  cookieName.unlock(baseEnv, 'site-abc') === '__opencanvas_unlock_site-abc',
  'cookieName.unlock composes prefix + unlock_<siteId>',
);
assert(
  cookieName.colorScheme(baseEnv) === '__opencanvas_theme',
  'cookieName.colorScheme composes prefix + theme',
);

expectThrow(
  () => cookieNamePrefix({ ...baseEnv, COOKIE_NAME_PREFIX: '' }),
  'COOKIE_NAME_PREFIX is required',
  'cookieNamePrefix throws on empty',
);
assert(
  cookieNamePrefix({ ...baseEnv, COOKIE_NAME_PREFIX: 'brand-' }) === 'brand-',
  'cookieNamePrefix accepts RFC 6265 token characters',
);
expectThrow(
  () => cookieNamePrefix({ ...baseEnv, COOKIE_NAME_PREFIX: 'bad;prefix' }),
  'COOKIE_NAME_PREFIX must be a valid cookie-name token',
  'cookieNamePrefix rejects RFC 6265 separator characters',
);
expectThrow(
  () => cookieName.unlock(baseEnv, ''),
  'siteId must be a non-empty string',
  'cookieName.unlock throws on empty siteId',
);
expectThrow(
  () => cookieName.unlock(baseEnv, 'has spaces'),
  'invalid characters',
  'cookieName.unlock throws on siteId with invalid chars',
);

// ---------------------------------------------------------------------------
// resolveDevPublicOrigin
// ---------------------------------------------------------------------------

assert(
  resolveDevPublicOrigin(baseEnv) === 'http://127.0.0.1:8787',
  'resolveDevPublicOrigin defaults when unset',
);
assert(
  resolveDevPublicOrigin({ ...baseEnv, DEV_PUBLIC_HOST: 'http://localhost:5173' }) ===
    'http://localhost:5173',
  'resolveDevPublicOrigin echoes explicit value',
);

expectThrow(
  () => resolveDevPublicOrigin({ ...baseEnv, DEV_PUBLIC_HOST: '' }),
  'must be a non-empty origin',
  'resolveDevPublicOrigin throws on empty string',
);
expectThrow(
  () => resolveDevPublicOrigin({ ...baseEnv, DEV_PUBLIC_HOST: 'not a url' }),
  'must be a valid origin',
  'resolveDevPublicOrigin throws on unparseable',
);
expectThrow(
  () =>
    resolveDevPublicOrigin({ ...baseEnv, DEV_PUBLIC_HOST: 'http://localhost:5173/path' }),
  'without path, query, or hash',
  'resolveDevPublicOrigin throws on origin with path',
);

console.log('[host-config:smoke] OK');
