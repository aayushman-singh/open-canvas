// src/editor-client/sections-picker.smoke.ts
//
// ADR 0061 Phase E — picker filter / haystack / sort smoke.
//
// The renderer talks to the DOM; the *behaviour* it depends on (which
// entries pass the filter, how the haystack matches, which order they
// come out in) lives in the pure `filterAndSortCatalog` function. This
// smoke runs that function against a mixed-category fixture and pins:
//
//   1. Category filter rejects entries whose `category` doesn't match;
//      `'all'` lets everything through.
//   2. Search haystack matches against slug + name + recipeId + category
//      + headingPreview + originTemplateName + description (Decision 11).
//      In particular: searching "testimonial" now surfaces the
//      `library-template-testimonial-quote` entry, which the pre-Phase-E
//      haystack (name + headingPreview + templateName only) would miss.
//   3. Sort mode 'a-z' orders by name ascending; 'recent' orders by
//      createdAt DESC, surfacing Owner-saved rows before the seed
//      sentinel rows.
//
// Run with `bun run sections-picker:smoke`.

import {
  filterAndSortCatalog,
  type SectionsCatalogEntry,
} from './sections-picker.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[sections-picker:smoke] ${message}`);
}

// -- Fixture ------------------------------------------------------------------

const SEED_TS = '1970-01-01T00:00:00.000Z';

function makeEntry(overrides: Partial<SectionsCatalogEntry>): SectionsCatalogEntry {
  return {
    source: 'seed',
    id: overrides.id ?? 'fixture',
    name: 'Fixture',
    recipeId: 'custom',
    headingPreview: '',
    visibility: 'global',
    category: 'other',
    description: '',
    baseSlug: 'fixture-slug',
    createdAt: SEED_TS,
    thumbnail: '',
    ...overrides,
  };
}

const catalog: SectionsCatalogEntry[] = [
  makeEntry({
    id: 'apogee-hero',
    name: 'Apogee Hero',
    category: 'hero',
    recipeId: 'hero-split',
    baseSlug: 'apogee-template-hero',
    headingPreview: 'Welcome to Apogee',
    templateName: 'Apogee Showcase',
  }),
  makeEntry({
    id: 'starter-features',
    name: 'Feature grid',
    category: 'features',
    recipeId: 'feature-grid',
    baseSlug: 'starter-template-features',
    headingPreview: 'Three feature columns',
    templateName: 'Starter Canvas',
  }),
  makeEntry({
    id: 'testimonial-quote',
    name: 'Testimonial — Quote',
    category: 'testimonials',
    recipeId: 'testimonial-row',
    baseSlug: 'library-template-testimonial-quote',
    headingPreview: 'A pulled quote',
    description: 'Single big quote + attribution',
    source: 'library',
    createdAt: '2026-06-04T00:00:00.000Z',
  }),
  makeEntry({
    id: 'recent-private',
    name: 'My recent save',
    category: 'cta',
    recipeId: 'cta-band',
    baseSlug: 'my-private-slug',
    description: 'Owner-saved at the latest moment',
    source: 'library',
    visibility: 'private',
    createdAt: '2026-06-04T10:00:00.000Z',
  }),
];

// -- Invariant 1: category filter ---------------------------------------------

{
  const all = filterAndSortCatalog(catalog, { category: 'all', query: '', sort: 'a-z' });
  assert(all.length === catalog.length, `category='all' should return every entry; got ${String(all.length)}/${String(catalog.length)}`);

  const heroes = filterAndSortCatalog(catalog, { category: 'hero', query: '', sort: 'a-z' });
  assert(heroes.length === 1 && heroes[0]!.id === 'apogee-hero', `category='hero' should yield exactly [apogee-hero]`);

  const testimonials = filterAndSortCatalog(catalog, { category: 'testimonials', query: '', sort: 'a-z' });
  assert(testimonials.length === 1 && testimonials[0]!.id === 'testimonial-quote', `category='testimonials' should yield exactly [testimonial-quote]`);

  const empty = filterAndSortCatalog(catalog, { category: 'gallery', query: '', sort: 'a-z' });
  assert(empty.length === 0, `category='gallery' has no matches in the fixture`);
}

// -- Invariant 2: widened haystack --------------------------------------------

{
  // Pre-Phase-E haystack would miss this because 'testimonial' is only in
  // slug + description + category, not in name + headingPreview + templateName.
  const byCategory = filterAndSortCatalog(catalog, { category: 'all', query: 'testimonial', sort: 'a-z' });
  assert(
    byCategory.some((e) => e.id === 'testimonial-quote'),
    `query='testimonial' must surface 'testimonial-quote' via category/slug/description match`,
  );

  // recipeId now searchable too.
  const byRecipe = filterAndSortCatalog(catalog, { category: 'all', query: 'feature-grid', sort: 'a-z' });
  assert(byRecipe.length === 1 && byRecipe[0]!.id === 'starter-features', `query='feature-grid' must surface entries with that recipeId`);

  // Origin template name still in haystack.
  const byTemplate = filterAndSortCatalog(catalog, { category: 'all', query: 'apogee', sort: 'a-z' });
  assert(
    byTemplate.some((e) => e.id === 'apogee-hero'),
    `query='apogee' must surface entries with that templateName`,
  );

  // baseSlug matches.
  const bySlug = filterAndSortCatalog(catalog, { category: 'all', query: 'library-template-testimonial-quote', sort: 'a-z' });
  assert(bySlug.length === 1 && bySlug[0]!.id === 'testimonial-quote', `query matching a full baseSlug must surface that entry`);

  // Empty query returns all entries.
  const emptyQuery = filterAndSortCatalog(catalog, { category: 'all', query: '', sort: 'a-z' });
  assert(emptyQuery.length === catalog.length, `empty query should not filter anything out`);

  // Case-insensitive.
  const upper = filterAndSortCatalog(catalog, { category: 'all', query: 'APOGEE', sort: 'a-z' });
  assert(upper.some((e) => e.id === 'apogee-hero'), `query should be case-insensitive`);
}

// -- Invariant 3: sort modes --------------------------------------------------

{
  const az = filterAndSortCatalog(catalog, { category: 'all', query: '', sort: 'a-z' });
  const azNames = az.map((e) => e.name);
  const expectedAz = [...azNames].sort((a, b) => a.localeCompare(b));
  assert(
    azNames.every((n, i) => n === expectedAz[i]),
    `sort='a-z' must order by name ascending; got [${azNames.join(', ')}]`,
  );

  const recent = filterAndSortCatalog(catalog, { category: 'all', query: '', sort: 'recent' });
  // The 'recent-private' entry has the latest timestamp; must come first.
  assert(recent[0]!.id === 'recent-private', `sort='recent' must put the most recent createdAt first; got ${recent[0]!.id}`);
  // Both seed entries carry the 1970 sentinel; they sort after every real DB row.
  const seedIndices = recent
    .map((e, i) => ({ i, isSeed: e.createdAt === SEED_TS }))
    .filter((x) => x.isSeed)
    .map((x) => x.i);
  const nonSeedIndices = recent
    .map((e, i) => ({ i, isSeed: e.createdAt === SEED_TS }))
    .filter((x) => !x.isSeed)
    .map((x) => x.i);
  const lastNonSeed = Math.max(...nonSeedIndices);
  const firstSeed = Math.min(...seedIndices);
  assert(lastNonSeed < firstSeed, `sort='recent' must place 1970-sentinel seed rows after every Owner-saved row`);
}

console.log(`[sections-picker:smoke] OK — category filter + widened haystack + sort modes verified across ${String(catalog.length)} fixtures`);
