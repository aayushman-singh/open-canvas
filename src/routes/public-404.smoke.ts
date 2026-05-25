// src/routes/public-404.smoke.ts
//
// Smoke test for the custom _404 canvas page feature.
// Run with `bun run public-404:smoke`.
//
// Asserts the three behaviours:
//   1. When a snapshot has a page with slug `_404`, prepareRender('/_404', snapshot)
//      returns that page (non-null).
//   2. When a snapshot does NOT have a `_404` page, prepareRender('/_404', snapshot)
//      returns page: null — caller falls through to the generic text 404.
//   3. A request to a non-existent slug on a snapshot WITH a `_404` page triggers
//      the _404 render path (simulated logic match).

import type { CanvasPage, PublishedSnapshot } from '../canvas/schema.js';
import { prepareRender } from '../i18n/render-hook.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    process.stderr.write(`[public-404:smoke] FAIL — ${message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePage(slug: string): CanvasPage {
  return {
    id: `page-${slug}`,
    slug,
    title: slug,
    width: 1440,
    sections: [
      {
        id: `sec-${slug}`,
        recipeId: 'hero-split',
        name: slug,
        height: 400,
        elements: [],
      },
    ],
  };
}

function makeSnapshot(pages: CanvasPage[]): PublishedSnapshot {
  return {
    version: 1,
    publishedAt: '2026-05-25T00:00:00.000Z',
    styleKit: 'charcoal',
    pages,
  };
}

// ---------------------------------------------------------------------------
// Assertion 1 — snapshot with a _404 page resolves it via prepareRender.
// ---------------------------------------------------------------------------

const homePage = makePage('home');
const notFoundPage = makePage('_404');
const snapshotWith404 = makeSnapshot([homePage, notFoundPage]);

const result1 = prepareRender('/_404', snapshotWith404);
assert(result1.page !== null, '1: prepareRender(/_404) must find the _404 page');
assert(result1.page!.slug === '_404', '1: resolved page slug must be _404');
assert(result1.pageSlug === '_404', '1: pageSlug must be _404');

// ---------------------------------------------------------------------------
// Assertion 2 — snapshot WITHOUT a _404 page returns page: null.
// ---------------------------------------------------------------------------

const snapshotWithout404 = makeSnapshot([homePage]);

const result2 = prepareRender('/_404', snapshotWithout404);
assert(result2.page === null, '2: prepareRender(/_404) must return null when no _404 page exists');

// ---------------------------------------------------------------------------
// Assertion 3 — the routing logic: unknown slug on snapshot with _404.
//
// Simulates the decision logic in src/routes/public.ts: when a primary
// prepareRender returns page: null and a _404 page exists, the code retries
// with '/_404' and uses that as the active render.
// ---------------------------------------------------------------------------

const unknownResult = prepareRender('/totally-unknown-page', snapshotWith404);
assert(unknownResult.page === null, '3: unknown slug must yield page: null initially');

// Now simulate the fallback logic from public.ts:
const notFoundRender = prepareRender('/_404', snapshotWith404);
assert(
  notFoundRender.page !== null,
  '3: _404 fallback render must find the _404 page for the 404 response',
);

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

process.stdout.write('[public-404:smoke] All assertions passed.\n');
