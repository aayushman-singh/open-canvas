// src/seo/smoke.ts
//
// Manual smoke for wishlist #21 — SEO meta + page metadata.
// Run with `bun.cmd run seo:smoke`.
//
// Asserts the six behaviours from the plan:
//   1. Page w/ title + description → output contains <title>, <meta name=description>,
//      and OG + Twitter equivalents.
//   2. noIndex: true → robots noindex,nofollow emitted.
//   3. ogImageAssetId set → og:image points to /assets/<contentHash> (stub lookup).
//   4. Without ogImageAssetId → og:image falls back to /og/<siteId>/<pageSlug>.png.
//      With an explicit but unresolved ogImageAssetId → throws loudly.
//   5. HTML entities in title/description escaped correctly.
//   6. Site-level siteNoIndex overrides per-page (always noindex).
//
// Bonus: round-trips through `renderCanvasSnapshot`'s additive
// `emitHeadMeta` hook to prove the contract holds.

import { renderCanvasSnapshot } from '../canvas/render.js';
import type { CanvasPage, PublishedSnapshot } from '../canvas/schema.js';
import { emitPageMeta, renderCanvasHead, resolveLang, resolveNoIndex } from './meta-emit.js';
import { resolveOgUrl } from './og-resolve.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    process.stderr.write(`[seo:smoke] FAIL — ${message}\n`);
    process.exit(1);
  }
}

function makeSnapshot(pages: CanvasPage[], extra: Record<string, unknown> = {}): PublishedSnapshot {
  // The base obeys the PublishedSnapshot shape; the optional `extra` overlay
  // is how the smoke threads experimental fields (`siteNoIndex`,
  // `defaultLocale`) that live on `CanvasSiteState` but may surface on the
  // snapshot via the structural probe in `meta-emit.ts`. We assemble the
  // base first, then attach extras via Object.assign so the resulting value
  // keeps the static `PublishedSnapshot` type.
  const base: PublishedSnapshot = {
    version: 1,
    publishedAt: '2026-05-23T00:00:00.000Z',
    styleKit: 'charcoal',
    pages,
  };
  Object.assign(base, extra);
  return base;
}

const SITE_ID = 'site-seo-smoke';
const HOST = 'studio.example.com';

// ---------------------------------------------------------------------------
// Assertion 1 — title + description emit all expected tags.
// ---------------------------------------------------------------------------

const page1: CanvasPage = {
  id: 'page-1',
  slug: 'about',
  title: 'About Us',
  width: 1440,
  sections: [],
  description: 'Who we are and what we ship.',
};

const snapshot1 = makeSnapshot([page1]);
const meta1 = emitPageMeta(page1, { siteId: SITE_ID, host: HOST, snapshot: snapshot1 });

assert(meta1.includes('<title>About Us</title>'), '1: <title> must contain the page title');
assert(
  meta1.includes('<meta name="description" content="Who we are and what we ship.">'),
  '1: <meta name="description"> must reflect page.description',
);
assert(
  meta1.includes('<meta property="og:title" content="About Us">'),
  '1: og:title must reflect page.title',
);
assert(
  meta1.includes('<meta property="og:description" content="Who we are and what we ship.">'),
  '1: og:description must reflect page.description',
);
assert(meta1.includes('<meta property="og:type" content="website">'), '1: og:type must be website');
assert(
  meta1.includes('<meta property="og:url" content="https://studio.example.com/about">'),
  '1: og:url must reflect the computed canonical URL',
);
assert(
  meta1.includes('<meta name="twitter:card" content="summary_large_image">'),
  '1: twitter:card must be summary_large_image',
);
assert(
  meta1.includes('<meta name="twitter:title" content="About Us">'),
  '1: twitter:title must reflect page.title',
);
assert(
  meta1.includes('<meta name="twitter:description" content="Who we are and what we ship.">'),
  '1: twitter:description must reflect page.description',
);
assert(
  meta1.includes('<link rel="canonical" href="https://studio.example.com/about">'),
  '1: <link rel=canonical> must compute from host + slug when canonical is unset',
);

// ---------------------------------------------------------------------------
// Assertion 2 — noIndex true emits robots noindex,nofollow.
// ---------------------------------------------------------------------------

const page2: CanvasPage = {
  id: 'page-2',
  slug: 'staging',
  title: 'Staging',
  width: 1440,
  sections: [],
  noIndex: true,
};
const snapshot2 = makeSnapshot([page2]);
const meta2 = emitPageMeta(page2, { siteId: SITE_ID, host: HOST, snapshot: snapshot2 });
assert(
  meta2.includes('<meta name="robots" content="noindex,nofollow">'),
  '2: noIndex:true must emit robots noindex,nofollow',
);
assert(
  resolveNoIndex(page2, snapshot2) === true,
  '2: resolveNoIndex must agree with the emit output',
);

// A page with neither flag must NOT emit the robots tag.
const meta1NoRobots = !meta1.includes('name="robots"');
assert(meta1NoRobots, '2: page without noIndex must not emit a robots meta tag');

// ---------------------------------------------------------------------------
// Assertion 3 — ogImageAssetId resolves to /assets/<contentHash> via the
// stub lookup. Stub: the test owns the id→hash map; in production this is
// the snapshot-bundled asset map or a DB lookup.
// ---------------------------------------------------------------------------

const KNOWN_ASSET_ID = 'asset-abc-123';
const KNOWN_ASSET_HASH = 'a'.repeat(64); // 64-hex content hash.

function stubAssetLookup(assetId: string): string | null {
  if (assetId === KNOWN_ASSET_ID) return KNOWN_ASSET_HASH;
  return null;
}

const page3: CanvasPage = {
  id: 'page-3',
  slug: 'launch',
  title: 'Launch',
  width: 1440,
  sections: [],
  description: 'Launch day.',
  ogImageAssetId: KNOWN_ASSET_ID,
};
const snapshot3 = makeSnapshot([page3]);
const meta3 = emitPageMeta(page3, {
  siteId: SITE_ID,
  host: HOST,
  snapshot: snapshot3,
  assetLookup: stubAssetLookup,
});
assert(
  meta3.includes(`<meta property="og:image" content="https://${HOST}/assets/${KNOWN_ASSET_HASH}">`),
  '3: og:image must be an absolute URL pointing to /assets/<contentHash> when ogImageAssetId resolves',
);
assert(
  meta3.includes(`<meta name="twitter:image" content="https://${HOST}/assets/${KNOWN_ASSET_HASH}">`),
  '3: twitter:image must be an absolute URL pointing to /assets/<contentHash> when ogImageAssetId resolves',
);
// resolveOgUrl direct check.
assert(
  resolveOgUrl(page3, { siteId: SITE_ID, assetLookup: stubAssetLookup }) ===
    `/assets/${KNOWN_ASSET_HASH}`,
  '3: resolveOgUrl must return /assets/<hash> when the lookup resolves',
);
const meta3Direct = emitPageMeta(page3, {
  siteId: SITE_ID,
  host: HOST,
  snapshot: snapshot3,
});
assert(
  meta3Direct.includes(`<meta property="og:image" content="https://${HOST}/assets/${KNOWN_ASSET_ID}">`),
  '3: og:image must be an absolute URL pointing to /assets/<assetId> when the public renderer has no asset lookup',
);

// ---------------------------------------------------------------------------
// Assertion 4 — without ogImageAssetId, og:image falls back to the generator.
// ---------------------------------------------------------------------------

const page4: CanvasPage = {
  id: 'page-4',
  slug: 'contact',
  title: 'Contact',
  width: 1440,
  sections: [],
};
const snapshot4 = makeSnapshot([page4]);
const meta4 = emitPageMeta(page4, { siteId: SITE_ID, host: HOST, snapshot: snapshot4 });
const expectedRelativeFallback = `/og/${encodeURIComponent(SITE_ID)}/${encodeURIComponent('contact')}.png`;
const expectedFallback = `https://${HOST}${expectedRelativeFallback}`;
assert(
  meta4.includes(`<meta property="og:image" content="${expectedFallback}">`),
  `4: og:image must be an absolute URL falling back to the OG generator`,
);
assert(
  meta4.includes(`<meta name="twitter:image" content="${expectedFallback}">`),
  `4: twitter:image must be an absolute URL falling back to the OG generator`,
);
assert(
  resolveOgUrl(page4, { siteId: SITE_ID }) === expectedRelativeFallback,
  '4: resolveOgUrl must produce the relative generator URL when no asset id is set',
);

// Also: an asset id present but unresolved is a publish/metadata integrity
// error. It must not silently fall through to a generated image that hides
// the broken explicit choice.
const page4b: CanvasPage = { ...page4, ogImageAssetId: 'missing-asset-id' };
let unresolvedOgThrew = false;
try {
  emitPageMeta(page4b, {
    siteId: SITE_ID,
    host: HOST,
    snapshot: snapshot4,
    assetLookup: stubAssetLookup,
  });
} catch (err) {
  unresolvedOgThrew = true;
  assert(
    err instanceof Error && err.message.includes('missing-asset-id'),
    `4: unresolved ogImageAssetId error must name the missing id, got ${err instanceof Error ? err.message : String(err)}`,
  );
}
assert(unresolvedOgThrew, '4: unresolved ogImageAssetId must throw loudly');

// ---------------------------------------------------------------------------
// Assertion 5 — HTML entities in title/description escaped correctly.
// ---------------------------------------------------------------------------

const page5: CanvasPage = {
  id: 'page-5',
  slug: 'specials',
  title: 'Ship "fast" & <bold>',
  width: 1440,
  sections: [],
  description: '<script>alert(1)</script> & "smart" quotes',
};
const snapshot5 = makeSnapshot([page5]);
const meta5 = emitPageMeta(page5, { siteId: SITE_ID, host: HOST, snapshot: snapshot5 });

// <title> uses text-content escaping: & < > only (quotes stay literal).
assert(
  meta5.includes('<title>Ship "fast" &amp; &lt;bold&gt;</title>'),
  '5: <title> must escape & < > (quotes pass through in text content)',
);
// Attribute escaping: " ' & < > all encoded.
assert(
  meta5.includes('<meta property="og:title" content="Ship &quot;fast&quot; &amp; &lt;bold&gt;">'),
  '5: og:title attribute must escape quotes and entities',
);
assert(
  meta5.includes(
    '<meta name="description" content="&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;smart&quot; quotes">',
  ),
  '5: description attribute must escape angle brackets, ampersands, and quotes',
);
// Defense in depth: the raw <script substring must NOT appear unescaped.
assert(
  !meta5.includes('<script>alert(1)</script>'),
  '5: raw <script>...</script> must not appear in emitted meta block',
);

// ---------------------------------------------------------------------------
// Assertion 6 — site-level siteNoIndex overrides per-page (always noindex).
// ---------------------------------------------------------------------------

const page6Indexable: CanvasPage = {
  id: 'page-6',
  slug: 'public',
  title: 'Public',
  width: 1440,
  sections: [],
  // No noIndex flag set on the page itself.
};
const snapshot6 = makeSnapshot([page6Indexable], { siteNoIndex: true });
assert(
  resolveNoIndex(page6Indexable, snapshot6) === true,
  '6: site-level siteNoIndex must override an unset per-page flag',
);
const meta6 = emitPageMeta(page6Indexable, { siteId: SITE_ID, host: HOST, snapshot: snapshot6 });
assert(
  meta6.includes('<meta name="robots" content="noindex,nofollow">'),
  '6: site-level siteNoIndex must emit the robots meta',
);

// And the reverse: an explicitly noIndex page on a site without the toggle
// still emits noindex (sanity check the OR semantics).
const snapshot6b = makeSnapshot([page2]); // page2.noIndex = true, no site flag.
assert(
  resolveNoIndex(page2, snapshot6b) === true,
  '6: per-page noIndex still triggers when siteNoIndex is unset',
);

// ---------------------------------------------------------------------------
// Bonus — resolveLang fallback chain and renderCanvasHead sibling integration.
// ---------------------------------------------------------------------------

const pageLocale: CanvasPage = {
  id: 'page-locale',
  slug: 'fr',
  title: 'Bonjour',
  width: 1440,
  sections: [],
  locale: 'fr',
};
assert(resolveLang(pageLocale, snapshot1) === 'fr', 'lang: per-page locale wins');
assert(resolveLang(page1, snapshot1) === 'en', 'lang: defaults to en when nothing else set');

const snapshotDefault = makeSnapshot([page1], { defaultLocale: 'es' });
assert(
  resolveLang(page1, snapshotDefault) === 'es',
  'lang: snapshot defaultLocale wins when per-page locale is unset',
);

// renderCanvasHead — finds the page by slug and emits its meta.
const headMeta = renderCanvasHead(snapshot3, {
  siteId: SITE_ID,
  host: HOST,
  pageSlug: 'launch',
  assetLookup: stubAssetLookup,
});
assert(
  headMeta.includes('<title>Launch</title>'),
  'renderCanvasHead: selects the page by slug and emits its title',
);

// renderCanvasSnapshot — additive emitHeadMeta hook is invoked per page.
const collected: string[] = [];
const snapshotMulti = makeSnapshot([page1, page4]);
renderCanvasSnapshot(snapshotMulti, '/assets', SITE_ID, {
  emitHeadMeta: (page) => {
    collected.push(page.slug);
    return emitPageMeta(page, { siteId: SITE_ID, host: HOST, snapshot: snapshotMulti });
  },
});
assert(
  collected.length === 2 && collected[0] === 'about' && collected[1] === 'contact',
  'render hook: emitHeadMeta must be invoked once per page in order',
);

// ---------------------------------------------------------------------------
process.stdout.write('[seo:smoke] OK — 6 assertions + bonus checks passed\n');
process.exit(0);
