// src/routes/api/canvas-assets-404-cache.smoke.ts
//
// Source-level smoke pinning the cold-load 404-cache invariant for the
// owner-gated asset preview route.
//
// WHY this smoke exists
// ---------------------
// `GET /api/canvas/sites/:siteId/assets/:assetId` is the editor's preview
// route for owner-uploaded media. When the editable_state references an
// assetId that doesn't resolve (legacy raw seed-ids that pre-date the
// `prepareSeedAssetsForCustomer` materialiser, or assets the Owner has
// since deleted), the route returns a 404. Without an explicit
// Cache-Control on that 404, the browser re-hits Neon on EVERY render
// cycle that emits the same `<img src>` — a single non-resolving seed
// reference repeated across 6 sections (per the portfolio fixture)
// produces 6 cold-Neon SELECT round trips on every page refresh.
//
// `private, max-age=60` lets the browser coalesce those repeat hits for
// a minute. `private` because the route is owner-gated — a 404 for one
// Owner must never be served from cache to a different Owner. 60s is
// short enough that a re-upload to fix the broken reference shows up
// without a hard refresh, long enough to flatten the cold-load burst.
//
// Why a SOURCE-level grep, not a runtime test
// -------------------------------------------
// The route handler is DB-backed; standing up a full Hono `.request()`
// harness with a stubbed Drizzle client + R2 mock here would couple this
// smoke to internals that other smokes (assets:smoke) already exercise.
// The invariant we care about is "every 404 exit path on the asset GET
// handler carries the cache header" — that's a textual property of the
// route body, the same shape canvas-state-gate.smoke.ts uses for the
// write boundary.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[canvas-assets-404-cache:smoke] ${message}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const canvasSource = readFileSync(join(here, 'canvas.ts'), 'utf8');

// The helper holds the cache header in one place so the route body can't
// drift from the 60s contract by accident — pin the header value at the
// source so a careless edit (e.g. dropping the `private` directive) trips
// the smoke instead of silently leaking 404s into shared caches.
assert(
  canvasSource.includes("'private, max-age=60'"),
  'expected canvas.ts to define the 404 Cache-Control header as `private, max-age=60`',
);
assert(
  canvasSource.includes('ASSET_NOT_FOUND_CACHE_CONTROL'),
  'expected canvas.ts to expose the cache header via a named constant so route handlers cannot fork the value',
);
assert(
  canvasSource.includes('function assetNotFoundResponse('),
  'expected canvas.ts to centralize the 404 response in `assetNotFoundResponse` so every 404 exit carries the cache header',
);

// Locate the asset GET handler body and assert every 404 path goes
// through `assetNotFoundResponse`. The `assetId` 404s (3 of them) must
// all route through the helper; the `siteId` 404 (auth gate) stays as
// a raw `c.json(..., 404)` because that's a permission-denied surface,
// not an asset-missing surface — caching that 404 would hide a granted
// permission until the TTL expired.
const assetGetMarker = "canvasApi.get('/sites/:siteId/assets/:assetId'";
const assetGetStart = canvasSource.indexOf(assetGetMarker);
assert(assetGetStart >= 0, `expected canvas.ts to mount ${assetGetMarker}`);
const nextRoute = canvasSource.indexOf('\ncanvasApi.', assetGetStart + assetGetMarker.length);
const assetGetBody =
  nextRoute >= 0 ? canvasSource.slice(assetGetStart, nextRoute) : canvasSource.slice(assetGetStart);

// Asset-missing 404 paths in the handler body:
//   1. row === undefined after the SELECT (no row matched the Owner)
//   2. readOwnerAsset() returns null (row matched but R2 had no bytes)
//   3. readOwnerAsset() threw (R2 transport / Drizzle shim crashed)
const helperHits = assetGetBody.match(/assetNotFoundResponse\(c\)/g) ?? [];
assert(
  helperHits.length === 3,
  `expected exactly 3 asset-missing 404 paths to route through assetNotFoundResponse(c) but found ${String(helperHits.length)}`,
);

// Pin that no asset-missing 404 sneaks back to raw c.json — easy to
// regress if someone adds a new failure mode and reaches for the
// nearest 404 idiom.
const rawAssetNotFound = assetGetBody.match(/c\.json\(\s*\{\s*error:\s*'asset not found'\s*\}\s*,\s*404\s*\)/g);
assert(
  rawAssetNotFound === null,
  'asset GET handler must not return `c.json({ error: "asset not found" }, 404)` directly; route through assetNotFoundResponse so the cache header stays attached',
);

console.log('[canvas-assets-404-cache:smoke] OK');
