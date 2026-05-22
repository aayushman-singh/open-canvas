// src/canvas/seed-assets.ts
//
// Seed asset registry — the Owner-Asset rows that materialise when an Owner
// creates a site from a Template Seed. Every `assetId` referenced by
// `src/canvas/fixtures/home.json` MUST appear as a key here so a brand-new
// site has no dangling media references.
//
// Per ADR 0004 (Owner-rooted assets) and ADR 0006 (R2 originals + content-
// hash addressing), the registry entries no longer ship inline bytes. Each
// entry carries:
//
//   - `contentHash` (sha256 hex) — stable address of the bytes in R2.
//   - `r2Key` — the bucket key derived from the content hash.
//   - `mediaType`, `kind`, `width`, `height`, `byteSize`, `alt` — DB row shape.
//   - `sourcePath` — path under `src/assets/seed-source/` that holds the raw
//     bytes as a base64 file. The `seed:assets` script reads these on first
//     dev start, uploads them to R2, and inserts the corresponding
//     `ownerAsset` rows for the dev customer.
//
// Once shipped, these ids, content hashes, and r2 keys are STABLE — Owners
// materialise sites against them and cannot rely on us swapping bytes
// underneath. If we need to roll a new seed, we add a NEW id (and a new bytes
// file) and update the fixture; we do NOT mutate the existing entries.
//
// Production validators (`validateCanvasSiteState`, `validatePublishedSnapshot`)
// do NOT consult this registry — customer-uploaded asset ids are unknown to
// it by design. Only `validateSeedFixture` (canvas/validate.ts) reads it, and
// only against the bundled fixture.

export interface SeedAsset {
  /**
   * Lower-case hex sha256 of the raw bytes referenced by `sourcePath`. This
   * is the immutable address used by the R2 read path; do not change it
   * without also rolling the registry key.
   */
  contentHash: string;
  /**
   * R2 object key under the `ASSETS_BUCKET` binding. The convention is
   * `assets/<contentHash[:32]>.<ext>` so the on-disk layout reads cleanly.
   */
  r2Key: string;
  mediaType: string;
  kind: 'image' | 'video';
  /**
   * Pixel dimensions for images. Null for video (the cf.image transform path
   * does not apply to video — see ADR 0006 decision 4).
   */
  width: number | null;
  height: number | null;
  /** Raw byte count of the original — drives the `byte_size` DB column. */
  byteSize: number;
  alt: string;
  /**
   * Path under `src/assets/seed-source/` holding the original bytes as
   * base64. Read by the `seed:assets` upload script; never inlined into a
   * route response. The base64 file shape keeps the repo plain-text
   * reviewable without committing binary blobs.
   */
  sourcePath: string;
}

// The two bundled seeds are both backed by the same 1x1 transparent PNG —
// 68 bytes. They share a contentHash (and therefore an R2 object) but are
// kept as separate registry keys so `MediaElement.assetId` references in
// fixtures stay stable across migrations. After re-rooting, the seed ids are
// also valid `ownerAsset.id` values inserted by `prepareSeedAssetsForCustomer`
// scoped to the dev Owner.
const TRANSPARENT_PNG = {
  contentHash: '0532547ce20ddc48bad91317a0c443a94e04dadd03e4362a21277d51da940bb7',
  r2Key: 'assets/0532547ce20ddc48bad91317a0c443a9.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  // The PNG IHDR encodes 1x1; we pin the dimensions here so the seed:assets
  // script does not need to decode the header to fill the DB row.
  width: 1,
  height: 1,
  byteSize: 68,
  sourcePath: 'transparent.png.b64',
};

export const SEED_ASSET_REGISTRY: Record<string, SeedAsset> = {
  'seed-hero-poster-1': {
    ...TRANSPARENT_PNG,
    alt: 'Editable site loop poster',
  },
  'seed-feature-canvas-1': {
    ...TRANSPARENT_PNG,
    alt: 'Canvas editing surface',
  },
};

export const SEED_ASSET_IDS = Object.keys(SEED_ASSET_REGISTRY);

export function isSeedAssetId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SEED_ASSET_REGISTRY, id);
}

export function getSeedAsset(id: string): SeedAsset | null {
  return Object.prototype.hasOwnProperty.call(SEED_ASSET_REGISTRY, id)
    ? (SEED_ASSET_REGISTRY[id] ?? null)
    : null;
}
