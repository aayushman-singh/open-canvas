// src/seo/meta-emit.ts
//
// Emits the `<head>` SEO meta block for a Published Page.
//
// Pure HTML composition. The caller (the main thread in `src/routes/public.ts`
// via `renderCanvasHead`) splices the returned string into the document head.
//
// Tag inventory:
//
//   - `<title>`                                — page.title (required field).
//   - `<meta name="description">`              — page.description, when set.
//   - Open Graph: og:title, og:description, og:image, og:image:type,
//                 og:image:width, og:image:height, og:image:alt, og:url,
//                 og:type=website, og:locale (when locale resolvable)
//   - Twitter: twitter:card=summary_large_image, twitter:title,
//              twitter:description, twitter:image, twitter:image:alt
//   - `<link rel="canonical">`                 — page.canonical || computed.
//   - `<meta name="robots" content="noindex,nofollow">` when noIndex || siteNoIndex.
//
// OG image dimensions: the generated card is always 1200×630 (matches
// `OG_WIDTH` / `OG_HEIGHT` in `src/og-image/render.tsx`). Owner-uploaded
// images can be any aspect ratio, so dimensions + image type are emitted
// only when the URL came from the generator path (i.e. starts with `/og/`).
//
// The `<html lang="…">` attribute is owned by the document envelope in
// `src/routes/public.ts` (main thread integration). This module exposes the
// resolved locale through `resolveLang` so the caller can wire it without
// duplicating fallback logic.
//
// All user-controlled strings are escaped via local HTML/attribute escapers.
// These are inlined here (rather than imported from `canvas/elements/render-utils`)
// to keep `src/seo/` independent of canvas internals.

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
// Escapers — local to this module.
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
  // PublishedSnapshot does not currently declare `defaultLocale`; it belongs
  // to EditableSite. Probe structurally so older snapshots fall back to
  // 'en' and newer snapshots can carry the locale without changing this API.
  const snapAny = snapshot;
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
  // Same structural probe as `resolveLang`: `siteNoIndex` belongs to
  // EditableSite today, but published snapshots may carry it.
  const snapAny = snapshot;
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
  // The page slug is the path. Locale-prefixed routes are owned by the i18n
  // router, so this helper does not prepend locale segments. Empty slug
  // ('home' equivalent) emits a bare root URL.
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

  // -- Favicon (site-level) ------------------------------------------------
  // The asset route accepts either the ownerAsset.id or the content hash; we
  // use the id so the Owner can swap the underlying file without re-publishing.
  const faviconAssetId = ctx.snapshot.faviconAssetId;
  if (typeof faviconAssetId === 'string' && faviconAssetId.length > 0) {
    lines.push(
      `<link rel="icon" href="/assets/${escapeAttr(encodeURIComponent(faviconAssetId))}">`,
    );
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
  // Generated OG cards are produced by `src/og-image/render.tsx` at a fixed
  // 1200×630 size and rasterised to PNG by `src/og-image/rasterise.ts`. The
  // generator path is `/og/<siteId>/<slug>.png`; owner-uploaded overrides
  // route through `/assets/<id-or-hash>`. We branch on the relative URL
  // prefix to decide whether we know the dimensions + image type.
  const OG_GENERATED_WIDTH = 1200;
  const OG_GENERATED_HEIGHT = 630;
  const isGeneratedOgImage =
    ogImageRelative !== null && ogImageRelative.startsWith('/og/');

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
  // og:locale — OG specifies `language_TERRITORY` (underscore). We carry
  // BCP-47 internally (`en`, `es-MX`); swap the hyphen so the emitted value
  // matches the spec. A bare-language tag (`en`) without a region is left
  // verbatim — crawlers tolerate the bare form.
  const lang = resolveLang(page, ctx.snapshot);
  if (lang.length > 0) {
    lines.push(`<meta property="og:locale" content="${escapeAttr(lang.replace('-', '_'))}">`);
  }
  if (ogImageAttr !== null) {
    lines.push(`<meta property="og:image" content="${ogImageAttr}">`);
    // Image alt is the page title — the visible focus of every generated
    // card — so screen readers and crawler accessibility checks see a
    // meaningful description rather than the file name.
    lines.push(`<meta property="og:image:alt" content="${titleAttr}">`);
    if (isGeneratedOgImage) {
      lines.push(`<meta property="og:image:type" content="image/png">`);
      lines.push(`<meta property="og:image:width" content="${String(OG_GENERATED_WIDTH)}">`);
      lines.push(`<meta property="og:image:height" content="${String(OG_GENERATED_HEIGHT)}">`);
    }
  }

  // -- Twitter Card --------------------------------------------------------
  lines.push(`<meta name="twitter:card" content="summary_large_image">`);
  lines.push(`<meta name="twitter:title" content="${titleAttr}">`);
  if (descriptionAttr !== null) {
    lines.push(`<meta name="twitter:description" content="${descriptionAttr}">`);
  }
  if (ogImageAttr !== null) {
    lines.push(`<meta name="twitter:image" content="${ogImageAttr}">`);
    lines.push(`<meta name="twitter:image:alt" content="${titleAttr}">`);
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
  // Escape all `<` as `\u003c` to prevent `</script>` injection in the JSON body.
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
    return '';
  }
  return emitPageMeta(page, {
    siteId: ctx.siteId,
    host: ctx.host,
    ...(ctx.protocol ? { protocol: ctx.protocol } : {}),
    snapshot,
    ...(ctx.assetLookup ? { assetLookup: ctx.assetLookup } : {}),
  });
}
