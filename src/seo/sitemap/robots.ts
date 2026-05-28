// src/seo/sitemap/robots.ts
//
// robots.txt builder.
//
// Pure string composition. Given a Published Snapshot, the visitor-facing
// host, and the Published Address that the `Sitemap:` directive should point
// at, returns a robots.txt body ready to ship as `text/plain`.
//
// Output shape:
//
//   1. Site-level `siteNoIndex` (the "publish but don't expose yet" switch)
//      collapses the entire body to:
//
//         User-agent: *
//         Disallow: /
//         Sitemap: <published-address>/sitemap.xml
//
//      The Sitemap line is still emitted — crawlers that read the URL list
//      to drop those pages from their index are exactly the audience we
//      want when the site flips to "don't index me." It's also the form
//      the sitemap.org spec recommends regardless of disallow scope.
//
//   2. Otherwise:
//
//         User-agent: *
//         Allow: /
//         Disallow: /<noindex-slug-1>
//         Disallow: /<noindex-slug-2>
//         ...
//         Sitemap: <published-address>/sitemap.xml
//
//      A page with an empty slug (root) cannot be selectively excluded via
//      robots.txt because `Disallow: /` would block the whole site. We
//      treat such a page the same as any other: omit it from the sitemap
//      (the build step already does that) and let the `<meta name="robots">`
//      tag on the rendered page carry the noindex signal. Crawlers respect
//      either; the meta-only path for the root is the least-surprising
//      behaviour we can offer.
//
// Reuse: `resolveNoIndex` from `../meta-emit.ts` (single source of truth).

import type { PublishedSnapshot } from '../../canvas/schema.js';
import { resolveNoIndex } from '../meta-emit.js';

// ---------------------------------------------------------------------------
// Public address normalisation
// ---------------------------------------------------------------------------

/**
 * Compose the absolute `Sitemap:` URL from the published-address base. We
 * accept either a fully-qualified URL (`https://acme.com`) or a bare host
 * (`acme.com`) and normalise both to `<base>/sitemap.xml`. The route handler
 * passes the same shape that the rest of the code path treats as canonical
 * for this site.
 */
function composeSitemapUrl(publishedAddress: string): string {
  // Strip trailing slash so we don't end up with `//sitemap.xml`.
  let base = publishedAddress;
  while (base.endsWith('/')) base = base.slice(0, base.length - 1);
  return `${base}/sitemap.xml`;
}

// ---------------------------------------------------------------------------
// buildRobotsTxt
// ---------------------------------------------------------------------------

/**
 * Build the robots.txt body. `publishedAddress` is the full origin (scheme +
 * host) the `Sitemap:` line should reference — typically the same scheme +
 * host the route handler used to satisfy the request. We never gate the
 * Sitemap line on the disallow scope; see the module banner.
 */
export function buildRobotsTxt(
  snapshot: PublishedSnapshot,
  publishedAddress: string,
): string {
  const sitemapLine = `Sitemap: ${composeSitemapUrl(publishedAddress)}`;

  // Site-level switch: everything off-limits. Per-page entries become
  // redundant — a crawler honouring `Disallow: /` is already done.
  if (snapshot.siteNoIndex === true) {
    return [
      'User-agent: *',
      'Disallow: /',
      sitemapLine,
      '', // Trailing newline so the file reads cleanly in `curl`.
    ].join('\n');
  }

  // Page-level: list every page whose `resolveNoIndex` is true AND has a
  // non-empty slug. Pages with an empty slug are the site root; we cannot
  // selectively disallow them without disallowing everything, so we let the
  // per-page `<meta name="robots">` tag handle them (sitemap omission +
  // meta noindex is sufficient signal). Stable iteration order: pages are
  // walked in snapshot order, which the publish path froze deterministically.
  const lines: string[] = ['User-agent: *', 'Allow: /'];
  for (const page of snapshot.pages) {
    if (!resolveNoIndex(page, snapshot)) continue;
    if (page.slug.length === 0) continue; // root — see comment above.
    lines.push(`Disallow: /${page.slug}`);
  }
  lines.push(sitemapLine);
  lines.push(''); // Trailing newline.
  return lines.join('\n');
}
