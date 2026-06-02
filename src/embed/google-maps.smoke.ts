// src/embed/google-maps.smoke.ts
//
// Smoke tests for Google Maps embed resolution. Verifies:
//
//   1. /maps/place/ URLs extract the place name as the query.
//   2. maps.google.com?q= URLs extract the query param.
//   3. /maps/@lat,lng URLs extract coordinates.
//   4. goo.gl/maps/ short links resolve to google-maps provider.
//   5. maps.app.goo.gl short links (modern Share-sheet) resolve too.
//   6. frameSrcOrigins always includes both canonical Google Maps origins
//      and any short-link host for the redirect chain.
//   7. /maps/embed?pb=... canonical embed URLs pass through unchanged.
//   8. Non-maps google.com URLs do NOT match (e.g. google.com/search).

import { resolveEmbed } from './oembed-resolve.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[google-maps:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// (1) /maps/place/ URL extracts place name.
// ---------------------------------------------------------------------------

const place = resolveEmbed('https://www.google.com/maps/place/Eiffel+Tower/@48.8584,2.2945,15z');
assert(place.providerName === 'google-maps', `expected google-maps; got ${place.providerName}`);
assert(
  place.embedUrl === `https://www.google.com/maps?q=${encodeURIComponent('Eiffel Tower')}&output=embed`,
  `place embedUrl mismatch; got ${place.embedUrl}`,
);

// ---------------------------------------------------------------------------
// (2) maps.google.com with ?q= param.
// ---------------------------------------------------------------------------

const queryParam = resolveEmbed('https://maps.google.com/maps?q=Tokyo');
assert(
  queryParam.providerName === 'google-maps',
  `expected google-maps; got ${queryParam.providerName}`,
);
assert(
  queryParam.embedUrl === `https://www.google.com/maps?q=${encodeURIComponent('Tokyo')}&output=embed`,
  `query param embedUrl mismatch; got ${queryParam.embedUrl}`,
);

// ---------------------------------------------------------------------------
// (3) /maps/@lat,lng URL extracts coordinates.
// ---------------------------------------------------------------------------

const coords = resolveEmbed('https://www.google.com/maps/@48.8584,2.2945,15z');
assert(coords.providerName === 'google-maps', `expected google-maps; got ${coords.providerName}`);
assert(
  coords.embedUrl === `https://www.google.com/maps?q=${encodeURIComponent('48.8584,2.2945')}&output=embed`,
  `coords embedUrl mismatch; got ${coords.embedUrl}`,
);

// ---------------------------------------------------------------------------
// (4) goo.gl/maps/ short links pass through with their host added to frame-src.
// ---------------------------------------------------------------------------

const shortLink = resolveEmbed('https://goo.gl/maps/abc123');
assert(
  shortLink.providerName === 'google-maps',
  `expected google-maps for goo.gl; got ${shortLink.providerName}`,
);
assert(
  shortLink.embedUrl === 'https://goo.gl/maps/abc123',
  `goo.gl embedUrl must be raw URL (browser follows redirect); got ${shortLink.embedUrl}`,
);

// ---------------------------------------------------------------------------
// (5) maps.app.goo.gl short links (modern Share-sheet) — same treatment.
// ---------------------------------------------------------------------------

const appShortLink = resolveEmbed('https://maps.app.goo.gl/abc123');
assert(
  appShortLink.providerName === 'google-maps',
  `expected google-maps for maps.app.goo.gl; got ${appShortLink.providerName}`,
);
assert(
  appShortLink.embedUrl === 'https://maps.app.goo.gl/abc123',
  `maps.app.goo.gl embedUrl must be raw URL; got ${appShortLink.embedUrl}`,
);

// ---------------------------------------------------------------------------
// (6) frameSrcOrigins always includes both canonical Google Maps origins,
//     plus the short-link host when applicable, so the browser's redirect
//     chain passes CSP at every hop.
// ---------------------------------------------------------------------------

function includesAll(arr: string[], wanted: string[]): boolean {
  return wanted.every((w) => arr.includes(w));
}

assert(
  includesAll(place.frameSrcOrigins, ['https://www.google.com', 'https://maps.google.com']),
  `place frameSrcOrigins missing canonical Google origins; got ${place.frameSrcOrigins.join(', ')}`,
);
assert(
  includesAll(queryParam.frameSrcOrigins, ['https://www.google.com', 'https://maps.google.com']),
  `queryParam frameSrcOrigins missing canonical origins; got ${queryParam.frameSrcOrigins.join(', ')}`,
);
assert(
  includesAll(coords.frameSrcOrigins, ['https://www.google.com', 'https://maps.google.com']),
  `coords frameSrcOrigins missing canonical origins; got ${coords.frameSrcOrigins.join(', ')}`,
);
assert(
  includesAll(shortLink.frameSrcOrigins, [
    'https://goo.gl',
    'https://www.google.com',
    'https://maps.google.com',
  ]),
  `shortLink frameSrcOrigins missing one of host/canonical; got ${shortLink.frameSrcOrigins.join(', ')}`,
);
assert(
  includesAll(appShortLink.frameSrcOrigins, [
    'https://maps.app.goo.gl',
    'https://www.google.com',
    'https://maps.google.com',
  ]),
  `appShortLink frameSrcOrigins missing one of host/canonical; got ${appShortLink.frameSrcOrigins.join(', ')}`,
);

// ---------------------------------------------------------------------------
// (7) /maps/embed?pb=... canonical embed URLs pass through unchanged.
// ---------------------------------------------------------------------------

const canonicalEmbed = resolveEmbed(
  'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3936.123!2sEiffel',
);
assert(
  canonicalEmbed.providerName === 'google-maps',
  `canonical /maps/embed should be google-maps; got ${canonicalEmbed.providerName}`,
);
assert(
  canonicalEmbed.embedUrl === 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3936.123!2sEiffel',
  `canonical embedUrl must pass through unchanged; got ${canonicalEmbed.embedUrl}`,
);

// ---------------------------------------------------------------------------
// (8) Non-maps google.com URLs must NOT match.
// ---------------------------------------------------------------------------

const search = resolveEmbed('https://www.google.com/search?q=hello');
assert(
  search.providerName === 'generic',
  `google.com/search should be generic, not google-maps; got ${search.providerName}`,
);

const drive = resolveEmbed('https://www.google.com/drive/folders/abc');
assert(
  drive.providerName === 'generic',
  `google.com/drive should be generic, not google-maps; got ${drive.providerName}`,
);

// ---------------------------------------------------------------------------
// All assertions passed.
// ---------------------------------------------------------------------------

console.log('[google-maps:smoke] OK — all assertions passed');
