// src/seo/og-resolve.ts
//
// Wishlist #21 — resolves the Open Graph image URL for a Published Page.
//
// Precedence (per plan 2026-05-23-21-seo-meta.md):
//   1. Owner-uploaded `page.ogImageAssetId` — if it resolves through the
//      provided `assetLookup` to a content hash, return `/assets/<hash>`.
//   2. Generated card from #6 — `/og/<siteId>/<pageSlug>.png`. Requires
//      `ctx.siteId` and `page.slug` to be non-empty.
//   3. None — `null`. The caller drops the `og:image` / `twitter:image` tag
//      pair when this returns null.
//
// Pure: no I/O, no DOM access. The optional `assetLookup` is the seam the
// caller fills with whatever id-or-hash resolution they have available
// (publish-time pre-resolve, snapshot-bundled hash map, or a live DB
// lookup; the smoke uses an in-memory stub).

import type { CanvasPage } from '../canvas/schema.js';

/**
 * Context passed to OG resolution. Kept identical-shaped to
 * `EmitMetaContext` (see `meta-emit.ts`) so the meta emitter can forward
 * verbatim — one place to construct, two places to consume.
 */
export interface OgResolveContext {
  /** Site id — used to compose the generator URL `/og/<siteId>/<pageSlug>.png`. */
  siteId: string;
  /** Optional id-or-hash resolver. Returns the content hash for a known asset id, else null. */
  assetLookup?: (assetId: string) => string | null;
}

/**
 * Resolve the OG image URL for a page given the resolution context.
 *
 * Returns `null` when no source resolves — the caller drops the
 * `og:image` / `twitter:image` tags entirely (per #21 Scope-in:
 * "OG image precedence: explicit > generated > none").
 */
export function resolveOgUrl(page: CanvasPage, ctx: OgResolveContext): string | null {
  // 1. Explicit asset wins.
  if (page.ogImageAssetId !== undefined && page.ogImageAssetId.length > 0) {
    const hash = ctx.assetLookup ? ctx.assetLookup(page.ogImageAssetId) : null;
    if (hash !== null && hash.length > 0) {
      return `/assets/${hash}`;
    }
    // Explicit asset id was set but did not resolve (e.g. row deleted).
    // Fall through to the generator rather than failing — matches the
    // resilient behaviour the OG route (`src/og-image/route.ts`) already
    // applies for the same scenario.
  }

  // 2. Generated card. Requires both siteId and slug to be present.
  if (ctx.siteId.length > 0 && page.slug.length > 0) {
    return `/og/${encodeURIComponent(ctx.siteId)}/${encodeURIComponent(page.slug)}.png`;
  }

  // 3. None.
  return null;
}
