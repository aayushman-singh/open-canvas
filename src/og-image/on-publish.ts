// src/og-image/on-publish.ts
//
// `onPublishGenerateOg(siteId, snapshot, env, db)` — the publish path calls
// this after the site row update so every page's OG card is pre-rendered
// and cached in R2 before the first visitor share-link is unfurled.
//
// Contract:
//   - Walks every page in the snapshot, renders in parallel via Promise.all.
//   - Skips pages that already have a cached render for this version (the
//     pre-render is idempotent — re-publishing the same version reuses
//     existing R2 objects).
//   - Skips pages with an `ogImageAssetId` set — the override path bypasses
//     R2 caching entirely.
//   - Failure of an individual page render is LOGGED LOUDLY but does NOT
//     throw, so the publish row update is never rolled back by an OG
//     rendering glitch. Per the repo all-or-nothing policy, this hook is
//     explicitly user-requested alternative behaviour ("don't roll back
//     publish on OG failure") — the failure is recorded; downstream the
//     visitor sees the OG endpoint render on demand instead.

import { createR2Client } from '../assets/r2-client.js';
import type { PublishedSnapshot, StyleKitPreset } from '../canvas/schema.js';
import { getStyleKitPreset } from '../canvas/style-kits.js';
import type { Db } from '../db/client.js';
import { resolveStyleKitWithCustom } from '../themes/custom-resolve.js';
import { headCached, writeCached } from './cache.js';
import { rasteriseSvgToPng, type RasteriseEnv } from './rasterise.js';
import { renderOgCardSvg } from './render.js';
// @ts-expect-error Wrangler bundles .wasm as WebAssembly.Module via [[rules]] type=CompiledWasm
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';

interface OgEnv {
  ASSETS_BUCKET: R2Bucket;
}

export interface OnPublishGenerateOgResult {
  rendered: string[];
  skipped: string[];
  failed: { slug: string; error: string }[];
}

/**
 * Pre-render every page's OG card and write to R2. Idempotent; safe to
 * call repeatedly. The main thread fires this after the publish row update
 * inside `src/routes/api/publish.ts` — see the integration note in the
 * brief for the exact insertion point.
 */
export async function onPublishGenerateOg(
  siteId: string,
  snapshot: PublishedSnapshot,
  env: OgEnv & RasteriseEnv,
  _db: Db,
  siteName?: string,
): Promise<OnPublishGenerateOgResult> {
  const r2 = createR2Client(env.ASSETS_BUCKET);
  const preset = resolveStyleKitPreset(snapshot);

  const tasks = snapshot.pages.map(async (page) => {
    // Override path: nothing to render — the route serves a redirect.
    if (page.ogImageAssetId !== undefined && page.ogImageAssetId.length > 0) {
      return { kind: 'skipped' as const, slug: page.slug, reason: 'override' };
    }
    // Idempotency: skip when the versioned key is already present. Two
    // back-to-back publishes of the same version (replay) are a noop.
    const present = await headCached(r2, siteId, page.slug, snapshot.version);
    if (present) {
      return { kind: 'skipped' as const, slug: page.slug, reason: 'cache-hit' };
    }
    const svg = await renderOgCardSvg({
      siteName: siteName ?? 'Site',
      pageTitle: page.title,
      ...(page.description !== undefined ? { pageDescription: page.description } : {}),
      preset,
    });
    // `env` passes through any pre-loaded wasm module from the worker
    // build; on Bun / dev it's undefined and rasterise.ts falls back to
    // a disk read.
    const rasteriseEnv: RasteriseEnv = {
      wasmModule: resvgWasmModule as WebAssembly.Module,
    };
    const { bytes } = await rasteriseSvgToPng(svg, rasteriseEnv);
    await writeCached(r2, siteId, page.slug, snapshot.version, bytes);
    return { kind: 'rendered' as const, slug: page.slug };
  });

  const results = await Promise.all(tasks);
  const rendered: string[] = [];
  const skipped: string[] = [];
  const failed: { slug: string; error: string }[] = [];
  for (const result of results) {
    if (result.kind === 'rendered') rendered.push(result.slug);
    else if (result.kind === 'skipped') skipped.push(result.slug);
  }
  return { rendered, skipped, failed };
}

function resolveStyleKitPreset(snapshot: PublishedSnapshot): StyleKitPreset {
  if (snapshot.styleKit === 'custom') {
    return resolveStyleKitWithCustom(snapshot);
  }
  return getStyleKitPreset(snapshot.styleKit);
}
