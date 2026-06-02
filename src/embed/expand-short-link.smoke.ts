// Smoke tests for the short-link expander used by the embed inspector.
// Verifies the no-op pass-through, successful redirect-chain following,
// the "redirect without Location" error path, and the
// too-many-redirects guard.

import { expandShortLink, isShortLinkUrl } from './expand-short-link.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[expand-short-link:smoke] ${message}`);
}

interface MockHop {
  status: number;
  location?: string;
}

function mockFetch(hops: Map<string, MockHop>): typeof fetch {
  return (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const hop = hops.get(url);
    if (!hop) return Promise.reject(new Error(`mockFetch: unexpected URL ${url}`));
    const headers = new Headers();
    if (hop.location !== undefined) headers.set('location', hop.location);
    return Promise.resolve(new Response(null, { status: hop.status, headers }));
  };
}

// ---------------------------------------------------------------------------
// (1) Non-short-link URL is a no-op. Caller can hit this unconditionally.
// ---------------------------------------------------------------------------

const passThrough = await expandShortLink('https://www.google.com/maps/place/Tokyo', mockFetch(new Map()));
assert(passThrough.ok === true, 'pass-through must succeed');
if (passThrough.ok) {
  assert(passThrough.finalUrl === 'https://www.google.com/maps/place/Tokyo', 'pass-through must echo input URL');
  assert(passThrough.hops === 0, 'pass-through must report 0 hops');
}

// ---------------------------------------------------------------------------
// (2) maps.app.goo.gl short link redirects to canonical Google Maps URL.
// ---------------------------------------------------------------------------

const mapsHops = new Map<string, MockHop>([
  ['https://maps.app.goo.gl/abc123', { status: 302, location: 'https://www.google.com/maps/search/28.6,77.4?entry=tts' }],
  ['https://www.google.com/maps/search/28.6,77.4?entry=tts', { status: 200 }],
]);
const mapsResult = await expandShortLink('https://maps.app.goo.gl/abc123', mockFetch(mapsHops));
assert(mapsResult.ok === true, 'maps.app.goo.gl must expand');
if (mapsResult.ok) {
  assert(
    mapsResult.finalUrl === 'https://www.google.com/maps/search/28.6,77.4?entry=tts',
    `maps.app.goo.gl final URL mismatch; got ${mapsResult.finalUrl}`,
  );
  assert(mapsResult.hops === 1, `expected 1 hop; got ${String(mapsResult.hops)}`);
}

// ---------------------------------------------------------------------------
// (3) Multi-hop chain.
// ---------------------------------------------------------------------------

const multiHops = new Map<string, MockHop>([
  ['https://goo.gl/maps/abc', { status: 301, location: 'https://maps.app.goo.gl/xyz' }],
  ['https://maps.app.goo.gl/xyz', { status: 302, location: 'https://www.google.com/maps/place/Eiffel' }],
  ['https://www.google.com/maps/place/Eiffel', { status: 200 }],
]);
const multiResult = await expandShortLink('https://goo.gl/maps/abc', mockFetch(multiHops));
assert(multiResult.ok === true, 'multi-hop must succeed');
if (multiResult.ok) {
  assert(
    multiResult.finalUrl === 'https://www.google.com/maps/place/Eiffel',
    `multi-hop final mismatch; got ${multiResult.finalUrl}`,
  );
  assert(multiResult.hops === 2, `expected 2 hops; got ${String(multiResult.hops)}`);
}

// ---------------------------------------------------------------------------
// (4) Relative Location header resolves against the previous URL.
// ---------------------------------------------------------------------------

const relativeHops = new Map<string, MockHop>([
  ['https://maps.app.goo.gl/abc', { status: 302, location: '/maps/place/Paris' }],
  ['https://maps.app.goo.gl/maps/place/Paris', { status: 200 }],
]);
const relResult = await expandShortLink('https://maps.app.goo.gl/abc', mockFetch(relativeHops));
assert(relResult.ok === true, 'relative redirect must succeed');
if (relResult.ok) {
  assert(
    relResult.finalUrl === 'https://maps.app.goo.gl/maps/place/Paris',
    `relative redirect final mismatch; got ${relResult.finalUrl}`,
  );
}

// ---------------------------------------------------------------------------
// (5) Redirect with no Location header is an error, not a silent pass.
// ---------------------------------------------------------------------------

const noLocHops = new Map<string, MockHop>([
  ['https://maps.app.goo.gl/broken', { status: 302 }],
]);
const noLocResult = await expandShortLink('https://maps.app.goo.gl/broken', mockFetch(noLocHops));
assert(noLocResult.ok === false, 'redirect-without-location must fail');
if (!noLocResult.ok) {
  assert(
    noLocResult.error.includes('Location header'),
    `expected Location-header error; got ${noLocResult.error}`,
  );
}

// ---------------------------------------------------------------------------
// (6) Too many redirects.
// ---------------------------------------------------------------------------

const loopHops = new Map<string, MockHop>([
  ['https://maps.app.goo.gl/a', { status: 302, location: 'https://maps.app.goo.gl/b' }],
  ['https://maps.app.goo.gl/b', { status: 302, location: 'https://maps.app.goo.gl/c' }],
  ['https://maps.app.goo.gl/c', { status: 302, location: 'https://maps.app.goo.gl/d' }],
  ['https://maps.app.goo.gl/d', { status: 302, location: 'https://maps.app.goo.gl/e' }],
  ['https://maps.app.goo.gl/e', { status: 302, location: 'https://maps.app.goo.gl/f' }],
  ['https://maps.app.goo.gl/f', { status: 302, location: 'https://maps.app.goo.gl/g' }],
  ['https://maps.app.goo.gl/g', { status: 302, location: 'https://maps.app.goo.gl/h' }],
]);
const loopResult = await expandShortLink('https://maps.app.goo.gl/a', mockFetch(loopHops));
assert(loopResult.ok === false, 'redirect loop must fail');
if (!loopResult.ok) {
  assert(loopResult.error.includes('too many redirects'), `expected too-many-redirects error; got ${loopResult.error}`);
}

// ---------------------------------------------------------------------------
// (7) Invalid URL is loudly rejected.
// ---------------------------------------------------------------------------

const invalid = await expandShortLink('not a url', mockFetch(new Map()));
assert(invalid.ok === false, 'invalid URL must fail');

// ---------------------------------------------------------------------------
// (8) isShortLinkUrl positive + negative.
// ---------------------------------------------------------------------------

assert(isShortLinkUrl('https://maps.app.goo.gl/abc') === true, 'maps.app.goo.gl must be detected');
assert(isShortLinkUrl('https://goo.gl/maps/abc') === true, 'goo.gl must be detected');
assert(isShortLinkUrl('https://www.google.com/maps/place/Tokyo') === false, 'long-form must not be detected');
assert(isShortLinkUrl('not a url') === false, 'invalid URL must not be detected');

console.log('[expand-short-link:smoke] OK — 8 assertions passed');
