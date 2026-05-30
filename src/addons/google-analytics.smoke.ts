// src/addons/google-analytics.smoke.ts
//
// Smoke test for the Google Analytics addon's measurementId validation
// contract. Verifies that:
//
//   1. The addon registry exposes a `measurementId` config field with a
//      regex pattern that matches the documented GA4 format.
//   2. The regex accepts a well-formed GA4 ID (G-PASS7TEST01).
//   3. The regex rejects malformed IDs that the addon-shop UI used to
//      accept on the wire (X-INVALID-123, "", "G-", "GA-abc").
//   4. The configFields entry carries the `patternHint` string the
//      addons.ts PUT handler surfaces back to the client on a 400.
//   5. The emitter throws the same way when fed an invalid id — defence
//      in depth against a malformed row that somehow slipped past the
//      route's pattern check (older row, migrated row, etc.).
//
// Run with `bun.cmd run google-analytics:smoke`.

import { getAddon } from './registry.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const addon = getAddon('addon_google_analytics');
assert(addon !== undefined, 'getAddon should find addon_google_analytics');

const field = addon!.configFields.find((f) => f.key === 'measurementId');
assert(field !== undefined, 'addon must expose a measurementId config field');
assert(
  typeof field!.pattern === 'string' && field!.pattern.length > 0,
  'measurementId field must carry a regex pattern',
);
assert(
  typeof field!.patternHint === 'string' && field!.patternHint.length > 0,
  'measurementId field must carry a patternHint for the 400-response error surface',
);

const re = new RegExp('^(?:' + field!.pattern + ')$');

// Positive case — what the docs / placeholder advertise.
assert(re.test('G-PASS7TEST01'), 'pattern must accept G-PASS7TEST01');
assert(re.test('G-XXXXXXXXXX'), 'pattern must accept the documented placeholder');
assert(re.test('G-1A2B3C4D'), 'pattern must accept mixed alphanumeric IDs');

// Negative cases — what the Pass-7 finding called out as silently accepted
// before the fix landed.
assert(!re.test('X-INVALID-123'), 'pattern must reject X-INVALID-123 (Pass-7 regression)');
assert(!re.test(''), 'pattern must reject empty string');
assert(!re.test('G-'), 'pattern must reject bare G- prefix');
assert(!re.test('GA-abc123'), 'pattern must reject GA- prefix');
assert(!re.test('g-abc123'), 'pattern must reject lowercase G-');
assert(!re.test('G-abc'), 'pattern must reject lowercase suffix (GA4 IDs are uppercase + digits)');

// Emitter throws on invalid id — even if a malformed row escaped the route
// guard (older row, migration, manual edit), the publish path refuses to
// stamp gtag.js with bad input.
let threwOnInvalid = false;
try {
  addon!.emitHeadScripts({ measurementId: 'X-INVALID-123' });
} catch {
  threwOnInvalid = true;
}
assert(threwOnInvalid, 'emitHeadScripts must throw on a malformed measurementId');

let threwOnMissing = false;
try {
  addon!.emitHeadScripts({});
} catch {
  threwOnMissing = true;
}
assert(threwOnMissing, 'emitHeadScripts must throw when measurementId is absent');

const valid = addon!.emitHeadScripts({ measurementId: 'G-PASS7TEST01' });
assert(valid.includes('G-PASS7TEST01'), 'emitHeadScripts must inline a valid measurementId');
assert(valid.includes('googletagmanager.com/gtag/js'), 'emitter must emit the gtag.js loader');

console.log('✓ google-analytics smoke passed');
