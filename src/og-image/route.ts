// src/og-image/route.ts
//
// Hono router mounted at `/og` by the main thread. Exposes:
//
//   GET /:siteId/:pageSlug.png
//
// Resolution:
//   1. Load site row (published snapshot + customerId).
//   2. Find the page in the snapshot by slug. 404 if absent.
//   3. If `page.ogImageAssetId` is set, look up the ownerAsset row for the
//      content hash and redirect (302) to `/assets/<contentHash>`. The
//      Owner-provided custom image always wins.
//   4. Otherwise, read R2 at the snapshot-versioned key. Hit → stream the
//      cached PNG. Miss → render via Satori + resvg, write to R2, stream.
//
// Caching headers: `Cache-Control: public, max-age=3600`. The R2 key is
// version-bumped on every publish, so the 1-hour Cache-Control just trims
// load between publishes; a publish that bumps the version invalidates
// downstream caches by URL not by header.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createR2Client } from '../assets/r2-client.js';
import type { PublishedSnapshot, StyleKitPreset } from '../canvas/schema.js';
import { getStyleKitPreset, STYLE_KIT_PRESETS } from '../canvas/style-kits.js';
import { db, type Db } from '../db/client.js';
import { ownerAsset, site } from '../db/schema.js';
import { readCached, writeCached, OG_CONTENT_TYPE } from './cache.js';
import { renderOgCardSvg } from './render.js';
import { rasteriseSvgToPng, type RasteriseEnv } from './rasterise.js';
// @ts-expect-error Wrangler bundles .wasm as WebAssembly.Module via [[rules]] type=CompiledWasm
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';

interface Bindings {
  DATABASE_URL: string;
  ASSETS_BUCKET: R2Bucket;
}

type Env = { Bindings: Bindings };

const ogRouter = new Hono<Env>();

ogRouter.get('/:siteId/:pageSlugWithExt', async (c) => {
  const siteId = c.req.param('siteId');
  const pageSlugWithExt = c.req.param('pageSlugWithExt');
  if (!siteId || !pageSlugWithExt) {
    return c.json({ error: 'site or page not found' }, 404);
  }
  if (!pageSlugWithExt.endsWith('.png')) {
    return c.json({ error: 'expected .png suffix' }, 404);
  }
  const pageSlug = pageSlugWithExt.slice(0, -'.png'.length);
  if (pageSlug.length === 0) {
    return c.json({ error: 'page not found' }, 404);
  }

  const database = db(c.env);
  const resolved = await resolveOgRequest(database, siteId, pageSlug);
  if (resolved.status === 'not_found') {
    return c.json({ error: resolved.reason }, 404);
  }
  if (resolved.status === 'override') {
    // Owner-uploaded custom image: redirect to the content-hash asset URL.
    // The asset route already sets immutable cache headers; nothing else to
    // do here.
    return c.redirect(`/assets/${resolved.contentHash}`, 302);
  }

  const r2 = createR2Client(c.env.ASSETS_BUCKET);
  const { snapshot, page, preset, siteName } = resolved;

  const cached = await readCached(r2, siteId, pageSlug, snapshot.version);
  if (cached !== null) {
    return new Response(cached.bytes, {
      status: 200,
      headers: {
        'content-type': cached.contentType,
        'cache-control': 'public, max-age=3600',
      },
    });
  }

  const svg = await renderOgCardSvg({
    siteName,
    pageTitle: page.title,
    ...(page.description !== undefined ? { pageDescription: page.description } : {}),
    preset,
  });
  const { bytes } = await rasteriseSvgToPng(svg, { wasmModule: resvgWasmModule as WebAssembly.Module });
  await writeCached(r2, siteId, pageSlug, snapshot.version, bytes);

  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': OG_CONTENT_TYPE,
      'cache-control': 'public, max-age=3600',
    },
  });
});

// ---------------------------------------------------------------------------
// Resolution — exported so the on-publish hook can reuse the page/preset
// lookup without going through HTTP.
// ---------------------------------------------------------------------------

export interface ResolvedRender {
  status: 'render';
  snapshot: PublishedSnapshot;
  page: PublishedSnapshot['pages'][number];
  preset: StyleKitPreset;
  siteName: string;
}

export interface ResolvedOverride {
  status: 'override';
  contentHash: string;
}

export interface ResolvedNotFound {
  status: 'not_found';
  reason: string;
}

export type ResolvedOgRequest = ResolvedRender | ResolvedOverride | ResolvedNotFound;

/**
 * Resolve a (siteId, pageSlug) pair to either a "render this page" outcome
 * or an "override redirect" outcome. The OG render path and the on-publish
 * pre-render path share this function so the override-detection logic
 * stays in one place.
 */
export async function resolveOgRequest(
  database: Db,
  siteId: string,
  pageSlug: string,
): Promise<ResolvedOgRequest> {
  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      customerId: site.customerId,
      publishedSnapshot: site.publishedSnapshot,
    })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1);
  const row = rows[0];
  if (!row) return { status: 'not_found', reason: 'site not found' };
  const snapshot = row.publishedSnapshot;
  if (snapshot === null) {
    return { status: 'not_found', reason: 'site not published' };
  }
  const page = snapshot.pages.find((p) => p.slug === pageSlug);
  if (!page) return { status: 'not_found', reason: 'page not found in published snapshot' };

  // Override path — Owner has set a custom image. Look up the ownerAsset
  // row scoped to the site's customer; the content hash drives the
  // redirect target. Mismatched customer (asset id pointing at someone
  // else's row) falls through to render — the publish guard already
  // rejected that case, but we are defensive here.
  if (page.ogImageAssetId !== undefined && page.ogImageAssetId.length > 0) {
    const assetRows = await database
      .select({ contentHash: ownerAsset.contentHash })
      .from(ownerAsset)
      .where(
        and(eq(ownerAsset.id, page.ogImageAssetId), eq(ownerAsset.customerId, row.customerId)),
      )
      .limit(1);
    const assetRow = assetRows[0];
    if (assetRow) {
      return { status: 'override', contentHash: assetRow.contentHash };
    }
    // Asset missing — fall through to the rendered card. We do not throw
    // because the published snapshot already passed the publish guard;
    // surfacing as "render the default" is the least surprising visitor
    // experience.
  }

  const preset = resolveStyleKitPreset(snapshot);
  return {
    status: 'render',
    snapshot,
    page,
    preset,
    siteName: row.name,
  };
}

function resolveStyleKitPreset(snapshot: PublishedSnapshot): StyleKitPreset {
  if (snapshot.styleKit === 'custom') {
    const custom = snapshot.customStyleKit;
    if (custom === undefined) {
      // The publish path is supposed to carry `customStyleKit` when the
      // selector is `'custom'`. If it didn't, fall back loudly to a
      // built-in so the OG card still renders — but log the drift.
      console.error(
        '[og-image] published snapshot has styleKit=custom but no customStyleKit; falling back to charcoal preset',
      );
      return STYLE_KIT_PRESETS.charcoal;
    }
    return custom;
  }
  return getStyleKitPreset(snapshot.styleKit);
}

export type { RasteriseEnv };
export default ogRouter;
