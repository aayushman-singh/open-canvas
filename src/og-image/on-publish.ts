// src/og-image/on-publish.ts
//
// `onPublishGenerateOg(siteId, snapshot, env, db)` — the publish path calls
// this before the site row update so every page's OG card is pre-rendered
// and cached in R2 before the first visitor share-link is unfurled.
//
// Two-tier cache:
//   - Per-page render inputs (siteName, page title/description, first section,
//     style preset, page width) hash into a SHA-256 content hash. Memoed PNGs
//     live at `og/c/{hash}.png` (see cache.ts) and are shared across sites.
//   - The OG-serving route still reads by `og/{siteId}/{slug}.v{version}.png`
//     so on a content-hash hit we copy the memoed bytes into the version key
//     and skip Satori+resvg. On a content-hash miss we render + write both
//     keys atomically (per-page parallel).
//
// Failure posture: rendering or writing failures throw through Promise.all.
// The publish route treats this as a pre-commit failure, so the published row
// does not move and the Owner sees an explicit publish error.

import { sha256Hex } from '../assets/hash.js';
import { createR2Client } from '../assets/r2-client.js';
import type { PublishedSnapshot, StyleKitPreset } from '../canvas/schema.js';
import { getStyleKitPreset } from '../canvas/style-kits.js';
import type { Db } from '../db/client.js';
import { resolveStyleKitWithCustom } from '../themes/custom-resolve.js';
import {
  contentCacheKeyFor,
  headCached,
  readContentCached,
  writeCached,
  writeContentCached,
} from './cache.js';
import { rasteriseSvgToPng, type RasteriseEnv } from './rasterise.js';
import { renderOgCardSvg, renderOgFromSectionSvg } from './render.js';
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

type Page = PublishedSnapshot['pages'][number];
type Section = Page['sections'][number];

interface CardHashInput {
  readonly variant: 'card';
  readonly siteName: string;
  readonly pageTitle: string;
  readonly pageDescription: string | null;
  readonly preset: StyleKitPreset;
}

interface SectionHashInput {
  readonly variant: 'section';
  readonly section: Section;
  readonly pageWidth: number;
  readonly preset: StyleKitPreset;
}

type OgHashInput = CardHashInput | SectionHashInput;

/**
 * Deterministic hash of every input that affects the rendered SVG bytes. A
 * republish that does not change any of these inputs produces the same hash;
 * the on-publish hook then takes the memo-hit path.
 *
 * V8 preserves insertion order for non-numeric string keys, so a literal
 * object spelled in a fixed order serialises stably under JSON.stringify.
 */
async function computeOgContentHash(input: OgHashInput): Promise<string> {
  const payload =
    input.variant === 'card'
      ? JSON.stringify({
          v: 'card-1',
          siteName: input.siteName,
          pageTitle: input.pageTitle,
          pageDescription: input.pageDescription,
          preset: input.preset,
        })
      : JSON.stringify({
          v: 'section-1',
          section: input.section,
          pageWidth: input.pageWidth,
          preset: input.preset,
        });
  const digest = await sha256Hex(new TextEncoder().encode(payload));
  // 32 hex chars (16 bytes) is the same width contentHashToR2Key uses for the
  // assets pipeline — plenty of collision resistance and shorter R2 keys.
  return digest.slice(0, 32);
}

function ogHashInputFor(page: Page, preset: StyleKitPreset, siteName: string): OgHashInput {
  const firstSection = page.sections[0];
  if (firstSection && firstSection.elements.length > 0) {
    return {
      variant: 'section',
      section: firstSection,
      pageWidth: page.width,
      preset,
    };
  }
  return {
    variant: 'card',
    siteName,
    pageTitle: page.title,
    pageDescription: page.description ?? null,
    preset,
  };
}

/**
 * Pre-render every page's OG card and write to R2. Idempotent; safe to
 * call repeatedly. The publish route calls this before updating the published
 * row so failures stop the publish rather than silently deferring OG state.
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
  const resolvedSiteName = siteName ?? 'Site';

  const tasks = snapshot.pages.map(async (page) => {
    // Override path: nothing to render — the route serves a redirect.
    if (page.ogImageAssetId !== undefined && page.ogImageAssetId.length > 0) {
      console.log('[og-page] skip:override', JSON.stringify({ siteId, slug: page.slug }));
      return { kind: 'skipped' as const, slug: page.slug, reason: 'override' };
    }

    // Version-keyed idempotency: a re-fire against an already-published
    // version (replay; defensive against double-fire from the deferred
    // executor) is a no-op.
    const versionHeadStart = performance.now();
    const versionPresent = await headCached(r2, siteId, page.slug, snapshot.version);
    const versionHeadMs = Math.round((performance.now() - versionHeadStart) * 100) / 100;
    if (versionPresent) {
      console.log(
        '[og-page] skip:version-replay',
        JSON.stringify({ siteId, slug: page.slug, version: snapshot.version, versionHeadMs }),
      );
      return { kind: 'skipped' as const, slug: page.slug, reason: 'version-replay' };
    }

    const hashInput = ogHashInputFor(page, preset, resolvedSiteName);
    const hashStart = performance.now();
    const contentHash = await computeOgContentHash(hashInput);
    const hashMs = Math.round((performance.now() - hashStart) * 100) / 100;

    // Content-hash memo lookup. A republish with identical inputs hits the
    // memo and skips Satori+resvg — the expensive CPU stretch under
    // concurrent isolate load.
    const memoStart = performance.now();
    const memo = await readContentCached(r2, contentHash);
    const memoMs = Math.round((performance.now() - memoStart) * 100) / 100;
    if (memo !== null) {
      const writeStart = performance.now();
      await writeCached(r2, siteId, page.slug, snapshot.version, memo.bytes);
      const writeMs = Math.round((performance.now() - writeStart) * 100) / 100;
      console.log(
        '[og-page] memo-hit',
        JSON.stringify({
          siteId,
          slug: page.slug,
          contentHash,
          contentKey: contentCacheKeyFor(contentHash),
          variant: hashInput.variant,
          pngBytes: memo.bytes.length,
          hashMs,
          memoMs,
          writeMs,
        }),
      );
      return { kind: 'rendered' as const, slug: page.slug, reason: 'memo-hit' };
    }

    const svgStart = performance.now();
    let svg: string;
    if (hashInput.variant === 'section') {
      svg = await renderOgFromSectionSvg({
        section: hashInput.section,
        pageWidth: hashInput.pageWidth,
        preset,
      });
    } else {
      svg = await renderOgCardSvg({
        siteName: hashInput.siteName,
        pageTitle: hashInput.pageTitle,
        ...(hashInput.pageDescription !== null
          ? { pageDescription: hashInput.pageDescription }
          : {}),
        preset,
      });
    }
    const svgMs = Math.round((performance.now() - svgStart) * 100) / 100;
    // `env` passes through any pre-loaded wasm module from the worker
    // build; on Bun / dev it's undefined and rasterise.ts falls back to
    // a disk read.
    const rasteriseEnv: RasteriseEnv = {
      wasmModule: resvgWasmModule as WebAssembly.Module,
    };
    const rasterStart = performance.now();
    const { bytes } = await rasteriseSvgToPng(svg, rasteriseEnv);
    const rasterMs = Math.round((performance.now() - rasterStart) * 100) / 100;
    // Parallel writes to BOTH keys: the version-keyed object the OG-serving
    // route reads, and the content-hash memo a future republish can hit.
    const writeStart = performance.now();
    await Promise.all([
      writeCached(r2, siteId, page.slug, snapshot.version, bytes),
      writeContentCached(r2, contentHash, bytes),
    ]);
    const writeMs = Math.round((performance.now() - writeStart) * 100) / 100;
    console.log(
      '[og-page] rendered',
      JSON.stringify({
        siteId,
        slug: page.slug,
        contentHash,
        variant: hashInput.variant,
        sectionElements: hashInput.variant === 'section' ? hashInput.section.elements.length : 0,
        svgBytes: svg.length,
        pngBytes: bytes.length,
        hashMs,
        memoMs,
        svgMs,
        rasterMs,
        writeMs,
      }),
    );
    return { kind: 'rendered' as const, slug: page.slug, reason: 'rendered' };
  });

  const tasksStart = performance.now();
  const results = await Promise.all(tasks);
  console.log(
    '[og-publish] all-pages-done',
    JSON.stringify({
      siteId,
      pages: snapshot.pages.length,
      totalMs: Math.round((performance.now() - tasksStart) * 100) / 100,
    }),
  );
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
