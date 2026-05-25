// src/embed/google-maps.smoke.ts
//
// Smoke tests for Google Maps embed resolution. Verifies:
//
//   1. /maps/place/ URLs extract the place name as the query.
//   2. maps.google.com?q= URLs extract the query param.
//   3. /maps/@lat,lng URLs extract coordinates.
//   4. goo.gl/maps/ short links resolve to google-maps provider.
//   5. frameSrcOrigin is always https://maps.google.com.
//   6. Non-maps google.com URLs do NOT match (e.g. google.com/search).

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
  place.embedUrl === `https://maps.google.com/maps?q=${encodeURIComponent('Eiffel Tower')}&output=embed`,
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
  queryParam.embedUrl === `https://maps.google.com/maps?q=${encodeURIComponent('Tokyo')}&output=embed`,
  `query param embedUrl mismatch; got ${queryParam.embedUrl}`,
);

// ---------------------------------------------------------------------------
// (3) /maps/@lat,lng URL extracts coordinates.
// ---------------------------------------------------------------------------

const coords = resolveEmbed('https://www.google.com/maps/@48.8584,2.2945,15z');
assert(coords.providerName === 'google-maps', `expected google-maps; got ${coords.providerName}`);
assert(
  coords.embedUrl === `https://maps.google.com/maps?q=${encodeURIComponent('48.8584,2.2945')}&output=embed`,
  `coords embedUrl mismatch; got ${coords.embedUrl}`,
);

// ---------------------------------------------------------------------------
// (4) goo.gl/maps/ short links.
// ---------------------------------------------------------------------------

const shortLink = resolveEmbed('https://goo.gl/maps/abc123');
assert(
  shortLink.providerName === 'google-maps',
  `expected google-maps for goo.gl; got ${shortLink.providerName}`,
);
// Short links have no extractable query — falls back to raw URL.
assert(
  shortLink.embedUrl === `https://maps.google.com/maps?q=${encodeURIComponent('https://goo.gl/maps/abc123')}&output=embed`,
  `goo.gl embedUrl mismatch; got ${shortLink.embedUrl}`,
);

// ---------------------------------------------------------------------------
// (5) frameSrcOrigin is always https://maps.google.com.
// ---------------------------------------------------------------------------

assert(
  place.frameSrcOrigin === 'https://maps.google.com',
  `frameSrcOrigin mismatch; got ${place.frameSrcOrigin}`,
);
assert(
  queryParam.frameSrcOrigin === 'https://maps.google.com',
  `frameSrcOrigin mismatch; got ${queryParam.frameSrcOrigin}`,
);
assert(
  coords.frameSrcOrigin === 'https://maps.google.com',
  `frameSrcOrigin mismatch; got ${coords.frameSrcOrigin}`,
);
assert(
  shortLink.frameSrcOrigin === 'https://maps.google.com',
  `frameSrcOrigin mismatch; got ${shortLink.frameSrcOrigin}`,
);

// ---------------------------------------------------------------------------
// (6) Non-maps google.com URLs must NOT match.
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
