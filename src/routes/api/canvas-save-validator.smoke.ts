// src/routes/api/canvas-save-validator.smoke.ts
//
// Regression for the live "save broken" bug fixed by
// `fix(api): save validator uses same seed-id fallback as read path`.
//
// PUT `/api/canvas/sites/:siteId` was rejecting any editable state that
// still referenced a bare seed id (`seed-project-thumb-neutral`) even
// when the customer had the deduped `seed-{customerId}-{seedId}` row
// because the validator checked `owner_asset.id IN (...)` and the bare
// id never matched. PR #18 had taught the GET read endpoint to look up
// the row by `content_hash` for known seed ids, but the save path was
// never updated, so the seam reopened every time the editor PUT a
// state containing a legacy reference.
//
// This smoke pins the two slices the fix relies on:
//
//   1. `mapRowsWithSeedFallback` post-fetch mapping — given a row keyed
//      by the SEED's content hash (the materialised row, whatever its
//      id), the returned AssetKindRow is keyed by the bare seed id so
//      `findAssetReferenceErrors` reports no "missing" reason.
//   2. `findAssetReferenceErrors` end-to-end against an EditableSite
//      that references a bare seed id — the validator must report
//      no errors when the fallback row is present, and must continue
//      to report "missing" when no row resolves the reference.
//
// The route-layer wiring (canvas.ts PUT handler calls the helper) is
// covered by a source-level grep at the bottom so a regression in the
// canvas.ts edit is loud.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mapRowsWithSeedFallback } from '../../assets/seed-id-fallback.js';
import { findAssetReferenceErrors } from '../../assets/site-assets.js';
import type { EditableSite } from '../../canvas/schema.js';
import { SEED_ASSET_REGISTRY } from '../../canvas/seed-assets.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[canvas-save-validator:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// 1) mapRowsWithSeedFallback — bare seed id maps onto content-hash row.
// ---------------------------------------------------------------------------

const seedId = 'seed-project-thumb-neutral';
const seed = SEED_ASSET_REGISTRY[seedId];
assert(seed !== undefined, 'expected seed-project-thumb-neutral in registry');
const materializedId = `seed-customer-a-${seedId}`;

const mapped = mapRowsWithSeedFallback(
  [{ id: materializedId, kind: 'image', contentHash: seed.contentHash }],
  [seedId],
  'customer-a',
);
assert(
  mapped.length === 1 && mapped[0]?.id === seedId && mapped[0]?.kind === 'image',
  'fallback row keyed by content_hash must surface as the requested bare seed id',
);

// Direct id hit must also work and take precedence over the seed branch.
const direct = mapRowsWithSeedFallback(
  [{ id: materializedId, kind: 'image', contentHash: seed.contentHash }],
  [materializedId],
  'customer-a',
);
assert(
  direct.length === 1 && direct[0]?.id === materializedId,
  'direct id match must be returned unchanged',
);

// No row, no seed registry entry → omitted (validator's missing branch fires).
const missingUnknown = mapRowsWithSeedFallback([], ['totally-not-a-seed-id'], 'customer-a');
assert(missingUnknown.length === 0, 'unknown id with no row must be omitted');

// Seed id, but the customer has no content-hash row → omitted.
const missingSeed = mapRowsWithSeedFallback([], [seedId], 'customer-a');
assert(
  missingSeed.length === 0,
  'seed id with no content-hash row must be omitted so validator surfaces it as missing',
);

// Empty input still returns []. (Helper's hot-path bail-out.)
const empty = mapRowsWithSeedFallback([], [], 'customer-a');
assert(empty.length === 0, 'empty requestedIds must short-circuit to []');

// ---------------------------------------------------------------------------
// 2) findAssetReferenceErrors end-to-end — validator over a real
//    EditableSite shape referencing the bare seed id.
// ---------------------------------------------------------------------------

function makeSiteWithSeedReference(assetId: string): EditableSite {
  return {
    pages: [
      {
        id: 'page-1',
        slug: '/',
        title: 'Home',
        sections: [
          {
            id: 'section-1',
            role: 'body',
            elements: [
              {
                id: 'media-1',
                type: 'media',
                mediaKind: 'image',
                assetId,
                x: 0,
                y: 0,
                width: 480,
                height: 640,
              },
            ],
          },
        ],
      },
    ],
  } as unknown as EditableSite;
}

const stateWithBareSeed = makeSiteWithSeedReference(seedId);

// Positive: legacy state + fallback present → no errors.
const presentRows = mapRowsWithSeedFallback(
  [{ id: materializedId, kind: 'image', contentHash: seed.contentHash }],
  [seedId],
  'customer-a',
);
const errsAccepted = findAssetReferenceErrors(stateWithBareSeed, presentRows);
assert(
  errsAccepted.length === 0,
  `expected no reference errors when the fallback row resolves the bare seed id, got ${JSON.stringify(errsAccepted)}`,
);

// Negative: legacy state but no fallback row → validator still rejects.
const errsRejected = findAssetReferenceErrors(stateWithBareSeed, []);
assert(
  errsRejected.length === 1 && errsRejected[0]?.reason === 'missing',
  'validator must keep rejecting bare seed refs when no fallback row exists',
);
assert(
  errsRejected[0]?.assetId === seedId,
  'rejection must surface the bare seed id, not a materialised one',
);

// Negative: kind mismatch is preserved — fallback row of the wrong kind
// still fails validation even though "missing" is satisfied.
const mismatchRows = mapRowsWithSeedFallback(
  [{ id: materializedId, kind: 'video', contentHash: seed.contentHash }],
  [seedId],
  'customer-a',
);
const errsMismatch = findAssetReferenceErrors(stateWithBareSeed, mismatchRows);
assert(
  errsMismatch.length === 1 && errsMismatch[0]?.reason === 'kind-mismatch',
  'kind-mismatch surfaces even when the fallback resolves the id',
);

// ---------------------------------------------------------------------------
// 3) Route-layer wiring — the PUT handler in canvas.ts must call the
//    shared helper, not the legacy `inArray(ownerAsset.id, ...)` direct
//    lookup. A grep on canvas.ts pins both directions.
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const canvasSource = readFileSync(join(here, 'canvas.ts'), 'utf8');

assert(
  canvasSource.includes("from '../../assets/seed-id-fallback'"),
  'canvas.ts must import the seed-id fallback helper',
);
assert(
  canvasSource.includes('loadAssetKindsWithSeedFallback('),
  'canvas.ts PUT handler must call loadAssetKindsWithSeedFallback before findAssetReferenceErrors',
);
assert(
  canvasSource.includes('resolveAssetRowForCustomer('),
  'canvas.ts GET /assets/:assetId handler must go through resolveAssetRowForCustomer so the read path stays in lockstep with the validator',
);
// The PUT handler must no longer do the raw inArray lookup the old code
// used — that's how the bug went live in the first place.
const putHandlerStart = canvasSource.indexOf("canvasApi.put('/sites/:siteId'");
assert(putHandlerStart >= 0, 'expected canvas.ts to define the PUT /sites/:siteId handler');
const nextRoute = canvasSource.indexOf('\ncanvasApi.', putHandlerStart + 1);
const putHandler =
  nextRoute >= 0
    ? canvasSource.slice(putHandlerStart, nextRoute)
    : canvasSource.slice(putHandlerStart);
assert(
  !/\.select\s*\(\s*\{\s*id:\s*ownerAsset\.id/.test(putHandler),
  'PUT /sites/:siteId must not run a raw owner_asset SELECT — go through loadAssetKindsWithSeedFallback',
);

console.log('[canvas-save-validator:smoke] OK');
