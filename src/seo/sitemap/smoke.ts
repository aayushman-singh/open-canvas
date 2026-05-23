// src/seo/sitemap/smoke.ts
//
// Manual smoke for wishlist #22 — sitemap.xml + robots.txt generation.
// Run with `bun.cmd run sitemap:smoke`.
//
// Coverage (per the plan):
//   1. Snapshot with 3 pages, 1 marked `noIndex` → sitemap lists exactly 2
//      `<loc>` entries; robots includes `Disallow: /the-noindex-slug`.
//   2. `siteNoIndex: true` → robots disallows everything (`Disallow: /`)
//      and the sitemap emits zero `<url>` children.
//   3. XML is well-formed (single root element `<urlset>`; declaration first).
//   4. The sitemap response carries `Content-Type: application/xml`.
//   5. `<lastmod>` matches `snapshot.publishedAt`.
//
// Bonus checks:
//   - Snapshot version embedded as a URL fragment so caches bust on republish.
//   - `<changefreq>weekly</changefreq>` constant per the brief.
//   - Robots `Sitemap:` line resolves against the supplied published address.
//   - Slug/title escapes — owner-supplied strings cannot inject XML.
//   - `buildRobotsResponse` returns text/plain.
//
// The smoke is DB-free: routes are exercised through the pure response
// builders (`buildSitemapResponse` / `buildRobotsResponse`) which the route
// handlers defer to once the snapshot is in hand. Host resolution is covered
// at the public-host integration boundary in `src/routes/public.ts`; the
// route module owns the body shape + headers, and that's what we verify.

import type { CanvasPage, PublishedSnapshot } from '../../canvas/schema.js';
import { buildSitemapXml } from './build.js';
import { buildRobotsTxt } from './robots.js';
import { buildRobotsResponse, buildSitemapResponse } from './route.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    process.stderr.write(`[sitemap:smoke] FAIL — ${message}\n`);
    process.exit(1);
  }
}

function ok(label: string): void {
  process.stdout.write(`[sitemap:smoke] OK   ${label}\n`);
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makePage(slug: string, title: string, extras: Partial<CanvasPage> = {}): CanvasPage {
  return {
    id: `page-${slug || 'root'}`,
    slug,
    title,
    width: 1440,
    sections: [],
    ...extras,
  };
}

function makeSnapshot(
  pages: CanvasPage[],
  extra: Record<string, unknown> = {},
  publishedAt: string = '2026-05-23T00:00:00.000Z',
  version: number = 7,
): PublishedSnapshot {
  // Build the base snapshot first, then layer optional `siteNoIndex` /
  // `defaultLocale` via Object.assign — same trick used by `src/seo/smoke.ts`.
  const base: PublishedSnapshot = {
    version,
    publishedAt,
    styleKit: 'charcoal',
    pages,
  };
  Object.assign(base, extra);
  return base;
}

const HOST = 'studio.example.com';
const PUBLISHED_ADDRESS = 'https://studio.example.com';

// ---------------------------------------------------------------------------
// Assertion 1 — three pages, one marked noIndex.
// ---------------------------------------------------------------------------

const homePage = makePage('', 'Home');
const aboutPage = makePage('about', 'About');
const stagingPage = makePage('staging', 'Staging', { noIndex: true });
const snapshot1 = makeSnapshot([homePage, aboutPage, stagingPage]);

const xml1 = buildSitemapXml(snapshot1, { host: HOST, protocol: 'https' });
const locMatches = xml1.match(/<loc>/g) ?? [];
assert(
  locMatches.length === 2,
  `1: sitemap must list 2 <loc> entries (3 pages minus 1 noIndex), got ${String(locMatches.length)}`,
);
ok('1a: sitemap omits the noIndex page (2 of 3 <loc> entries)');

assert(
  xml1.includes('<loc>https://studio.example.com/#v=7</loc>'),
  '1: root page emits scheme://host/ with version fragment',
);
assert(
  xml1.includes('<loc>https://studio.example.com/about#v=7</loc>'),
  '1: about page emits scheme://host/about with version fragment',
);
assert(
  !xml1.includes('/staging'),
  '1: the noIndex page must not appear anywhere in the sitemap',
);
ok('1b: noIndex page omitted entirely (no slug substring leaked)');

const robots1 = buildRobotsTxt(snapshot1, PUBLISHED_ADDRESS);
assert(
  robots1.includes('User-agent: *'),
  '1: robots.txt begins with User-agent: *',
);
assert(
  robots1.includes('Allow: /'),
  '1: robots.txt allows the root path when site-level switch is off',
);
assert(
  robots1.includes('Disallow: /staging'),
  '1: robots.txt lists the noIndex page slug under Disallow:',
);
assert(
  robots1.includes('Sitemap: https://studio.example.com/sitemap.xml'),
  '1: robots.txt carries the absolute Sitemap: directive',
);
ok('1c: robots.txt disallows the noIndex slug and includes the Sitemap line');

// ---------------------------------------------------------------------------
// Assertion 2 — siteNoIndex collapses everything.
// ---------------------------------------------------------------------------

const snapshot2 = makeSnapshot([homePage, aboutPage], { siteNoIndex: true });
const robots2 = buildRobotsTxt(snapshot2, PUBLISHED_ADDRESS);
assert(
  robots2.includes('User-agent: *'),
  '2: robots.txt still names the user-agent under site-wide noindex',
);
assert(
  robots2.includes('Disallow: /'),
  '2: site-level siteNoIndex must disallow the entire site',
);
assert(
  !robots2.includes('Allow:'),
  '2: site-wide noindex must not emit an Allow line',
);
assert(
  robots2.includes('Sitemap: https://studio.example.com/sitemap.xml'),
  '2: Sitemap: line is still emitted under site-wide noindex',
);

const xml2 = buildSitemapXml(snapshot2, { host: HOST, protocol: 'https' });
const locMatches2 = xml2.match(/<loc>/g) ?? [];
assert(
  locMatches2.length === 0,
  `2: site-level siteNoIndex must produce zero <url> entries, got ${String(locMatches2.length)}`,
);
assert(
  xml2.includes('<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9"') &&
    xml2.includes('</urlset>'),
  '2: an empty sitemap still wraps in <urlset>',
);
ok('2: siteNoIndex disallows everything and produces an empty <urlset>');

// ---------------------------------------------------------------------------
// Assertion 3 — XML well-formed; root element is <urlset>.
// ---------------------------------------------------------------------------

assert(
  xml1.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'),
  '3: XML must begin with the standard declaration',
);
// After the declaration, the root element must be <urlset> (with namespace).
const afterDecl = xml1.slice(xml1.indexOf('\n') + 1);
assert(
  afterDecl.startsWith('<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9"'),
  '3: root element is <urlset> with the sitemap.org namespace',
);
assert(
  afterDecl.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'),
  '3: <urlset> declares the xhtml namespace so xhtml:link validates',
);
// Single root: exactly one opening and one closing <urlset> tag.
const urlsetOpens = (xml1.match(/<urlset/g) ?? []).length;
const urlsetCloses = (xml1.match(/<\/urlset>/g) ?? []).length;
assert(
  urlsetOpens === 1 && urlsetCloses === 1,
  `3: exactly one <urlset>...</urlset> pair (opens=${String(urlsetOpens)} closes=${String(urlsetCloses)})`,
);
// Balanced child tags: each <url> closes; each <loc>/<lastmod>/<changefreq>
// closes too.
function balanced(open: string, close: string, src: string, label: string): void {
  const o = (src.match(new RegExp(open, 'g')) ?? []).length;
  const c = (src.match(new RegExp(close, 'g')) ?? []).length;
  assert(o === c, `3: balanced ${label} tags (open=${String(o)} close=${String(c)})`);
}
balanced('<url>', '</url>', xml1, '<url>');
balanced('<loc>', '</loc>', xml1, '<loc>');
balanced('<lastmod>', '</lastmod>', xml1, '<lastmod>');
balanced('<changefreq>', '</changefreq>', xml1, '<changefreq>');
ok('3: XML declaration + <urlset> root + balanced child tags');

// ---------------------------------------------------------------------------
// Assertion 4 — Content-Type: application/xml on sitemap response.
// ---------------------------------------------------------------------------

const sitemapResponse = buildSitemapResponse(snapshot1, HOST, 'https');
assert(sitemapResponse.status === 200, '4: sitemap response status is 200');
const sitemapContentType = sitemapResponse.headers.get('Content-Type') ?? '';
assert(
  sitemapContentType.startsWith('application/xml'),
  `4: sitemap Content-Type must start with application/xml, got "${sitemapContentType}"`,
);
const sitemapCacheControl = sitemapResponse.headers.get('Cache-Control') ?? '';
assert(
  sitemapCacheControl === 'public, max-age=3600',
  `4: sitemap Cache-Control must be 1-hour public, got "${sitemapCacheControl}"`,
);
const sitemapBody = await sitemapResponse.text();
assert(
  sitemapBody === xml1,
  '4: sitemap response body matches buildSitemapXml output byte-for-byte',
);
ok('4: sitemap response carries application/xml + 1-hour public Cache-Control');

// robots response: Content-Type text/plain.
const robotsResponse = buildRobotsResponse(snapshot1, HOST, 'https');
const robotsContentType = robotsResponse.headers.get('Content-Type') ?? '';
assert(
  robotsContentType.startsWith('text/plain'),
  `bonus: robots Content-Type must start with text/plain, got "${robotsContentType}"`,
);
ok('bonus: robots response carries text/plain');

// ---------------------------------------------------------------------------
// Assertion 5 — <lastmod> matches snapshot.publishedAt.
// ---------------------------------------------------------------------------

const PUBLISHED_AT = '2027-01-15T12:34:56.789Z';
const snapshot5 = makeSnapshot([aboutPage], {}, PUBLISHED_AT, 11);
const xml5 = buildSitemapXml(snapshot5, { host: HOST, protocol: 'https' });
assert(
  xml5.includes(`<lastmod>${PUBLISHED_AT}</lastmod>`),
  `5: <lastmod> must reflect snapshot.publishedAt (${PUBLISHED_AT})`,
);
ok('5: <lastmod> matches snapshot.publishedAt');

// ---------------------------------------------------------------------------
// Bonus — snapshot version embedded as URL fragment for cache busting.
// ---------------------------------------------------------------------------

assert(
  xml5.includes('#v=11'),
  'bonus: snapshot version must be embedded as a #v=<n> fragment on each <loc>',
);
const xmlV12 = buildSitemapXml(
  makeSnapshot([aboutPage], {}, PUBLISHED_AT, 12),
  { host: HOST, protocol: 'https' },
);
assert(
  xmlV12.includes('#v=12') && !xmlV12.includes('#v=11'),
  'bonus: bumping the snapshot version must change the <loc> fragment',
);
ok('bonus: snapshot version embedded as URL fragment for cache busting');

// ---------------------------------------------------------------------------
// Bonus — changefreq is constant `weekly`.
// ---------------------------------------------------------------------------

const changefreqMatches = xml1.match(/<changefreq>weekly<\/changefreq>/g) ?? [];
assert(
  changefreqMatches.length === locMatches.length,
  `bonus: every <url> entry carries <changefreq>weekly</changefreq> (entries=${String(locMatches.length)} freq=${String(changefreqMatches.length)})`,
);
ok('bonus: <changefreq>weekly</changefreq> on every <url>');

// ---------------------------------------------------------------------------
// Bonus — XML escaping. An owner-controlled slug containing reserved chars
// must not break the document.
// ---------------------------------------------------------------------------

const evilPage = makePage('q?a=1&b=2', 'Q&A');
const snapshotEvil = makeSnapshot([evilPage]);
const xmlEvil = buildSitemapXml(snapshotEvil, { host: HOST, protocol: 'https' });
assert(
  xmlEvil.includes('&amp;'),
  'bonus: ampersands in slug must be escaped to &amp;',
);
assert(
  !xmlEvil.includes('<loc>https://studio.example.com/q?a=1&b=2'),
  'bonus: raw ampersand must not appear in <loc>',
);
ok('bonus: reserved XML chars in slugs are escaped');

// ---------------------------------------------------------------------------
// Bonus — protocol override (http vs https).
// ---------------------------------------------------------------------------

const xmlHttp = buildSitemapXml(snapshot1, { host: HOST, protocol: 'http' });
assert(
  xmlHttp.includes('<loc>http://studio.example.com/about#v=7</loc>'),
  'bonus: protocol option drives <loc> scheme',
);
ok('bonus: protocol override flows through to <loc>');

// ---------------------------------------------------------------------------
// Bonus — robots Sitemap directive is composed from the published address,
// stripping a trailing slash if present.
// ---------------------------------------------------------------------------

const robotsTrailing = buildRobotsTxt(snapshot1, 'https://studio.example.com/');
assert(
  robotsTrailing.includes('Sitemap: https://studio.example.com/sitemap.xml'),
  'bonus: trailing slash on published address must be normalised',
);
assert(
  !robotsTrailing.includes('Sitemap: https://studio.example.com//sitemap.xml'),
  'bonus: no double slash in Sitemap: URL after normalisation',
);
ok('bonus: trailing slash on published address is normalised');

// ---------------------------------------------------------------------------
// Bonus — root page flagged noIndex does NOT appear in robots Disallow list
// (we cannot selectively block / without blocking the whole site; the meta
// tag carries the noindex signal for the root). Sitemap still omits it.
// ---------------------------------------------------------------------------

const noIndexRoot = makePage('', 'Root', { noIndex: true });
const snapshotNoIndexRoot = makeSnapshot([noIndexRoot, aboutPage]);
const robotsNoIndexRoot = buildRobotsTxt(snapshotNoIndexRoot, PUBLISHED_ADDRESS);
// The line `Disallow: /` (root) would block the whole site; we must never
// emit it for a per-page noIndex on the root. Split into lines and check
// each one exactly so we don't accidentally also reject `Disallow: /about`.
const robotsLines = robotsNoIndexRoot.split('\n');
assert(
  !robotsLines.some((line) => line === 'Disallow: /'),
  'bonus: noIndex root must not emit Disallow: / (would block the whole site)',
);
const xmlNoIndexRoot = buildSitemapXml(snapshotNoIndexRoot, { host: HOST, protocol: 'https' });
assert(
  !xmlNoIndexRoot.includes('<loc>https://studio.example.com/#v='),
  'bonus: noIndex root is omitted from the sitemap',
);
ok('bonus: noIndex root falls through to <meta robots> only (no Disallow: /)');

// ---------------------------------------------------------------------------
// Assertion 6 — multi-locale hreflang annotations (wishlist follow-up #6).
//
// A snapshot with an English original and a Spanish sibling must emit, on
// each `<url>`, one `xhtml:link` per family member (including self) plus an
// `x-default` pointing at the canonical default-locale page.
// ---------------------------------------------------------------------------

const enAbout = makePage('about', 'About', { locale: 'en' });
const esAbout = makePage('es/about', 'Acerca de', { locale: 'es' });
const snapshotI18n = makeSnapshot([enAbout, esAbout], { defaultLocale: 'en' });
const xmlI18n = buildSitemapXml(snapshotI18n, { host: HOST, protocol: 'https' });

// Both <loc> entries are still present, one per (locale, page) pair.
const i18nLocMatches = xmlI18n.match(/<loc>/g) ?? [];
assert(
  i18nLocMatches.length === 2,
  `6: multi-locale sitemap must list 2 <loc> entries (one per locale), got ${String(i18nLocMatches.length)}`,
);
ok('6a: multi-locale sitemap lists one <loc> per (locale, page) pair');

// Each <url> block carries an xhtml:link for `en`, an xhtml:link for `es`,
// and an x-default. We slice the document into per-<url> chunks so a check
// can't accidentally pass by matching a link emitted on the other page.
function urlBlocks(xml: string): string[] {
  // Trailing-newline tolerant; opens at `  <url>` and closes at `  </url>`.
  const blocks: string[] = [];
  const opens = /  <url>/g;
  let match: RegExpExecArray | null = opens.exec(xml);
  while (match !== null) {
    const start = match.index;
    const closeRel = xml.indexOf('  </url>', start);
    if (closeRel === -1) break;
    blocks.push(xml.slice(start, closeRel + '  </url>'.length));
    match = opens.exec(xml);
  }
  return blocks;
}

const blocks = urlBlocks(xmlI18n);
assert(
  blocks.length === 2,
  `6: expected 2 <url> blocks in i18n sitemap, got ${String(blocks.length)}`,
);

const enBlock = blocks.find((b) => b.includes('<loc>https://studio.example.com/about#v=')) ?? '';
const esBlock =
  blocks.find((b) => b.includes('<loc>https://studio.example.com/es/about#v=')) ?? '';
assert(enBlock.length > 0, '6: found the <url> block for the English original');
assert(esBlock.length > 0, '6: found the <url> block for the Spanish sibling');

for (const [label, block] of [
  ['en', enBlock],
  ['es', esBlock],
] as const) {
  assert(
    block.includes(
      '<xhtml:link rel="alternate" hreflang="en" href="https://studio.example.com/about#v=7" />',
    ),
    `6: ${label} <url> includes hreflang="en" pointing at the English original`,
  );
  assert(
    block.includes(
      '<xhtml:link rel="alternate" hreflang="es" href="https://studio.example.com/es/about#v=7" />',
    ),
    `6: ${label} <url> includes hreflang="es" pointing at the Spanish sibling`,
  );
  assert(
    block.includes(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://studio.example.com/about#v=7" />',
    ),
    `6: ${label} <url> includes hreflang="x-default" pointing at the English original (canonical)`,
  );
}
ok('6b: both <url> blocks carry hreflang for en, es, and x-default');

// ---------------------------------------------------------------------------
// Assertion 7 — single-page snapshot emits NO xhtml:link elements.
// ---------------------------------------------------------------------------

const lonePage = makePage('about', 'About');
const snapshotLone = makeSnapshot([lonePage]);
const xmlLone = buildSitemapXml(snapshotLone, { host: HOST, protocol: 'https' });
assert(
  !xmlLone.includes('xhtml:link'),
  '7: a single-member family must not emit any xhtml:link elements',
);
ok('7: single-page snapshot omits hreflang annotations entirely');

// ---------------------------------------------------------------------------
// Assertion 8 — noIndex still filters family members after grouping.
//
// English original + Spanish sibling, but the Spanish sibling is marked
// noIndex. The English <url> must still be emitted, but its hreflang block
// must drop the Spanish entry — a noIndex page is not a crawlable URL and
// cannot appear as an alternate.
// ---------------------------------------------------------------------------

const enAbout2 = makePage('about', 'About', { locale: 'en' });
const esAboutNoIndex = makePage('es/about', 'Acerca de', { locale: 'es', noIndex: true });
const snapshotMixed = makeSnapshot([enAbout2, esAboutNoIndex], { defaultLocale: 'en' });
const xmlMixed = buildSitemapXml(snapshotMixed, { host: HOST, protocol: 'https' });

const mixedLocMatches = xmlMixed.match(/<loc>/g) ?? [];
assert(
  mixedLocMatches.length === 1,
  `8: noIndex Spanish sibling must be excluded — expected 1 <loc>, got ${String(mixedLocMatches.length)}`,
);
assert(
  !xmlMixed.includes('/es/about'),
  '8: the noIndex Spanish sibling slug must not appear anywhere in the sitemap',
);
// With only one crawlable member left in the family, no hreflang annotations
// at all — emitting a self-only link would be a documented anti-pattern.
assert(
  !xmlMixed.includes('xhtml:link'),
  '8: when a noIndex filter shrinks the family to one member, no xhtml:link is emitted',
);
ok('8: noIndex filtering survives the new family grouping');

// ---------------------------------------------------------------------------
// Assertion 9 — XML still well-formed after multi-locale extension.
// ---------------------------------------------------------------------------

const urlsetOpensI18n = (xmlI18n.match(/<urlset/g) ?? []).length;
const urlsetClosesI18n = (xmlI18n.match(/<\/urlset>/g) ?? []).length;
assert(
  urlsetOpensI18n === 1 && urlsetClosesI18n === 1,
  `9: i18n sitemap still has exactly one <urlset>...</urlset> pair (opens=${String(urlsetOpensI18n)} closes=${String(urlsetClosesI18n)})`,
);
balanced('<url>', '</url>', xmlI18n, '<url> (i18n)');
balanced('<loc>', '</loc>', xmlI18n, '<loc> (i18n)');
balanced('<lastmod>', '</lastmod>', xmlI18n, '<lastmod> (i18n)');
balanced('<changefreq>', '</changefreq>', xmlI18n, '<changefreq> (i18n)');
// xhtml:link is self-closing — count occurrences and verify they all end with ` />`.
const xhtmlMatches = xmlI18n.match(/<xhtml:link [^>]*\/>/g) ?? [];
const xhtmlOpens = (xmlI18n.match(/<xhtml:link/g) ?? []).length;
assert(
  xhtmlMatches.length === xhtmlOpens,
  `9: every <xhtml:link> must be self-closing (opens=${String(xhtmlOpens)} self-closed=${String(xhtmlMatches.length)})`,
);
// 2 pages × (2 siblings + 1 x-default) = 6 xhtml:link elements.
assert(
  xhtmlMatches.length === 6,
  `9: expected 6 xhtml:link elements (2 pages × 3 each), got ${String(xhtmlMatches.length)}`,
);
ok('9: i18n sitemap stays well-formed (balanced tags, self-closing xhtml:link)');

// ---------------------------------------------------------------------------
// Assertion 10 — malformed authoring fails LOUDLY (no silent guessing).
//
// A slug whose first segment matches the locale grammar but whose `locale`
// field is unset is an authoring inconsistency. The builder must throw with
// a precise error rather than silently picking a side.
// ---------------------------------------------------------------------------

const malformed = makePage('es/about', 'About');
// Intentionally NOT setting `locale: 'es'` — that's the bug.
const snapshotMalformed = makeSnapshot([malformed]);
let malformedError: Error | null = null;
try {
  buildSitemapXml(snapshotMalformed, { host: HOST, protocol: 'https' });
} catch (err) {
  malformedError = err instanceof Error ? err : new Error(String(err));
}
assert(
  malformedError !== null,
  '10: malformed page (locale-shaped prefix, no locale field) must throw',
);
assert(
  malformedError !== null && malformedError.message.includes('page-es/about'),
  `10: the thrown error must name the offending page id, got: ${malformedError?.message ?? '(none)'}`,
);
assert(
  malformedError !== null && malformedError.message.includes('es/about'),
  `10: the thrown error must name the offending slug, got: ${malformedError?.message ?? '(none)'}`,
);
ok('10: malformed locale-prefix slug with no locale field throws loudly');

// ---------------------------------------------------------------------------
process.stdout.write('[sitemap:smoke] OK — 10 assertions + bonus checks passed\n');
process.exit(0);
