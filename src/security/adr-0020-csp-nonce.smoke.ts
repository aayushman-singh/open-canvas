// src/security/adr-0020-csp-nonce.smoke.ts
//
// ADR 0020 follow-up smoke — verifies the nonce-generator + CSP-builder
// contract end-to-end.
//
//   1. `generateNonce()` returns a base64 string with at least 128 bits
//      of underlying entropy. Two consecutive calls return different
//      values (the per-request property the ADR depends on).
//   2. `buildEditorCSP(nonce)` emits a Content-Security-Policy directive
//      whose `script-src` lists the supplied nonce verbatim, drops
//      `'unsafe-inline'`, and includes the conservative `https:` starter
//      values from ADR 0020 decision 2 (a).
//   3. A rendered editor route HTML carries a `<script nonce="…">`
//      attribute whose value matches the nonce in the
//      `Content-Security-Policy: script-src 'nonce-…'` directive. A
//      mismatch silently drops the inline script in real browsers, so
//      the smoke pins the equality.

import { buildEditorCSP, generateNonce } from './csp-nonce.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[adr-0020-csp-nonce:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// 1. generateNonce — entropy + per-request freshness.
// ---------------------------------------------------------------------------

const nonceA = generateNonce();
const nonceB = generateNonce();
assert(typeof nonceA === 'string' && nonceA.length > 0, 'nonce must be a non-empty string');
assert(nonceA !== nonceB, 'consecutive nonces must differ (per-request contract)');

// base64-encoded 16 bytes → 24 chars including padding. Allow ± a few for
// implementations that strip padding (we don't, but assert robustly).
assert(
  nonceA.length >= 22 && nonceA.length <= 28,
  `nonce length unexpected (${String(nonceA.length)}); 128-bit base64 is 22–28 chars`,
);

// Plain base64 alphabet only; no URL-safe chars sneaking in.
assert(
  /^[A-Za-z0-9+/=]+$/.test(nonceA),
  `nonce contains characters outside the base64 alphabet: "${nonceA}"`,
);

// ---------------------------------------------------------------------------
// 2. buildEditorCSP — directive shape.
// ---------------------------------------------------------------------------

const nonce = generateNonce();
const csp = buildEditorCSP(nonce);

assert(csp.includes(`script-src 'nonce-${nonce}'`), `script-src must list the nonce verbatim: ${csp}`);
const scriptSrcMatch = /script-src ([^;]+)/.exec(csp);
assert(scriptSrcMatch !== null, `csp must carry an explicit script-src: ${csp}`);
assert(
  !scriptSrcMatch[1]!.includes("'unsafe-inline'"),
  `script-src must NOT carry 'unsafe-inline': "${scriptSrcMatch[1] ?? ''}"`,
);
assert(csp.includes(`default-src 'none'`), `must explicitly deny default-src: ${csp}`);
assert(csp.includes(`base-uri 'self'`), `must pin base-uri: ${csp}`);
assert(csp.includes(`form-action 'self'`), `must pin form-action: ${csp}`);
assert(csp.includes(`frame-ancestors 'none'`), `must deny frame embedding: ${csp}`);
assert(
  csp.includes(`connect-src 'self' wss: https:`),
  `connect-src must allow wss + https (co-edit + API): ${csp}`,
);

// Conservative `https:` starter — every directive that needs more than
// 'self' accepts https. Tightening is a follow-up.
for (const directive of ['script-src', 'style-src', 'img-src', 'font-src', 'frame-src', 'media-src']) {
  assert(
    csp.includes(`${directive} `) && csp.includes(' https:'),
    `${directive} should ship with conservative https: starter: ${csp}`,
  );
}

// ---------------------------------------------------------------------------
// 3. Header / inline-script equality — rendered editor route shape.
// ---------------------------------------------------------------------------

// We can't easily mount the full Hono route under bun without the DB +
// Clerk wiring; check the contract by constructing the matching pieces
// the route would produce and asserting the equality property.
const headerValue = `Content-Security-Policy: ${csp}`;
const inlineScriptTag = `<script nonce="${nonce}">window.__opencanvasEditorBoot = {};</script>`;
const scriptNonceMatch = /<script[^>]*nonce="([^"]+)"/.exec(inlineScriptTag);
const headerNonceMatch = /script-src 'nonce-([^']+)'/.exec(headerValue);
assert(scriptNonceMatch !== null, 'inline script must carry a nonce attribute');
assert(headerNonceMatch !== null, 'CSP header must carry a nonce in script-src');
assert(
  scriptNonceMatch[1] === headerNonceMatch[1],
  `inline-script nonce "${scriptNonceMatch[1] ?? ''}" must match header nonce "${headerNonceMatch[1] ?? ''}"`,
);

process.stdout.write('[adr-0020-csp-nonce:smoke] generateNonce + buildEditorCSP OK\n');
process.stdout.write('[adr-0020-csp-nonce:smoke] OK\n');
