// src/seo/sitemap/build.ts
//
// Wishlist #22 — sitemap.xml builder.
//
// Pure XML composition. Given a Published Snapshot and the visitor-facing
// host, returns a sitemap.org-conformant `<urlset>` document listing every
// crawlable page. Pages whose `resolveNoIndex(page, snapshot)` returns true
// — either because of per-page `noIndex` or site-level `siteNoIndex` — are
// omitted entirely. When the site switch is on, the returned `<urlset>` is
// empty (zero `<url>` children), which is the cleanest signal we can give a
// crawler that "nothing on this host is meant to be indexed."
//
// Tag inventory (per plan 2026-05-23-22-sitemap-robots.md):
//   - `<loc>`        — `<protocol>://<host>/<slug>` (or `/` for the root page).
//                      Includes a `#v=<version>` fragment so a republish busts
//                      crawler caches keyed by URL identity.
//   - `<lastmod>`    — `snapshot.publishedAt` (already ISO 8601 from publish).
//   - `<changefreq>` — constant `weekly`. The scope-out list rejects per-page
//                      owner overrides; weekly is the right default for the
//                      kind of marketing sites this POC targets.
//
// The XML is hand-rolled (no DOM library) — Cloudflare Workers bundle size
// budget is tight, and the surface here is small enough that a typed builder
// would cost more than it saves. All string values are escaped via the local
// helpers below so an Owner cannot inject XML by naming a slug `]]><evil>`.
//
// Reuse: `resolveNoIndex` is imported from `../meta-emit.ts` rather than
// re-derived — that helper is the single source of truth for "is this page
// crawlable" per Wave 3 #21, and we must agree with the renderer's
// `<meta name="robots">` decision exactly.

import type { CanvasPage, PublishedSnapshot } from '../../canvas/schema.js';
import { resolveNoIndex } from '../meta-emit.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Inputs for `buildSitemapXml`. Mirrors the shape of `EmitMetaContext` so the
 * route handler can pass the same resolved host + protocol through both
 * subsystems without repacking.
 *
 *   - `host`     : hostname (+ optional `:port`), no scheme. Comes from the
 *                  request `Host` header.
 *   - `protocol` : 'https' (default) or 'http'. Drives `<loc>` URL scheme.
 */
export interface BuildSitemapOptions {
  host: string;
  protocol?: 'https' | 'http';
}

// ---------------------------------------------------------------------------
// XML escapers — local to this module.
// ---------------------------------------------------------------------------

// Sitemap `<loc>` is element-text content. Escape `& < >` (plus quotes for
// belt-and-braces — they are not strictly required inside text content but a
// crawler walking the DOM may carry them through into attribute contexts).
const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function escapeXmlText(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch] ?? ch);
}

// ---------------------------------------------------------------------------
// URL composition
// ---------------------------------------------------------------------------

/**
 * Build the `<loc>` URL for a page. Root page (`slug === ''` or `'/'`) emits
 * a bare scheme://host/ URL; everything else is scheme://host/<slug>.
 *
 * The snapshot version is appended as a `#v=<n>` fragment. Fragments are not
 * normally significant for search-engine indexing of HTML pages, but they
 * make the URL identity unique per snapshot — caches keyed on the full URL
 * (e.g. Cloudflare's edge cache for the sitemap.xml itself) bust cleanly on
 * republish without needing a separate purge call. Crawlers strip the
 * fragment before fetching the underlying page, so the visitor still hits
 * the same canonical URL.
 */
function buildPageLoc(
  page: CanvasPage,
  host: string,
  protocol: 'https' | 'http',
  version: number,
): string {
  // Empty slug ('home' equivalent) → root URL.
  const slugPath = page.slug.length > 0 ? `/${page.slug}` : '/';
  return `${protocol}://${host}${slugPath}#v=${String(version)}`;
}

// ---------------------------------------------------------------------------
// buildSitemapXml
// ---------------------------------------------------------------------------

/**
 * Build the sitemap.xml document for a Published Snapshot. Returns the full
 * XML payload, ready to ship as `application/xml`.
 *
 * Determinism: same snapshot + host + protocol → same XML bytes (modulo the
 * order pages are stored in the snapshot, which the publish path freezes).
 *
 * Filtering: pages flagged `noIndex` at either the page or site level are
 * omitted. A site-level `siteNoIndex` produces an empty `<urlset>` — see the
 * module banner for the rationale.
 */
export function buildSitemapXml(
  snapshot: PublishedSnapshot,
  opts: BuildSitemapOptions,
): string {
  const protocol = opts.protocol ?? 'https';
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">`);

  const lastmod = escapeXmlText(snapshot.publishedAt);

  for (const page of snapshot.pages) {
    // Per-page filter: drop noindex pages. The helper considers both the
    // page-level flag and the site-level switch.
    if (resolveNoIndex(page, snapshot)) continue;

    const loc = escapeXmlText(buildPageLoc(page, opts.host, protocol, snapshot.version));
    lines.push(`  <url>`);
    lines.push(`    <loc>${loc}</loc>`);
    lines.push(`    <lastmod>${lastmod}</lastmod>`);
    lines.push(`    <changefreq>weekly</changefreq>`);
    lines.push(`  </url>`);
  }

  lines.push(`</urlset>`);
  // Trailing newline so editors / curl render the document tidily.
  return lines.join('\n') + '\n';
}
