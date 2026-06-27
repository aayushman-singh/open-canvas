// src/security/csp-nonce.ts
//
// ADR 0020 — per-request CSP nonce generator + editor Content-Security-Policy
// builder. Shared by the editor route today; ADR 0021's dashboard route
// will consume the same `generateNonce()` helper so the two surfaces never
// drift on entropy or encoding shape.
//
// The CSP builder is route-specific by design (per ADR 0020 decision 3 —
// route-by-route variation is real and a single site-wide CSP would have
// to be the loosest of every route). The editor's directive set lives
// here so it's reviewable alongside the nonce that gates it; the
// dashboard's analogue lives next door once ADR 0021 lands.

/**
 * Generate a fresh CSP nonce — 128 bits of cryptographic entropy,
 * base64-encoded. Standard floor for nonce-based CSPs; collision
 * probability across any conceivable deployment lifetime is operationally
 * zero. The encoding is plain base64 (with `+/=`), which all browsers
 * accept inside `script-src 'nonce-…'` and the matching `<script nonce>`
 * attribute without further sanitisation.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Workers and modern browsers both expose `btoa`; cast through a
  // binary-string helper because btoa requires a one-byte-per-char input.
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Build the editor route's Content-Security-Policy header value.
 *
 * Decision 2 (a) — conservative `https:` starter. Every directive that
 * needs more than `'self'` accepts `https:` (or `wss:` for connect-src).
 * The nonce hardens script-src against XSS; the rest of the directives
 * stay loose enough that legitimate CDN / Clerk / Google-Fonts / asset-
 * delivery loads do not regress. Tightening to specific origins is a
 * follow-up.
 *
 * `style-src` keeps `'unsafe-inline'` because the editor still emits
 * inline `<style>` blocks (bell styles, conditional preview CSS, etc.) —
 * a separate ADR addresses inline-style removal.
 *
 * `script-src` carries `'unsafe-eval'` because behaviour/rich-motion preview
 * (src/editor-client/hydrate-behaviour.ts) executes the shared visitor
 * runtime source verbatim via `new Function`, so preview runs byte-identical
 * code to what ships on the published page. This is scoped to the
 * authenticated, owner-only editor route — the public site CSP is built
 * elsewhere and stays eval-free.
 */
export function buildEditorCSP(nonce: string): string {
  return [
    `default-src 'none'`,
    `script-src 'nonce-${nonce}' 'self' 'unsafe-eval' https:`,
    `style-src 'self' 'unsafe-inline' https:`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data: https:`,
    `connect-src 'self' wss: https:`,
    `frame-src 'self' https:`,
    `media-src 'self' blob: https:`,
    `worker-src 'self' blob:`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}
