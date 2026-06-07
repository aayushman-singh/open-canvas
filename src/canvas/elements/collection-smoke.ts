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
//   4. ADR 0065 D1/D2 — `display: 'custom'` is accepted and `customTemplate`
//      validates + Yjs round-trips.
//
// The render + materialization behaviour smokes belong to Phase 2B once the
// per-element materialization is implemented; the dead manual/page-bound
// rendering assertions retired with the page-bound model.

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  TextElement,
} from '../schema.js';
import { validateEditableSite } from '../validate.js';
import type { CollectionElement } from './collection.js';
import { encodeYDoc, decodeYDoc } from '../yjs-projection.js';
import { seedCustomTemplate } from './collection-defaults.js';

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

  // ADR 0065 D1 — `display: 'custom'` is now an accepted value.
  const customDisplay = validateEditableSite(
    makeSiteState({ ...makeCollection(), display: 'custom' }),
  );
  assert(
    customDisplay.valid,
    `(1) display 'custom' is accepted (ADR 0065 D1): ${customDisplay.valid ? '' : customDisplay.errors.join('; ')}`,
  );

  // Unknown display string is still rejected.
  const badDisplay = validateEditableSite(
    makeSiteState({
      ...makeCollection(),
      display: 'magazine' as unknown as NonNullable<CollectionElement['display']>,
    }),
  );
  assert(!badDisplay.valid, '(1) unknown display value is rejected');

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

// ---------------------------------------------------------------------------
// (4) ADR 0065 D2 — `customTemplate` validates + Yjs round-trips
// ---------------------------------------------------------------------------

{
  // seedCustomTemplate() is the canonical "first switch to 'custom'" payload
  // (ADR 0065 D3); it must validate against the schema unmodified.
  const seeded = seedCustomTemplate('el-collection');
  assert(seeded.length > 0, '(4) seedCustomTemplate returns a non-empty array');
  const seedState = validateEditableSite(
    makeSiteState(makeCollection({ display: 'custom', customTemplate: seeded })),
  );
  assert(
    seedState.valid,
    `(4) seeded customTemplate validates: ${seedState.valid ? '' : seedState.errors.join('; ')}`,
  );

  // Empty customTemplate is a valid shape — the materializer's Phase 2B
  // "zero elements" failure path (ADR 0065 D8) emits a publish warning;
  // the validator does not block. (No-fallback discipline: do not silently
  // synthesise a default template here.)
  const emptyTemplate = validateEditableSite(
    makeSiteState(makeCollection({ display: 'custom', customTemplate: [] })),
  );
  assert(emptyTemplate.valid, '(4) empty customTemplate is shape-valid (warning is Phase 2B)');

  // Malformed children inside customTemplate fail validation just like any
  // other element subtree.
  const badChild: TextElement = {
    id: 'bad-child',
    type: 'text',
    box: { x: 0, y: 0, w: 100, h: 40, z: 1 },
    content: [{ text: 'oops' }],
    role: 'body',
    fontSize: -5, // invalid: fontSize must be positive
    fontWeight: 400,
    align: 'left',
  };
  const badTemplate = validateEditableSite(
    makeSiteState(
      makeCollection({
        display: 'custom',
        customTemplate: [badChild satisfies CanvasElement],
      }),
    ),
  );
  assert(!badTemplate.valid, '(4) malformed customTemplate child is rejected');

  // Yjs round-trip preserves customTemplate as a flat element array.
  const state = makeSiteState(
    makeCollection({ display: 'custom', customTemplate: seedCustomTemplate('el-collection') }),
  );
  const doc = encodeYDoc(state);
  const decoded = decodeYDoc(doc);
  const el = decoded.pages[0]!.sections[0]!.elements[0]! as CollectionElement;
  assert(el.display === 'custom', '(4) display=custom round-trips through Yjs');
  assert(Array.isArray(el.customTemplate), '(4) customTemplate round-trips as array');
  assert(
    el.customTemplate.length === seeded.length,
    `(4) customTemplate preserves length (got ${String(el.customTemplate.length)}, expected ${String(seeded.length)})`,
  );
  // Spot-check the outer Container survived encode/decode.
  assert(
    el.customTemplate[0]!.type === 'container',
    '(4) customTemplate[0] is the outer Container after round-trip',
  );

  // ADR 0065 D4 — silent keep. Flipping display away from 'custom' must
  // not strip customTemplate at the validator/Yjs layer; persistence is the
  // editor's job to preserve.
  const keptAfterSwitch = makeSiteState(
    makeCollection({ display: 'card', customTemplate: seedCustomTemplate('el-collection') }),
  );
  const keptResult = validateEditableSite(keptAfterSwitch);
  assert(
    keptResult.valid,
    `(4) customTemplate survives display='card' validation: ${keptResult.valid ? '' : keptResult.errors.join('; ')}`,
  );
  const keptDoc = encodeYDoc(keptAfterSwitch);
  const keptDecoded = decodeYDoc(keptDoc);
  const keptEl = keptDecoded.pages[0]!.sections[0]!.elements[0]! as CollectionElement;
  assert(
    Array.isArray(keptEl.customTemplate) && keptEl.customTemplate.length > 0,
    '(4) customTemplate survives display switch through Yjs',
  );
}

// ---------------------------------------------------------------------------
// (5) Codex review pass 1 — two Collections on the same page each seeded
//     with `seedCustomTemplate(collectionId)` pass page-level uniqueness.
//     Before the fix, both collections seeded `card-default-root` and the
//     validator rejected the page with a duplicate-id error (save + publish
//     blocked).
// ---------------------------------------------------------------------------

{
  const collA: CollectionElement = {
    id: 'coll-alpha',
    type: 'collection',
    box: { x: 0, y: 0, w: 600, h: 400, z: 1 },
    collectionSlug: 'blog',
    sort: 'date-desc',
    display: 'custom',
    customTemplate: seedCustomTemplate('coll-alpha'),
  };
  const collB: CollectionElement = {
    id: 'coll-beta',
    type: 'collection',
    box: { x: 0, y: 400, w: 600, h: 400, z: 2 },
    collectionSlug: 'blog',
    sort: 'date-desc',
    display: 'custom',
    customTemplate: seedCustomTemplate('coll-beta'),
  };
  const section: CanvasSection = {
    id: 'sec-two-collections',
    recipeId: 'custom',
    name: 'Two collections',
    height: 800,
    elements: [collA, collB],
  };
  const page: CanvasPage = {
    id: 'page-two-collections',
    slug: 'two-collections',
    title: 'Two collections',
    width: 1200,
    sections: [section],
  };
  const result = validateEditableSite({ styleKit: 'charcoal', pages: [page] });
  assert(
    result.valid,
    `(5) two Collections on one page with seeded customTemplates validate: ` +
      `${result.valid ? '' : result.errors.join('; ')}`,
  );
}

console.log('[collection:smoke] OK');
