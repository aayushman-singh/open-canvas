// src/seo/og-resolve.ts
//
// Resolves the Open Graph image URL for a Published Page.
//
// Precedence:
//   1. Owner-uploaded `page.ogImageAssetId` — if it resolves through the
//      provided `assetLookup` to a content hash, return `/assets/<hash>`.
//      Without an assetLookup (the public renderer path), return
//      `/assets/<assetId>` and let the public asset route enforce snapshot
//      reachability. If a provided lookup cannot resolve the explicit id,
//      throw loudly instead of hiding the broken explicit choice.
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
    if (!ctx.assetLookup) {
      return `/assets/${encodeURIComponent(page.ogImageAssetId)}`;
    }
    const hash = ctx.assetLookup(page.ogImageAssetId);
    if (hash !== null && hash.length > 0) {
      return `/assets/${hash}`;
    }
    throw new Error(`resolveOgUrl: ogImageAssetId ${page.ogImageAssetId} did not resolve`);
  }

  // 2. Generated card. Requires both siteId and slug to be present.
  if (ctx.siteId.length > 0 && page.slug.length > 0) {
    return `/og/${encodeURIComponent(ctx.siteId)}/${encodeURIComponent(page.slug)}.png`;
  }

  // 3. None.
  return null;
}
