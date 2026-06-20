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
// Production validators (`validateEditableSite`, `validatePublishedSnapshot`)
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

// Portfolio template seeds (Bundle F). Two abstract SVGs that ship as default
// imagery for the engineer portfolio template (and any other template that
// wants a stylised placeholder portrait or a neutral 16:9 project thumbnail).
// SVG bytes are stable — re-rendering the same XML byte-for-byte yields the
// same contentHash, so do not reformat the source. To replace, add a NEW id.
const PORTRAIT_PLACEHOLDER_SVG = {
  contentHash: 'bef738e250e2bc98bf724a984f617e24c18f579bd9addd196d8cf7f81d6af8bc',
  r2Key: 'assets/bef738e250e2bc98bf724a984f617e24.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 480,
  height: 640,
  byteSize: 610,
  sourcePath: 'portrait-placeholder.svg.b64',
};

const PROJECT_THUMB_NEUTRAL_SVG = {
  contentHash: '5839975c71a6830ab051da26a02a9a56aba08680fc5f46bd49c19dfa9fe640aa',
  r2Key: 'assets/5839975c71a6830ab051da26a02a9a56.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 800,
  height: 450,
  byteSize: 761,
  sourcePath: 'project-thumb-neutral.svg.b64',
};

// Raydotsh Portfolio template seeds. These bytes come from the source repo the
// template was converted from and are kept as explicit seed assets so the
// template preview and new-site materialisation do not depend on that repo.
const RAYDOTSH_YORU = {
  contentHash: 'e04237ce4f94c8e15c3c94c4137aa128415a895129a877f58a03b38068594593',
  r2Key: 'assets/e04237ce4f94c8e15c3c94c4137aa128.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  width: 400,
  height: 400,
  byteSize: 114802,
  sourcePath: 'raydotsh-yoru.png.b64',
};

const RAYDOTSH_PYCASTER = {
  contentHash: '1202d7082b51783d0c46b464260e573df959ffba06b99b70dcc32606fd6c5062',
  r2Key: 'assets/1202d7082b51783d0c46b464260e573d.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  width: 959,
  height: 750,
  byteSize: 60241,
  sourcePath: 'raydotsh-pycaster.png.b64',
};

const RAYDOTSH_FAVICON = {
  contentHash: 'f9dac453bbd3c381ec5f44a448cee0058b4c707a2b62b335ef93257bd27fe20b',
  r2Key: 'assets/f9dac453bbd3c381ec5f44a448cee005.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  width: 785,
  height: 727,
  byteSize: 3508,
  sourcePath: 'raydotsh-favicon.png.b64',
};

const RAYDOTSH_BOOK_A_LITTLE_LIFE = {
  contentHash: 'e79d2d3ebb4dd6868f02a77ca306591055d1a248c0d4c266472470c02509b9f8',
  r2Key: 'assets/e79d2d3ebb4dd6868f02a77ca3065910.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  width: 614,
  height: 1024,
  byteSize: 738989,
  sourcePath: 'raydotsh-book-a-little-life.png.b64',
};

const RAYDOTSH_BOOK_PRIDE_AND_PREJUDICE = {
  contentHash: '87b7f80d2a3840e3759f3a1714a77cdc075467dd05659eff6ffb2719a193f6f5',
  r2Key: 'assets/87b7f80d2a3840e3759f3a1714a77cdc.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  width: 267,
  height: 406,
  byteSize: 222593,
  sourcePath: 'raydotsh-book-pride-and-prejudice.png.b64',
};

const RAYDOTSH_BOOK_DRACULA = {
  contentHash: 'd985e52ff584d89411a4c7972472318b7bfce657e6fa97bb3a5976ccf9b9f4fb',
  r2Key: 'assets/d985e52ff584d89411a4c7972472318b.jpg',
  mediaType: 'image/jpeg',
  kind: 'image' as const,
  width: 668,
  height: 1024,
  byteSize: 328511,
  sourcePath: 'raydotsh-book-dracula.jpg.b64',
};

const RAYDOTSH_BOOK_JANE_EYRE = {
  contentHash: '0bda831c856c3582f916601b8ebdefae2e6610f5b6c3d7a7552dbeb8b3a0cc41',
  r2Key: 'assets/0bda831c856c3582f916601b8ebdefae.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  width: 480,
  height: 792,
  byteSize: 737881,
  sourcePath: 'raydotsh-book-jane-eyre.png.b64',
};

const RAYDOTSH_BOOK_HARRY_POTTER = {
  contentHash: 'c5cb82c7340ddd33dcbebedfce36d39abd61e60fe093d97563b31e287f79d79b',
  r2Key: 'assets/c5cb82c7340ddd33dcbebedfce36d39a.jpg',
  mediaType: 'image/jpeg',
  kind: 'image' as const,
  width: 684,
  height: 1024,
  byteSize: 321088,
  sourcePath: 'raydotsh-book-harry-potter.jpg.b64',
};

const RAYDOTSH_BOOK_GOODNIGHT_PUNPUN = {
  contentHash: 'e6d9d0dccd705898831c0822e2c318a6f8508c87a68fbce39ff2f6626e351486',
  r2Key: 'assets/e6d9d0dccd705898831c0822e2c318a6.jpg',
  mediaType: 'image/jpeg',
  kind: 'image' as const,
  width: 712,
  height: 1024,
  byteSize: 651183,
  sourcePath: 'raydotsh-book-goodnight-punpun.jpg.b64',
};

const RAYDOTSH_BOOK_HUNGER_GAMES = {
  contentHash: 'c3cb1940baa011a6c8c8793320108c828feb4ed25529d2df728ef19c4a1d5d66',
  r2Key: 'assets/c3cb1940baa011a6c8c8793320108c82.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  width: 652,
  height: 1000,
  byteSize: 380090,
  sourcePath: 'raydotsh-book-hunger-games.png.b64',
};

const RAYDOTSH_BOOK_THOUSAND_SPLENDID_SUNS = {
  contentHash: 'e64c4453ede15ab70ebe554232db3bf84943fe5dedb80f0c3072cc021c6c1dd2',
  r2Key: 'assets/e64c4453ede15ab70ebe554232db3bf8.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  width: 499,
  height: 768,
  byteSize: 736580,
  sourcePath: 'raydotsh-book-thousand-splendid-suns.png.b64',
};

const RAYDOTSH_BOOK_MAN_CALLED_OVE = {
  contentHash: 'd63da7f70c2f09432d5994ecf4eb7383d3179aa745605dbb421f99852bbb3cbd',
  r2Key: 'assets/d63da7f70c2f09432d5994ecf4eb7383.jpg',
  mediaType: 'image/jpeg',
  kind: 'image' as const,
  width: 656,
  height: 1024,
  byteSize: 321882,
  sourcePath: 'raydotsh-book-man-called-ove.jpg.b64',
};

const RAYDOTSH_BOOK_RED_TRAINERS = {
  contentHash: '4cfd4fce78738b4c67b2026524694d6b2a036c36dfe22a694bc5127c5c187103',
  r2Key: 'assets/4cfd4fce78738b4c67b2026524694d6b.png',
  mediaType: 'image/png',
  kind: 'image' as const,
  width: 302,
  height: 475,
  byteSize: 165346,
  sourcePath: 'raydotsh-book-red-trainers.png.b64',
};

// Velocity Athlete template seeds (fidelity pilot). Twelve abstract helmet
// sequence frames plus four editorial media studies. SVG bytes are stable —
// re-rendering the same XML byte-for-byte yields the same contentHash.
const VELOCITY_HELMET_FRAME_00 = {
  contentHash: '675923a27b456d9d34d6cb47396c32b1ff14dde9b9038b66bc183f1f64510b3e',
  r2Key: 'assets/675923a27b456d9d34d6cb47396c32b1.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1734,
  sourcePath: 'velocity-helmet-frame-00.svg.b64',
};

const VELOCITY_HELMET_FRAME_01 = {
  contentHash: 'cfbec8a9d8e18eea9ad13c51aee644540d2406139a7ef747b08797fd8913b85d',
  r2Key: 'assets/cfbec8a9d8e18eea9ad13c51aee64454.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1765,
  sourcePath: 'velocity-helmet-frame-01.svg.b64',
};

const VELOCITY_HELMET_FRAME_02 = {
  contentHash: '2cd746eb0983ca09a5fb3d829ffb33c3ae060af151d2779f992b3160a5effdac',
  r2Key: 'assets/2cd746eb0983ca09a5fb3d829ffb33c3.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1749,
  sourcePath: 'velocity-helmet-frame-02.svg.b64',
};

const VELOCITY_HELMET_FRAME_03 = {
  contentHash: '40e3bd9ebbbf44b2d34d5d9eb04b4d16ecc91526550b90de7aa4b0e40a88c853',
  r2Key: 'assets/40e3bd9ebbbf44b2d34d5d9eb04b4d16.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1735,
  sourcePath: 'velocity-helmet-frame-03.svg.b64',
};

const VELOCITY_HELMET_FRAME_04 = {
  contentHash: '486c57d95441f6746e1427f54b69c2fb84cad7b1d4639b979c894f06c2c64e81',
  r2Key: 'assets/486c57d95441f6746e1427f54b69c2fb.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1750,
  sourcePath: 'velocity-helmet-frame-04.svg.b64',
};

const VELOCITY_HELMET_FRAME_05 = {
  contentHash: 'eb4512615b9ff40ae3fd2103e80da9b7d1b9ff009b30beeee89d56096d16b77d',
  r2Key: 'assets/eb4512615b9ff40ae3fd2103e80da9b7.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1766,
  sourcePath: 'velocity-helmet-frame-05.svg.b64',
};

const VELOCITY_HELMET_FRAME_06 = {
  contentHash: '0a2ccf3bcf46266ca5aba71ed4bdf19c8c58be38247e919f66eaa00a4ad82830',
  r2Key: 'assets/0a2ccf3bcf46266ca5aba71ed4bdf19c.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1736,
  sourcePath: 'velocity-helmet-frame-06.svg.b64',
};

const VELOCITY_HELMET_FRAME_07 = {
  contentHash: '289101a6a8060ddab557b0a278f5fd27a05bd51fb98da55bde645eabc9d2ef8c',
  r2Key: 'assets/289101a6a8060ddab557b0a278f5fd27.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1766,
  sourcePath: 'velocity-helmet-frame-07.svg.b64',
};

const VELOCITY_HELMET_FRAME_08 = {
  contentHash: 'bb89d4ee13af78f1a427537e71ddedd3a79bcf894459d87637c1e5cc188e0eb0',
  r2Key: 'assets/bb89d4ee13af78f1a427537e71ddedd3.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1750,
  sourcePath: 'velocity-helmet-frame-08.svg.b64',
};

const VELOCITY_HELMET_FRAME_09 = {
  contentHash: '175552d6ad06a4ec891f2c94e3f7bf8b2a6ede102a1cc7e7aa6b018102734d82',
  r2Key: 'assets/175552d6ad06a4ec891f2c94e3f7bf8b.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1736,
  sourcePath: 'velocity-helmet-frame-09.svg.b64',
};

const VELOCITY_HELMET_FRAME_10 = {
  contentHash: 'a1394c646cf423f2b10c6e6cd32e87128d18fc25cb496ed365de6a41049d030e',
  r2Key: 'assets/a1394c646cf423f2b10c6e6cd32e8712.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1750,
  sourcePath: 'velocity-helmet-frame-10.svg.b64',
};

const VELOCITY_HELMET_FRAME_11 = {
  contentHash: '5d7a349625d5aacf7955158d2350723993ff81fb3b4b076a3848cc92c0a79af6',
  r2Key: 'assets/5d7a349625d5aacf7955158d23507239.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 520,
  height: 520,
  byteSize: 1766,
  sourcePath: 'velocity-helmet-frame-11.svg.b64',
};

const VELOCITY_TRACK_STUDY = {
  contentHash: 'd235ad957777752735327b8e1eff2d57b59f62ba36ac61247772c4e542e006e6',
  r2Key: 'assets/d235ad957777752735327b8e1eff2d57.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 960,
  height: 640,
  byteSize: 1060,
  sourcePath: 'velocity-track-study.svg.b64',
};

const VELOCITY_GARAGE_STUDY = {
  contentHash: 'a56a9e64dfd7df8ef059329d8402144619cfe998472f57e2ed54866a702f969f',
  r2Key: 'assets/a56a9e64dfd7df8ef059329d84021446.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 960,
  height: 640,
  byteSize: 976,
  sourcePath: 'velocity-garage-study.svg.b64',
};

const VELOCITY_SUIT_STUDY = {
  contentHash: '5afefe168f7731c1a287bc7dfec0fb360da5844959f9bc9858fbd220bf5eb2b0',
  r2Key: 'assets/5afefe168f7731c1a287bc7dfec0fb36.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 720,
  height: 960,
  byteSize: 1182,
  sourcePath: 'velocity-suit-study.svg.b64',
};

const VELOCITY_PRODUCT_STUDY = {
  contentHash: 'a14c994f83d78da5389dc7587666c91667574bca2d0eefb090df90716b74f27a',
  r2Key: 'assets/a14c994f83d78da5389dc7587666c916.svg',
  mediaType: 'image/svg+xml',
  kind: 'image' as const,
  width: 800,
  height: 800,
  byteSize: 927,
  sourcePath: 'velocity-product-study.svg.b64',
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
  'seed-portrait-placeholder': {
    ...PORTRAIT_PLACEHOLDER_SVG,
    alt: 'Stylised figure portrait placeholder',
  },
  'seed-project-thumb-neutral': {
    ...PROJECT_THUMB_NEUTRAL_SVG,
    alt: 'Neutral project thumbnail',
  },
  'seed-raydotsh-yoru': {
    ...RAYDOTSH_YORU,
    alt: 'Rehana portrait illustration from the Raydotsh portfolio source site',
  },
  'seed-raydotsh-pycaster': {
    ...RAYDOTSH_PYCASTER,
    alt: 'Pycaster project screenshot from the Raydotsh portfolio source site',
  },
  'seed-raydotsh-favicon': {
    ...RAYDOTSH_FAVICON,
    alt: 'Raydotsh source favicon',
  },
  'seed-raydotsh-book-a-little-life': {
    ...RAYDOTSH_BOOK_A_LITTLE_LIFE,
    alt: 'A Little Life book cover',
  },
  'seed-raydotsh-book-pride-and-prejudice': {
    ...RAYDOTSH_BOOK_PRIDE_AND_PREJUDICE,
    alt: 'Pride and Prejudice book cover',
  },
  'seed-raydotsh-book-dracula': {
    ...RAYDOTSH_BOOK_DRACULA,
    alt: 'Dracula book cover',
  },
  'seed-raydotsh-book-jane-eyre': {
    ...RAYDOTSH_BOOK_JANE_EYRE,
    alt: 'Jane Eyre book cover',
  },
  'seed-raydotsh-book-harry-potter': {
    ...RAYDOTSH_BOOK_HARRY_POTTER,
    alt: "Harry Potter and the Philosopher's Stone book cover",
  },
  'seed-raydotsh-book-goodnight-punpun': {
    ...RAYDOTSH_BOOK_GOODNIGHT_PUNPUN,
    alt: 'Goodnight Punpun book cover',
  },
  'seed-raydotsh-book-hunger-games': {
    ...RAYDOTSH_BOOK_HUNGER_GAMES,
    alt: 'The Hunger Games book cover',
  },
  'seed-raydotsh-book-thousand-splendid-suns': {
    ...RAYDOTSH_BOOK_THOUSAND_SPLENDID_SUNS,
    alt: 'A Thousand Splendid Suns book cover',
  },
  'seed-raydotsh-book-man-called-ove': {
    ...RAYDOTSH_BOOK_MAN_CALLED_OVE,
    alt: 'A Man Called Ove book cover',
  },
  'seed-raydotsh-book-red-trainers': {
    ...RAYDOTSH_BOOK_RED_TRAINERS,
    alt: 'She Wore Red Trainers book cover',
  },
  'seed-velocity-helmet-frame-00': {
    ...VELOCITY_HELMET_FRAME_00,
    alt: 'Abstract signal helmet frame 1 of 12',
  },
  'seed-velocity-helmet-frame-01': {
    ...VELOCITY_HELMET_FRAME_01,
    alt: 'Abstract signal helmet frame 2 of 12',
  },
  'seed-velocity-helmet-frame-02': {
    ...VELOCITY_HELMET_FRAME_02,
    alt: 'Abstract signal helmet frame 3 of 12',
  },
  'seed-velocity-helmet-frame-03': {
    ...VELOCITY_HELMET_FRAME_03,
    alt: 'Abstract signal helmet frame 4 of 12',
  },
  'seed-velocity-helmet-frame-04': {
    ...VELOCITY_HELMET_FRAME_04,
    alt: 'Abstract signal helmet frame 5 of 12',
  },
  'seed-velocity-helmet-frame-05': {
    ...VELOCITY_HELMET_FRAME_05,
    alt: 'Abstract signal helmet frame 6 of 12',
  },
  'seed-velocity-helmet-frame-06': {
    ...VELOCITY_HELMET_FRAME_06,
    alt: 'Abstract signal helmet frame 7 of 12',
  },
  'seed-velocity-helmet-frame-07': {
    ...VELOCITY_HELMET_FRAME_07,
    alt: 'Abstract signal helmet frame 8 of 12',
  },
  'seed-velocity-helmet-frame-08': {
    ...VELOCITY_HELMET_FRAME_08,
    alt: 'Abstract signal helmet frame 9 of 12',
  },
  'seed-velocity-helmet-frame-09': {
    ...VELOCITY_HELMET_FRAME_09,
    alt: 'Abstract signal helmet frame 10 of 12',
  },
  'seed-velocity-helmet-frame-10': {
    ...VELOCITY_HELMET_FRAME_10,
    alt: 'Abstract signal helmet frame 11 of 12',
  },
  'seed-velocity-helmet-frame-11': {
    ...VELOCITY_HELMET_FRAME_11,
    alt: 'Abstract signal helmet frame 12 of 12',
  },
  'seed-velocity-track-study': {
    ...VELOCITY_TRACK_STUDY,
    alt: 'Editorial track contour study with speed lines',
  },
  'seed-velocity-garage-study': {
    ...VELOCITY_GARAGE_STUDY,
    alt: 'Editorial garage workspace study with geometric forms',
  },
  'seed-velocity-suit-study': {
    ...VELOCITY_SUIT_STUDY,
    alt: 'Editorial race suit textile weave study',
  },
  'seed-velocity-product-study': {
    ...VELOCITY_PRODUCT_STUDY,
    alt: 'Editorial product macro study with signal accents',
  },
};

export const SEED_ASSET_IDS = Object.keys(SEED_ASSET_REGISTRY);

export function isSeedAssetId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(SEED_ASSET_REGISTRY, id);
}

export function getSeedAsset(id: string): SeedAsset | null {
  return Object.prototype.hasOwnProperty.call(SEED_ASSET_REGISTRY, id)
    ? SEED_ASSET_REGISTRY[id]!
    : null;
}
