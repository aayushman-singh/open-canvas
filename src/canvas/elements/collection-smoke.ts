// src/canvas/elements/collection-smoke.ts
//
// `bun run collection:smoke` — Collection element smoke test. Verifies:
//   1. Manual-mode collection renders all entries with grid layout
//   2. Page-bound mode emits the correct mode attribute
//   3. Validation accepts well-formed collections and rejects bad ones
//   4. Page metadata fields survive schema validation
//   5. Yjs round-trip preserves collection + page metadata

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  TextElement,
} from '../schema.js';
import { validateEditableSite } from '../validate.js';
import { renderCollection, type CollectionElement } from './collection.js';
import { encodeYDoc, decodeYDoc } from '../yjs-projection.js';
import { renderText } from './text.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[collection:smoke] ${message}`);
}

// `renderChild` mirrors production: each cell is a fully-wrapped `rev01-element`
// div around the body. Production threads the canonical renderElement through
// ctx; the smoke fixtures only contain text children, so a minimal wrapper
// that carries the same data-rev01-element attribute is enough to assert on.
const RENDER_CTX = {
  styleKit: 'charcoal',
  assetBasePath: '/assets',
  renderChild: (element: CanvasElement): string => {
    if (element.type === 'text') {
      return `<div class="rev01-element" data-rev01-element="${element.id}" data-element-type="text">${renderText(element)}</div>`;
    }
    throw new Error(`[collection:smoke] unsupported fixture child type ${element.type}`);
  },
};

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

function makeManualCollection(): CollectionElement {
  return {
    id: 'el-collection-manual',
    type: 'collection',
    mode: 'manual',
    box: { x: 0, y: 0, w: 1200, h: 600, z: 1 },
    entryTemplate: [makeText('tmpl-name', 'Name'), makeText('tmpl-role', 'Role')],
    entries: [
      [makeText('entry-0-name', 'Alice'), makeText('entry-0-role', 'CEO')],
      [makeText('entry-1-name', 'Bob'), makeText('entry-1-role', 'CTO')],
      [makeText('entry-2-name', 'Carol'), makeText('entry-2-role', 'Design')],
    ],
    layout: { columns: 3, gap: 24 },
  };
}

function makePageBoundCollection(): CollectionElement {
  return {
    id: 'el-collection-pagebound',
    type: 'collection',
    mode: 'page-bound',
    box: { x: 0, y: 0, w: 1200, h: 600, z: 1 },
    entryTemplate: [makeText('tmpl-title', 'Title')],
    entries: [],
    filter: { category: 'blog', tags: ['launch', 'design'], limit: 10 },
    sort: { field: 'publishedDate', order: 'desc' },
    cardTemplate: [makeText('card-title', 'Card title')],
    fieldBindings: { 'card-title': 'title' },
    layout: { columns: 2, gap: 32 },
  };
}

function makeSection(elements: CollectionElement[]): CanvasSection {
  return {
    id: 'sec-collection',
    recipeId: 'custom',
    name: 'Collection section',
    height: 800,
    elements,
  };
}

function makeSiteState(
  collection: CollectionElement,
  pageMetadata?: Partial<CanvasPage>,
): EditableSite {
  const page: CanvasPage = {
    id: 'page-home',
    slug: 'home',
    title: 'Home',
    width: 1200,
    sections: [makeSection([collection])],
    ...pageMetadata,
  };
  return { styleKit: 'charcoal', pages: [page] };
}

// ---------------------------------------------------------------------------
// (1) Manual-mode collection renders all entries with grid layout
// ---------------------------------------------------------------------------

{
  const el = makeManualCollection();
  const html = renderCollection(el, RENDER_CTX);

  assert(html.includes('data-collection-mode="manual"'), '(1) manual mode attr present');
  assert(
    html.includes('grid-template-columns:repeat(3,1fr)'),
    '(1) grid-template-columns matches layout.columns=3',
  );
  assert(html.includes('gap:24px'), '(1) gap matches layout.gap=24');

  const entryMatches = html.match(/data-rev01-entry="/g) ?? [];
  assert(entryMatches.length === 3, `(1) renders 3 entries (got ${String(entryMatches.length)})`);

  // 2 cells per entry × 3 entries = 6 `rev01-element` wrappers emitted by
  // renderChild. The collection no longer wraps cells in a per-child layer;
  // each cell IS a full element wrapper.
  const childMatches = html.match(/class="rev01-element"/g) ?? [];
  assert(
    childMatches.length === 6,
    `(1) renders 6 children total (2 per entry × 3 entries, got ${String(childMatches.length)})`,
  );
  assert(html.includes('Alice'), '(1) renders entry text content, not placeholder divs only');
  assert(html.includes('CEO'), '(1) renders all text children for an entry');
}

// ---------------------------------------------------------------------------
// (2) Page-bound mode emits correct attributes
// ---------------------------------------------------------------------------

{
  const el = makePageBoundCollection();
  const html = renderCollection(el, RENDER_CTX);

  assert(html.includes('data-collection-mode="page-bound"'), '(2) page-bound mode attr present');
  assert(
    html.includes('grid-template-columns:repeat(2,1fr)'),
    '(2) grid-template-columns matches layout.columns=2',
  );

  const entryMatches = html.match(/data-rev01-entry="/g) ?? [];
  assert(
    entryMatches.length === 0,
    `(2) page-bound with no entries renders 0 entries (got ${String(entryMatches.length)})`,
  );
}

// ---------------------------------------------------------------------------
// (3) Validation: accepts good, rejects bad
// ---------------------------------------------------------------------------

{
  const goodState = makeSiteState(makeManualCollection());
  const goodResult = validateEditableSite(goodState);
  assert(
    goodResult.valid,
    `(3) valid manual collection passes validation: ${goodResult.valid ? '' : goodResult.errors.join('; ')}`,
  );

  const pageBoundState = makeSiteState(makePageBoundCollection());
  const pbResult = validateEditableSite(pageBoundState);
  assert(
    pbResult.valid,
    `(3) valid page-bound collection passes validation: ${pbResult.valid ? '' : pbResult.errors.join('; ')}`,
  );

  // Bad: missing mode
  const badMode = makeSiteState({
    ...makeManualCollection(),
    mode: 'invalid' as CollectionElement['mode'],
  });
  const badModeResult = validateEditableSite(badMode);
  assert(!badModeResult.valid, '(3) invalid mode rejected');

  // Bad: layout.columns < 1
  const badCols = makeSiteState({
    ...makeManualCollection(),
    layout: { columns: 0, gap: 10 },
  });
  const badColsResult = validateEditableSite(badCols);
  assert(!badColsResult.valid, '(3) layout.columns=0 rejected');

  // Bad: layout.gap < 0
  const badGap = makeSiteState({
    ...makeManualCollection(),
    layout: { columns: 2, gap: -1 },
  });
  const badGapResult = validateEditableSite(badGap);
  assert(!badGapResult.valid, '(3) layout.gap=-1 rejected');

  const badNestedText = makeManualCollection();
  badNestedText.entries = [[{ ...makeText('entry-bad-title', ''), content: [] }]];
  const badNestedResult = validateEditableSite(makeSiteState(badNestedText));
  assert(!badNestedResult.valid, '(3) invalid nested entry element rejected');

  const badBinding = makePageBoundCollection();
  badBinding.fieldBindings = {
    'card-title': 'slug' as NonNullable<CollectionElement['fieldBindings']>[string],
  };
  const badBindingResult = validateEditableSite(makeSiteState(badBinding));
  assert(!badBindingResult.valid, '(3) invalid field binding rejected');

  const badMetadataResult = validateEditableSite(
    makeSiteState(makeManualCollection(), { publishedDate: 'not-a-date' }),
  );
  assert(!badMetadataResult.valid, '(3) invalid page metadata date rejected');
}

// ---------------------------------------------------------------------------
// (4) Page metadata fields survive schema validation
// ---------------------------------------------------------------------------

{
  const state = makeSiteState(makeManualCollection(), {
    publishedDate: '2026-05-25T00:00:00.000Z',
    author: 'Alice',
    tags: ['launch', 'design'],
    category: 'blog',
  });
  const result = validateEditableSite(state);
  assert(
    result.valid,
    `(4) page metadata passes validation: ${result.valid ? '' : result.errors.join('; ')}`,
  );
  assert(
    state.pages[0]!.publishedDate === '2026-05-25T00:00:00.000Z',
    '(4) publishedDate preserved',
  );
  assert(state.pages[0]!.author === 'Alice', '(4) author preserved');
  assert(state.pages[0]!.tags!.length === 2, '(4) tags preserved');
  assert(state.pages[0]!.category === 'blog', '(4) category preserved');
}

// ---------------------------------------------------------------------------
// (5) Yjs round-trip: collection + page metadata survive encode → decode
// ---------------------------------------------------------------------------

{
  const state = makeSiteState(makePageBoundCollection(), {
    publishedDate: '2026-05-25T00:00:00.000Z',
    author: 'Alice',
    tags: ['launch', 'design'],
    category: 'blog',
  });

  const doc = encodeYDoc(state);
  const decoded = decodeYDoc(doc);

  // Page metadata round-trip
  const page = decoded.pages[0]!;
  assert(page.publishedDate === '2026-05-25T00:00:00.000Z', '(5) publishedDate round-trips');
  assert(page.author === 'Alice', '(5) author round-trips');
  assert(JSON.stringify(page.tags) === '["launch","design"]', '(5) tags round-trip');
  assert(page.category === 'blog', '(5) category round-trips');

  // Collection element round-trip
  const el = page.sections[0]!.elements[0]! as CollectionElement;
  assert(el.type === 'collection', '(5) element type round-trips');
  assert(el.mode === 'page-bound', '(5) mode round-trips');
  assert(el.layout.columns === 2, '(5) layout.columns round-trips');
  assert(el.layout.gap === 32, '(5) layout.gap round-trips');
  assert(el.filter!.category === 'blog', '(5) filter.category round-trips');
  assert(JSON.stringify(el.filter!.tags) === '["launch","design"]', '(5) filter.tags round-trip');
  assert(el.filter!.limit === 10, '(5) filter.limit round-trips');
  assert(el.sort!.field === 'publishedDate', '(5) sort.field round-trips');
  assert(el.sort!.order === 'desc', '(5) sort.order round-trips');
  assert(el.cardTemplate!.length === 1, '(5) cardTemplate round-trips');
  assert(el.fieldBindings!['card-title'] === 'title', '(5) fieldBindings round-trip');
  assert(el.entryTemplate.length === 1, '(5) entryTemplate round-trips');
}

console.log('[collection:smoke] OK');
