// src/fonts/upload.ts
//
// Wave 5 #12 — Custom font upload primitive.
//
// Storage choice (recorded for the brief): we use a PARALLEL siteFont store
// rather than reusing the Owner-rooted `ownerAsset` table. Two reasons:
//
//   1. The schema delta `siteFont` table (Phase 0) is keyed by siteId, not
//      customerId. The intent — and the existing comment on the table —
//      is that a font belongs to ONE site so an Owner can adopt different
//      typography per site without leaking font choices across them.
//      Owner-rooted assets would re-tangle that domain boundary.
//
//   2. Font references inside a Style Kit (`"font:<contentHash>"`) name the
//      font by its content hash, NOT by an asset UUID. Keeping a separate
//      table whose primary index is `(siteId, contentHash)` keeps the
//      lookup paths simple — the renderer never has to translate "asset id
//      → font row" because there is no such id in the kit token.
//
// R2 key shape: `fonts/<contentHash>.woff2` — parallel to the asset path
// `assets/<contentHash>.<ext>`. The keys cannot collide because the
// `fonts/` and `assets/` prefixes are distinct. We use the full 64-hex
// hash (rather than the 32-char truncation the asset pipeline uses)
// because the public read URL (`/fonts/<contentHash>`) is content-hashed
// and the brief specifies `/fonts/<contentHash>.woff2` as the canonical
// shape — keeping the URL hash and the R2 key hash identical avoids a
// pointless translation step.

import { and, eq } from 'drizzle-orm';
import type { R2Client } from '../assets/r2-client.js';
import { sha256Hex } from '../assets/hash.js';
import type { Db } from '../db/client.js';
import { siteFont, type SiteFontStyle } from '../db/schema.js';
import { assertValidWoff2, FontValidationError } from './validate.js';

/** Inputs the upload primitive accepts. */
export interface UploadFontInput {
  /** Site the uploaded font is scoped to (FK to `site.id`). */
  siteId: string;
  /** Raw bytes off the multipart upload. */
  bytes: Uint8Array;
  /** Owner-visible name used as the CSS `font-family`. Non-empty. */
  name: string;
  /**
   * Family classification (e.g. 'sans-serif', 'serif', 'mono'). The renderer
   * does not consume this today but the metadata informs future grouping in
   * the theme panel. Required because the schema marks it not-null.
   */
  family: string;
  /** Numeric font weight (100..900). Defaults to 400 per the schema. */
  weight?: number;
  /** Font slant. `'normal'` or `'italic'`. */
  style?: SiteFontStyle;
}

export interface UploadFontResult {
  id: string;
  siteId: string;
  name: string;
  family: string;
  weight: number;
  style: SiteFontStyle;
  contentHash: string;
  r2Key: string;
  byteSize: number;
  /**
   * `true` when a fresh row was inserted; `false` when the (siteId,
   * contentHash) probe matched an existing row. Mirrors the asset
   * pipeline's "inserted" flag so the editor can label the response
   * accordingly.
   */
  inserted: boolean;
  /** `true` when the R2 object was freshly written. */
  r2Uploaded: boolean;
}

export interface UploadFontDeps {
  db: Db;
  r2: R2Client;
}

/**
 * Compute the R2 key for a font upload. Exported so the route handler and
 * the smoke can both reach it without duplicating the format. Validates
 * the hash format because the key is interpolated into both the R2 key
 * and (downstream) the `@font-face src` URL — a stray slash would split
 * the path; we refuse anything that is not 64-hex.
 */
export function fontContentHashToR2Key(contentHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    throw new Error(
      `fontContentHashToR2Key: contentHash must be 64 hex characters, got ${contentHash}`,
    );
  }
  return `fonts/${contentHash}.woff2`;
}

/**
 * Core upload primitive. Validates the bytes (signature + size), computes
 * the content hash, dedupes per-site, writes R2 + the DB row.
 *
 * Failure modes per the global "all-or-nothing" policy:
 *   - Invalid signature / oversize → `FontValidationError` (400 at the route).
 *   - Empty / blank name → `FontValidationError` (400 at the route).
 *   - DB / R2 unhandled errors propagate verbatim.
 */
export async function uploadSiteFont(
  deps: UploadFontDeps,
  input: UploadFontInput,
): Promise<UploadFontResult> {
  assertValidWoff2(input.bytes);

  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new FontValidationError('font name must be a non-empty string');
  }
  const trimmedFamily = input.family.trim();
  if (trimmedFamily.length === 0) {
    throw new FontValidationError('font family classification must be a non-empty string');
  }
  const weight = input.weight ?? 400;
  if (!Number.isInteger(weight) || weight < 1 || weight > 1000) {
    throw new FontValidationError(
      `font weight must be an integer 1..1000, got ${String(input.weight)}`,
    );
  }
  const style: SiteFontStyle = input.style ?? 'normal';
  if (style !== 'normal' && style !== 'italic') {
    throw new FontValidationError(
      `font style must be 'normal' or 'italic', got ${JSON.stringify(input.style)}`,
    );
  }

  const contentHash = await sha256Hex(input.bytes);
  const r2Key = fontContentHashToR2Key(contentHash);

  // Per-site dedup probe. Re-uploading the same bytes against the same site
  // returns the existing row unchanged so the editor doesn't accumulate
  // duplicate rows from the Owner clicking "upload" twice.
  const existing = await deps.db
    .select()
    .from(siteFont)
    .where(and(eq(siteFont.siteId, input.siteId), eq(siteFont.contentHash, contentHash)))
    .limit(1);
  const found = existing[0];
  if (found) {
    return {
      id: found.id,
      siteId: found.siteId,
      name: found.name,
      family: found.family,
      weight: found.weight,
      style: found.style,
      contentHash: found.contentHash,
      r2Key,
      byteSize: found.byteSize,
      inserted: false,
      r2Uploaded: false,
    };
  }

  // Put-if-missing into R2. Two sites uploading the same bytes share the R2
  // object; only one DB row per (siteId, contentHash) pair exists.
  const existingObject = await deps.r2.head(r2Key);
  let r2Uploaded = false;
  if (existingObject === null) {
    const putResult = await deps.r2.put(r2Key, input.bytes, 'font/woff2', { ifMissing: true });
    r2Uploaded = putResult.uploaded;
  }

  const id = crypto.randomUUID();
  await deps.db.insert(siteFont).values({
    id,
    siteId: input.siteId,
    name: trimmedName,
    family: trimmedFamily,
    weight,
    style,
    contentHash,
    byteSize: input.bytes.byteLength,
  });

  return {
    id,
    siteId: input.siteId,
    name: trimmedName,
    family: trimmedFamily,
    weight,
    style,
    contentHash,
    r2Key,
    byteSize: input.bytes.byteLength,
    inserted: true,
    r2Uploaded,
  };
}
