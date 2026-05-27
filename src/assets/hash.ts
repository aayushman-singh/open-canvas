// src/assets/hash.ts
//
// SHA-256 helper used by the upload path to derive content addresses. The
// implementation goes through Web Crypto (`crypto.subtle.digest`) so it
// works identically in the Workers runtime, in Bun (smoke test), and in any
// future Node-with-WebCrypto environment.

/**
 * Compute the lowercase-hex SHA-256 of the given bytes. Accepts both
 * `ArrayBuffer` and `Uint8Array`; the result is always 64 hex characters.
 *
 * Failure mode: if Web Crypto is unavailable (truly broken runtime), the
 * Workers binding throws and the caller bubbles it. There is no fallback.
 */
export async function sha256Hex(input: ArrayBuffer | Uint8Array): Promise<string> {
  // crypto.subtle.digest accepts BufferSource. We pass through both shapes
  // unchanged — a Uint8Array IS a BufferSource — but a copy is needed when
  // the source is a partial view on a larger buffer to avoid hashing data
  // outside the intended range.
  // REVIEW: dead code — both ternary branches return `input`. The comment says "a copy is needed when the source is a partial view" but no copy is made. If the intent is to handle Uint8Array views over shared buffers, do `input instanceof Uint8Array ? input.slice() : input`.
  const source: BufferSource = input instanceof Uint8Array ? input : input;
  const digest = await crypto.subtle.digest('SHA-256', source);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i] as number;
    hex += value.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Convert a content hash to the R2 object key. The truncation to 32 hex
 * chars (the first 16 bytes of the digest) is per ADR 0006's `assets/<hash>.<ext>`
 * convention — it keeps keys short while preserving collision resistance
 * far beyond what the POC will ever exercise.
 */
export function contentHashToR2Key(contentHash: string, ext: string): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    throw new Error(
      `contentHashToR2Key: contentHash must be 64 hex characters, got ${contentHash}`,
    );
  }
  const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
  if (!/^[a-z0-9]+$/.test(cleanExt)) {
    throw new Error(`contentHashToR2Key: ext must be lowercase alphanumeric, got ${ext}`);
  }
  return `assets/${contentHash.slice(0, 32)}.${cleanExt}`;
}

/**
 * Map a media type to its conventional file extension. Used by the upload
 * path to derive the R2 key shape. Unknown types fall back to `bin` rather
 * than silently picking something — the route still accepts the upload, but
 * the file ends up at `assets/<hash>.bin`.
 */
export function extFromMediaType(mediaType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
  };
  return map[mediaType.toLowerCase()] ?? 'bin';
}
