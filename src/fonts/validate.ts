// src/fonts/validate.ts
//
// WOFF2 signature validator.
//
// Real WOFF2 files start with the four magic bytes `wOF2` (0x77 0x4F 0x46
// 0x32) followed by the sfnt flavour and table directory. The POC ships the
// uploaded bytes verbatim (no subsetting), so the validator's only job is
// to reject anything that is NOT a WOFF2 before it reaches R2 or the DB.
//
// Failure handling per the global "all-or-nothing" policy: every problem
// throws a `FontValidationError` whose message names the offending byte
// position. The upload route catches the typed error and maps to HTTP 400.

/** Maximum upload size enforced at validation time. 1MB per the brief. */
export const MAX_FONT_BYTES = 1_048_576;

/** WOFF2 magic bytes — `wOF2` at offset 0. */
export const WOFF2_MAGIC = [0x77, 0x4f, 0x46, 0x32] as const;

export class FontValidationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'FontValidationError';
    this.status = status;
  }
}

/**
 * Assert that `bytes` is a plausible WOFF2 payload. Throws
 * `FontValidationError` on any defect. The check is intentionally narrow
 * (signature + size) because the POC does not parse the table directory or
 * verify checksums — Cloudflare's CDN serves the bytes verbatim and the
 * browser is the ultimate parser. We refuse only the obviously-bogus shapes:
 *
 *   - Empty / sub-header payloads (cannot carry the magic bytes).
 *   - Payloads exceeding `MAX_FONT_BYTES` (DoS surface + over-quota R2).
 *   - Payloads whose first four bytes are NOT `wOF2`.
 *
 * A WOFF1 (`wOFF`) or TTF/OTF upload trips the magic-byte check and is
 * rejected with a precise message naming the observed signature. The POC
 * explicitly does NOT accept WOFF1 / TTF / OTF — the publish path emits
 * `format('woff2')` only.
 */
export function assertValidWoff2(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) {
    throw new FontValidationError('font upload bytes must not be empty');
  }
  if (bytes.byteLength > MAX_FONT_BYTES) {
    throw new FontValidationError(
      `font upload exceeds ${String(MAX_FONT_BYTES)} byte limit (got ${String(bytes.byteLength)} bytes)`,
    );
  }
  if (bytes.byteLength < WOFF2_MAGIC.length) {
    throw new FontValidationError(
      `font upload too short to carry WOFF2 signature (got ${String(bytes.byteLength)} bytes, need at least ${String(WOFF2_MAGIC.length)})`,
    );
  }
  for (let i = 0; i < WOFF2_MAGIC.length; i++) {
    if (bytes[i] !== WOFF2_MAGIC[i]) {
      throw new FontValidationError(
        `font upload signature mismatch at offset ${String(i)}: expected 0x${WOFF2_MAGIC[i]!.toString(16).padStart(2, '0')} (\"wOF2\"), got 0x${(bytes[i] ?? 0).toString(16).padStart(2, '0')} — only WOFF2 is accepted`,
      );
    }
  }
}

/**
 * Return-shape variant of `assertValidWoff2`. Useful for branches that prefer
 * to inspect a boolean over catching an exception (e.g. UI preflight
 * checks). The upload path uses the assertion form so the error message
 * propagates to the HTTP response.
 */
export function isValidWoff2(bytes: Uint8Array): boolean {
  try {
    assertValidWoff2(bytes);
    return true;
  } catch {
    return false;
  }
}
