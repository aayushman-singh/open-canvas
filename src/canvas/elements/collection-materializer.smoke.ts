// src/canvas/elements/collection-materializer.smoke.ts
//
// ADR 0060 + ADR 0063 — publish-time materialization pass smoke.
//
// Survivors from Phase 1 (template-page expansion):
//   1. Template page (`pageKind: 'collection-item-template'`) expands into
//      one concrete page per matching entry, with metadata copied from the
//      entry row and `pageKind` / `collectionSlug` stripped from the clone.
//   2. Empty entries list → template drops out, ordinary pages pass through.
//   3. Page without `pageKind` passes through unchanged.
//   4. Purity: the input EditableSite is not mutated.
//   5. Template-page clone ids are deterministic across replays.
//   6. Collection membership binds to `collectionSlug`, not `category`.
//
// New in Phase 2B (ADR 0063 D4/D7/D8 materializer):
//   7. `display: 'image-only'` emits one image-wrapped-in-a-linked-Container
//      per entry, ordered per the active sort.
//   8. `display: 'card'` clones DEFAULT_CARD_TEMPLATE per entry, substitutes
//      `{{title}}` / `{{excerpt}}` / `{{ogImageAssetId}}` / `{{slug}}`, and
//      sets the outer linkHref to `/<collectionSlug>/<entry.slug>`.
//   9. `folder` excludes non-matching entries; absence means all entries in
//      the slug pass through.
//  10. `sort: 'manual'` orders by `manualOrder` (entry IDs); entries not in
//      the list append at the end in date-desc order. Stale ids in
//      `manualOrder` are skipped silently.
//  11. Zero-entry case (no matches OR `collectionSlug === undefined`) yields
//      `el.entries = []` and a warning string of the ADR-pinned shape.
//
// New in Phase 2B / ADR 0065 D8 (`'custom'` arm):
//  14. `display: 'custom'` clones `el.customTemplate` per entry with the same
//      substitution rules as the `'card'` arm.
//  15. Shared-helper identity: `'custom'` with
//      `[DEFAULT_CARD_TEMPLATE, ...DEFAULT_CARD_SIBLINGS]` as customTemplate
//      produces output byte-equal to the `'card'` arm.
//  16. `customTemplate === undefined` → zero cards + the literal warning
//      `"Collection element <id> display='custom' but customTemplate is not set."`.
//  17. `customTemplate === []` → zero cards + the literal warning
//      `"Collection element <id> display='custom' but customTemplate has zero elements."`.
//  18. `customTemplate` present + zero matching entries → existing
//      zero-entries warning fires (NOT the custom-empty warnings).
//  19. Folder filter + sort behave identically for `'card'` and `'custom'`.

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  ContainerElement,
  EditableSite,
  ImageMediaElement,
  TextElement,
} from '../schema.js';
import type { CollectionElement } from './collection.js';
import { DEFAULT_CARD_SIBLINGS, DEFAULT_CARD_TEMPLATE } from './collection-defaults.js';
import {
  materializeCollections,
  materializeCollectionsWithReport,
  type MaterializerEntry,
} from './collection-materializer.js';

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

// ---------------------------------------------------------------------------
// Phase 2B fixture helpers — Collection-on-ordinary-page coverage
// ---------------------------------------------------------------------------

function makeCollectionElement(overrides: Partial<CollectionElement> = {}): CollectionElement {
  return {
    id: 'col-1',
    type: 'collection',
    box: { x: 0, y: 0, w: 1200, h: 600, z: 1 },
    collectionSlug: 'blog',
    display: 'card',
    sort: 'date-desc',
    ...overrides,
  };
}

function makeOrdinaryPageWithCollection(
  collection: CollectionElement,
  slug = 'home',
): CanvasPage {
  return {
    id: `page-${slug}`,
    slug,
    title: slug,
    width: 1200,
    sections: [makeSection([collection])],
  };
}

function getCollectionFrom(site: EditableSite, pageSlug = 'home'): CollectionElement {
  const page = site.pages.find((p) => p.slug === pageSlug);
  if (page === undefined) throw new Error(`page ${pageSlug} not found`);
  const el = page.sections[0]!.elements[0];
  if (!el || el.type !== 'collection') throw new Error('expected collection at [0][0]');
  return el;
}

function externalUrlOf(container: ContainerElement): string {
  const href = container.linkHref;
  if (href === undefined) throw new Error('container.linkHref is undefined');
  if (href.type !== 'external') throw new Error('container.linkHref is not external');
  return href.url;
}

// ---------------------------------------------------------------------------
// (7) `display: 'image-only'` emits one Image-wrapped-in-Container per entry
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({ display: 'image-only' });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const entries: MaterializerEntry[] = [
    makeEntry({
      slug: 'newer',
      title: 'Newer post',
      ogImageAssetId: 'asset-newer',
      publishedDate: '2026-06-04T00:00:00.000Z',
    }),
    makeEntry({
      slug: 'older',
      title: 'Older post',
      ogImageAssetId: 'asset-older',
      publishedDate: '2026-05-01T00:00:00.000Z',
    }),
  ];
  const out = materializeCollections(site, entries);
  const hydrated = getCollectionFrom(out);
  const matrix = hydrated.entries;
  assert(Array.isArray(matrix), '(7) image-only writes entries matrix');
  assert(matrix.length === 2, `(7) one instance per entry (got ${String(matrix.length)})`);

  const first = matrix[0]!;
  const firstContainer = first[0]! as ContainerElement;
  assert(firstContainer.type === 'container', '(7) instance[0] is the link container');
  assert(
    externalUrlOf(firstContainer) === '/blog/newer',
    `(7) linkHref url = /blog/newer (got ${externalUrlOf(firstContainer)})`,
  );
  const firstImage = first[1]! as ImageMediaElement;
  assert(firstImage.type === 'media' && firstImage.mediaKind === 'image', '(7) image sibling');
  assert(firstImage.assetId === 'asset-newer', '(7) image carries entry ogImageAssetId');
  assert(firstImage.alt === 'Newer post', '(7) image alt = title');

  const secondContainer = matrix[1]![0]! as ContainerElement;
  assert(
    externalUrlOf(secondContainer) === '/blog/older',
    '(7) second instance links to /blog/older',
  );
}

// ---------------------------------------------------------------------------
// (8) `display: 'card'` clones DEFAULT_CARD_TEMPLATE per entry with subs
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({ display: 'card' });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const entry = makeEntry({
    slug: 'welcome',
    title: 'Welcome to the blog',
    excerpt: 'Three lines of teaser text.',
    ogImageAssetId: 'asset-welcome',
  });
  const out = materializeCollections(site, [entry]);
  const hydrated = getCollectionFrom(out);
  const instance = hydrated.entries![0]!;

  const container = instance[0]! as ContainerElement;
  assert(container.type === 'container', '(8) instance[0] is Container');
  assert(container.preset === 'card', '(8) outer Container carries preset: card');
  assert(
    externalUrlOf(container) === '/blog/welcome',
    `(8) outer linkHref = /blog/welcome (got ${externalUrlOf(container)})`,
  );
  assert(container.linkLabel === 'Welcome to the blog', '(8) linkLabel = entry title');

  const image = instance[1]! as ImageMediaElement;
  assert(image.type === 'media' && image.mediaKind === 'image', '(8) sibling[0] = Image');
  assert(image.assetId === 'asset-welcome', '(8) image bound to ogImageAssetId');
  assert(image.alt === 'Welcome to the blog', '(8) image alt = title');

  const title = instance[2]! as TextElement;
  assert(title.type === 'text' && title.role === 'heading', '(8) sibling[1] = title TextElement');
  assert(title.content[0]!.text === 'Welcome to the blog', '(8) title substituted');

  const excerpt = instance[3]! as TextElement;
  assert(excerpt.type === 'text' && excerpt.role === 'body', '(8) sibling[2] = excerpt');
  assert(excerpt.content[0]!.text === 'Three lines of teaser text.', '(8) excerpt substituted');

  const cta = instance[4]!;
  assert(cta.type === 'action', '(8) sibling[3] = Action button');
  if (cta.type === 'action') {
    assert(
      cta.label[0]!.text === 'Read more',
      `(8) CTA label = "Read more" (got ${cta.label[0]?.text ?? ''})`,
    );
    assert(
      cta.href !== undefined && cta.href.type === 'external' && cta.href.url === '/blog/welcome',
      `(8) CTA href = /blog/welcome (got ${JSON.stringify(cta.href)})`,
    );
  }

  assert(container.id === 'card-default-root--welcome', '(8) container id derived from slug');
  assert(title.id === 'card-default-title--welcome', '(8) title id derived from slug');
}

// ---------------------------------------------------------------------------
// (9) `folder` filter narrows the candidate pool
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({ folder: 'tech-notes' });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'tech-1', folder: 'tech-notes' }),
    makeEntry({ slug: 'tech-2', folder: 'tech-notes' }),
    makeEntry({ slug: 'design-1', folder: 'design-notes' }),
    makeEntry({ slug: 'no-folder' }),
  ];
  const out = materializeCollections(site, entries);
  const hydrated = getCollectionFrom(out);
  const matrix = hydrated.entries!;
  assert(matrix.length === 2, `(9) folder narrows to 2 entries (got ${String(matrix.length)})`);
  const urls = matrix.map((inst) => externalUrlOf(inst[0]! as ContainerElement));
  assert(urls.includes('/blog/tech-1'), '(9) tech-1 included');
  assert(urls.includes('/blog/tech-2'), '(9) tech-2 included');
  assert(!urls.includes('/blog/design-1'), '(9) design-1 excluded');
  assert(!urls.includes('/blog/no-folder'), '(9) un-foldered entry excluded');
}

// ---------------------------------------------------------------------------
// (9b) Absent `folder` includes every entry in the slug regardless of folder
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement();
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'tech-1', folder: 'tech-notes' }),
    makeEntry({ slug: 'design-1', folder: 'design-notes' }),
    makeEntry({ slug: 'no-folder' }),
  ];
  const out = materializeCollections(site, entries);
  const matrix = getCollectionFrom(out).entries!;
  assert(matrix.length === 3, `(9b) absent folder = all 3 entries (got ${String(matrix.length)})`);
}

// ---------------------------------------------------------------------------
// (10) `sort: 'manual'` honours manualOrder, appends missing in date-desc
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({
    sort: 'manual',
    manualOrder: ['entry-third', 'entry-first'],
  });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'first', publishedDate: '2026-01-01T00:00:00.000Z' }),
    makeEntry({ slug: 'second', publishedDate: '2026-02-01T00:00:00.000Z' }),
    makeEntry({ slug: 'third', publishedDate: '2026-03-01T00:00:00.000Z' }),
    makeEntry({ slug: 'fourth', publishedDate: '2026-04-01T00:00:00.000Z' }),
  ];
  const out = materializeCollections(site, entries);
  const matrix = getCollectionFrom(out).entries!;
  const urls = matrix.map((inst) => externalUrlOf(inst[0]! as ContainerElement));
  assert(
    urls[0] === '/blog/third' && urls[1] === '/blog/first',
    `(10) manualOrder respected (got ${urls.join(',')})`,
  );
  assert(
    urls[2] === '/blog/fourth' && urls[3] === '/blog/second',
    `(10) unclaimed entries appended date-desc (got ${urls.join(',')})`,
  );
}

// ---------------------------------------------------------------------------
// (10b) Stale ids in `manualOrder` (entry deleted) are skipped silently
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({
    sort: 'manual',
    manualOrder: ['entry-vanished', 'entry-first', 'entry-also-gone'],
  });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'first', publishedDate: '2026-01-01T00:00:00.000Z' }),
    makeEntry({ slug: 'second', publishedDate: '2026-02-01T00:00:00.000Z' }),
  ];
  let threw = false;
  try {
    const out = materializeCollections(site, entries);
    const matrix = getCollectionFrom(out).entries!;
    const urls = matrix.map((inst) => externalUrlOf(inst[0]! as ContainerElement));
    assert(urls.length === 2, `(10b) only surviving entries rendered (got ${urls.length})`);
    assert(
      urls[0] === '/blog/first' && urls[1] === '/blog/second',
      `(10b) stale ids skipped, then date-desc append (got ${urls.join(',')})`,
    );
  } catch (_e) {
    threw = true;
  }
  assert(!threw, '(10b) stale manualOrder ids do not crash the materializer');
}

// ---------------------------------------------------------------------------
// (10c) `sort: 'date-asc'` orders oldest-first
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({ sort: 'date-asc' });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'newer', publishedDate: '2026-06-01T00:00:00.000Z' }),
    makeEntry({ slug: 'older', publishedDate: '2026-01-01T00:00:00.000Z' }),
  ];
  const out = materializeCollections(site, entries);
  const matrix = getCollectionFrom(out).entries!;
  const urls = matrix.map((inst) => externalUrlOf(inst[0]! as ContainerElement));
  assert(
    urls[0] === '/blog/older' && urls[1] === '/blog/newer',
    `(10c) date-asc orders oldest-first (got ${urls.join(',')})`,
  );
}

// ---------------------------------------------------------------------------
// (11) Zero-entry case returns empty + a warning of the ADR-pinned shape
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({ id: 'col-empty', collectionSlug: 'nonexistent' });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const { site: out, warnings } = materializeCollectionsWithReport(site, []);
  const matrix = getCollectionFrom(out).entries!;
  assert(matrix.length === 0, `(11) zero matches → empty matrix (got ${String(matrix.length)})`);
  assert(warnings.length === 1, `(11) one warning emitted (got ${String(warnings.length)})`);
  assert(
    warnings[0]!.includes('Collection element col-empty on page home matched 0 entries'),
    `(11) warning names element + page (got: ${warnings[0]!})`,
  );
  assert(
    warnings[0]!.includes('source=nonexistent') && warnings[0]!.includes('folder=unset'),
    `(11) warning carries source + folder (got: ${warnings[0]!})`,
  );
}

// ---------------------------------------------------------------------------
// (11b) `collectionSlug === undefined` also yields empty + 'source=unset'
// ---------------------------------------------------------------------------

{
  const collection: CollectionElement = {
    id: 'col-unbound',
    type: 'collection',
    box: { x: 0, y: 0, w: 1200, h: 600, z: 1 },
    display: 'card',
    sort: 'date-desc',
  };
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const entries: MaterializerEntry[] = [makeEntry({ slug: 'anything' })];
  const { site: out, warnings } = materializeCollectionsWithReport(site, entries);
  const matrix = getCollectionFrom(out).entries!;
  assert(matrix.length === 0, '(11b) unbound collection produces no instances');
  assert(
    warnings[0]!.includes('source=unset'),
    `(11b) unbound warning labels source=unset (got: ${warnings[0]!})`,
  );
}

// ---------------------------------------------------------------------------
// (11c) Folder filter referencing an empty folder → warning carries folder
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({ id: 'col-no-folder-hits', folder: 'ghost-folder' });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const entries: MaterializerEntry[] = [makeEntry({ slug: 'real', folder: 'tech-notes' })];
  const { warnings } = materializeCollectionsWithReport(site, entries);
  assert(warnings.length === 1, '(11c) one warning for empty folder');
  assert(
    warnings[0]!.includes('source=blog') && warnings[0]!.includes('folder=ghost-folder'),
    `(11c) warning names source + folder (got: ${warnings[0]!})`,
  );
}

// ---------------------------------------------------------------------------
// (13) Purity holds across the hydrate path too
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement();
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const before = JSON.stringify(site);
  materializeCollections(site, [makeEntry({ slug: 'one' })]);
  const after = JSON.stringify(site);
  assert(before === after, '(13) hydrate path does not mutate input site');
}

// ---------------------------------------------------------------------------
// ADR 0065 D8 — `'custom'` arm
// ---------------------------------------------------------------------------

/** Build a small, non-default customTemplate the Owner might author themselves:
 *  outer container link surface + bare title text. Exercises the shared
 *  helper's "first container → linkHref overwritten" and "{{title}} text
 *  substitution" without re-using the default constants. */
function makeOwnerAuthoredCustomTemplate(): CanvasElement[] {
  const container: ContainerElement = {
    id: 'owner-card-root',
    type: 'container',
    box: { x: 0, y: 0, w: 400, h: 250, z: 1 },
    variant: 'flat',
    linkHref: { type: 'external', url: '/{{slug}}' },
    linkLabel: '{{title}}',
  };
  const title: TextElement = {
    id: 'owner-card-title',
    type: 'text',
    box: { x: 16, y: 16, w: 368, h: 48, z: 2 },
    content: [{ text: '{{title}}' }],
    role: 'heading',
    fontSize: 28,
    fontWeight: 700,
    align: 'left',
  };
  return [container, title];
}

// ---------------------------------------------------------------------------
// (14) `display: 'custom'` clones customTemplate per entry with substitutions
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({
    display: 'custom',
    customTemplate: makeOwnerAuthoredCustomTemplate(),
  });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'one', title: 'Custom one' }),
    makeEntry({ slug: 'two', title: 'Custom two' }),
  ];
  const out = materializeCollections(site, entries);
  const matrix = getCollectionFrom(out).entries!;
  assert(matrix.length === 2, `(14) custom arm renders N entries (got ${String(matrix.length)})`);

  const firstContainer = matrix[0]![0]! as ContainerElement;
  assert(firstContainer.type === 'container', '(14) custom instance[0] is the link container');
  assert(firstContainer.id === 'owner-card-root--one', '(14) custom container id suffixed by slug');
  assert(
    externalUrlOf(firstContainer) === '/blog/one',
    `(14) custom outer linkHref = /blog/one (got ${externalUrlOf(firstContainer)})`,
  );
  assert(firstContainer.linkLabel === 'Custom one', '(14) custom container linkLabel substituted');

  const firstTitle = matrix[0]![1]! as TextElement;
  assert(firstTitle.id === 'owner-card-title--one', '(14) custom title id suffixed by slug');
  assert(firstTitle.content[0]!.text === 'Custom one', '(14) custom title text substituted');

  const secondContainer = matrix[1]![0]! as ContainerElement;
  assert(
    externalUrlOf(secondContainer) === '/blog/two',
    '(14) second custom instance links to /blog/two',
  );
}

// ---------------------------------------------------------------------------
// (15) Shared-helper identity: `'card'` and `'custom'` produce byte-equal
//      output when customTemplate is the default card template array
// ---------------------------------------------------------------------------

{
  const cardCollection = makeCollectionElement({ id: 'col-shared', display: 'card' });
  const customCollection = makeCollectionElement({
    id: 'col-shared',
    display: 'custom',
    customTemplate: [DEFAULT_CARD_TEMPLATE, ...DEFAULT_CARD_SIBLINGS],
  });
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'identity-a', title: 'Identity A', ogImageAssetId: 'asset-a' }),
    makeEntry({ slug: 'identity-b', title: 'Identity B', ogImageAssetId: 'asset-b' }),
  ];
  const cardOut = materializeCollections(
    makeSite([makeOrdinaryPageWithCollection(cardCollection)]),
    entries,
  );
  const customOut = materializeCollections(
    makeSite([makeOrdinaryPageWithCollection(customCollection)]),
    entries,
  );
  const cardEntries = getCollectionFrom(cardOut).entries!;
  const customEntries = getCollectionFrom(customOut).entries!;
  assert(
    JSON.stringify(cardEntries) === JSON.stringify(customEntries),
    "(15) 'card' and 'custom' arms produce byte-equal output when sharing the same template",
  );
}

// ---------------------------------------------------------------------------
// (16) `customTemplate === undefined` → zero cards + literal warning
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({ id: 'col-no-template', display: 'custom' });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const { site: out, warnings } = materializeCollectionsWithReport(site, [
    makeEntry({ slug: 'doesnt-matter' }),
  ]);
  const matrix = getCollectionFrom(out).entries!;
  assert(matrix.length === 0, `(16) undefined customTemplate → zero cards (got ${matrix.length})`);
  assert(
    warnings.includes(
      "Collection element col-no-template display='custom' but customTemplate is not set.",
    ),
    `(16) undefined customTemplate emits the ADR-pinned warning (got: ${warnings.join(' | ')})`,
  );
  // The zero-entries warning must NOT also fire — broken template short-circuits.
  assert(
    !warnings.some((w) => w.includes('matched 0 entries')),
    '(16) zero-entries warning does not also fire when customTemplate is undefined',
  );
}

// ---------------------------------------------------------------------------
// (17) `customTemplate === []` → zero cards + literal warning
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({
    id: 'col-empty-template',
    display: 'custom',
    customTemplate: [],
  });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const { site: out, warnings } = materializeCollectionsWithReport(site, [
    makeEntry({ slug: 'still-doesnt-matter' }),
  ]);
  const matrix = getCollectionFrom(out).entries!;
  assert(matrix.length === 0, `(17) empty customTemplate → zero cards (got ${matrix.length})`);
  assert(
    warnings.includes(
      "Collection element col-empty-template display='custom' but customTemplate has zero elements.",
    ),
    `(17) empty customTemplate emits the ADR-pinned warning (got: ${warnings.join(' | ')})`,
  );
  assert(
    !warnings.some((w) => w.includes('matched 0 entries')),
    '(17) zero-entries warning does not also fire when customTemplate is empty',
  );
}

// ---------------------------------------------------------------------------
// (18) `customTemplate` non-empty + zero matching entries → existing
//      zero-entries warning fires, NOT the custom-empty warning
// ---------------------------------------------------------------------------

{
  const collection = makeCollectionElement({
    id: 'col-no-entries',
    collectionSlug: 'nonexistent',
    display: 'custom',
    customTemplate: makeOwnerAuthoredCustomTemplate(),
  });
  const site = makeSite([makeOrdinaryPageWithCollection(collection)]);
  const { site: out, warnings } = materializeCollectionsWithReport(site, []);
  const matrix = getCollectionFrom(out).entries!;
  assert(matrix.length === 0, `(18) zero entries → empty matrix (got ${matrix.length})`);
  assert(
    warnings.some((w) => w.includes('matched 0 entries')),
    `(18) zero-entries warning fires (got: ${warnings.join(' | ')})`,
  );
  assert(
    !warnings.some((w) => w.includes("display='custom' but customTemplate")),
    '(18) custom-empty warnings do NOT fire when customTemplate is well-formed',
  );
}

// ---------------------------------------------------------------------------
// (19) Folder filter + sort + manualOrder are identical between
//      `'card'` and `'custom'` — both arms route through the same
//      resolveEntriesForCollection path.
// ---------------------------------------------------------------------------

{
  const entries: MaterializerEntry[] = [
    makeEntry({ slug: 'tech-1', folder: 'tech-notes', publishedDate: '2026-01-01T00:00:00.000Z' }),
    makeEntry({ slug: 'tech-2', folder: 'tech-notes', publishedDate: '2026-03-01T00:00:00.000Z' }),
    makeEntry({ slug: 'design-1', folder: 'design', publishedDate: '2026-02-01T00:00:00.000Z' }),
  ];

  // (19a) Folder filter parity
  const cardFolder = makeCollectionElement({ folder: 'tech-notes', display: 'card' });
  const customFolder = makeCollectionElement({
    folder: 'tech-notes',
    display: 'custom',
    customTemplate: makeOwnerAuthoredCustomTemplate(),
  });
  const cardFolderUrls = getCollectionFrom(
    materializeCollections(makeSite([makeOrdinaryPageWithCollection(cardFolder)]), entries),
  )
    .entries!.map((inst) => externalUrlOf(inst[0]! as ContainerElement))
    .sort();
  const customFolderUrls = getCollectionFrom(
    materializeCollections(makeSite([makeOrdinaryPageWithCollection(customFolder)]), entries),
  )
    .entries!.map((inst) => externalUrlOf(inst[0]! as ContainerElement))
    .sort();
  assert(
    JSON.stringify(cardFolderUrls) === JSON.stringify(customFolderUrls),
    `(19a) folder filter behaves identically for 'card' and 'custom' ` +
      `(card=${cardFolderUrls.join(',')}, custom=${customFolderUrls.join(',')})`,
  );

  // (19b) Sort parity (date-asc)
  const cardSort = makeCollectionElement({ sort: 'date-asc', display: 'card' });
  const customSort = makeCollectionElement({
    sort: 'date-asc',
    display: 'custom',
    customTemplate: makeOwnerAuthoredCustomTemplate(),
  });
  const cardSortUrls = getCollectionFrom(
    materializeCollections(makeSite([makeOrdinaryPageWithCollection(cardSort)]), entries),
  ).entries!.map((inst) => externalUrlOf(inst[0]! as ContainerElement));
  const customSortUrls = getCollectionFrom(
    materializeCollections(makeSite([makeOrdinaryPageWithCollection(customSort)]), entries),
  ).entries!.map((inst) => externalUrlOf(inst[0]! as ContainerElement));
  assert(
    JSON.stringify(cardSortUrls) === JSON.stringify(customSortUrls),
    `(19b) sort: date-asc orders identically for 'card' and 'custom' ` +
      `(card=${cardSortUrls.join(',')}, custom=${customSortUrls.join(',')})`,
  );

  // (19c) manualOrder parity
  const cardManual = makeCollectionElement({
    sort: 'manual',
    manualOrder: ['entry-design-1', 'entry-tech-2'],
    display: 'card',
  });
  const customManual = makeCollectionElement({
    sort: 'manual',
    manualOrder: ['entry-design-1', 'entry-tech-2'],
    display: 'custom',
    customTemplate: makeOwnerAuthoredCustomTemplate(),
  });
  const cardManualUrls = getCollectionFrom(
    materializeCollections(makeSite([makeOrdinaryPageWithCollection(cardManual)]), entries),
  ).entries!.map((inst) => externalUrlOf(inst[0]! as ContainerElement));
  const customManualUrls = getCollectionFrom(
    materializeCollections(makeSite([makeOrdinaryPageWithCollection(customManual)]), entries),
  ).entries!.map((inst) => externalUrlOf(inst[0]! as ContainerElement));
  assert(
    JSON.stringify(cardManualUrls) === JSON.stringify(customManualUrls),
    `(19c) manualOrder honoured identically for 'card' and 'custom' ` +
      `(card=${cardManualUrls.join(',')}, custom=${customManualUrls.join(',')})`,
  );
}

console.log('[collection-materializer:smoke] OK');
