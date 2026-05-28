// src/seo/sitemap/build.ts
//
// sitemap.xml builder.
//
// Pure XML composition. Given a Published Snapshot and the visitor-facing
// host, returns a sitemap.org-conformant `<urlset>` document listing every
// crawlable page. Pages whose `resolveNoIndex(page, snapshot)` returns true
// — either because of per-page `noIndex` or site-level `siteNoIndex` — are
// omitted entirely. When the site switch is on, the returned `<urlset>` is
// empty (zero `<url>` children), which is the cleanest signal we can give a
// crawler that "nothing on this host is meant to be indexed."
//
// Tag inventory:
//   - `<loc>`        — `<protocol>://<host>/<slug>` (or `/` for the root page).
//                      Includes a `#v=<version>` fragment so a republish busts
//                      crawler caches keyed by URL identity.
//   - `<lastmod>`    — `snapshot.publishedAt` (already ISO 8601 from publish).
//   - `<changefreq>` — constant `weekly`. The scope-out list rejects per-page
//                      owner overrides; weekly is the right default for the
//                      kind of marketing sites this POC targets.
//
// Multi-locale annotations (i18n parity — see `src/i18n/`):
//   - `<xhtml:link rel="alternate" hreflang="…" href="…" />` — one per
//     non-noIndex sibling translation of the page (INCLUDING self), plus a
//     single `hreflang="x-default"` pointing at the canonical default-locale
//     sibling. The `xmlns:xhtml="http://www.w3.org/1999/xhtml"` declaration
//     is added to `<urlset>` so the prefixed element name validates.
//   - Pages with no siblings (the only translation in their family) emit no
//     `xhtml:link` elements — `xhtml:link` is meaningful only when alternates
//     exist, and emitting a self-only annotation is a documented anti-pattern.
//
// The XML is hand-rolled (no DOM library) — Cloudflare Workers bundle size
// budget is tight, and the surface here is small enough that a typed builder
// would cost more than it saves. All string values are escaped via the local
// helpers below so an Owner cannot inject XML by naming a slug `]]><evil>`.
//
// Reuse: `resolveNoIndex` is imported from `../meta-emit.ts` rather than
// re-derived — that helper is the single source of truth for "is this page
// crawlable" and we must agree with the renderer's `<meta name="robots">`
// decision exactly.

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
// Locale prefix grammar — mirrors `src/i18n/locale-resolve.ts`. Do NOT diverge.
// Exact BCP-47-subset: 2 lowercase letters, optional `-` + 2 uppercase letters.
// ---------------------------------------------------------------------------

const LOCALE_PREFIX_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * Primary-subtag agreement — mirrors `localesMatch` in
 * `src/i18n/locale-resolve.ts`. Two locale tags agree when they are byte-equal
 * OR when their primary subtags (the part before any `-`) are byte-equal,
 * case-insensitive on the primary. This is the same permissive matching the
 * resolver uses so an `es-MX` page declared under an `/es/` URL prefix
 * doesn't trip the authoring-bug guardrail.
 */
function localesAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const aPrimary = (a.indexOf('-') === -1 ? a : a.slice(0, a.indexOf('-'))).toLowerCase();
  const bPrimary = (b.indexOf('-') === -1 ? b : b.slice(0, b.indexOf('-'))).toLowerCase();
  return aPrimary === bPrimary;
}

/**
 * Resolve the snapshot's `defaultLocale` to a non-empty string. The field is
 * optional on PublishedSnapshot; absent or empty values fall through to `'en'`.
 * Kept in shape with `src/i18n/locale-resolve.ts` so the two agree.
 */
function resolveDefaultLocale(snapshot: PublishedSnapshot): string {
  if (typeof snapshot.defaultLocale === 'string' && snapshot.defaultLocale.length > 0) {
    return snapshot.defaultLocale;
  }
  return 'en';
}

// ---------------------------------------------------------------------------
// Translation families
// ---------------------------------------------------------------------------

/**
 * A parsed view of a page for family grouping.
 *
 *   - `page`         : the original CanvasPage (retained for noIndex re-checks).
 *   - `residualSlug` : the slug AFTER stripping a leading `<locale>/` prefix.
 *                      For an unprefixed page, this equals `page.slug` verbatim.
 *   - `locale`       : the effective locale of the page — the prefix when
 *                      present, otherwise `page.locale`, otherwise the
 *                      snapshot default. Used as the `hreflang` value.
 *   - `hasLocalePrefix` : true when the slug started with a `<locale>/` segment.
 *                         Determines which family member is the `x-default`.
 */
interface ParsedPage {
  page: CanvasPage;
  residualSlug: string;
  locale: string;
  hasLocalePrefix: boolean;
}

/**
 * Parse a page into the (residualSlug, locale, hasLocalePrefix) triple used
 * for family grouping.
 *
 * Failure mode (loud, per the no-fallbacks rule): a slug whose first segment
 * matches the locale-prefix grammar but whose `page.locale` field is unset
 * (or doesn't agree with the prefix) is an authoring inconsistency. We throw
 * with the exact ids and offending values so the smoke / publish path can
 * surface it instead of silently guessing which way to read it.
 */
function parsePage(page: CanvasPage, defaultLocale: string): ParsedPage {
  const slug = page.slug;
  const slashIdx = slug.indexOf('/');
  const firstSegment = slashIdx === -1 ? slug : slug.slice(0, slashIdx);

  if (LOCALE_PREFIX_RE.test(firstSegment)) {
    // Slug shape says "I'm a translated sibling." The page MUST carry a
    // matching `locale` field — anything else is an authoring bug.
    const declared = typeof page.locale === 'string' ? page.locale : null;
    if (declared === null || declared.length === 0) {
      throw new Error(
        `[sitemap] page id=${page.id} slug=${JSON.stringify(slug)} has a locale-prefix-shaped slug but no \`locale\` field — refusing to guess`,
      );
    }
    if (!localesAgree(declared, firstSegment)) {
      throw new Error(
        `[sitemap] page id=${page.id} slug=${JSON.stringify(slug)} prefix locale=${JSON.stringify(firstSegment)} disagrees with page.locale=${JSON.stringify(declared)} — refusing to guess`,
      );
    }
    const residual = slashIdx === -1 ? '' : slug.slice(slashIdx + 1);
    return {
      page,
      residualSlug: residual,
      // Prefer the page-declared locale — it can carry region qualification
      // (`es-MX`) that the bare URL prefix (`es`) loses. The prefix is only
      // used for grouping; the hreflang attribute should be as specific as
      // the page itself is.
      locale: declared,
      hasLocalePrefix: true,
    };
  }

  // No locale prefix on the slug. The page is either an unset-locale default
  // or carries an explicit `page.locale` (e.g. one author chose to mark the
  // English original as `locale: 'en'` — still belongs in the default-locale
  // slot of its family).
  const declared =
    typeof page.locale === 'string' && page.locale.length > 0 ? page.locale : defaultLocale;
  return {
    page,
    residualSlug: slug,
    locale: declared,
    hasLocalePrefix: false,
  };
}

/**
 * Pick the family member that should be the `x-default` target. Preference
 * order:
 *
 *   1. The unprefixed page whose locale equals the snapshot default. This
 *      is the "canonical" original.
 *   2. Any unprefixed page (rare — e.g. site default is `en` but the only
 *      original was authored without a `locale` field at all, which still
 *      parses as `defaultLocale`).
 *   3. The page whose locale equals the snapshot default (covers the edge
 *      case where every member of the family carries a locale prefix —
 *      should not happen by construction but we tolerate it).
 *   4. Falls through to `null` — caller MUST skip emitting the x-default
 *      link in that case. We don't pick an arbitrary winner: Google's
 *      protocol explicitly says the x-default points at the canonical /
 *      language-picker page, and guessing produces wrong behaviour.
 */
function pickDefaultMember(family: ParsedPage[], defaultLocale: string): ParsedPage | null {
  const unprefixedDefault = family.find(
    (p) => !p.hasLocalePrefix && localesAgree(p.locale, defaultLocale),
  );
  if (unprefixedDefault) return unprefixedDefault;
  const anyUnprefixed = family.find((p) => !p.hasLocalePrefix);
  if (anyUnprefixed) return anyUnprefixed;
  const defaultLocaleMember = family.find((p) => localesAgree(p.locale, defaultLocale));
  if (defaultLocaleMember) return defaultLocaleMember;
  return null;
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
  // Empty slug, or the conventional `home` alias for the index page, both
  // collapse to the root URL. Without the `home` branch the sitemap would
  // advertise `/home#v=N` while the rendered site also serves the same
  // page at `/`, splitting crawler attribution across two URLs.
  const isRoot = page.slug.length === 0 || page.slug === 'home';
  const slugPath = isRoot ? '/' : `/${page.slug}`;
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
 *
 * Multi-locale: pages are first grouped into translation families by their
 * residual slug (slug with any leading `<locale>/` stripped). When a family
 * has more than one crawlable member, each emitted `<url>` carries one
 * `xhtml:link` per non-noIndex sibling (including self) plus an `x-default`.
 */
export function buildSitemapXml(
  snapshot: PublishedSnapshot,
  opts: BuildSitemapOptions,
): string {
  const protocol = opts.protocol ?? 'https';
  const defaultLocale = resolveDefaultLocale(snapshot);
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
  );

  const lastmod = escapeXmlText(snapshot.publishedAt);

  // --- Stage 1: parse every page into its (residual, locale, prefixed) triple.
  // We parse ALL pages first (including noIndex ones) so we can throw loud
  // errors on malformed slugs even if the page would otherwise be filtered.
  // Authoring bugs should surface; silent skips are the failure mode the
  // global "no fallbacks" rule explicitly rejects.
  const parsed: ParsedPage[] = snapshot.pages.map((page) => parsePage(page, defaultLocale));

  // --- Stage 2: group into families by residual slug. Within a family, the
  // pages might come in any order; we preserve snapshot order for determinism.
  const families = new Map<string, ParsedPage[]>();
  for (const p of parsed) {
    const key = p.residualSlug;
    const bucket = families.get(key);
    if (bucket) {
      bucket.push(p);
    } else {
      families.set(key, [p]);
    }
  }

  // --- Stage 3: emit a `<url>` per crawlable page, attaching family
  // annotations. We re-derive crawlability via `resolveNoIndex` inside the
  // loop so the existing per-page filter still wins.
  for (const p of parsed) {
    if (resolveNoIndex(p.page, snapshot)) continue;

    const family = families.get(p.residualSlug);
    // `family` is always populated — `p` is in it — but guard for the type
    // checker. Filter the family to crawlable members only; a noIndex sibling
    // is not a published URL and must not appear in hreflang annotations.
    const crawlableSiblings = (family ?? []).filter(
      (sib) => !resolveNoIndex(sib.page, snapshot),
    );

    const loc = escapeXmlText(buildPageLoc(p.page, opts.host, protocol, snapshot.version));
    lines.push(`  <url>`);
    lines.push(`    <loc>${loc}</loc>`);
    lines.push(`    <lastmod>${lastmod}</lastmod>`);
    lines.push(`    <changefreq>weekly</changefreq>`);

    // Only emit `xhtml:link` annotations when alternates exist. A single-
    // member family produces no hreflang block — Google treats a self-only
    // annotation as a no-op signal anyway.
    if (crawlableSiblings.length > 1) {
      for (const sib of crawlableSiblings) {
        const sibLoc = escapeXmlText(
          buildPageLoc(sib.page, opts.host, protocol, snapshot.version),
        );
        const sibLocale = escapeXmlText(sib.locale);
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${sibLocale}" href="${sibLoc}" />`,
        );
      }
      const defaultMember = pickDefaultMember(crawlableSiblings, defaultLocale);
      if (defaultMember !== null) {
        const defLoc = escapeXmlText(
          buildPageLoc(defaultMember.page, opts.host, protocol, snapshot.version),
        );
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${defLoc}" />`,
        );
      }
    }

    lines.push(`  </url>`);
  }

  lines.push(`</urlset>`);
  // Trailing newline so editors / curl render the document tidily.
  return lines.join('\n') + '\n';
}
