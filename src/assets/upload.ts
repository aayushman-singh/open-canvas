// src/assets/upload.ts
//
// Owner-rooted asset upload service for the dashboard and editor.
//
// Original bytes are stored under content-hash R2 keys, while `owner_asset`
// rows remain per Owner. That keeps shared object storage deduplicated without
// merging owner-specific metadata, permissions, or library history.
//
// Flow:
//   1. Parse the multipart form: file blob + optional `alt` text + optional
//      `siteId` and `elementId` for slot-history book-keeping.
//   2. Compute SHA-256 of the bytes.
//   3. Dedup probe: SELECT * FROM ownerAsset WHERE customerId=? AND contentHash=?.
//      If a row exists, return it unchanged — no R2 put, no row insert.
//   4. Otherwise: probe image dimensions (null for video), put the bytes into
//      R2 with put-if-missing semantics (the R2 object may already exist if
//      another Owner uploaded the same bytes), insert the ownerAsset row,
//      optionally append a `slot_history` row if siteId+elementId came in
//      and the site belongs to this Owner.
//
// Failure handling is loud: any malformed input or unsupported media type
// returns a 400 with a precise error string. R2/DB errors propagate.

import { and, eq } from 'drizzle-orm';
import { contentHashToR2Key, extFromMediaType, sha256Hex } from './hash.js';
import { probeImageDimensions } from './image-probe.js';
import type { R2Client } from './r2-client.js';
import type { Db } from '../db/client.js';
import { ownerAsset, site, slotHistory } from '../db/schema.js';

export interface UploadAssetInput {
  customerId: string;
  /** The raw bytes the Owner uploaded. */
  bytes: Uint8Array;
  /** Browser-supplied media type. The upload route is strict about prefix. */
  mediaType: string;
  alt: string;
  /**
   * Optional slot-history book-keeping. When both are present, a row is
   * inserted into `slot_history` keyed by (siteId, elementId, ownerAssetId).
   * The MRU model lives entirely in this sibling table; canvas JSON is not
   * touched by the upload path.
   */
  siteId?: string;
  elementId?: string;
}

export interface UploadAssetResult {
  id: string;
  contentHash: string;
  r2Key: string;
  mediaType: string;
  kind: 'image' | 'video';
  alt: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  /**
   * `true` when a fresh row was inserted; `false` when the (customerId,
   * contentHash) probe matched an existing row and the upload deduplicated
   * to that row. Useful for the caller's response framing — the editor can
   * say "already in your library" instead of "uploaded".
   */
  inserted: boolean;
  /**
   * `true` when the underlying R2 object was newly written. `false` when the
   * object already existed (because the same bytes were previously uploaded
   * by anyone — same Owner, different Owner, or seed materialiser).
   */
  r2Uploaded: boolean;
}

export interface UploadAssetDeps {
  db: Db;
  r2: R2Client;
}

const ALLOWED_MEDIA_PREFIXES = ['image/', 'video/'];

// SVG carries executable script content; serving an Owner-uploaded SVG from
// the same origin as the editor and dashboard is a stored-XSS surface. The
// canvas renderer has no use for SVG that PNG/JPEG/AVIF cannot satisfy, so
// reject at the upload boundary. Mirror the deny on the read path with
// `X-Content-Type-Options: nosniff` so a mediaType-spoofed upload cannot be
// re-typed as SVG by the browser.
const DENIED_MEDIA_TYPES = new Set(['image/svg+xml', 'image/svg']);

export class UploadAssetError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UploadAssetError';
    this.status = status;
  }
}

function normaliseMediaType(mediaType: string): string {
  const base = mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (base.length === 0) {
    throw new UploadAssetError('media type must include a concrete image/* or video/* type');
  }
  return base;
}

/**
 * Core upload implementation. The route wrapper does the multipart parsing
 * and Clerk-auth gating; the function below is the pure business logic so
 * the smoke can exercise it without an HTTP request.
 */
export async function uploadOwnerAsset(
  deps: UploadAssetDeps,
  input: UploadAssetInput,
): Promise<UploadAssetResult> {
  const hasSiteId = input.siteId !== undefined;
  const hasElementId = input.elementId !== undefined;
  if (hasSiteId !== hasElementId) {
    throw new UploadAssetError('siteId and elementId must be provided together');
  }
  const mediaType = normaliseMediaType(input.mediaType);
  if (!ALLOWED_MEDIA_PREFIXES.some((prefix) => mediaType.startsWith(prefix))) {
    throw new UploadAssetError(
      `unsupported media type: ${input.mediaType} (must start with image/ or video/)`,
    );
  }
  if (DENIED_MEDIA_TYPES.has(mediaType)) {
    throw new UploadAssetError(
      `unsupported media type: ${input.mediaType} (SVG uploads are not permitted)`,
    );
  }
  if (input.bytes.byteLength === 0) {
    throw new UploadAssetError('upload bytes must not be empty');
  }
  const kind: 'image' | 'video' = mediaType.startsWith('image/') ? 'image' : 'video';

  const contentHash = await sha256Hex(input.bytes);
  const r2Key = contentHashToR2Key(contentHash, extFromMediaType(mediaType));

  // Dedup probe — per Owner. Two Owners uploading the same bytes share the
  // R2 object but get distinct ownerAsset rows; the same Owner re-uploading
  // returns the existing row, per the upload contract.
  const existing = await deps.db
    .select()
    .from(ownerAsset)
    .where(
      and(eq(ownerAsset.customerId, input.customerId), eq(ownerAsset.contentHash, contentHash)),
    )
    .limit(1);
  const found = existing[0];
  if (found) {
    if (input.siteId !== undefined && input.elementId !== undefined) {
      await recordOwnedSiteSlotUse(
        deps.db,
        input.customerId,
        input.siteId,
        input.elementId,
        found.id,
      );
    }
    return {
      id: found.id,
      contentHash: found.contentHash,
      r2Key: found.r2Key,
      mediaType: found.mediaType,
      kind: found.kind,
      alt: found.alt,
      width: found.width,
      height: found.height,
      byteSize: found.byteSize,
      inserted: false,
      r2Uploaded: false,
    };
  }

  // Probe dimensions before R2 put — if we are inserting a row we want the
  // dimensions in the row, and the probe is cheap (handful of byte reads).
  const dimensions =
    kind === 'image' ? probeImageDimensions(input.bytes) : { width: null, height: null };

  // R2 put-if-missing. The shared bytes-across-Owners case (different Owner
  // uploaded these bytes earlier) is the path where `uploaded` is false —
  // we still create the DB row for this Owner.
  const existingObject = await deps.r2.head(r2Key);
  let r2Uploaded = false;
  if (existingObject === null) {
    const result = await deps.r2.put(r2Key, input.bytes, mediaType, { ifMissing: true });
    r2Uploaded = result.uploaded;
  }

  const id = crypto.randomUUID();
  await deps.db.insert(ownerAsset).values({
    id,
    customerId: input.customerId,
    contentHash,
    r2Key,
    mediaType,
    kind,
    alt: input.alt,
    width: dimensions.width,
    height: dimensions.height,
    byteSize: input.bytes.byteLength,
  });

  if (input.siteId !== undefined && input.elementId !== undefined) {
    await recordOwnedSiteSlotUse(deps.db, input.customerId, input.siteId, input.elementId, id);
  }

  return {
    id,
    contentHash,
    r2Key,
    mediaType,
    kind,
    alt: input.alt,
    width: dimensions.width,
    height: dimensions.height,
    byteSize: input.bytes.byteLength,
    inserted: true,
    r2Uploaded,
  };
}

async function recordOwnedSiteSlotUse(
  db: Db,
  customerId: string,
  siteId: string,
  elementId: string,
  ownerAssetId: string,
): Promise<void> {
  // Slot history feeds the editor's "recently used here" UI. Check site
  // ownership before inserting so a malicious caller cannot poison another
  // Owner's MRU list by guessing site and element ids.
  const siteRows = await db
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  if (!siteRows[0]) {
    throw new UploadAssetError(`site not owned for slot history: ${siteId}`, 403);
  }

  // Composite primary key keeps duplicates a no-op via ON CONFLICT DO
  // NOTHING. We always update `used_at` so the gallery's MRU ordering moves
  // the asset to the top on every reuse.
  await db
    .insert(slotHistory)
    .values({ siteId, elementId, ownerAssetId })
    .onConflictDoUpdate({
      target: [slotHistory.siteId, slotHistory.elementId, slotHistory.ownerAssetId],
      set: { usedAt: new Date() },
    });
}
