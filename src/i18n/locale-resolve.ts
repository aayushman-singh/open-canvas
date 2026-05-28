// src/i18n/locale-resolve.ts
//
// Request-path → (locale, pageSlug, page) resolver.
//
// Visitor path patterns the resolver recognises:
//
//   /                     → default locale, root slug ('' — first page).
//   /<slug>               → default locale, page with matching slug.
//   /<locale>/            → locale prefix only; root slug of that locale.
//   /<locale>/<slug>      → explicit locale + slug pair.
//
// Locale prefix syntax: BCP-47 language tag, optionally region-qualified
// (`ar`, `ar-EG`, `zh-CN`). We require the primary subtag to be exactly two
// lowercase letters and the optional region to be exactly two uppercase
// letters, matching the curated set the editor exposes. Anything that
// doesn't fit the shape is treated as a slug, not a locale.
//
// Lookup behaviour, in priority order:
//
//   1. If the first segment looks like a locale prefix AND a page exists
//      whose `locale` matches (case-insensitive on primary subtag) AND
//      whose `slug` matches the remaining path, return that page.
//   2. If the first segment looks like a locale prefix AND that locale
//      equals the resolved default locale, fall back to a plain-slug
//      lookup ignoring the prefix — so `/en/about` matches a page whose
//      slug is `about` and whose locale is unset, when default is `en`.
//   3. If the first segment looks like a locale prefix that NO page uses
//      (and is not the default), return `{ locale, pageSlug, page: null }`.
//      The caller (`src/routes/public.ts`) renders a 404 — no implicit
//      fallback to the default locale, per the "Owner explicitly asked
//      for `/de/about`" rule in the wave brief.
//   4. Otherwise, treat the full path as a slug under the default locale.
//
// The resolver does NOT throw. Unknown paths return `page: null`; the
// caller decides between 404 and a marketing-style "site root → first
// page" redirect.

import type { CanvasPage, PublishedSnapshot } from '../canvas/schema.js';

// ---------------------------------------------------------------------------
// Locale prefix grammar
// ---------------------------------------------------------------------------

// Exact BCP-47-subset the editor exposes: 2 lowercase letters, optional
// `-` + 2 uppercase letters. This rejects 3-letter ISO 639-2 codes (`fil`,
// `kok`) by design — the editor doesn't author them today, and a 3-letter
// path segment is almost always a slug (`api`, `app`, `dev`).
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

function looksLikeLocalePrefix(segment: string): boolean {
  return LOCALE_RE.test(segment);
}

function primarySubtag(locale: string): string {
  const dashIdx = locale.indexOf('-');
  return (dashIdx === -1 ? locale : locale.slice(0, dashIdx)).toLowerCase();
}

function localesMatch(a: string, b: string): boolean {
  // Exact match wins (`ar-EG` vs `ar-EG`).
  if (a === b) return true;
  // Primary-subtag fallback: a bare prefix `ar` matches any region
  // qualification `ar-EG`, and vice versa. The brief is silent on this
  // case; we choose the permissive interpretation because the curated
  // editor list rarely emits region-qualified tags and visitors typing a
  // URL by hand will type the bare two-letter form.
  return primarySubtag(a) === primarySubtag(b);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of {@link resolveLocale}. Always returns a `locale` and a
 * `pageSlug`; `page` is `null` only when the lookup failed and the caller
 * must produce a 404.
 *
 * - `locale`   : the resolved BCP-47 tag — explicit from the URL prefix
 *                when present, otherwise the snapshot default.
 * - `pageSlug` : the slug used for the lookup (may differ from the raw
 *                URL when a locale prefix was stripped; identical to the
 *                raw path otherwise).
 * - `page`     : the matched {@link CanvasPage}, or `null` when no page
 *                in the snapshot satisfies the (locale, slug) pair.
 */
export interface ResolveLocaleResult {
  locale: string;
  pageSlug: string;
  page: CanvasPage | null;
}

// ---------------------------------------------------------------------------
// Path normalisation
// ---------------------------------------------------------------------------

function normalisePath(rawPath: string): string {
  // Strip query / hash defensively even though typical callers pass
  // `requestUrl.pathname` which already excludes them.
  let path = rawPath;
  const queryIdx = path.indexOf('?');
  if (queryIdx !== -1) path = path.slice(0, queryIdx);
  const hashIdx = path.indexOf('#');
  if (hashIdx !== -1) path = path.slice(0, hashIdx);
  // Collapse leading slash; preserve internal segments.
  if (path.startsWith('/')) path = path.slice(1);
  // Drop a trailing slash so '/ar/' and '/ar' resolve identically.
  if (path.endsWith('/')) path = path.slice(0, path.length - 1);
  return path;
}

function resolveDefaultLocale(snapshot: PublishedSnapshot): string {
  // `defaultLocale` is declared optional on PublishedSnapshot; treat the
  // empty-string case as "absent" so authors can clear the field without
  // tripping a different code path.
  if (typeof snapshot.defaultLocale === 'string' && snapshot.defaultLocale.length > 0) {
    return snapshot.defaultLocale;
  }
  return 'en';
}

// ---------------------------------------------------------------------------
// resolveLocale
// ---------------------------------------------------------------------------

/**
 * Parse `path` against the snapshot's pages and return the (locale, slug,
 * page) triple. See file header for the lookup rules.
 *
 * `path` is treated as the request pathname only (no query, no hash).
 * The function defensively strips them anyway so callers passing
 * `request.url` cannot trip themselves.
 */
export function resolveLocale(path: string, snapshot: PublishedSnapshot): ResolveLocaleResult {
  const defaultLocale = resolveDefaultLocale(snapshot);
  const normalised = normalisePath(path);

  // Empty path → root.
  if (normalised.length === 0) {
    const rootPage = findPageByLocaleAndSlug(snapshot, defaultLocale, '');
    return { locale: defaultLocale, pageSlug: '', page: rootPage };
  }

  const segments = normalised.split('/');
  const firstSegment = segments[0] ?? '';
  const rest = segments.slice(1).join('/');

  if (looksLikeLocalePrefix(firstSegment)) {
    // Case 1: locale prefix matches a page directly.
    const explicitLocale = firstSegment;
    const slugAfterPrefix = rest;
    const directHit = findPageByLocaleAndSlug(snapshot, explicitLocale, slugAfterPrefix);
    if (directHit !== null) {
      return { locale: explicitLocale, pageSlug: slugAfterPrefix, page: directHit };
    }

    // Case 2: locale prefix is the default locale — strip and retry as a
    // plain slug lookup. This is the documented "optional default-locale
    // prefix" behaviour: `/en/about` finds the same page as `/about` when
    // default is `en`.
    if (localesMatch(explicitLocale, defaultLocale)) {
      const fallbackHit = findPageByLocaleAndSlug(snapshot, defaultLocale, slugAfterPrefix);
      return {
        locale: defaultLocale,
        pageSlug: slugAfterPrefix,
        page: fallbackHit,
      };
    }

    // Case 3: unknown locale prefix — caller renders 404. Do NOT silently
    // fall back to the default locale: the visitor explicitly asked for
    // `/de/about`, and returning the English about page would be wrong.
    return { locale: explicitLocale, pageSlug: slugAfterPrefix, page: null };
  }

  // Case 4: no locale prefix at all — full path is the slug, default
  // locale is the locale.
  const slug = normalised;
  const page = findPageByLocaleAndSlug(snapshot, defaultLocale, slug);
  return { locale: defaultLocale, pageSlug: slug, page };
}

// ---------------------------------------------------------------------------
// Page lookup
// ---------------------------------------------------------------------------

/**
 * Find a page whose (locale, slug) matches. Locale match uses
 * {@link localesMatch} (region-qualified ↔ bare); slug must be exact.
 *
 * When the searched locale equals the snapshot default, pages with NO
 * `locale` field set are also eligible — they are implicitly default-locale
 * pages (see `resolveLang` in `src/seo/meta-emit.ts`).
 */
function findPageByLocaleAndSlug(
  snapshot: PublishedSnapshot,
  locale: string,
  slug: string,
): CanvasPage | null {
  const defaultLocale = resolveDefaultLocale(snapshot);
  const lookingForDefault = localesMatch(locale, defaultLocale);

  for (const page of snapshot.pages) {
    if (page.slug !== slug) continue;
    const pageLocale =
      typeof page.locale === 'string' && page.locale.length > 0 ? page.locale : null;
    if (pageLocale === null) {
      // No explicit page locale — treat as default. Match only when the
      // requested locale is the default too.
      if (lookingForDefault) return page;
      continue;
    }
    if (localesMatch(pageLocale, locale)) return page;
  }
  return null;
}
