// src/canvas/elements/collection-materializer.smoke.ts
//
// ADR 0060 + ADR 0063 — publish-time materialization pass smoke. After ADR
// 0063, `'collection-index'` pages are retired (D2) and the page-bound
// per-element card-cloning logic was lifted off the materializer; Phase 2B
// reintroduces element-level card materialization keyed on the new
// `collectionSlug` / `folder` / `sort` / `display` fields and will own the
// per-element coverage smokes.
//
// Phase 1 keeps coverage on the parts of the materializer that survived
// unchanged:
//   1. Template page (`pageKind: 'collection-item-template'`) expands into
//      one concrete page per matching entry, with metadata copied from the
//      entry row and `pageKind` / `collectionSlug` stripped from the clone.
//   2. Empty entries list → template drops out, ordinary pages pass through.
//   3. Page without `pageKind` passes through unchanged.
//   4. Purity: the input EditableSite is not mutated.
//   5. Template-page clone ids are deterministic across replays.
//   6. Collection membership binds to `collectionSlug`, not `category`.

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  TextElement,
} from '../schema.js';
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

function makeSection(elements: CanvasElement[]): CanvasSection {
  return {
    id: 'sec-1',
    recipeId: 'custom',
    name: 'Section',
    height: 800,
    elements,
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
    id: `entry-${overrides.slug}`,
    collectionSlug: 'blog',
    title: 'Post title',
    excerpt: 'Post excerpt',
    body: 'Post body',
    publishedDate: '2026-05-25T00:00:00.000Z',
    author: 'Alice',
    category: 'blog',
    tags: ['launch'],
    ogImageAssetId: null,
    folder: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (1) Template page: one template → N pages with metadata + placeholders
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
    `(1) template expands to 3 pages (got ${String(out.pages.length)})`,
  );

  for (const page of out.pages) {
    assert(page.pageKind === undefined, `(1) cloned page strips pageKind (page ${page.id})`);
    assert(
      page.collectionSlug === undefined,
      `(1) cloned page strips collectionSlug (page ${page.id})`,
    );
  }

  const firstClone = out.pages[0]!;
  assert(firstClone.id.startsWith('page-blog-template--'), '(1) clone id is deterministic');
  assert(
    firstClone.slug.startsWith('blog/'),
    `(1) clone slug prefixed by collection (got ${firstClone.slug})`,
  );
  assert(firstClone.title === 'First post', '(1) title pulled from entry');
  assert(firstClone.description === entries[0]!.excerpt, '(1) description = entry.excerpt');
  assert(firstClone.author === entries[0]!.author, '(1) author pulled from entry');
  assert(firstClone.publishedDate === entries[0]!.publishedDate, '(1) publishedDate pulled');
  assert(firstClone.category === 'blog', '(1) category pulled from entry');

  const heroBody = (firstClone.sections[0]!.elements[2]! as TextElement).content[0]!.text;
  assert(heroBody === 'Body of first', `(1) {{body}} substituted (got ${heroBody})`);
  const heroSlug = (firstClone.sections[0]!.elements[3]! as TextElement).content[0]!.text;
  assert(heroSlug === 'slug: first-post', `(1) {{slug}} substituted (got ${heroSlug})`);
}

// ---------------------------------------------------------------------------
// (2) Empty entries → template drops, ordinary stays
// ---------------------------------------------------------------------------

{
  const site = makeSite([makeTemplatePage(), makeOrdinaryPage()]);
  const out = materializeCollections(site, []);
  assert(
    out.pages.length === 1,
    `(2) template drops when no entries (got ${String(out.pages.length)})`,
  );
  assert(out.pages[0]!.id === 'page-about', '(2) ordinary page retained');
}

// ---------------------------------------------------------------------------
// (3) Ordinary page passes through untouched
// ---------------------------------------------------------------------------

{
  const ordinary = makeOrdinaryPage();
  const site = makeSite([ordinary]);
  const entries: MaterializerEntry[] = [makeEntry({ slug: 's', title: 'T', body: 'B' })];
  const out = materializeCollections(site, entries);
  assert(out.pages.length === 1, '(3) ordinary page count unchanged');
  const headline = (out.pages[0]!.sections[0]!.elements[0]! as TextElement).content[0]!.text;
  assert(headline === 'About us', `(3) ordinary page text untouched (got ${headline})`);
}

// ---------------------------------------------------------------------------
// (4) Purity: input site is not mutated
// ---------------------------------------------------------------------------

{
  const template = makeTemplatePage();
  const site = makeSite([template]);
  const before = JSON.stringify(site);
  const entries: MaterializerEntry[] = [makeEntry({ slug: 's1', title: 'T1' })];
  materializeCollections(site, entries);
  const after = JSON.stringify(site);
  assert(before === after, '(4) input site is not mutated');
}

// ---------------------------------------------------------------------------
// (5) Template-page clone ids are deterministic across replays
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
    '(5) two runs on the same input produce byte-equal output',
  );
}

// ---------------------------------------------------------------------------
// (6) Collection membership binds to collectionSlug, not category
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
  const out = materializeCollections(makeSite([makeTemplatePage()]), entries);
  assert(
    out.pages.some((page) => page.slug === 'blog/engineering-note'),
    '(6) template clones blog entry even when category differs',
  );
  assert(
    !out.pages.some((page) => page.slug === 'blog/case-study'),
    '(6) template does not clone entries from another collection',
  );
}

console.log('[collection-materializer:smoke] OK');
