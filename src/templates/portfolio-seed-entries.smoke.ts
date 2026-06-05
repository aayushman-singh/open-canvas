// src/templates/portfolio-seed-entries.smoke.ts
//
// ADR 0060 F2 + ADR 0063 F5 — pins the portfolio-showcase template's
// CMS shape:
//
//   1. The fixture no longer ships individual `page-pf-post-*` pages —
//      those are replaced by a single `collection-item-template` page.
//   2. The blog index page (`page-pf-blog`) is an ordinary CanvasPage
//      (no `pageKind`, no page-level `collectionSlug`). Its body
//      contains one Collection element pre-bound to `'blog'` via
//      element-level `collectionSlug` per ADR 0063 dec 1 + F5.
//   3. The collection-item-template page exists with the matching slug.
//   4. The seed entry list has four rows, each with the fields the
//      materializer + db insert path require.
//   5. The materializer expands the template + seed entries into four
//      concrete post pages with the expected slugs and titles.
//
// Run with `bun run portfolio-seed-entries:smoke`.

import type { EditableSite } from '../canvas/schema.js';
import {
  materializeCollections,
  type MaterializerEntry,
} from '../canvas/elements/collection-materializer.js';
import { validateEditableSite } from '../canvas/validate.js';
import { PORTFOLIO_SHOWCASE_SEED_ENTRIES } from './portfolio-seed-entries.js';
import { instantiateTemplate, portfolioShowcaseTemplate } from './registry.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[portfolio-seed-entries:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// (1) Fixture: no leftover post pages, template + index pages present
// ---------------------------------------------------------------------------

{
  const state = instantiateTemplate(portfolioShowcaseTemplate.id);
  const postPages = state.pages.filter((p) => /^page-pf-post-/.test(p.id));
  const templatePages = postPages.filter((p) => p.pageKind === 'collection-item-template');
  const concretePostPages = postPages.filter((p) => p.pageKind === undefined);

  assert(
    templatePages.length === 1,
    `(1) expected exactly one collection-item-template page (got ${String(templatePages.length)})`,
  );
  assert(
    concretePostPages.length === 0,
    `(1) no individual post pages may remain in the fixture (got ${concretePostPages
      .map((p) => p.id)
      .join(', ')})`,
  );

  const templatePage = templatePages[0]!;
  assert(
    templatePage.collectionSlug === 'blog',
    `(1) template page must bind to "blog" (got ${String(templatePage.collectionSlug)})`,
  );
}

// ---------------------------------------------------------------------------
// (2) Blog index page carries no page-level pageKind/collectionSlug after
//     ADR 0063 F5 — the binding lives on the Collection element instead.
// ---------------------------------------------------------------------------

{
  const state = instantiateTemplate(portfolioShowcaseTemplate.id);
  const indexPage = state.pages.find((p) => p.id === 'page-pf-blog');
  assert(indexPage !== undefined, '(2) page-pf-blog must be present');
  assert(
    indexPage!.pageKind === undefined,
    '(2) page-pf-blog must not carry pageKind after F5 (collection-index is retired)',
  );
  assert(
    indexPage!.collectionSlug === undefined,
    '(2) page-pf-blog must not carry page-level collectionSlug after F5',
  );
  // Find the Collection element inside the blog-list section and confirm
  // its element-level binding survived the JSON edit.
  const allElements = indexPage!.sections.flatMap((s) => s.elements);
  const collection = allElements.find((e) => e.type === 'collection');
  assert(collection !== undefined, '(2) page-pf-blog must contain a Collection element');
  assert(
    (collection as { collectionSlug?: string }).collectionSlug === 'blog',
    '(2) Collection element must bind to "blog" via element-level collectionSlug',
  );
}

// ---------------------------------------------------------------------------
// (3) Seed entries: shape + count
// ---------------------------------------------------------------------------

{
  const entries = PORTFOLIO_SHOWCASE_SEED_ENTRIES;
  assert(entries.length === 4, `(3) expected 4 seed entries (got ${String(entries.length)})`);

  const slugs = new Set(entries.map((e) => e.slug));
  assert(slugs.size === 4, '(3) seed entry slugs must be unique');

  for (const entry of entries) {
    assert(entry.collectionSlug === 'blog', `(3) ${entry.slug}: collectionSlug must be "blog"`);
    assert(entry.title.length > 0, `(3) ${entry.slug}: title required`);
    assert(entry.excerpt.length > 0, `(3) ${entry.slug}: excerpt required`);
    assert(entry.body.length > 0, `(3) ${entry.slug}: body required`);
    assert(/^\d{4}-\d{2}-\d{2}/.test(entry.publishedDate), `(3) ${entry.slug}: ISO date required`);
    assert(entry.author.length > 0, `(3) ${entry.slug}: author required`);
    assert(entry.category === 'notes', `(3) ${entry.slug}: category must match index filter`);
    assert(Array.isArray(entry.tags), `(3) ${entry.slug}: tags must be an array`);
    assert(entry.status === 'published', `(3) ${entry.slug}: seed entries ship as published`);
  }
}

// ---------------------------------------------------------------------------
// (4) Materializer expands template + entries into N concrete post pages
// ---------------------------------------------------------------------------

{
  const seed = PORTFOLIO_SHOWCASE_SEED_ENTRIES;
  const materializerEntries: MaterializerEntry[] = seed.map((row) => ({
    collectionSlug: row.collectionSlug,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    publishedDate: row.publishedDate,
    author: row.author,
    category: row.category,
    tags: row.tags,
    ogImageAssetId: row.ogImageAssetId,
  }));
  const state: EditableSite = instantiateTemplate(portfolioShowcaseTemplate.id);
  const materialized = materializeCollections(state, materializerEntries);

  const concretePostPages = materialized.pages.filter((p) => p.slug.startsWith('blog/'));
  assert(
    concretePostPages.length === 4,
    `(4) expected 4 expanded post pages (got ${String(concretePostPages.length)})`,
  );

  const expectedSlugs = new Set([
    'blog/demos-lie',
    'blog/jarvis-self-healing-ci',
    'blog/local-first-honest',
    'blog/state-trust',
  ]);
  for (const page of concretePostPages) {
    assert(
      expectedSlugs.has(page.slug),
      `(4) unexpected expanded slug ${page.slug}`,
    );
    assert(
      page.pageKind === undefined,
      `(4) expanded page ${page.slug} must drop pageKind`,
    );
    assert(
      page.collectionSlug === undefined,
      `(4) expanded page ${page.slug} must drop collectionSlug`,
    );
  }
}

// ---------------------------------------------------------------------------
// (5) Materialized site validates end-to-end (no schema break)
// ---------------------------------------------------------------------------

{
  const seed = PORTFOLIO_SHOWCASE_SEED_ENTRIES;
  const materializerEntries: MaterializerEntry[] = seed.map((row) => ({
    collectionSlug: row.collectionSlug,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    publishedDate: row.publishedDate,
    author: row.author,
    category: row.category,
    tags: row.tags,
    ogImageAssetId: row.ogImageAssetId,
  }));
  const materialized = materializeCollections(instantiateTemplate(portfolioShowcaseTemplate.id), materializerEntries);
  const result = validateEditableSite(materialized);
  assert(
    result.valid,
    `(5) materialized portfolio site must validate (errors: ${result.valid ? '' : result.errors.join('; ')})`,
  );
}

console.log('[portfolio-seed-entries:smoke] OK');
