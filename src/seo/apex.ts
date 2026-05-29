// src/seo/apex.ts
//
// Apex-host SEO surface: sitemap.xml, robots.txt, and the OG card for the
// marketing landing page (src/landing/index.tsx).
//
// Why a separate module: the published-site SEO router in
// `src/seo/sitemap/route.ts` resolves the request host to a site row in the
// DB and serves per-site content. The apex (`APP_DOMAIN`) has no site row —
// it is the product's brand page — so it needs its own static handlers. We
// mount this router at `/` BEFORE the published-site router so apex requests
// match here; subdomain / custom-domain requests fall through via `next()`.
//
// Host gate: each handler checks `isApexHost(env, requestHost)`. The check
// allows the configured apex AND local-dev hosts (`localhost` / `127.0.0.1`)
// so the surface is exercisable under `wrangler dev`. Canonical URLs always
// use the production apex via `appOrigin(env)`; dev never appears in
// crawler-visible bytes.
//
// OG image: the marketing card reuses `renderOgCardSvg` + `rasteriseSvgToPng`
// — the same satori/resvg pipeline the published-site OG route uses —
// fed a constant (siteName, headline, description, preset) tuple. The bytes
// are cached in R2 at a static key (`og/apex/landing.v1.png`); bump the
// version suffix when any input changes. Cache-Control is 1 hour, matching
// the published-site OG route, so Cloudflare's edge cache absorbs the
// post-deploy traffic.

import { Hono } from 'hono';
import { createR2Client, type R2Client } from '../assets/r2-client.js';
import { STYLE_KIT_PRESETS } from '../canvas/style-kits.js';
import { appDomain, appOrigin, type HostConfigEnv } from '../host-config.js';
import { OG_CONTENT_TYPE } from '../og-image/cache.js';
import { rasteriseSvgToPng, type RasteriseEnv } from '../og-image/rasterise.js';
import { renderOgCardSvg } from '../og-image/render.js';
// @ts-expect-error Wrangler bundles .wasm as WebAssembly.Module via [[rules]] type=CompiledWasm
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

type Bindings = HostConfigEnv & {
  ASSETS_BUCKET: R2Bucket;
};

type Env = { Bindings: Bindings };

// ---------------------------------------------------------------------------
// Apex brand constants. Update this block when the marketing copy changes;
// then bump APEX_OG_VERSION so the R2 cache key shifts and the next request
// re-renders.
// ---------------------------------------------------------------------------

export const APEX_OG_SITE_NAME = 'Open Canvas';
export const APEX_OG_HEADLINE = 'Build your site, together';
export const APEX_OG_DESCRIPTION =
  'Drag things where you want them. Ask the built-in assistant. Hit publish and it is live — no code, no plugins.';
const APEX_OG_VERSION = 1;
const APEX_OG_R2_KEY = `og/apex/landing.v${String(APEX_OG_VERSION)}.png`;

const CACHE_CONTROL_PUBLIC_1H = 'public, max-age=3600';
const CACHE_CONTROL_PUBLIC_1D = 'public, max-age=86400';

// ---------------------------------------------------------------------------
// Host gate
// ---------------------------------------------------------------------------

/**
 * True when the request host is the configured apex OR a local-dev host
 * (`localhost` / `127.0.0.1` with any port). Apex SEO handlers serve only on
 * matching hosts; subdomain / custom-domain requests fall through to the
 * published-site router. Comparison is case-insensitive on the hostname
 * portion to match RFC-1035.
 */
export function isApexHost(env: HostConfigEnv, host: string): boolean {
  const hostLower = host.toLowerCase();
  if (hostLower === appDomain(env)) return true;
  const hostNoPort = hostLower.split(':', 1)[0] ?? hostLower;
  if (hostNoPort === 'localhost' || hostNoPort === '127.0.0.1') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Pure builders — exported so the smoke can exercise them without DB / R2.
// ---------------------------------------------------------------------------

/**
 * Build the apex sitemap.xml body. One URL — `/` — because the apex is the
 * single-page marketing surface. `/auth` is omitted intentionally (it is a
 * functional sign-in page, not marketing content); `/dashboard` is omitted
 * because it is gated.
 *
 * `origin` is the absolute scheme+host (`https://opencanvas.aayushman.dev`),
 * with no trailing slash; the helper appends the path.
 */
export function buildApexSitemapXml(origin: string, lastmod: string): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">`);
  lines.push(`  <url>`);
  lines.push(`    <loc>${origin}/</loc>`);
  lines.push(`    <lastmod>${lastmod}</lastmod>`);
  lines.push(`    <changefreq>monthly</changefreq>`);
  lines.push(`    <priority>1.0</priority>`);
  lines.push(`  </url>`);
  lines.push(`</urlset>`);
  return lines.join('\n') + '\n';
}

/**
 * Build the apex robots.txt body. Allows root-path crawling and explicitly
 * blocks every back-of-house path on the apex (API surface, dashboard,
 * live-socket, on-site editor) — these are auth-gated but explicit Disallow
 * is a stronger signal to crawlers than "you'll get redirected anyway."
 */
export function buildApexRobotsTxt(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /__api/',
    'Disallow: /__rev01/',
    'Disallow: /__live/',
    'Disallow: /__invite/',
    'Disallow: /dashboard/',
    'Disallow: /og/',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Apex OG image — cache-through-R2 wrapper around the satori card renderer.
// ---------------------------------------------------------------------------

async function readApexOgCached(r2: R2Client): Promise<Uint8Array | null> {
  const obj = await r2.get(APEX_OG_R2_KEY);
  if (obj === null) return null;
  const buf = await obj.arrayBuffer();
  return new Uint8Array(buf);
}

async function writeApexOgCached(r2: R2Client, bytes: Uint8Array): Promise<void> {
  await r2.put(APEX_OG_R2_KEY, bytes, OG_CONTENT_TYPE);
}

/**
 * Render the apex OG card. Reads from R2 first; on miss, runs satori + resvg,
 * writes the bytes back, returns them. The render inputs are constant per
 * deploy (siteName / headline / description / preset), so a single cached
 * blob serves every request until APEX_OG_VERSION is bumped.
 */
export async function renderApexOgPng(env: Bindings & RasteriseEnv): Promise<Uint8Array> {
  const r2 = createR2Client(env.ASSETS_BUCKET);
  const cached = await readApexOgCached(r2);
  if (cached !== null) return cached;

  const svg = await renderOgCardSvg({
    siteName: APEX_OG_SITE_NAME,
    pageTitle: APEX_OG_HEADLINE,
    pageDescription: APEX_OG_DESCRIPTION,
    preset: STYLE_KIT_PRESETS.charcoal,
  });
  const { bytes } = await rasteriseSvgToPng(svg, {
    wasmModule: resvgWasmModule as WebAssembly.Module,
  });
  await writeApexOgCached(r2, bytes);
  return bytes;
}

// ---------------------------------------------------------------------------
// Hono router
// ---------------------------------------------------------------------------

const apex = new Hono<Env>();

apex.get('/sitemap.xml', async (c, next) => {
  const requestUrl = new URL(c.req.url);
  if (!isApexHost(c.env, requestUrl.host)) {
    return next();
  }
  // Canonical URLs always reference the production apex — even in dev — so
  // crawler-visible URLs never leak a localhost origin.
  const origin = appOrigin(c.env);
  // `lastmod` is the day of the deploy; we don't have a build-time stamp in
  // the worker bundle, so we use the request date floored to the day. That
  // keeps the value stable enough that crawlers don't re-fetch on every poll.
  const lastmod = new Date().toISOString().slice(0, 10);
  const xml = buildApexSitemapXml(origin, lastmod);
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': CACHE_CONTROL_PUBLIC_1H,
    },
  });
});

apex.get('/robots.txt', async (c, next) => {
  const requestUrl = new URL(c.req.url);
  if (!isApexHost(c.env, requestUrl.host)) {
    return next();
  }
  const origin = appOrigin(c.env);
  const body = buildApexRobotsTxt(origin);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': CACHE_CONTROL_PUBLIC_1H,
    },
  });
});

apex.get('/og-card.png', async (c, next) => {
  const requestUrl = new URL(c.req.url);
  if (!isApexHost(c.env, requestUrl.host)) {
    return next();
  }
  const bytes = await renderApexOgPng(c.env);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': OG_CONTENT_TYPE,
      // 1 day at the edge — apex OG bytes are immutable per APEX_OG_VERSION,
      // so we lean harder on the cache than per-site OGs (which republish).
      'Cache-Control': CACHE_CONTROL_PUBLIC_1D,
    },
  });
});

export default apex;
