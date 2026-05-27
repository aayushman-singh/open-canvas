// src/seo/meta-emit.ts
//
// Wishlist #21 — emits the `<head>` SEO meta block for a Published Page.
//
// Pure HTML composition. The caller (the main thread in `src/routes/public.ts`
// via `renderCanvasHead`) splices the returned string into the document head.
//
// Tag inventory (per plan 2026-05-23-21-seo-meta.md):
//
//   - `<title>`                                — page.title (required field).
//   - `<meta name="description">`              — page.description, when set.
//   - Open Graph: og:title, og:description, og:image, og:url, og:type=website
//   - Twitter: twitter:card=summary_large_image, twitter:title, twitter:description, twitter:image
//   - `<link rel="canonical">`                 — page.canonical || computed.
//   - `<meta name="robots" content="noindex,nofollow">` when noIndex || siteNoIndex.
//
// The `<html lang="…">` attribute is owned by the document envelope in
// `src/routes/public.ts` (main thread integration). This module exposes the
// resolved locale through `resolveLang` so the caller can wire it without
// duplicating fallback logic.
//
// All user-controlled strings are escaped via local HTML/attribute escapers.
// These are inlined here (rather than imported from `canvas/elements/render-utils`)
// to keep `src/seo/` independent of canvas internals — Wave 3 file-ownership
// boundary.

import type { CanvasPage, PublishedSnapshot } from '../canvas/schema.js';
import { CUSTOM_404_PAGE_SLUG } from '../canvas/page-routing.js';
import { resolveOgUrl, type OgResolveContext } from './og-resolve.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Context passed to `emitPageMeta`. Carries:
 *
 *   - `siteId`     : drives the OG generator URL fallback.
 *   - `host`       : drives the canonical URL when `page.canonical` is unset.
 *                    Format: hostname (and optional :port), no scheme. The
 *                    caller typically passes `request.headers.get('host')`.
 *                    Empty string disables canonical computation — the tag
 *                    is then only emitted if `page.canonical` is set.
 *   - `protocol`   : 'https' (default) or 'http'. The canonical URL scheme.
 *   - `snapshot`   : the Published Snapshot the page belongs to. Used to
 *                    read site-level `siteNoIndex` and `defaultLocale`.
 *   - `assetLookup`: optional resolver from `ogImageAssetId` to content hash.
 *                    Forwarded verbatim to `resolveOgUrl`.
 */
export interface EmitMetaContext {
  siteId: string;
  host: string;
  protocol?: 'https' | 'http';
  snapshot: PublishedSnapshot;
  assetLookup?: (assetId: string) => string | null;
}

// ---------------------------------------------------------------------------
// Escapers — local to this module (Wave 3 boundary).
// ---------------------------------------------------------------------------

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

const ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ATTR_ESCAPES[ch] ?? ch);
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the BCP-47 lang tag for a page, applying the documented fallback
 * chain: per-page `locale` → site `defaultLocale` → 'en'.
 *
 * Exported so the main thread can stamp `<html lang>` on the outer document
 * envelope (which lives outside this renderer's scope) without re-implementing
 * the fallback.
 */
export function resolveLang(page: CanvasPage, snapshot: PublishedSnapshot): string {
  // We treat any non-empty string as a valid lang tag — BCP-47 grammar is
  // permissive and validating here would add a runtime dependency for no
  // win (the editor UI is the right place to constrain).
  if (typeof page.locale === 'string' && page.locale.length > 0) {
    return page.locale;
  }
  // PublishedSnapshot does not currently carry `defaultLocale` — that field
  // lives on `CanvasSiteState`. The publish path may or may not have copied
  // it across (Wave 5 #25 owns the i18n routing wiring). We probe the
  // snapshot via a structural type to avoid coupling: if a future publish
  // mirror surfaces `defaultLocale`, we honour it; otherwise we fall back
  // to 'en'.
  const snapAny = snapshot as PublishedSnapshot & { defaultLocale?: unknown };
  if (typeof snapAny.defaultLocale === 'string' && snapAny.defaultLocale.length > 0) {
    return snapAny.defaultLocale;
  }
  return 'en';
}

/**
 * Resolve whether the page should be `noindex,nofollow`. Site-level
 * `siteNoIndex` is an unconditional OR over per-page `noIndex` — when the
 * site switch is on, every page is noindex regardless of per-page setting.
 */
export function resolveNoIndex(page: CanvasPage, snapshot: PublishedSnapshot): boolean {
  if (page.slug === CUSTOM_404_PAGE_SLUG) return true;
  // Same structural probe as `resolveLang` — `siteNoIndex` is declared on
  // `CanvasSiteState`, not on the snapshot type today. Wave 5 / publish-path
  // changes may surface it; we honour it whenever it is present.
  const snapAny = snapshot as PublishedSnapshot & { siteNoIndex?: unknown };
  if (snapAny.siteNoIndex === true) return true;
  return page.noIndex === true;
}

/**
 * Compose the canonical URL for a page. Returns `null` when no canonical can
 * be derived (no explicit `page.canonical` and no host in ctx).
 */
function resolveCanonical(page: CanvasPage, ctx: EmitMetaContext): string | null {
  if (typeof page.canonical === 'string' && page.canonical.length > 0) {
    return page.canonical;
  }
  if (ctx.host.length === 0) return null;
  const protocol = ctx.protocol ?? 'https';
  // The page slug is the path. Per the Wave 5 #25 caveat in the brief, this
  // module does NOT prepend locale segments — the i18n router owns that.
  // Empty slug ('home' equivalent) emits a bare root URL.
  const path = page.slug.length > 0 ? `/${page.slug}` : '/';
  return `${protocol}://${ctx.host}${path}`;
}

// ---------------------------------------------------------------------------
// emitPageMeta
// ---------------------------------------------------------------------------

/**
 * Build the `<head>` SEO meta HTML for a single page. Returns a string of
 * concatenated tags (no surrounding `<head>` element — the caller already
 * has one).
 *
 * Determinism: same input → same output, modulo property iteration. All
 * branches that drop a tag do so cleanly (no empty tags emitted).
 */
export function emitPageMeta(page: CanvasPage, ctx: EmitMetaContext): string {
  const lines: string[] = [];

  // -- Title (required) ----------------------------------------------------
  const title = page.title;
  const titleAttr = escapeAttr(title);
  const titleText = escapeText(title);
  lines.push(`<title>${titleText}</title>`);

  // -- Description --------------------------------------------------------
  const hasDescription = typeof page.description === 'string' && page.description.length > 0;
  const descriptionAttr = hasDescription ? escapeAttr(page.description as string) : null;
  if (descriptionAttr !== null) {
    lines.push(`<meta name="description" content="${descriptionAttr}">`);
  }

  // -- Canonical URL -------------------------------------------------------
  const canonical = resolveCanonical(page, ctx);
  if (canonical !== null) {
    lines.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`);
  }

  // -- Robots --------------------------------------------------------------
  if (resolveNoIndex(page, ctx.snapshot)) {
    lines.push(`<meta name="robots" content="noindex,nofollow">`);
  }

  // -- OG image (shared between og:image and twitter:image) ----------------
  const ogCtx: OgResolveContext = {
    siteId: ctx.siteId,
    ...(ctx.assetLookup ? { assetLookup: ctx.assetLookup } : {}),
  };
  const ogImageRelative = resolveOgUrl(page, ogCtx);
  const ogOrigin = ctx.host.length > 0 ? `${ctx.protocol ?? 'https'}://${ctx.host}` : '';
  const ogImageUrl = ogImageRelative !== null ? `${ogOrigin}${ogImageRelative}` : null;
  const ogImageAttr = ogImageUrl !== null ? escapeAttr(ogImageUrl) : null;

  // -- Open Graph ----------------------------------------------------------
  // og:url uses the canonical URL when available — OG crawlers treat og:url
  // as the canonical permalink, which matches our intent.
  lines.push(`<meta property="og:type" content="website">`);
  lines.push(`<meta property="og:title" content="${titleAttr}">`);
  if (descriptionAttr !== null) {
    lines.push(`<meta property="og:description" content="${descriptionAttr}">`);
  }
  if (canonical !== null) {
    lines.push(`<meta property="og:url" content="${escapeAttr(canonical)}">`);
  }
  if (ogImageAttr !== null) {
    lines.push(`<meta property="og:image" content="${ogImageAttr}">`);
  }

  // -- Twitter Card --------------------------------------------------------
  lines.push(`<meta name="twitter:card" content="summary_large_image">`);
  lines.push(`<meta name="twitter:title" content="${titleAttr}">`);
  if (descriptionAttr !== null) {
    lines.push(`<meta name="twitter:description" content="${descriptionAttr}">`);
  }
  if (ogImageAttr !== null) {
    lines.push(`<meta name="twitter:image" content="${ogImageAttr}">`);
  }

  // -- Schema.org JSON-LD ----------------------------------------------------
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
  };
  if (hasDescription) {
    jsonLd.description = page.description;
  }
  if (canonical !== null) {
    jsonLd.url = canonical;
  }
  if (ogImageUrl !== null) {
    jsonLd.image = ogImageUrl;
  }
  // Escape all `<` as `<` to prevent `</script>` injection in the JSON body.
  const jsonLdStr = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
  lines.push(`<script type="application/ld+json">${jsonLdStr}</script>`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// renderCanvasHead — sibling to renderCanvasSnapshot for the public route.
// ---------------------------------------------------------------------------

/**
 * Inputs the main thread passes when calling `renderCanvasHead`. `pageSlug`
 * selects the page from the snapshot; the result is the meta block for that
 * page only.
 *
 * Visitor traffic hits one page at a time, so emitting per-page (not
 * per-snapshot) head meta is the right granularity — the renderer body
 * currently concatenates every page in the snapshot into one document, but
 * the head represents the page the visitor is reading.
 */
export interface RenderHeadContext {
  siteId: string;
  host: string;
  protocol?: 'https' | 'http';
  /** Which page's meta to emit. Matched against `page.slug`. */
  pageSlug: string;
  /** Optional asset id-to-hash resolver (same shape as `OgResolveContext`). */
  assetLookup?: (assetId: string) => string | null;
}

/**
 * Sibling to `renderCanvasSnapshot` — returns the head meta block for the
 * requested page in the snapshot. Empty string when the page is not found
 * (defensive: the caller already resolved the page slug from the request
 * path, but a stale link to a deleted page should not crash the render).
 */
export function renderCanvasHead(snapshot: PublishedSnapshot, ctx: RenderHeadContext): string {
  const page = snapshot.pages.find((p) => p.slug === ctx.pageSlug);
  if (!page) {
    console.warn('[seo/meta-emit] page not found in snapshot, falling back to first page', { pageSlug: ctx.pageSlug });
    const first = snapshot.pages[0];
    if (!first) return '';
    return emitPageMeta(first, {
      siteId: ctx.siteId,
      host: ctx.host,
      ...(ctx.protocol ? { protocol: ctx.protocol } : {}),
      snapshot,
      ...(ctx.assetLookup ? { assetLookup: ctx.assetLookup } : {}),
    });
  }
  return emitPageMeta(page, {
    siteId: ctx.siteId,
    host: ctx.host,
    ...(ctx.protocol ? { protocol: ctx.protocol } : {}),
    snapshot,
    ...(ctx.assetLookup ? { assetLookup: ctx.assetLookup } : {}),
  });
}
