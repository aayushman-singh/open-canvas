// src/canvas/elements/collection-materializer.smoke.ts
//
// `bun run src/canvas/elements/collection-materializer.smoke.ts` — exercises
// the ADR 0060 publish-time materialization pass. Covers:
//   1. Index page: page-bound CollectionElement.entries is populated by
//      cloning cardTemplate per matching entry, with placeholders substituted.
//   2. Template page: a single `collection-item-template` page expands into
//      one concrete page per matching entry, with metadata copied from the
//      entry row and `pageKind`/`collectionSlug` stripped from the clone.
//   3. Empty entries list → no-op shape (index entries stay empty, template
//      pages drop out of the page list with no clones).
//   4. Pages without `pageKind` pass through unchanged.
//   5. `filter.tags` requires every listed tag to appear on the entry.
//   6. Default sort is `publishedDate desc` when `element.sort` is unset.
//   7. The input EditableSite is not mutated (purity contract).
//   8. Template-page clone ids are deterministic across replays.
//   9. Collection membership binds to collectionSlug, not category.
//  10. fieldBindings can populate text cards even without literal placeholders.

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  TextElement,
} from '../schema.js';
import type { CollectionElement } from './collection.js';
import { materializeCollections, type MaterializerEntry } from './collection-materializer.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[collection-materializer:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeText(id: string, text: string): TextElement {
  return {
    id,
    type: 'text',
    box: { x: 0, y: 0, w: 300, h: 40, z: 1 },
    content: [{ text }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
  };
}

function makeIndexCollection(): CollectionElement {
  return {
    id: 'el-collection-blog',
    type: 'collection',
    mode: 'page-bound',
    box: { x: 0, y: 0, w: 1200, h: 600, z: 1 },
    entryTemplate: [makeText('tmpl-title', 'Title')],
    entries: [],
    cardTemplate: [
      makeText('card-title', '{{title}}'),
      makeText('card-excerpt', '{{excerpt}}'),
      makeText('card-meta', '{{author}} — {{publishedDate}}'),
    ],
    fieldBindings: { 'card-title': 'title' },
    layout: { columns: 3, gap: 24 },
  };
}

function makeSection(elements: CanvasElement[]): CanvasSection {
  return {
    id: 'sec-1',
    recipeId: 'custom',
    name: 'Section',
    height: 800,
    elements,
  };
}

function makeIndexPage(): CanvasPage {
  return {
    id: 'page-blog',
    slug: 'blog',
    title: 'Blog',
    width: 1200,
    sections: [makeSection([makeIndexCollection()])],
    pageKind: 'collection-index',
    collectionSlug: 'blog',
  };
}

function makeTemplatePage(): CanvasPage {
  return {
    id: 'page-blog-template',
    slug: 'blog-template',
    title: 'Blog post (template)',
    width: 1200,
    sections: [
      makeSection([
        makeText('hero-title', '{{title}}'),
        makeText('hero-meta', 'by {{author}} on {{publishedDate}}'),
        makeText('hero-body', '{{body}}'),
        makeText('hero-slug', 'slug: {{slug}}'),
      ]),
    ],
    pageKind: 'collection-item-template',
    collectionSlug: 'blog',
  };
}

function makeOrdinaryPage(): CanvasPage {
  return {
    id: 'page-about',
    slug: 'about',
    title: 'About',
    width: 1200,
    sections: [makeSection([makeText('about-headline', 'About us')])],
  };
}

function makeSite(pages: CanvasPage[]): EditableSite {
  return { styleKit: 'charcoal', pages };
}

function makeEntry(overrides: Partial<MaterializerEntry> & { slug: string }): MaterializerEntry {
  return {
    collectionSlug: 'blog',
    title: 'Post title',
    excerpt: 'Post excerpt',
    body: 'Post body',
    publishedDate: '2026-05-25T00:00:00.000Z',
    author: 'Alice',
    category: 'blog',
    tags: ['launch'],
    ogImageAssetId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (1) Index page: cardTemplate gets cloned + substituted per entry
// ---------------------------------------------------------------------------

{
  const entries: MaterializerEntry[] = [
    makeEntry({
      slug: 'first-post',
      title: 'First post',
      excerpt: 'First excerpt',
      author: 'Alice',
      publishedDate: '2026-05-01T00:00:00.000Z',
    }),
    makeEntry({
      slug: 'second-post',
      title: 'Second post',
      excerpt: 'Second excerpt',
      author: 'Bob',
      publishedDate: '2026-05-15T00:00:00.000Z',
    }),
  ];
  const site = makeSite([makeIndexPage()]);
  const out = materializeCollections(site, entries);

  const indexPage = out.pages[0]!;
  assert(indexPage.id === 'page-blog', '(1) index page preserved at slot 0');
  const collEl = indexPage.sections[0]!.elements[0]! as CollectionElement;
  assert(
    collEl.entries.length === 2,
    `(1) expected 2 entries, got ${String(collEl.entries.length)}`,
  );

  // Default sort is publishedDate desc → Second post (May 15) before First (May 1).
  const firstEntryTitleText = (collEl.entries[0]![0]! as TextElement).content[0]!.text;
  assert(
    firstEntryTitleText === 'Second post',
    `(1) default sort desc places later date first (got ${firstEntryTitleText})`,
  );
  const secondEntryExcerpt = (collEl.entries[1]![1]! as TextElement).content[0]!.text;
  assert(
    secondEntryExcerpt === 'First excerpt',
    `(1) {{excerpt}} substituted on second entry (got ${secondEntryExcerpt})`,
  );
  const firstEntryMeta = (collEl.entries[0]![2]! as TextElement).content[0]!.text;
  assert(
    firstEntryMeta === 'Bob — 2026-05-15T00:00:00.000Z',
    `(1) multi-token meta substituted (got ${firstEntryMeta})`,
  );
}

// ---------------------------------------------------------------------------
// (2) Template page: one template → N pages
// ---------------------------------------------------------------------------

{
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'first-post', title: 'First post', body: 'Body of first' }),
    makeEntry({ slug: 'second-post', title: 'Second post', body: 'Body of second' }),
    makeEntry({ slug: 'third-post', title: 'Third post', body: 'Body of third' }),
  ];
  const site = makeSite([makeTemplatePage()]);
  const out = materializeCollections(site, entries);

  assert(
    out.pages.length === 3,
    `(2) template expands to 3 pages (got ${String(out.pages.length)})`,
  );

  // Verify each clone strips template metadata.
  for (const page of out.pages) {
    assert(page.pageKind === undefined, `(2) cloned page strips pageKind (page ${page.id})`);
    assert(
      page.collectionSlug === undefined,
      `(2) cloned page strips collectionSlug (page ${page.id})`,
    );
  }

  // Verify metadata copy + slug composition + deterministic id.
  const firstClone = out.pages[0]!;
  assert(firstClone.id.startsWith('page-blog-template--'), '(2) clone id is deterministic');
  assert(
    firstClone.slug.startsWith('blog/'),
    `(2) clone slug prefixed by collection (got ${firstClone.slug})`,
  );
  assert(firstClone.title === 'First post', '(2) title pulled from entry');
  assert(firstClone.description === entries[0]!.excerpt, '(2) description = entry.excerpt');
  assert(firstClone.author === entries[0]!.author, '(2) author pulled from entry');
  assert(firstClone.publishedDate === entries[0]!.publishedDate, '(2) publishedDate pulled');
  assert(firstClone.category === 'blog', '(2) category pulled from entry');

  // Verify body placeholder substituted across an element string field.
  const heroBody = (firstClone.sections[0]!.elements[2]! as TextElement).content[0]!.text;
  assert(heroBody === 'Body of first', `(2) {{body}} substituted (got ${heroBody})`);
  const heroSlug = (firstClone.sections[0]!.elements[3]! as TextElement).content[0]!.text;
  assert(heroSlug === 'slug: first-post', `(2) {{slug}} substituted (got ${heroSlug})`);
}

// ---------------------------------------------------------------------------
// (3) Empty entries list → no-op on index, template drops out
// ---------------------------------------------------------------------------

{
  const site = makeSite([makeIndexPage(), makeTemplatePage(), makeOrdinaryPage()]);
  const out = materializeCollections(site, []);

  // Index page survives with empty entries[]; template drops; ordinary stays.
  assert(
    out.pages.length === 2,
    `(3) template drops when no entries (got ${String(out.pages.length)})`,
  );
  assert(out.pages[0]!.id === 'page-blog', '(3) index page retained');
  assert(out.pages[1]!.id === 'page-about', '(3) ordinary page retained');
  const indexCollEl = out.pages[0]!.sections[0]!.elements[0]! as CollectionElement;
  assert(indexCollEl.entries.length === 0, '(3) index collection stays empty');
}

// ---------------------------------------------------------------------------
// (4) Page without pageKind: untouched
// ---------------------------------------------------------------------------

{
  const ordinary = makeOrdinaryPage();
  const site = makeSite([ordinary]);
  const entries: MaterializerEntry[] = [makeEntry({ slug: 's', title: 'T', body: 'B' })];
  const out = materializeCollections(site, entries);
  assert(out.pages.length === 1, '(4) ordinary page count unchanged');
  const headline = (out.pages[0]!.sections[0]!.elements[0]! as TextElement).content[0]!.text;
  assert(headline === 'About us', `(4) ordinary page text untouched (got ${headline})`);
}

// ---------------------------------------------------------------------------
// (5) filter.tags requires every listed tag
// ---------------------------------------------------------------------------

{
  const index = makeIndexPage();
  const collEl = index.sections[0]!.elements[0]! as CollectionElement;
  collEl.filter = { tags: ['launch', 'design'] };
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'a', title: 'A', tags: ['launch', 'design', 'extra'] }),
    makeEntry({ slug: 'b', title: 'B', tags: ['launch'] }), // missing 'design'
    makeEntry({ slug: 'c', title: 'C', tags: ['design'] }), // missing 'launch'
    makeEntry({ slug: 'd', title: 'D', tags: ['launch', 'design'] }),
  ];
  const out = materializeCollections(makeSite([index]), entries);
  const hydrated = out.pages[0]!.sections[0]!.elements[0]! as CollectionElement;
  assert(
    hydrated.entries.length === 2,
    `(5) only entries with all tags match (got ${String(hydrated.entries.length)})`,
  );

  const matchedTitles = hydrated.entries.map((e) => (e[0]! as TextElement).content[0]!.text).sort();
  assert(
    matchedTitles[0] === 'A' && matchedTitles[1] === 'D',
    `(5) matched A and D, got ${JSON.stringify(matchedTitles)}`,
  );
}

// ---------------------------------------------------------------------------
// (6) Default sort is publishedDate desc; filter.limit applies
// ---------------------------------------------------------------------------

{
  const index = makeIndexPage();
  const collEl = index.sections[0]!.elements[0]! as CollectionElement;
  collEl.filter = { limit: 2 };
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'oldest', title: 'Oldest', publishedDate: '2026-01-01T00:00:00.000Z' }),
    makeEntry({ slug: 'newest', title: 'Newest', publishedDate: '2026-06-01T00:00:00.000Z' }),
    makeEntry({ slug: 'middle', title: 'Middle', publishedDate: '2026-03-01T00:00:00.000Z' }),
  ];
  const out = materializeCollections(makeSite([index]), entries);
  const hydrated = out.pages[0]!.sections[0]!.elements[0]! as CollectionElement;
  assert(
    hydrated.entries.length === 2,
    `(6) limit caps to 2 (got ${String(hydrated.entries.length)})`,
  );
  const first = (hydrated.entries[0]![0]! as TextElement).content[0]!.text;
  const second = (hydrated.entries[1]![0]! as TextElement).content[0]!.text;
  assert(first === 'Newest', `(6) newest first (got ${first})`);
  assert(second === 'Middle', `(6) middle second (got ${second})`);
}

// ---------------------------------------------------------------------------
// (7) Purity: input site is not mutated
// ---------------------------------------------------------------------------

{
  const index = makeIndexPage();
  const site = makeSite([index]);
  const before = JSON.stringify(site);
  const entries: MaterializerEntry[] = [makeEntry({ slug: 's1', title: 'T1' })];
  materializeCollections(site, entries);
  const after = JSON.stringify(site);
  assert(before === after, '(7) input site is not mutated');
}

// ---------------------------------------------------------------------------
// (8) Template-page clone ids are deterministic across replays
// ---------------------------------------------------------------------------

{
  const site = makeSite([makeTemplatePage()]);
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'alpha', title: 'Alpha' }),
    makeEntry({ slug: 'beta', title: 'Beta' }),
  ];
  const a = materializeCollections(site, entries);
  const b = materializeCollections(site, entries);
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    '(8) two runs on the same input produce byte-equal output',
  );
}

// ---------------------------------------------------------------------------
// (9) Collection membership binds to collectionSlug, not category
// ---------------------------------------------------------------------------

{
  const entries: MaterializerEntry[] = [
    makeEntry({
      slug: 'engineering-note',
      title: 'Engineering note',
      collectionSlug: 'blog',
      category: 'engineering',
    }),
    makeEntry({
      slug: 'case-study',
      title: 'Case study',
      collectionSlug: 'work',
      category: 'blog',
    }),
  ];
  const out = materializeCollections(makeSite([makeIndexPage(), makeTemplatePage()]), entries);
  const index = out.pages[0]!;
  const hydrated = index.sections[0]!.elements[0]! as CollectionElement;
  assert(
    hydrated.entries.length === 1,
    `(9) index page must include only blog collection entries, got ${String(hydrated.entries.length)}`,
  );
  assert(
    (hydrated.entries[0]![0]! as TextElement).content[0]!.text === 'Engineering note',
    '(9) index page must include blog entry even when category differs',
  );
  assert(
    out.pages.some((page) => page.slug === 'blog/engineering-note'),
    '(9) template page must clone blog collection entry even when category differs',
  );
  assert(
    !out.pages.some((page) => page.slug === 'blog/case-study'),
    '(9) template page must not clone entries from another collection even when category matches',
  );
}

// ---------------------------------------------------------------------------
// (10) fieldBindings populate text cards without literal placeholders
// ---------------------------------------------------------------------------

{
  const index = makeIndexPage();
  const collEl = index.sections[0]!.elements[0]! as CollectionElement;
  collEl.cardTemplate = [
    makeText('bound-title', 'Static title'),
    makeText('bound-description', 'Static description'),
  ];
  collEl.fieldBindings = {
    'bound-title': 'title',
    'bound-description': 'description',
  };
  const out = materializeCollections(makeSite([index]), [
    makeEntry({ slug: 'bound', title: 'Bound title', excerpt: 'Bound excerpt' }),
  ]);
  const hydrated = out.pages[0]!.sections[0]!.elements[0]! as CollectionElement;
  assert(
    (hydrated.entries[0]![0]! as TextElement).content[0]!.text === 'Bound title',
    '(10) fieldBindings title must replace text content',
  );
  assert(
    (hydrated.entries[0]![1]! as TextElement).content[0]!.text === 'Bound excerpt',
    '(10) fieldBindings description must map to entry excerpt',
  );
}

// ---------------------------------------------------------------------------
// (11) Nested page-bound collection inside an outer cardTemplate: when the
//      outer hydration suffixes element ids with the outer entry slug, the
//      nested collection's `fieldBindings` map must be remapped to the new
//      ids in lockstep — otherwise the next hydration pass's
//      applyFieldBindings lookup misses every key and the nested cards
//      render their static placeholder content. Regression pin for the
//      codex P2 finding on the id-suffix change.
// ---------------------------------------------------------------------------

{
  const innerText = makeText('nested-title', 'Static');
  const nested: CollectionElement = {
    id: 'nested-coll',
    type: 'collection',
    mode: 'page-bound',
    box: { x: 0, y: 0, w: 300, h: 200, z: 1 },
    entryTemplate: [],
    entries: [],
    filter: { category: 'child' },
    cardTemplate: [innerText],
    fieldBindings: { 'nested-title': 'title' },
    layout: { columns: 1, gap: 1 },
  };
  const outer: CollectionElement = {
    id: 'outer-coll',
    type: 'collection',
    mode: 'page-bound',
    box: { x: 0, y: 0, w: 300, h: 200, z: 1 },
    entryTemplate: [],
    entries: [],
    filter: { category: 'parent' },
    cardTemplate: [nested],
    layout: { columns: 1, gap: 1 },
  };
  const site: EditableSite = {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-blog',
        slug: 'blog',
        title: 'Blog',
        width: 1200,
        pageKind: 'collection-index',
        collectionSlug: 'blog',
        sections: [
          {
            id: 'sec',
            recipeId: 'custom',
            name: 's',
            height: 800,
            elements: [outer],
          },
        ],
      },
    ],
  };
  const entries: MaterializerEntry[] = [
    makeEntry({
      slug: 'parent',
      title: 'Parent title',
      category: 'parent',
      collectionSlug: 'blog',
    }),
    makeEntry({
      slug: 'child',
      title: 'Child title',
      category: 'child',
      collectionSlug: 'blog',
    }),
  ];
  const out = materializeCollections(site, entries);
  const hydratedOuter = out.pages[0]!.sections[0]!.elements[0]! as CollectionElement;
  assert(
    hydratedOuter.entries.length === 1,
    `(11) outer hydration must pick parent-categorised entry only (got ${String(hydratedOuter.entries.length)})`,
  );
  const hydratedNested = hydratedOuter.entries[0]![0]! as CollectionElement;
  assert(
    hydratedNested.type === 'collection',
    '(11) nested element must remain a collection after id suffixing',
  );
  assert(
    hydratedNested.entries.length === 1,
    `(11) nested hydration must pick child-categorised entry only (got ${String(hydratedNested.entries.length)})`,
  );
  const nestedCardText = (hydratedNested.entries[0]![0]! as TextElement).content[0]!.text;
  assert(
    nestedCardText === 'Child title',
    `(11) nested cardTemplate fieldBindings must resolve to entry title after outer id-suffix rename (got ${nestedCardText})`,
  );
}

console.log('[collection-materializer:smoke] OK');
