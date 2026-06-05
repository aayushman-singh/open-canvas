// src/canvas/collections-scaffold.smoke.ts
//
// ADR 0063 Decision 11 — pins the "+ New Collection" wizard's pure scaffold:
//
//   1. Valid slug produces an index page + template page + two seed entries.
//   2. The index page is an ordinary CanvasPage (no pageKind, no page-level
//      collectionSlug — ADR 0063 F5 retired that binding model). The
//      template page still carries pageKind='collection-item-template' +
//      matching collectionSlug. The Collection element on the index page
//      ships ADR-0063 element-level binding (collectionSlug,
//      sort='date-desc', display='card').
//   3. The materializer expands the template + each seed entry into one
//      concrete page per entry.
//   4. The resulting site validates end-to-end.
//   5. Slug rule failures (uppercase, empty, too long, bad chars) error
//      with `step: 'slug-format'`.
//   6. Slug already in use as a page slug / collectionSlug errors with
//      `step: 'slug-conflict'`.
//   7. `resolveAvailableSlug` falls back from 'blog' → 'collection-1' →
//      'collection-2' when the earlier candidates are taken, and surfaces
//      pool exhaustion as a hard error.
//   8. `wizardSeedEntries` mints two entries dated today + yesterday with
//      the canonical welcome / second-post content.
//
// Run with `bun run collections-scaffold:smoke`.

import type { CanvasPage, EditableSite } from './schema.js';
import {
  materializeCollections,
  type MaterializerEntry,
} from './elements/collection-materializer.js';
import { validateEditableSite } from './validate.js';
import {
  resolveAvailableSlug,
  scaffoldCollection,
  WIZARD_DEFAULT_SLUG,
} from './collections-scaffold.js';
import { wizardSeedEntries } from '../templates/portfolio-seed-entries.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[collections-scaffold:smoke] ${message}`);
}

function emptySite(): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'index',
        title: 'Home',
        width: 1440,
        sections: [
          {
            id: 'sec-home-empty',
            recipeId: 'custom',
            name: 'Home',
            height: 600,
            elements: [
              {
                id: 'home-headline',
                type: 'text',
                box: { x: 80, y: 80, w: 600, h: 60, z: 1 },
                content: [{ text: 'Hi' }],
                role: 'heading',
                fontSize: 48,
                fontWeight: 600,
                align: 'left',
              },
            ],
          },
        ],
      },
    ],
  };
}

const FIXED_NOW = new Date('2026-06-05T12:00:00Z');

// ---------------------------------------------------------------------------
// (1) Valid slug → index + template + two seed entries
// ---------------------------------------------------------------------------

{
  const result = scaffoldCollection(emptySite(), 'blog', FIXED_NOW);
  assert(result.ok, `(1) valid slug should succeed (got ${result.ok ? 'ok' : result.error})`);
  if (!result.ok) throw new Error('unreachable');

  const [indexPage, templatePage] = result.newPages;
  // ADR 0063 F5 — the wizard no longer stamps `pageKind: 'collection-
  // index'` or page-level `collectionSlug` on the index page. The
  // element-level binding on the Collection element (asserted below
  // via the materializer round-trip) is the single source of truth.
  assert(indexPage.pageKind === undefined, '(1) index page pageKind retired after F5');
  assert(
    indexPage.collectionSlug === undefined,
    '(1) index page must not carry page-level collectionSlug after F5',
  );
  assert(indexPage.slug === 'blog', '(1) index page slug = "blog"');
  assert(templatePage.pageKind === 'collection-item-template', '(1) template pageKind');
  assert(templatePage.collectionSlug === 'blog', '(1) template collectionSlug');
  assert(templatePage.slug === 'blog/_template', '(1) template page slug uses _template');
  assert(templatePage.noIndex === true, '(1) template page is excluded from sitemap');

  assert(result.seedEntries.length === 2, '(1) two seed entries minted');
  assert(result.collectionSlug === 'blog', '(1) result echoes the chosen slug');
  for (const entry of result.seedEntries) {
    assert(entry.collectionSlug === 'blog', '(1) seed entry collectionSlug');
    assert(entry.status === 'published', '(1) seed entry status published');
    assert(entry.body.length > 0, '(1) seed entry body non-empty');
    assert(entry.ogImageAssetId === null, '(1) seed entry ogImageAssetId null');
    assert(entry.tags.length === 0, '(1) seed entry tags empty');
  }
  assert(
    result.seedEntries[0]!.slug === 'welcome-to-your-blog',
    '(1) first seed entry is welcome-to-your-blog',
  );
  assert(
    result.seedEntries[1]!.slug === 'your-second-post',
    '(1) second seed entry is your-second-post',
  );
}

// ---------------------------------------------------------------------------
// (2) Index page Collection element ships ADR-0063 element-level binding
// ---------------------------------------------------------------------------

{
  const result = scaffoldCollection(emptySite(), 'blog', FIXED_NOW);
  if (!result.ok) throw new Error('(2) unreachable');
  const [indexPage] = result.newPages;
  const indexElements = indexPage.sections.flatMap((s) => s.elements);
  const collectionEl = indexElements.find((el) => el.type === 'collection');
  assert(collectionEl !== undefined, '(2) index page contains a Collection element');
  if (collectionEl === undefined || collectionEl.type !== 'collection') throw new Error('unreachable');
  assert(
    collectionEl.collectionSlug === 'blog',
    '(2) Collection element binds collectionSlug at element level',
  );
  assert(collectionEl.sort === 'date-desc', '(2) Collection element sort defaults to date-desc');
  assert(collectionEl.display === 'card', '(2) Collection element display defaults to card');
  assert(collectionEl.folder === undefined, '(2) Collection element folder is unset');
  assert(collectionEl.manualOrder === undefined, '(2) Collection element manualOrder is unset');
}

// ---------------------------------------------------------------------------
// (3) Element ids on the two new pages are unique within their page
// ---------------------------------------------------------------------------

{
  const result = scaffoldCollection(emptySite(), 'blog', FIXED_NOW);
  if (!result.ok) throw new Error('(3) unreachable');
  for (const page of result.newPages) {
    const ids = new Set<string>();
    for (const section of page.sections) {
      for (const el of section.elements) {
        assert(!ids.has(el.id), `(3) page ${page.id} has duplicate element id ${el.id}`);
        ids.add(el.id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// (4) Materializer expands the template into one concrete page per seed entry
// ---------------------------------------------------------------------------

{
  const baseState = emptySite();
  const result = scaffoldCollection(baseState, 'blog', FIXED_NOW);
  if (!result.ok) throw new Error('(4) unreachable');
  const updatedState: EditableSite = {
    ...baseState,
    pages: [...baseState.pages, ...result.newPages],
  };
  const materializerEntries: MaterializerEntry[] = result.seedEntries.map((entry) => ({
    collectionSlug: entry.collectionSlug,
    slug: entry.slug,
    title: entry.title,
    excerpt: entry.excerpt,
    body: entry.body,
    publishedDate: entry.publishedDate,
    author: entry.author,
    category: entry.category,
    tags: entry.tags,
    ogImageAssetId: entry.ogImageAssetId,
  }));
  const materialized = materializeCollections(updatedState, materializerEntries);
  for (const entry of result.seedEntries) {
    const expandedSlug = `blog/${entry.slug}`;
    const expanded = materialized.pages.find((p) => p.slug === expandedSlug);
    assert(
      expanded !== undefined,
      `(4) materializer must produce a page at ${expandedSlug}`,
    );
    assert(
      expanded!.pageKind === undefined,
      `(4) materialized clone at ${expandedSlug} strips pageKind`,
    );
  }
  // Template page itself is gone from materialized output.
  assert(
    materialized.pages.find((p) => p.slug === 'blog/_template') === undefined,
    '(4) materializer drops the template page from publish output',
  );
}

// ---------------------------------------------------------------------------
// (5) Slug shape failures (step = 'slug-format')
// ---------------------------------------------------------------------------

{
  for (const bad of ['', 'Blog', 'a'.repeat(81), 'has space', '-leading', 'trailing-', 'sp ace']) {
    const result = scaffoldCollection(emptySite(), bad, FIXED_NOW);
    assert(!result.ok, `(5) slug ${JSON.stringify(bad)} must fail`);
    if (!result.ok) {
      assert(
        result.step === 'slug-format',
        `(5) slug ${JSON.stringify(bad)} must fail with step 'slug-format' (got ${result.step})`,
      );
      assert(
        result.error.toLowerCase().includes('slug'),
        `(5) error must mention slug for ${JSON.stringify(bad)} (got ${result.error})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (6) Slug-conflict failures (step = 'slug-conflict')
// ---------------------------------------------------------------------------

{
  const baseState = emptySite();
  const first = scaffoldCollection(baseState, 'blog', FIXED_NOW);
  if (!first.ok) throw new Error('(6a) unreachable');
  const afterFirst: EditableSite = {
    ...baseState,
    pages: [...baseState.pages, ...first.newPages],
  };
  const second = scaffoldCollection(afterFirst, 'blog', FIXED_NOW);
  assert(!second.ok, '(6a) same slug twice should fail');
  if (!second.ok) {
    assert(second.step === 'slug-conflict', '(6a) repeat slug must fail with slug-conflict step');
    assert(
      second.error.toLowerCase().includes('blog'),
      `(6a) conflict error must mention the slug (got ${second.error})`,
    );
  }
}

{
  // Existing page with the proposed slug as its literal `slug` field.
  const baseState = emptySite();
  baseState.pages.push({
    id: 'page-existing-blog',
    slug: 'blog',
    title: 'Blog (manual)',
    width: 1440,
    sections: [
      {
        id: 'sec-existing-blog',
        recipeId: 'custom',
        name: 'Body',
        height: 400,
        elements: [
          {
            id: 'existing-blog-heading',
            type: 'text',
            box: { x: 80, y: 80, w: 600, h: 60, z: 1 },
            content: [{ text: 'Manual' }],
            role: 'heading',
            fontSize: 32,
            fontWeight: 600,
            align: 'left',
          },
        ],
      },
    ],
  });
  const result = scaffoldCollection(baseState, 'blog', FIXED_NOW);
  assert(!result.ok, '(6b) existing page at /blog should block');
  if (!result.ok) {
    assert(result.step === 'slug-conflict', '(6b) conflict must use slug-conflict step');
    assert(
      result.error.includes('blog'),
      `(6b) error must mention conflicting slug (got ${result.error})`,
    );
  }
}

// ---------------------------------------------------------------------------
// (7) resolveAvailableSlug walks 'blog' → 'collection-1' → 'collection-2'
// ---------------------------------------------------------------------------

{
  const empty = emptySite();
  const r0 = resolveAvailableSlug(empty.pages, WIZARD_DEFAULT_SLUG);
  assert(r0.ok && r0.slug === 'blog', '(7) empty site resolves to blog');

  // Take 'blog'.
  const after1 = scaffoldCollection(empty, 'blog', FIXED_NOW);
  if (!after1.ok) throw new Error('(7) unreachable');
  const state1: EditableSite = {
    ...empty,
    pages: [...empty.pages, ...after1.newPages],
  };
  const r1 = resolveAvailableSlug(state1.pages, WIZARD_DEFAULT_SLUG);
  assert(
    r1.ok && r1.slug === 'collection-1',
    `(7) after taking blog, fallback to collection-1 (got ${r1.ok ? r1.slug : r1.error})`,
  );

  // Take 'collection-1' too.
  const after2 = scaffoldCollection(state1, 'collection-1', FIXED_NOW);
  if (!after2.ok) throw new Error('(7) unreachable');
  const state2: EditableSite = {
    ...state1,
    pages: [...state1.pages, ...after2.newPages],
  };
  const r2 = resolveAvailableSlug(state2.pages, WIZARD_DEFAULT_SLUG);
  assert(
    r2.ok && r2.slug === 'collection-2',
    `(7) after taking blog+collection-1, fallback to collection-2 (got ${r2.ok ? r2.slug : r2.error})`,
  );

  // Custom slug does NOT auto-fallback when free or taken; collisions
  // surface from scaffoldCollection's own check, not resolveAvailableSlug.
  const r3 = resolveAvailableSlug(state2.pages, 'case-studies');
  assert(r3.ok && r3.slug === 'case-studies', '(7) custom slug passes through verbatim');

  // Pool exhaustion: synthesise a site where every default slug is taken.
  const exhausted = emptySite();
  const occupants: CanvasPage[] = [{
    id: 'page-block-blog',
    slug: 'blog',
    title: 'B',
    width: 1440,
    sections: [{
      id: 'sec', recipeId: 'custom', name: '', height: 100,
      elements: [{
        id: 'e1', type: 'text', box: { x: 0, y: 0, w: 10, h: 10, z: 1 },
        content: [{ text: 'x' }], role: 'body', fontSize: 12, fontWeight: 400, align: 'left',
      }],
    }],
  }];
  for (let i = 1; i <= 99; i += 1) {
    occupants.push({
      id: `page-block-collection-${i}`,
      slug: `collection-${i}`,
      title: `C${i}`,
      width: 1440,
      sections: [{
        id: `sec-${i}`, recipeId: 'custom', name: '', height: 100,
        elements: [{
          id: `e-${i}`, type: 'text', box: { x: 0, y: 0, w: 10, h: 10, z: 1 },
          content: [{ text: 'x' }], role: 'body', fontSize: 12, fontWeight: 400, align: 'left',
        }],
      }],
    });
  }
  exhausted.pages.push(...occupants);
  const rExhausted = resolveAvailableSlug(exhausted.pages, WIZARD_DEFAULT_SLUG);
  assert(!rExhausted.ok, '(7) exhausted pool must fail loudly');
  if (!rExhausted.ok) {
    assert(
      rExhausted.error.toLowerCase().includes('exhausted'),
      `(7) pool-exhausted error must mention "exhausted" (got ${rExhausted.error})`,
    );
  }
}

// ---------------------------------------------------------------------------
// (8) wizardSeedEntries shape — two entries dated today + yesterday
// ---------------------------------------------------------------------------

{
  const rows = wizardSeedEntries('blog', FIXED_NOW);
  assert(rows.length === 2, '(8) wizardSeedEntries returns exactly two rows');
  assert(rows[0]!.slug === 'welcome-to-your-blog', '(8) first row slug');
  assert(rows[1]!.slug === 'your-second-post', '(8) second row slug');
  assert(rows[0]!.title === 'Welcome to your blog', '(8) first row title');
  assert(rows[1]!.title === 'Your second post', '(8) second row title');
  assert(rows[0]!.publishedDate === '2026-06-05', '(8) first row dated today (UTC)');
  assert(rows[1]!.publishedDate === '2026-06-04', '(8) second row dated yesterday (UTC)');
  assert(rows[0]!.author === 'You' && rows[1]!.author === 'You', '(8) author is You');
  assert(
    rows[0]!.collectionSlug === 'blog' && rows[1]!.collectionSlug === 'blog',
    '(8) collectionSlug matches the chosen slug',
  );
}

// ---------------------------------------------------------------------------
// (9) End-to-end: scaffolded + materialized site validates
// ---------------------------------------------------------------------------

{
  const baseState = emptySite();
  const result = scaffoldCollection(baseState, 'blog', FIXED_NOW);
  if (!result.ok) throw new Error('(9) unreachable');
  const updatedState: EditableSite = {
    ...baseState,
    pages: [...baseState.pages, ...result.newPages],
  };
  const editValidation = validateEditableSite(updatedState);
  assert(
    editValidation.valid,
    `(9) updated site must validate (errors: ${editValidation.valid ? '' : editValidation.errors.join('; ')})`,
  );
}

console.log('[collections-scaffold:smoke] OK');
