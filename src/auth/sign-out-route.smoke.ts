import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signOutCookieNames, buildExpiredSignOutCookieHeaders } from './sign-out-route.js';
import { cookieName, type HostConfigEnv } from '../host-config.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[sign-out-route:smoke] ${message}`);
}

const source = readFileSync(join(process.cwd(), 'src', 'auth', 'sign-out-route.ts'), 'utf8');

// Test against an injected APP_DOMAIN + COOKIE_NAME_PREFIX (ADR 0013 dec 7,
// ADR 0017 dec 1) — the smoke asserts the contract (cookie scoped to the
// configured apex when the host is the apex / a sub-host, with a name
// derived from the configured prefix), not a specific brand literal.
const testEnv: HostConfigEnv = {
  APP_DOMAIN: 'opencanvas.aayushman.dev',
  AUTHORIZED_PARTIES: 'https://opencanvas.aayushman.dev',
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: 'noreply@opencanvas.aayushman.dev',
};

assert(
  signOutCookieNames(testEnv).includes(cookieName.edit(testEnv)),
  'sign-out must clear the on-site editor auth cookie as well as Clerk cookies',
);

const prodHeaders = buildExpiredSignOutCookieHeaders(
  testEnv,
  new URL(`https://${testEnv.APP_DOMAIN}/sign-out`),
);
assert(
  prodHeaders.some(
    (header) =>
      header.startsWith(`${cookieName.edit(testEnv)}=`) &&
      header.includes(`Domain=${testEnv.APP_DOMAIN}`) &&
      header.includes('Max-Age=0'),
  ),
  'sign-out must expire the edit token on the configured apex domain',
);
assert(
  prodHeaders.some(
    (header) =>
      header.startsWith('__session=') &&
      !header.includes('Domain=') &&
      header.includes('Max-Age=0'),
  ),
  'sign-out must also expire host-only Clerk cookies',
);
assert(
  !source.includes('Revocation failure is not fatal') &&
    !source.includes('still want to clear cookies'),
  'sign-out must not silently continue after Clerk session revocation fails',
);

console.log('[sign-out-route:smoke] OK');
