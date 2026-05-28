import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SIGN_OUT_COOKIE_NAMES, buildExpiredSignOutCookieHeaders } from './sign-out-route.js';
import { EDIT_TOKEN_COOKIE } from './edit-token.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[sign-out-route:smoke] ${message}`);
}

const source = readFileSync(join(process.cwd(), 'src', 'auth', 'sign-out-route.ts'), 'utf8');

assert(
  SIGN_OUT_COOKIE_NAMES.includes(EDIT_TOKEN_COOKIE),
  'sign-out must clear the on-site editor auth cookie as well as Clerk cookies',
);

const prodHeaders = buildExpiredSignOutCookieHeaders(
  new URL('https://rev01.aayushman.dev/sign-out'),
);
assert(
  prodHeaders.some(
    (header) =>
      header.startsWith(`${EDIT_TOKEN_COOKIE}=`) &&
      header.includes('Domain=rev01.aayushman.dev') &&
      header.includes('Max-Age=0'),
  ),
  'sign-out must expire the edit token on the shared rev01 domain',
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
