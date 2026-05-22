// src/canvas/seed-assets.ts
//
// Seed asset registry — the bytes that materialise as `siteAsset` rows when an
// Owner creates a site from the Template Seed. Every `assetId` referenced by
// `src/canvas/fixtures/home.json` MUST appear as a key here so a brand-new
// site has no dangling media references.
//
// The bytes shipped here are intentionally minimal-but-real:
//   - The image entries embed a 1x1 transparent PNG (33-byte minimum PNG
//     payload encoded as base64). It renders as a fully transparent pixel; the
//     Owner replaces it with real media via the upload route (T6 Step 4).
//   - The video entry reuses the same 1x1 PNG bytes but declares
//     `mediaType: 'video/mp4'`. This deliberately produces a file the browser
//     cannot play; the smoke + validators + DB writes are the things being
//     exercised here. The Owner replaces it via upload, exactly like the
//     image entries. Real video bytes ship in a follow-up.
//
// Once shipped, these ids and bytes are STABLE — Owners materialise sites
// against them and cannot rely on us swapping bytes underneath. If we need to
// roll a new seed, we add a NEW id and update the fixture; we do NOT mutate
// the existing entries.
//
// Production validators (`validateCanvasSiteState`, `validatePublishedSnapshot`)
// do NOT consult this registry — customer-uploaded asset ids are unknown to
// it by design. Only `validateSeedFixture` (canvas/validate.ts) reads it, and
// only against the bundled fixture.

export interface SeedAsset {
  kind: 'image' | 'video';
  mediaType: string;
  alt: string;
  bytesBase64: string;
}

// 1x1 transparent PNG — public-domain "smallest valid PNG" used widely as a
// placeholder pixel. The bytes decode to 67 raw bytes including the PNG
// signature, IHDR, IDAT, and IEND chunks.
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

export const SEED_ASSET_REGISTRY: Record<string, SeedAsset> = {
  'seed-hero-video-1': {
    kind: 'video',
    // POC placeholder: bytes are a 1x1 PNG with the wrong mediaType so the
    // browser will refuse to play it. The Owner replaces it via the asset
    // upload route; the validator + renderer + DB write end-to-end paths
    // exercise correctly against this placeholder.
    mediaType: 'video/mp4',
    alt: 'Editable site loop',
    bytesBase64: TRANSPARENT_PNG_BASE64,
  },
  'seed-hero-poster-1': {
    kind: 'image',
    mediaType: 'image/png',
    alt: 'Editable site loop poster',
    bytesBase64: TRANSPARENT_PNG_BASE64,
  },
  'seed-feature-canvas-1': {
    kind: 'image',
    mediaType: 'image/png',
    alt: 'Canvas editing surface',
    bytesBase64: TRANSPARENT_PNG_BASE64,
  },
};

export const SEED_ASSET_IDS = Object.keys(SEED_ASSET_REGISTRY);

export function isSeedAssetId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SEED_ASSET_REGISTRY, id);
}

export function getSeedAsset(id: string): SeedAsset | null {
  return Object.prototype.hasOwnProperty.call(SEED_ASSET_REGISTRY, id)
    ? SEED_ASSET_REGISTRY[id] ?? null
    : null;
}
