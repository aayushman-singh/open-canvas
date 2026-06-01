// src/seo/apex.smoke.ts
//
// Manual smoke for the apex SEO surface added in the 2026-05-29 setup pass.
// Run with `bun run apex-seo:smoke` (registered in package.json).
//
// Coverage:
//
//   1. `isApexHost` returns true for the configured apex and for local-dev
//      hosts (`localhost` / `127.0.0.1`, with any port). Returns false for
//      published-subdomain and custom-domain shapes.
//   2. `buildApexSitemapXml` emits a well-formed single-`<url>` sitemap whose
//      `<loc>` matches `${origin}/`, with lastmod / changefreq / priority.
//   3. `buildApexRobotsTxt` emits `User-agent: *`, `Allow: /`, every
//      back-of-house Disallow line, and a `Sitemap:` directive pointing at
//      `${origin}/sitemap.xml`.
//   4. `renderApexOgPng` round-trips through the satori + resvg pipeline,
//      writes a PNG into the supplied R2 mock, and a second call reads from
//      the cache (no new put).
//
// The apex routes themselves are not exercised here — the route handlers are
// thin wrappers around these pure builders + the cached render, so the smoke
// targets the underlying contract. The host-gate + `next()` fall-through is
// covered transitively by `isApexHost` plus a hand-checked routing review.
//
// Failure: any assertion failure prints `[apex-seo:smoke] FAIL — <reason>`
// and exits non-zero.

import { createR2Client, type R2BucketLike, type R2PutOptions } from '../assets/r2-client.js';
import type { HostConfigEnv } from '../host-config.js';
import { rasteriseSvgToPng } from '../og-image/rasterise.js';
import {
  APEX_OG_DESCRIPTION,
  APEX_OG_HEADLINE,
  APEX_OG_SITE_NAME,
  buildApexRobotsTxt,
  buildApexSitemapXml,
  isApexHost,
  renderApexOgPng,
} from './apex.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    process.stderr.write(`[apex-seo:smoke] FAIL — ${message}\n`);
    process.exit(1);
  }
}

function ok(label: string): void {
  process.stdout.write(`[apex-seo:smoke] OK   ${label}\n`);
}

// ---------------------------------------------------------------------------
// Fixture: an env with the production apex string so the host-gate check
// agrees with what wrangler.toml ships.
// ---------------------------------------------------------------------------

const APEX = 'opencanvas.aayushman.dev';
const ENV: HostConfigEnv = {
  APP_DOMAIN: APEX,
  AUTHORIZED_PARTIES: `https://${APEX}`,
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: `noreply@${APEX}`,
};

// ---------------------------------------------------------------------------
// Assertion 1 — `isApexHost`.
// ---------------------------------------------------------------------------

assert(isApexHost(ENV, APEX), '1: apex host matches');
assert(isApexHost(ENV, APEX.toUpperCase()), '1: apex host match is case-insensitive');
assert(isApexHost(ENV, 'localhost'), '1: bare localhost is apex (dev)');
assert(isApexHost(ENV, 'localhost:8787'), '1: localhost:8787 is apex (dev)');
assert(isApexHost(ENV, '127.0.0.1'), '1: bare 127.0.0.1 is apex (dev)');
assert(isApexHost(ENV, '127.0.0.1:8787'), '1: 127.0.0.1:8787 is apex (dev)');
assert(!isApexHost(ENV, `acme.${APEX}`), '1: published-subdomain host is NOT apex');
assert(!isApexHost(ENV, 'example.com'), '1: arbitrary custom domain is NOT apex');
assert(!isApexHost(ENV, '10.0.0.5'), '1: LAN IP is NOT apex (only loopback)');
ok('1: isApexHost handles apex + loopback dev hosts; rejects subdomains/custom domains');

// ---------------------------------------------------------------------------
// Assertion 2 — `buildApexSitemapXml`.
// ---------------------------------------------------------------------------

const ORIGIN = `https://${APEX}`;
const LASTMOD = '2026-05-29';
const xml = buildApexSitemapXml(ORIGIN, LASTMOD);

assert(
  xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'),
  '2: sitemap begins with the standard XML declaration',
);
assert(
  xml.includes('<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">'),
  '2: <urlset> declares the sitemap.org namespace',
);
const locCount = (xml.match(/<loc>/g) ?? []).length;
assert(locCount === 1, `2: exactly one <url> entry on the apex (got ${String(locCount)})`);
assert(xml.includes(`<loc>${ORIGIN}/</loc>`), '2: the single <loc> is the apex root URL');
assert(xml.includes(`<lastmod>${LASTMOD}</lastmod>`), '2: <lastmod> is the supplied date');
assert(xml.includes('<changefreq>monthly</changefreq>'), '2: <changefreq> is monthly');
assert(xml.includes('<priority>1.0</priority>'), '2: <priority> is 1.0');
const urlsetOpens = (xml.match(/<urlset/g) ?? []).length;
const urlsetCloses = (xml.match(/<\/urlset>/g) ?? []).length;
assert(
  urlsetOpens === 1 && urlsetCloses === 1,
  `2: exactly one <urlset>...</urlset> pair (opens=${String(urlsetOpens)} closes=${String(urlsetCloses)})`,
);
ok('2: apex sitemap is a well-formed single-URL document');

// ---------------------------------------------------------------------------
// Assertion 3 — `buildApexRobotsTxt`.
// ---------------------------------------------------------------------------

const robots = buildApexRobotsTxt(ORIGIN);
const robotsLines = robots.split('\n');

assert(robotsLines[0] === 'User-agent: *', '3: first line is User-agent: *');
assert(robotsLines.includes('Allow: /'), '3: root path is allowed');
for (const path of [
  '/api/',
  '/__api/',
  '/__opencanvas/',
  '/__live/',
  '/__invite/',
  '/dashboard/',
  '/og/',
]) {
  assert(
    robotsLines.includes(`Disallow: ${path}`),
    `3: back-of-house path ${path} must be disallowed`,
  );
}
assert(
  robotsLines.includes(`Sitemap: ${ORIGIN}/sitemap.xml`),
  '3: Sitemap: directive points at the apex sitemap',
);
assert(
  !robotsLines.some((line) => line === 'Disallow: /'),
  '3: must NOT emit Disallow: / (would block the marketing page itself)',
);
ok('3: apex robots.txt allows /, blocks back-of-house, advertises the sitemap');

// ---------------------------------------------------------------------------
// Assertion 4 — `renderApexOgPng` round-trip through R2 mock.
// ---------------------------------------------------------------------------

interface MockR2Entry {
  bytes: Uint8Array;
  contentType: string;
}

class MockR2 implements R2BucketLike {
  store = new Map<string, MockR2Entry>();
  putCount = 0;
  getCount = 0;
  headCount = 0;

  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    if (typeof value === 'string' || value instanceof ReadableStream) {
      throw new Error('mock R2 does not accept string or stream bodies');
    }
    let bytes: Uint8Array;
    if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value.slice(0));
    } else {
      const view = value;
      bytes = new Uint8Array(
        view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
      );
    }
    this.store.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream',
    });
    this.putCount += 1;
    return Promise.resolve(makeR2Object(key, this.store.get(key)!.contentType));
  }

  get(key: string): Promise<R2ObjectBody | null> {
    this.getCount += 1;
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    return Promise.resolve(makeR2ObjectBody(key, entry));
  }

  head(key: string): Promise<R2Object | null> {
    this.headCount += 1;
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    return Promise.resolve(makeR2Object(key, entry.contentType));
  }

  delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) this.store.delete(k);
    return Promise.resolve();
  }
}

function makeR2Object(key: string, contentType: string): R2Object {
  return {
    key,
    httpMetadata: { contentType },
    customMetadata: {},
  } as unknown as R2Object;
}

function makeR2ObjectBody(key: string, entry: MockR2Entry): R2ObjectBody {
  const responseForBody = new Response(entry.bytes);
  return {
    key,
    httpMetadata: { contentType: entry.contentType },
    customMetadata: {},
    body: responseForBody.body!,
    arrayBuffer: () => Promise.resolve(entry.bytes.buffer.slice(0)),
    text: () => Promise.resolve(new TextDecoder().decode(entry.bytes)),
    json: () => Promise.resolve(JSON.parse(new TextDecoder().decode(entry.bytes)) as unknown),
    blob: () => Promise.resolve(new Blob([entry.bytes], { type: entry.contentType })),
  } as unknown as R2ObjectBody;
}

function assertPngSignature(bytes: Uint8Array, label: string): void {
  const expected = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < expected.length; i += 1) {
    if (bytes[i] !== expected[i]) {
      throw new Error(
        `[apex-seo:smoke] ${label}: expected PNG byte ${String(i)}=${String(expected[i])}, got ${String(bytes[i])}`,
      );
    }
  }
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // IHDR width / height are big-endian uint32 at offsets 16..20 and 20..24.
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

// Sanity: re-use the exported brand constants so a future rename catches here.
assert(APEX_OG_SITE_NAME.length > 0, '4: APEX_OG_SITE_NAME is non-empty');
assert(APEX_OG_HEADLINE.length > 0, '4: APEX_OG_HEADLINE is non-empty');
assert(APEX_OG_DESCRIPTION.length > 0, '4: APEX_OG_DESCRIPTION is non-empty');

// Pre-warm the wasm module via the disk-read fallback path. The production
// path passes a wrangler-bundled `WebAssembly.Module` to `initWasm`; under
// Bun the same import resolves to a path string that `initWasm` cannot
// consume. `ensureWasm` caches the init promise at module level, so calling
// `rasteriseSvgToPng` once without an env loads the wasm from disk and
// makes every subsequent call (including the wasmModule-passing one in
// `renderApexOgPng`) short-circuit on the cached promise. The same trick is
// used by `src/og-image/smoke.ts:196` for the same reason.
await rasteriseSvgToPng(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
);

const r2 = new MockR2();
const renderEnv = { ASSETS_BUCKET: r2 as unknown as R2Bucket } as Parameters<
  typeof renderApexOgPng
>[0];

const t0 = performance.now();
const bytes1 = await renderApexOgPng(renderEnv);
const t1 = performance.now();
assert(bytes1.length > 0, '4a: first render returns non-empty bytes');
assertPngSignature(bytes1, '4a');
const { width, height } = readPngDimensions(bytes1);
assert(width === 1200, `4a: PNG width must be 1200, got ${String(width)}`);
assert(height === 630, `4a: PNG height must be 630, got ${String(height)}`);
assert(r2.putCount === 1, `4a: first render must put once, got ${String(r2.putCount)}`);
ok(
  `4a: cache miss renders 1200x630 PNG (${String(bytes1.length)} bytes, ${String(Math.round(t1 - t0))}ms)`,
);

const t2 = performance.now();
const bytes2 = await renderApexOgPng(renderEnv);
const t3 = performance.now();
assert(bytes2.length === bytes1.length, '4b: cache hit returns same byte length');
assert(r2.putCount === 1, `4b: cache hit must NOT trigger another put (got ${String(r2.putCount)})`);
ok(`4b: cache hit returns same bytes without re-rendering (${String(Math.round(t3 - t2))}ms)`);

let matches = true;
for (let i = 0; i < bytes1.length; i += 1) {
  if (bytes1[i] !== bytes2[i]) {
    matches = false;
    break;
  }
}
assert(matches, '4c: cache hit bytes are byte-for-byte equal to first render');
ok('4c: cache hit bytes are byte-identical to the first render');

assert(r2.getCount >= 2, `4d: R2 saw at least 2 gets (one per render call), got ${String(r2.getCount)}`);
ok('4d: R2 interaction counts agree with cache miss + cache hit');

const probe = createR2Client(r2);
assert(typeof probe.get === 'function', '4e: createR2Client wires the get method');

// ---------------------------------------------------------------------------
process.stdout.write('[apex-seo:smoke] OK — 4 assertions passed\n');
process.exit(0);
