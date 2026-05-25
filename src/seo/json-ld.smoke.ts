// src/seo/json-ld.smoke.ts
//
// Smoke test for Schema.org JSON-LD structured data emission.
// Run with `bun.cmd run seo:smoke` (or directly `bun src/seo/json-ld.smoke.ts`).
//
// Asserts:
//   1. emitPageMeta emits a <script type="application/ld+json"> tag.
//   2. The JSON inside is valid and contains @context, @type, name.
//   3. A page with description includes `description` in the JSON-LD.
//   4. A page without description omits `description` from the JSON-LD.
//   5. The canonical URL is included as `url` when present.
//   6. The OG image is included as `image` when present.
//   7. Special characters in title/description are safely encoded (no raw
//      `</script>` possible in the output).

import type { CanvasPage, PublishedSnapshot } from '../canvas/schema.js';
import { emitPageMeta } from './meta-emit.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    process.stderr.write(`[json-ld:smoke] FAIL — ${message}\n`);
    process.exit(1);
  }
}

function makeSnapshot(pages: CanvasPage[]): PublishedSnapshot {
  return {
    version: 1,
    publishedAt: '2026-05-25T00:00:00.000Z',
    styleKit: 'charcoal',
    pages,
  };
}

function extractJsonLd(meta: string): Record<string, unknown> | null {
  const tag = '<script type="application/ld+json">';
  const start = meta.indexOf(tag);
  if (start === -1) return null;
  const bodyStart = start + tag.length;
  const end = meta.indexOf('</script>', bodyStart);
  if (end === -1) return null;
  const raw = meta.slice(bodyStart, end);
  return JSON.parse(raw) as Record<string, unknown>;
}

const SITE_ID = 'site-jsonld-smoke';
const HOST = 'example.com';

// ---------------------------------------------------------------------------
// 1. emitPageMeta emits a JSON-LD script tag.
// ---------------------------------------------------------------------------

const page1: CanvasPage = {
  id: 'p1',
  slug: 'home',
  title: 'Home',
  width: 1440,
  sections: [],
};
const snap1 = makeSnapshot([page1]);
const meta1 = emitPageMeta(page1, { siteId: SITE_ID, host: HOST, snapshot: snap1 });

assert(
  meta1.includes('<script type="application/ld+json">'),
  '1: output must contain a JSON-LD script tag',
);

// ---------------------------------------------------------------------------
// 2. The JSON is valid and contains @context, @type, name.
// ---------------------------------------------------------------------------

const ld1 = extractJsonLd(meta1);
assert(ld1 !== null, '2: JSON-LD must be parseable');
assert(ld1!['@context'] === 'https://schema.org', '2: @context must be https://schema.org');
assert(ld1!['@type'] === 'WebPage', '2: @type must be WebPage');
assert(ld1!['name'] === 'Home', '2: name must equal page.title');

// ---------------------------------------------------------------------------
// 3. A page with description includes `description` in JSON-LD.
// ---------------------------------------------------------------------------

const page3: CanvasPage = {
  id: 'p3',
  slug: 'about',
  title: 'About',
  width: 1440,
  sections: [],
  description: 'All about us.',
};
const snap3 = makeSnapshot([page3]);
const meta3 = emitPageMeta(page3, { siteId: SITE_ID, host: HOST, snapshot: snap3 });
const ld3 = extractJsonLd(meta3);
assert(ld3 !== null, '3: JSON-LD must be parseable');
assert(ld3!['description'] === 'All about us.', '3: description must be present in JSON-LD');

// ---------------------------------------------------------------------------
// 4. A page without description omits `description` from JSON-LD.
// ---------------------------------------------------------------------------

assert(!('description' in ld1!), '4: JSON-LD must omit description when page has none');

// ---------------------------------------------------------------------------
// 5. The canonical URL is included as `url`.
// ---------------------------------------------------------------------------

assert(
  ld3!['url'] === 'https://example.com/about',
  '5: JSON-LD url must equal the computed canonical',
);

// Also test explicit canonical override.
const page5: CanvasPage = {
  id: 'p5',
  slug: 'legacy',
  title: 'Legacy',
  width: 1440,
  sections: [],
  canonical: 'https://custom.example.com/page',
};
const snap5 = makeSnapshot([page5]);
const meta5 = emitPageMeta(page5, { siteId: SITE_ID, host: HOST, snapshot: snap5 });
const ld5 = extractJsonLd(meta5);
assert(ld5 !== null, '5b: JSON-LD must be parseable');
assert(
  ld5!['url'] === 'https://custom.example.com/page',
  '5b: JSON-LD url must use explicit page.canonical when set',
);

// ---------------------------------------------------------------------------
// 6. The OG image is included as `image`.
// ---------------------------------------------------------------------------

const page6: CanvasPage = {
  id: 'p6',
  slug: 'launch',
  title: 'Launch',
  width: 1440,
  sections: [],
  ogImageAssetId: 'asset-xyz',
};
const KNOWN_HASH = 'b'.repeat(64);
const snap6 = makeSnapshot([page6]);
const meta6 = emitPageMeta(page6, {
  siteId: SITE_ID,
  host: HOST,
  snapshot: snap6,
  assetLookup: (id) => (id === 'asset-xyz' ? KNOWN_HASH : null),
});
const ld6 = extractJsonLd(meta6);
assert(ld6 !== null, '6: JSON-LD must be parseable');
assert(ld6!['image'] === `/assets/${KNOWN_HASH}`, '6: JSON-LD image must resolve from asset lookup');

// ---------------------------------------------------------------------------
// 7. Special characters — no raw `</script>` possible.
// ---------------------------------------------------------------------------

const page7: CanvasPage = {
  id: 'p7',
  slug: 'xss',
  title: '</script><script>alert(1)</script>',
  width: 1440,
  sections: [],
  description: 'A "quoted" & <dangerous> value with </script> inside',
};
const snap7 = makeSnapshot([page7]);
const meta7 = emitPageMeta(page7, { siteId: SITE_ID, host: HOST, snapshot: snap7 });

// The JSON-LD body must not contain a literal `</script>` that would break out.
const jsonLdTag = '<script type="application/ld+json">';
const jsonLdStart = meta7.indexOf(jsonLdTag) + jsonLdTag.length;
const jsonLdEnd = meta7.indexOf('</script>', jsonLdStart);
const jsonLdBody = meta7.slice(jsonLdStart, jsonLdEnd);

assert(
  !jsonLdBody.includes('</script>'),
  '7: JSON-LD body must not contain raw </script>',
);
assert(
  !jsonLdBody.includes('<'),
  '7: JSON-LD body must not contain any raw < character',
);

// The JSON must still parse correctly (\\u003c decodes to <).
const ld7 = JSON.parse(jsonLdBody) as Record<string, unknown>;
assert(
  ld7['name'] === '</script><script>alert(1)</script>',
  '7: JSON-LD name must round-trip the original title via \\u003c escaping',
);
assert(
  (ld7['description'] as string).includes('</script>'),
  '7: JSON-LD description must round-trip the original value via \\u003c escaping',
);

// ---------------------------------------------------------------------------
process.stdout.write('[json-ld:smoke] OK — 7 assertions passed\n');
process.exit(0);
