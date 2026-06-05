// src/canvas/elements/collection-smoke.ts
//
// ADR 0063 cutover — the Collection element no longer carries authorable
// children. Source binding, folder filter, sort, and display now live as
// scalar fields on the element; per-entry DOM is materializer output
// (Phase 2B). This smoke covers the type/validator shape Phase 1 lands:
//   1. Validation accepts a well-formed Collection (collectionSlug, sort,
//      display) and rejects malformed folder values per dec 7.
//   2. Page metadata fields survive schema validation.
//   3. Yjs round-trip preserves the new ADR-0063 fields plus page metadata.
//
// The render + materialization behaviour smokes belong to Phase 2B once the
// per-element materialization is implemented; the dead manual/page-bound
// rendering assertions retired with the page-bound model.

import type {
  CanvasPage,
  CanvasSection,
  EditableSite,
} from '../schema.js';
import { validateEditableSite } from '../validate.js';
import type { CollectionElement } from './collection.js';
import { encodeYDoc, decodeYDoc } from '../yjs-projection.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[collection:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeCollection(overrides: Partial<CollectionElement> = {}): CollectionElement {
  return {
    id: 'el-collection',
    type: 'collection',
    box: { x: 0, y: 0, w: 1200, h: 600, z: 1 },
    collectionSlug: 'blog',
    sort: 'date-desc',
    display: 'card',
    ...overrides,
  };
}

function makeSection(element: CollectionElement): CanvasSection {
  return {
    id: 'sec-collection',
    recipeId: 'custom',
    name: 'Collection section',
    height: 800,
    elements: [element],
  };
}

function makeSiteState(
  collection: CollectionElement,
  pageMetadata: Partial<CanvasPage> = {},
): EditableSite {
  const page: CanvasPage = {
    id: 'page-home',
    slug: 'home',
    title: 'Home',
    width: 1200,
    sections: [makeSection(collection)],
    ...pageMetadata,
  };
  return { styleKit: 'charcoal', pages: [page] };
}

// ---------------------------------------------------------------------------
// (1) Validation: accepts well-formed ADR-0063 Collection, rejects malformed
// ---------------------------------------------------------------------------

{
  const good = validateEditableSite(makeSiteState(makeCollection()));
  assert(
    good.valid,
    `(1) valid ADR-0063 collection passes validation: ${good.valid ? '' : good.errors.join('; ')}`,
  );

  // Unbound source is allowed (the inspector renders a "Pick a source" prompt).
  // exactOptionalPropertyTypes forbids passing `undefined` through Partial, so
  // construct the element directly with the key omitted to express absence.
  const unboundEl: CollectionElement = {
    id: 'el-collection',
    type: 'collection',
    box: { x: 0, y: 0, w: 1200, h: 600, z: 1 },
    sort: 'date-desc',
    display: 'card',
  };
  const unbound = validateEditableSite(makeSiteState(unboundEl));
  assert(unbound.valid, '(1) unbound collection (collectionSlug undefined) is allowed');

  // Folder shape constraints (ADR 0063 dec 7).
  const badSlash = validateEditableSite(makeSiteState(makeCollection({ folder: 'a/b' })));
  assert(!badSlash.valid, '(1) folder with "/" is rejected');

  const badBackslash = validateEditableSite(
    makeSiteState(makeCollection({ folder: 'a\\b' })),
  );
  assert(!badBackslash.valid, '(1) folder with "\\" is rejected');

  const tooLong = 'a'.repeat(65);
  const badLength = validateEditableSite(makeSiteState(makeCollection({ folder: tooLong })));
  assert(!badLength.valid, '(1) folder over 64 chars is rejected');

  // Unknown sort + display values are rejected. Build the elements directly
  // — exactOptionalPropertyTypes won't let an `undefined`-permitting cast
  // flow through Partial<CollectionElement>.
  const badSort = validateEditableSite(
    makeSiteState({
      ...makeCollection(),
      sort: 'random' as unknown as NonNullable<CollectionElement['sort']>,
    }),
  );
  assert(!badSort.valid, '(1) unknown sort value is rejected');

  const badDisplay = validateEditableSite(
    makeSiteState({
      ...makeCollection(),
      display: 'custom' as unknown as NonNullable<CollectionElement['display']>,
    }),
  );
  assert(!badDisplay.valid, "(1) display 'custom' (deferred to F1) is rejected this commit");

  // manualOrder shape: must be string[] when present.
  const manualOk = validateEditableSite(
    makeSiteState(makeCollection({ sort: 'manual', manualOrder: ['e1', 'e2'] })),
  );
  assert(manualOk.valid, "(1) sort='manual' with manualOrder string[] is allowed");

  const badManual = validateEditableSite(
    makeSiteState(
      makeCollection({
        sort: 'manual',
        manualOrder: [42 as unknown as string],
      }),
    ),
  );
  assert(!badManual.valid, '(1) manualOrder with a non-string id is rejected');
}

// ---------------------------------------------------------------------------
// (2) Page metadata still validates around the new Collection shape
// ---------------------------------------------------------------------------

{
  const state = makeSiteState(makeCollection(), {
    publishedDate: '2026-05-25T00:00:00.000Z',
    author: 'Alice',
    tags: ['launch', 'design'],
    category: 'blog',
  });
  const result = validateEditableSite(state);
  assert(
    result.valid,
    `(2) page metadata passes validation: ${result.valid ? '' : result.errors.join('; ')}`,
  );
  assert(
    state.pages[0]!.publishedDate === '2026-05-25T00:00:00.000Z',
    '(2) publishedDate preserved',
  );
  assert(state.pages[0]!.author === 'Alice', '(2) author preserved');
  assert(state.pages[0]!.tags!.length === 2, '(2) tags preserved');
  assert(state.pages[0]!.category === 'blog', '(2) category preserved');

  const badMetadata = validateEditableSite(
    makeSiteState(makeCollection(), { publishedDate: 'not-a-date' }),
  );
  assert(!badMetadata.valid, '(2) invalid page metadata date rejected');
}

// ---------------------------------------------------------------------------
// (3) Yjs round-trip: ADR-0063 fields + page metadata survive encode -> decode
// ---------------------------------------------------------------------------

{
  const state = makeSiteState(
    makeCollection({
      collectionSlug: 'blog',
      folder: 'tech',
      sort: 'manual',
      manualOrder: ['e1', 'e2', 'e3'],
      display: 'image-only',
    }),
    {
      publishedDate: '2026-05-25T00:00:00.000Z',
      author: 'Alice',
      tags: ['launch', 'design'],
      category: 'blog',
    },
  );

  const doc = encodeYDoc(state);
  const decoded = decodeYDoc(doc);

  // Page metadata round-trip
  const page = decoded.pages[0]!;
  assert(page.publishedDate === '2026-05-25T00:00:00.000Z', '(3) publishedDate round-trips');
  assert(page.author === 'Alice', '(3) author round-trips');
  assert(JSON.stringify(page.tags) === '["launch","design"]', '(3) tags round-trip');
  assert(page.category === 'blog', '(3) category round-trips');

  // Collection element round-trip
  const el = page.sections[0]!.elements[0]! as CollectionElement;
  assert(el.type === 'collection', '(3) element type round-trips');
  assert(el.collectionSlug === 'blog', '(3) collectionSlug round-trips');
  assert(el.folder === 'tech', '(3) folder round-trips');
  assert(el.sort === 'manual', '(3) sort round-trips');
  assert(el.display === 'image-only', '(3) display round-trips');
  assert(JSON.stringify(el.manualOrder) === '["e1","e2","e3"]', '(3) manualOrder round-trips');
}

console.log('[collection:smoke] OK');
