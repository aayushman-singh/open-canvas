// Regression pin for rebuildRequestForLocalDevClerk(). The previous
// implementation forwarded c.req.raw.body into the rebuilt Request, which
// transfers ownership of the underlying ReadableStream per the Fetch spec.
// That left downstream handlers calling c.req.json() reading from a locked
// or empty stream — silently breaking every POST/PATCH through clerkAuth
// when the test Clerk keys were in use. This smoke pins:
//   1. The rebuild rewrites URL / Host / Origin to the local dev origin.
//   2. The original request's body remains readable after the rebuild.

import { rebuildRequestForLocalDevClerk } from './middleware.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[clerk-dev-rebuild:smoke] ${message}`);
}

const LOCAL_ORIGIN = 'http://127.0.0.1:8787';

const bodyPayload = { siteId: 'site-abc', name: 'updated name' };
const original = new Request('https://rev01.aayushman.dev/api/sites/site-abc', {
  method: 'PATCH',
  headers: {
    'content-type': 'application/json',
    host: 'rev01.aayushman.dev',
    origin: 'https://rev01.aayushman.dev',
    referer: 'https://rev01.aayushman.dev/dashboard/sites/site-abc',
    cookie: '__session=fake; __client_uat=fake',
  },
  body: JSON.stringify(bodyPayload),
});

const rebuilt = rebuildRequestForLocalDevClerk(original, LOCAL_ORIGIN);

const rebuiltUrl = new URL(rebuilt.url);
assert(
  rebuiltUrl.origin === LOCAL_ORIGIN,
  `rebuilt URL origin: expected ${LOCAL_ORIGIN}, got ${rebuiltUrl.origin}`,
);
assert(
  rebuiltUrl.pathname === '/api/sites/site-abc',
  `rebuilt URL path preserved: got ${rebuiltUrl.pathname}`,
);
assert(rebuilt.headers.get('host') === '127.0.0.1:8787', 'host header rewritten');
assert(rebuilt.headers.get('origin') === LOCAL_ORIGIN, 'origin header rewritten');
assert(
  rebuilt.headers.get('referer') === `${LOCAL_ORIGIN}/dashboard/sites/site-abc`,
  'referer header rewritten',
);
assert(
  rebuilt.headers.get('cookie') === '__session=fake; __client_uat=fake',
  'cookie header preserved verbatim',
);

// `original.json()` returns `unknown` under this tsconfig; cast to the shape
// we constructed the request with so the assertion below can read fields.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
const parsedOriginal = (await original.json()) as typeof bodyPayload;
assert(
  parsedOriginal.siteId === bodyPayload.siteId && parsedOriginal.name === bodyPayload.name,
  "original request's body must remain readable after the rebuild",
);

const requestWithoutBody = new Request('https://rev01.aayushman.dev/api/sites', {
  method: 'GET',
  headers: { host: 'rev01.aayushman.dev', origin: 'https://rev01.aayushman.dev' },
});
const rebuiltGet = rebuildRequestForLocalDevClerk(requestWithoutBody, LOCAL_ORIGIN);
assert(rebuiltGet.method === 'GET', 'method preserved on bodyless request');
assert(
  new URL(rebuiltGet.url).origin === LOCAL_ORIGIN,
  'bodyless request URL also rewritten',
);

const requestWithBadReferer = new Request('https://rev01.aayushman.dev/api/sites', {
  method: 'GET',
  headers: { referer: 'not a url' },
});
let threwOnBadReferer = false;
try {
  rebuildRequestForLocalDevClerk(requestWithBadReferer, LOCAL_ORIGIN);
} catch {
  threwOnBadReferer = true;
}
assert(threwOnBadReferer, 'malformed referer must surface as an error, not be silently dropped');

console.log('[clerk-dev-rebuild:smoke] OK');
