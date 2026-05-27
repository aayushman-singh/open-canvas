// src/auth/on-site-edit-security.smoke.ts
//
// Focused regression checks for the on-site editor auth handoff. These are
// source-level because the vulnerable edges live in inline browser scripts
// and Hono middleware composition rather than a single exported pure function.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[on-site-edit-security:smoke] ${message}`);
}

async function readSource(relativePath: string): Promise<string> {
  return readFile(join(dirname(fileURLToPath(import.meta.url)), '..', relativePath), 'utf8');
}

const popupSource = await readSource('routes/api/on-site-edit.ts');
const publicSource = await readSource('routes/public.ts');
const authSource = await readSource('auth/middleware.ts');

assert(
  !/postMessage\([\s\S]*,\s*["']\*["']\s*\)/.test(popupSource),
  'auth popup must not post edit bearer tokens to wildcard target origins',
);
assert(
  popupSource.includes('returnOriginJson') &&
    popupSource.includes('stateJson') &&
    popupSource.includes('isAuthorizedOnSiteEditReturnOrigin'),
  'auth popup must validate and use an exact return origin plus state',
);
assert(
  publicSource.includes('authState') &&
    publicSource.includes('returnOrigin=') &&
    publicSource.includes('e.origin !== "https://rev01.aayushman.dev"') &&
    publicSource.includes('e.source !== popup') &&
    publicSource.includes('e.data.state !== authState'),
  'public edit bootstrap must verify popup origin, source window, and nonce state',
);
assert(
  authSource.includes('resolveEditHostSiteId') &&
    authSource.includes('extractEditApiRouteSiteId') &&
    authSource.includes('payload.siteId !== expectedSiteId') &&
    authSource.includes('requestedSiteId !== payload.siteId'),
  'edit-token middleware must bind the token to both the public host site and requested site path',
);
assert(
  !publicSource.includes('MAX_RETRIES') &&
    !publicSource.includes('if (retryCount >=') &&
    publicSource.includes("ws.addEventListener('open'"),
  'visitor live websocket must keep reconnecting and reset backoff on open',
);

console.log('[on-site-edit-security:smoke] OK');
