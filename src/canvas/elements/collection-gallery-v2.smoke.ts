import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasElement, CanvasPage, CanvasSection, EditableSite, PublishedSnapshot } from '../schema.js';
import { validateEditableSite } from '../validate.js';
import { decodeYDoc, encodeYDoc } from '../yjs-projection.js';
import { renderCanvasSnapshot } from '../render.js';
import { renderCollection, type CollectionElement } from './collection.js';
import { INTERACTIVE_RUNTIME_SRC } from '../../interactive/build.js';
import { COLLECTION_GALLERY_RUNTIME_SRC } from '../../interactive/collection-gallery.js';
import { snapshotNeedsInteractiveRuntime } from '../../interactive/inject.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[collection-gallery-v2:smoke] ' + message);
}

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoSrcDir = join(thisDir, '..', '..');

function textElement(id: string, text: string, y = 0): CanvasElement {
  return {
    id,
    type: 'text',
    box: { x: 0, y, w: 240, h: 48, z: 1 },
    content: [{ text }],
    role: 'body',
    fontSize: 18,
    fontWeight: 600,
    align: 'left',
  };
}

function videoElement(id: string): CanvasElement {
  return {
    id,
    type: 'media',
    mediaKind: 'video',
    assetId: 'entry-video',
    posterAssetId: 'entry-poster',
    alt: 'Entry video',
    fit: 'cover',
    box: { x: 0, y: 0, w: 320, h: 180, z: 1 },
    playback: { muted: true, loop: true },
  };
}

function makeCollection(overrides: Partial<CollectionElement> = {}): CollectionElement {
  return {
    id: 'collection-gallery',
    type: 'collection',
    box: { x: 0, y: 0, w: 960, h: 540, z: 1 },
    collectionSlug: 'helmets',
    sort: 'date-desc',
    display: 'custom',
    gallery: {
      mode: 'hover-reveal-detail',
      detailMode: 'inline-panel',
      reducedMotion: 'allow',
    },
    entries: [
      [textElement('entry-one-title', 'First reveal')],
      [textElement('entry-two-title', 'Second reveal')],
    ],
    ...overrides,
  } as unknown as CollectionElement;
}

function makeSite(collection: CollectionElement): EditableSite {
  const section: CanvasSection = {
    id: 'collection-gallery-section',
    recipeId: 'custom',
    name: 'Collection Gallery',
    height: 760,
    elements: [collection],
  };
  const page: CanvasPage = {
    id: 'page-gallery',
    slug: 'gallery',
    title: 'Gallery',
    width: 1200,
    sections: [section],
  };
  return { styleKit: 'charcoal', pages: [page] };
}

const collection = makeCollection();
const state = makeSite(collection);
const valid = validateEditableSite(state);
assert(valid.valid, valid.valid ? 'valid gallery state should pass' : valid.errors.join('; '));

const invalid = makeSite(
  makeCollection({
    gallery: {
      mode: 'carousel',
      detailMode: 'inline-panel',
      reducedMotion: 'allow',
    } as unknown as NonNullable<CollectionElement['gallery']>,
  }),
);
const invalidResult = validateEditableSite(invalid);
assert(!invalidResult.valid, 'unknown collection gallery mode must fail validation');
assert(
  invalidResult.errors.some((error) => error.includes('gallery.mode')),
  `validation error must name gallery.mode; got ${invalidResult.valid ? 'valid' : invalidResult.errors.join(' | ')}`,
);

const invalidVideoHover = makeSite(
  makeCollection({
    gallery: {
      mode: 'hover-reveal-detail',
      detailMode: 'inline-panel',
      reducedMotion: 'allow',
      videoHover: {
        enabled: true,
        mode: 'spin',
        reducedMotion: 'allow',
      },
    } as unknown as NonNullable<CollectionElement['gallery']>,
  }),
);
const invalidVideoHoverResult = validateEditableSite(invalidVideoHover);
assert(!invalidVideoHoverResult.valid, 'invalid collection gallery video hover must fail validation');
assert(
  invalidVideoHoverResult.errors.some((error) => error.includes('gallery.videoHover.mode')),
  `validation error must name gallery.videoHover.mode; got ${invalidVideoHoverResult.valid ? 'valid' : invalidVideoHoverResult.errors.join(' | ')}`,
);

const dragSliderCollection = makeCollection({
  gallery: {
    mode: 'drag-slider',
    detailMode: 'inline-panel',
    reducedMotion: 'allow',
    sliderAxis: 'x',
    sliderInertia: true,
    showProgress: true,
  },
});
const dragSliderState = makeSite(dragSliderCollection);
const dragSliderValidation = validateEditableSite(dragSliderState);
assert(
  dragSliderValidation.valid,
  dragSliderValidation.valid ? 'valid drag-slider gallery should pass' : dragSliderValidation.errors.join('; '),
);

const searchCollection = makeCollection({
  search: {
    enabled: true,
    placeholder: 'Search helmets',
    emptyMessage: 'No matching helmets',
    reducedMotion: 'instant',
  },
});
const searchState = makeSite(searchCollection);
const searchValidation = validateEditableSite(searchState);
assert(
  searchValidation.valid,
  searchValidation.valid ? 'valid collection search should pass' : searchValidation.errors.join('; '),
);

const filterCollection = makeCollection({
  filterChips: {
    enabled: true,
    field: 'category',
    reducedMotion: 'instant',
    options: [
      { label: 'Road', value: 'road' },
      { label: 'Wet', value: 'wet' },
    ],
    defaultValue: 'road',
  },
  entryMetadata: [
    { slug: 'first', title: 'First reveal', folder: 'helmets', category: 'road', tags: ['aero', 'race'] },
    { slug: 'second', title: 'Second reveal', folder: 'garage', category: 'wet', tags: ['rain'] },
  ],
});
const filterState = makeSite(filterCollection);
const filterValidation = validateEditableSite(filterState);
assert(
  filterValidation.valid,
  filterValidation.valid ? 'valid collection filter chips should pass' : filterValidation.errors.join('; '),
);

const viewToggleCollection = makeCollection({
  viewToggle: {
    enabled: true,
    defaultMode: 'list',
    reducedMotion: 'instant',
  },
});
const viewToggleState = makeSite(viewToggleCollection);
const viewToggleValidation = validateEditableSite(viewToggleState);
assert(
  viewToggleValidation.valid,
  viewToggleValidation.valid ? 'valid collection view toggle should pass' : viewToggleValidation.errors.join('; '),
);

const invalidSearch = makeSite(
  makeCollection({
    search: {
      enabled: true,
      placeholder: '',
      emptyMessage: '',
      reducedMotion: 'fade',
    },
  } as unknown as Partial<CollectionElement>),
);
const invalidSearchResult = validateEditableSite(invalidSearch);
assert(!invalidSearchResult.valid, 'invalid collection search config must fail validation');
assert(
  invalidSearchResult.errors.some((error) => error.includes('search.reducedMotion')),
  `validation error must name search.reducedMotion; got ${invalidSearchResult.valid ? 'valid' : invalidSearchResult.errors.join(' | ')}`,
);
assert(
  invalidSearchResult.errors.some((error) => error.includes('search.placeholder')),
  `validation error must name search.placeholder; got ${invalidSearchResult.valid ? 'valid' : invalidSearchResult.errors.join(' | ')}`,
);

const invalidFilter = makeSite(
  makeCollection({
    filterChips: {
      enabled: true,
      field: 'driver',
      reducedMotion: 'fade',
      options: [],
      defaultValue: 'missing',
    },
  } as unknown as Partial<CollectionElement>),
);
const invalidFilterResult = validateEditableSite(invalidFilter);
assert(!invalidFilterResult.valid, 'invalid collection filter chip config must fail validation');
assert(
  invalidFilterResult.errors.some((error) => error.includes('filterChips.field')),
  `validation error must name filterChips.field; got ${invalidFilterResult.valid ? 'valid' : invalidFilterResult.errors.join(' | ')}`,
);
assert(
  invalidFilterResult.errors.some((error) => error.includes('filterChips.options')),
  `validation error must name filterChips.options; got ${invalidFilterResult.valid ? 'valid' : invalidFilterResult.errors.join(' | ')}`,
);
assert(
  invalidFilterResult.errors.some((error) => error.includes('filterChips.defaultValue')),
  `validation error must name filterChips.defaultValue; got ${invalidFilterResult.valid ? 'valid' : invalidFilterResult.errors.join(' | ')}`,
);

const invalidViewToggle = makeSite(
  makeCollection({
    viewToggle: {
      enabled: true,
      defaultMode: 'masonry',
      reducedMotion: 'fade',
    },
  } as unknown as Partial<CollectionElement>),
);
const invalidViewToggleResult = validateEditableSite(invalidViewToggle);
assert(!invalidViewToggleResult.valid, 'invalid collection view toggle config must fail validation');
assert(
  invalidViewToggleResult.errors.some((error) => error.includes('viewToggle.defaultMode')),
  `validation error must name viewToggle.defaultMode; got ${invalidViewToggleResult.valid ? 'valid' : invalidViewToggleResult.errors.join(' | ')}`,
);
assert(
  invalidViewToggleResult.errors.some((error) => error.includes('viewToggle.reducedMotion')),
  `validation error must name viewToggle.reducedMotion; got ${invalidViewToggleResult.valid ? 'valid' : invalidViewToggleResult.errors.join(' | ')}`,
);

const invalidDragSlider = makeSite(
  makeCollection({
    gallery: {
      mode: 'drag-slider',
      detailMode: 'inline-panel',
      reducedMotion: 'allow',
      sliderAxis: 'diagonal',
      sliderInertia: 'yes',
      showProgress: 'yes',
    } as unknown as NonNullable<CollectionElement['gallery']>,
  }),
);
const invalidDragSliderResult = validateEditableSite(invalidDragSlider);
assert(!invalidDragSliderResult.valid, 'invalid collection gallery drag slider must fail validation');
assert(
  invalidDragSliderResult.errors.some((error) => error.includes('gallery.sliderAxis')),
  `validation error must name gallery.sliderAxis; got ${invalidDragSliderResult.valid ? 'valid' : invalidDragSliderResult.errors.join(' | ')}`,
);
assert(
  invalidDragSliderResult.errors.some((error) => error.includes('gallery.sliderInertia')),
  `validation error must name gallery.sliderInertia; got ${invalidDragSliderResult.valid ? 'valid' : invalidDragSliderResult.errors.join(' | ')}`,
);
assert(
  invalidDragSliderResult.errors.some((error) => error.includes('gallery.showProgress')),
  `validation error must name gallery.showProgress; got ${invalidDragSliderResult.valid ? 'valid' : invalidDragSliderResult.errors.join(' | ')}`,
);

const html = renderCollection(collection, {
  styleKit: 'charcoal',
  assetBasePath: '/assets',
  renderChild: (child) => `<span data-opencanvas-element="${child.id}"></span>`,
});
assert(
  html.includes('data-opencanvas-collection-gallery="hover-reveal-detail"'),
  'renderer must emit explicit gallery mode metadata',
);
assert(
  html.includes('data-opencanvas-collection-gallery-detail="inline-panel"'),
  'renderer must emit explicit gallery detail metadata',
);
assert(
  html.includes('data-opencanvas-collection-gallery-reduced-motion="allow"'),
  'renderer must emit explicit gallery reduced-motion metadata',
);
assert(
  html.includes('data-opencanvas-collection-entry-active="true"'),
  'renderer must mark the initial active detail entry',
);
assert(html.includes('role="button"'), 'gallery entries must be keyboard-addressable buttons');

const dragSliderHtml = renderCollection(dragSliderCollection, {
  styleKit: 'charcoal',
  assetBasePath: '/assets',
  renderChild: (child) => `<span data-opencanvas-element="${child.id}"></span>`,
});
assert(
  dragSliderHtml.includes('data-opencanvas-collection-gallery="drag-slider"'),
  'renderer must emit drag-slider gallery mode metadata',
);
assert(
  dragSliderHtml.includes('data-opencanvas-collection-gallery-slider-axis="x"'),
  'renderer must emit drag-slider axis metadata',
);
assert(
  dragSliderHtml.includes('data-opencanvas-collection-gallery-slider-inertia="true"'),
  'renderer must emit drag-slider inertia metadata',
);
assert(
  dragSliderHtml.includes('data-opencanvas-collection-gallery-progress="true"'),
  'renderer must emit drag-slider progress metadata',
);
assert(
  dragSliderHtml.includes('data-opencanvas-collection-gallery-progress-dot="1"'),
  'renderer must emit one progress dot per materialized entry',
);
assert(
  dragSliderHtml.includes('tabindex="0"'),
  'renderer must make drag-slider gallery roots keyboard focusable',
);

const searchHtml = renderCollection(searchCollection, {
  styleKit: 'charcoal',
  assetBasePath: '/assets',
  renderChild: (child) => `<span data-opencanvas-element="${child.id}">${child.type === 'text' ? 'Searchable ' + child.id : ''}</span>`,
});
assert(
  searchHtml.includes('data-opencanvas-collection-search="true"'),
  'renderer must emit collection search metadata',
);
assert(
  searchHtml.includes('data-opencanvas-collection-search-reduced-motion="instant"'),
  'renderer must emit collection search reduced-motion metadata',
);
assert(
  searchHtml.includes('data-opencanvas-collection-search-input'),
  'renderer must emit a collection search input control',
);
assert(
  searchHtml.includes('placeholder="Search helmets"'),
  'renderer must emit owner-authored search placeholder copy',
);
assert(
  searchHtml.includes('No matching helmets'),
  'renderer must emit owner-authored search empty-state copy',
);

const filterHtml = renderCollection(filterCollection, {
  styleKit: 'charcoal',
  assetBasePath: '/assets',
  renderChild: (child) => `<span data-opencanvas-element="${child.id}"></span>`,
});
assert(
  filterHtml.includes('data-opencanvas-collection-filter="category"'),
  'renderer must emit collection filter field metadata',
);
assert(
  filterHtml.includes('data-opencanvas-collection-filter-reduced-motion="instant"'),
  'renderer must emit collection filter reduced-motion metadata',
);
assert(
  filterHtml.includes('data-opencanvas-collection-filter-option="road"'),
  'renderer must emit owner-authored filter option buttons',
);
assert(
  filterHtml.includes('data-opencanvas-collection-filter-active="true"'),
  'renderer must mark the default filter option active',
);
assert(
  filterHtml.includes('data-opencanvas-collection-entry-category="road"'),
  'renderer must emit per-entry category metadata',
);
assert(
  filterHtml.includes('data-opencanvas-collection-entry-tags="[&quot;aero&quot;,&quot;race&quot;]"'),
  'renderer must emit per-entry tags metadata',
);

const viewToggleHtml = renderCollection(viewToggleCollection, {
  styleKit: 'charcoal',
  assetBasePath: '/assets',
  renderChild: (child) => `<span data-opencanvas-element="${child.id}"></span>`,
});
assert(
  viewToggleHtml.includes('data-opencanvas-collection-view-toggle="true"'),
  'renderer must emit collection view-toggle metadata',
);
assert(
  viewToggleHtml.includes('data-opencanvas-collection-view-active="list"'),
  'renderer must emit default collection view state',
);
assert(
  viewToggleHtml.includes('data-opencanvas-collection-view-option="grid"') &&
    viewToggleHtml.includes('data-opencanvas-collection-view-option="list"'),
  'renderer must emit grid/list view toggle buttons',
);

const videoHoverCollection = makeCollection({
  gallery: {
    mode: 'hover-reveal-detail',
    detailMode: 'inline-panel',
    reducedMotion: 'allow',
    videoHover: {
      enabled: true,
      mode: 'play-reset',
      streamAssetId: 'entry-hover-video',
      streamPosterAssetId: 'entry-hover-poster',
      intentDelayMs: 100,
      reducedMotion: 'disabled',
    },
  },
  entries: [[videoElement('entry-video-card')]],
});
const videoHoverSnapshot: PublishedSnapshot = {
  ...makeSite(videoHoverCollection),
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
const videoHoverHtml = renderCanvasSnapshot(videoHoverSnapshot, '/assets', 'collection-gallery-video-hover', {
  turnstileSiteKey: 'test-key',
});
assert(
  videoHoverHtml.includes('data-opencanvas-video-hover="true"'),
  'collection gallery video hover must batch-apply hover metadata to entry videos',
);
assert(
  videoHoverHtml.includes('data-opencanvas-video-hover-stream-src="/assets/entry-hover-video"'),
  'collection gallery video hover must emit inherited stream asset metadata',
);
assert(
  videoHoverHtml.includes('data-opencanvas-video-hover-intent-delay-ms="100"'),
  'collection gallery video hover must emit inherited intent delay metadata',
);

const decoded = decodeYDoc(encodeYDoc(state));
const decodedCollection = decoded.pages[0]!.sections[0]!.elements[0]! as CollectionElement;
assert(
  decodedCollection.gallery?.mode === 'hover-reveal-detail',
  'Yjs projection must preserve collection gallery mode',
);
assert(
  decodedCollection.gallery?.detailMode === 'inline-panel',
  'Yjs projection must preserve collection gallery detail mode',
);
assert(
  decodedCollection.gallery?.reducedMotion === 'allow',
  'Yjs projection must preserve collection gallery reduced-motion policy',
);

const decodedVideoHover = decodeYDoc(encodeYDoc(makeSite(videoHoverCollection))).pages[0]!.sections[0]!
  .elements[0]! as CollectionElement;
assert(
  decodedVideoHover.gallery?.videoHover?.mode === 'play-reset',
  'Yjs projection must preserve collection gallery video hover policy',
);

const decodedDragSlider = decodeYDoc(encodeYDoc(dragSliderState)).pages[0]!.sections[0]!
  .elements[0]! as CollectionElement;
assert(
    decodedDragSlider.gallery?.mode === 'drag-slider' &&
    decodedDragSlider.gallery?.sliderAxis === 'x' &&
    decodedDragSlider.gallery?.sliderInertia === true &&
    decodedDragSlider.gallery?.showProgress === true,
  'Yjs projection must preserve collection gallery drag-slider policy',
);
const decodedSearch = decodeYDoc(encodeYDoc(searchState)).pages[0]!.sections[0]!
  .elements[0]! as CollectionElement;
assert(
  decodedSearch.search?.enabled === true &&
    decodedSearch.search.placeholder === 'Search helmets' &&
    decodedSearch.search.emptyMessage === 'No matching helmets' &&
    decodedSearch.search.reducedMotion === 'instant',
  'Yjs projection must preserve collection search policy',
);
const decodedFilter = decodeYDoc(encodeYDoc(filterState)).pages[0]!.sections[0]!
  .elements[0]! as CollectionElement;
assert(
  decodedFilter.filterChips?.enabled === true &&
    decodedFilter.filterChips.field === 'category' &&
    decodedFilter.filterChips.options.length === 2 &&
    decodedFilter.filterChips.defaultValue === 'road' &&
    decodedFilter.entryMetadata?.[0]?.tags.join('|') === 'aero|race',
  'Yjs projection must preserve collection filter chip policy and entry metadata',
);
const decodedViewToggle = decodeYDoc(encodeYDoc(viewToggleState)).pages[0]!.sections[0]!
  .elements[0]! as CollectionElement;
assert(
  decodedViewToggle.viewToggle?.enabled === true &&
    decodedViewToggle.viewToggle.defaultMode === 'list' &&
    decodedViewToggle.viewToggle.reducedMotion === 'instant',
  'Yjs projection must preserve collection view toggle policy',
);

const snapshot: PublishedSnapshot = {
  ...state,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
assert(
  snapshotNeedsInteractiveRuntime(snapshot),
  'gallery-enabled Collection must require the visitor interactive runtime',
);
assert(
  INTERACTIVE_RUNTIME_SRC.includes('hydrateCollectionGalleries'),
  'Runtime Hydrator bundle must include collection gallery hydration',
);
assert(
  INTERACTIVE_RUNTIME_SRC.includes('opencanvas:collection-gallery-failed'),
  'collection gallery runtime must emit a named failure event',
);
assert(
  INTERACTIVE_RUNTIME_SRC.includes('opencanvas:collection-search-failed'),
  'collection search runtime must emit a named failure event',
);
assert(
  INTERACTIVE_RUNTIME_SRC.includes('opencanvas:collection-filter-failed'),
  'collection filter runtime must emit a named failure event',
);

const searchSnapshot: PublishedSnapshot = {
  ...searchState,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
assert(
  snapshotNeedsInteractiveRuntime(searchSnapshot),
  'search-enabled Collection must require the visitor interactive runtime',
);
const filterSnapshot: PublishedSnapshot = {
  ...filterState,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
assert(
  snapshotNeedsInteractiveRuntime(filterSnapshot),
  'filter-enabled Collection must require the visitor interactive runtime',
);
const viewToggleSnapshot: PublishedSnapshot = {
  ...viewToggleState,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
assert(
  snapshotNeedsInteractiveRuntime(viewToggleSnapshot),
  'view-toggle-enabled Collection must require the visitor interactive runtime',
);

interface StubNode {
  attrs: Record<string, string>;
  listeners: Record<string, Array<(ev: Record<string, unknown>) => void>>;
  props: Record<string, string>;
  getAttribute(key: string): string | null;
  setAttribute(key: string, value: string): void;
  addEventListener(type: string, handler: (ev: Record<string, unknown>) => void): void;
  querySelectorAll(selector: string): StubNode[];
  querySelector(selector: string): StubNode | null;
  getBoundingClientRect(): { width: number; height: number };
  style: { setProperty(key: string, value: string): void };
  hidden: boolean;
  textContent: string;
  value: string;
}

function makeStubNode(attrs: Record<string, string>, width = 100, textContent = ''): StubNode {
  const listeners: StubNode['listeners'] = {};
  const props: Record<string, string> = {};
  return {
    attrs,
    listeners,
    props,
    hidden: false,
    textContent,
    value: '',
    getAttribute(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(attrs, key) ? attrs[key]! : null;
    },
    setAttribute(key: string, value: string): void {
      attrs[key] = value;
    },
    addEventListener(type: string, handler: (ev: Record<string, unknown>) => void): void {
      (listeners[type] ||= []).push(handler);
    },
    querySelectorAll(): StubNode[] {
      return [];
    },
    querySelector(): StubNode | null {
      return null;
    },
    getBoundingClientRect(): { width: number; height: number } {
      return { width, height: 80 };
    },
    style: {
      setProperty(key: string, value: string): void {
        props[key] = value;
      },
    },
  };
}

type HydrateCollectionGalleries = (scope: StubNode) => void;
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const makeHydrateCollectionGalleries = new Function(
  `${COLLECTION_GALLERY_RUNTIME_SRC}\nreturn hydrateCollectionGalleries;`,
) as () => HydrateCollectionGalleries;
const hydrateCollectionGalleries = makeHydrateCollectionGalleries();
function stubHidden(node: StubNode): boolean {
  return node.hidden;
}
function stubAttr(node: StubNode, key: string): string | undefined {
  return node.attrs[key];
}
{
  const firstEntry = makeStubNode({
    'data-opencanvas-collection-entry': '0',
    'data-opencanvas-collection-entry-active': 'true',
    'aria-expanded': 'true',
  });
  const secondEntry = makeStubNode({
    'data-opencanvas-collection-entry': '1',
    'data-opencanvas-collection-entry-active': 'false',
    'aria-expanded': 'false',
  });
  const firstDot = makeStubNode({
    'data-opencanvas-collection-gallery-progress-dot': '0',
    'data-opencanvas-collection-gallery-progress-active': 'true',
    'aria-current': 'true',
  });
  const secondDot = makeStubNode({
    'data-opencanvas-collection-gallery-progress-dot': '1',
    'data-opencanvas-collection-gallery-progress-active': 'false',
    'aria-current': 'false',
  });
  const root = makeStubNode({
    'data-opencanvas-collection-gallery': 'drag-slider',
    'data-opencanvas-collection-gallery-detail': 'inline-panel',
    'data-opencanvas-collection-gallery-reduced-motion': 'allow',
    'data-opencanvas-collection-gallery-slider-axis': 'x',
    'data-opencanvas-collection-gallery-slider-inertia': 'false',
    'data-opencanvas-collection-gallery-progress': 'true',
  });
  root.querySelectorAll = (selector: string): StubNode[] => {
    if (selector === '[data-opencanvas-collection-gallery]') return [];
    if (selector === '[data-opencanvas-collection-entry]') return [firstEntry, secondEntry];
    if (selector === '[data-opencanvas-collection-gallery-progress-dot]') return [firstDot, secondDot];
    return [];
  };
  hydrateCollectionGalleries(root);
  assert((root.listeners.pointerdown?.length ?? 0) === 1, 'drag-slider runtime must wire pointerdown');
  assert((root.listeners.pointermove?.length ?? 0) === 1, 'drag-slider runtime must wire pointermove');
  assert((root.listeners.pointerup?.length ?? 0) === 1, 'drag-slider runtime must wire pointerup');
  assert((root.listeners.keydown?.length ?? 0) === 1, 'drag-slider runtime must wire keyboard paging');
  assert((secondDot.listeners.click?.length ?? 0) === 1, 'drag-slider runtime must wire progress dot click');
  secondDot.listeners.click![0]!({ preventDefault(): void {} });
  assert(
    root.props['--opencanvas-collection-slider-x'] === '-100.00px',
    `progress dot click must move slider x to the second entry; got ${root.props['--opencanvas-collection-slider-x']}`,
  );
  assert(secondEntry.attrs['data-opencanvas-collection-entry-active'] === 'true', 'progress dot click must activate nearest entry');
  root.listeners.pointerdown![0]!({ clientX: 0, clientY: 0, preventDefault(): void {} });
  root.listeners.pointermove![0]!({ clientX: -120, clientY: 0, preventDefault(): void {} });
  root.listeners.pointerup![0]!({ clientX: -120, clientY: 0 });
  assert(
    root.props['--opencanvas-collection-slider-x'] === '-100.00px',
    `drag-slider runtime must clamp slider x to the second entry; got ${root.props['--opencanvas-collection-slider-x']}`,
  );
  assert(secondEntry.attrs['data-opencanvas-collection-entry-active'] === 'true', 'drag-slider must activate nearest entry');
  assert(root.attrs['data-opencanvas-collection-active-entry'] === '1', 'drag-slider must publish active entry index');
  assert(secondDot.attrs['data-opencanvas-collection-gallery-progress-active'] === 'true', 'drag-slider must activate nearest progress dot');
  assert(secondDot.attrs['aria-current'] === 'true', 'drag-slider progress dot must expose aria-current');
  root.listeners.keydown![0]!({ key: 'ArrowLeft', preventDefault(): void {} });
  const activeAfterArrow: string | undefined = root.attrs['data-opencanvas-collection-active-entry'];
  assert(activeAfterArrow === '0', 'ArrowLeft must page to the previous entry');
  const sliderAfterArrow: string | undefined = root.props['--opencanvas-collection-slider-x'];
  assert(
    sliderAfterArrow === '0.00px',
    `ArrowLeft must move slider x to the previous entry; got ${sliderAfterArrow}`,
  );
}
{
  const firstEntry = makeStubNode({ 'data-opencanvas-collection-entry': '0' }, 100, 'First Helmet Aero');
  const secondEntry = makeStubNode({ 'data-opencanvas-collection-entry': '1' }, 100, 'Second Helmet Rain');
  const input = makeStubNode({ 'data-opencanvas-collection-search-input': '' });
  const empty = makeStubNode({ 'data-opencanvas-collection-search-empty': '' });
  const root = makeStubNode({
    'data-opencanvas-collection-search': 'true',
    'data-opencanvas-collection-search-reduced-motion': 'instant',
  });
  root.querySelectorAll = (selector: string): StubNode[] => {
    if (selector === '[data-opencanvas-collection-gallery],[data-opencanvas-collection-search="true"]') return [];
    if (selector === '[data-opencanvas-collection-entry]') return [firstEntry, secondEntry];
    return [];
  };
  root.querySelector = (selector: string): StubNode | null => {
    if (selector === '[data-opencanvas-collection-search-input]') return input;
    if (selector === '[data-opencanvas-collection-search-empty]') return empty;
    return null;
  };
  hydrateCollectionGalleries(root);
  assert((input.listeners.input?.length ?? 0) === 1, 'collection search runtime must wire input events');
  input.value = 'rain';
  input.listeners.input![0]!({});
  assert(stubHidden(firstEntry) === true, 'collection search must hide unmatched entries');
  assert(stubHidden(secondEntry) === false, 'collection search must keep matched entries visible');
  assert(
    firstEntry.attrs['data-opencanvas-collection-entry-search-match'] === 'false',
    'collection search must publish unmatched entry state',
  );
  assert(
    secondEntry.attrs['data-opencanvas-collection-entry-search-match'] === 'true',
    'collection search must publish matched entry state',
  );
  assert(empty.hidden === true, 'collection search empty state must stay hidden when matches exist');
  input.value = 'nomatch';
  input.listeners.input![0]!({});
  assert(stubHidden(empty) === false, 'collection search empty state must show when no entries match');
  input.value = '';
  input.listeners.input![0]!({});
  assert(
    stubHidden(firstEntry) === false && stubHidden(secondEntry) === false,
    'empty collection search must restore all entries',
  );
}
{
  const firstEntry = makeStubNode({
    'data-opencanvas-collection-entry': '0',
    'data-opencanvas-collection-entry-category': 'road',
    'data-opencanvas-collection-entry-filter-match': 'true',
  }, 100, 'First Helmet Aero');
  const secondEntry = makeStubNode({
    'data-opencanvas-collection-entry': '1',
    'data-opencanvas-collection-entry-category': 'wet',
    'data-opencanvas-collection-entry-filter-match': 'true',
  }, 100, 'Second Helmet Rain');
  const allButton = makeStubNode({ 'data-opencanvas-collection-filter-option': '__all__' });
  const roadButton = makeStubNode({
    'data-opencanvas-collection-filter-option': 'road',
    'data-opencanvas-collection-filter-active': 'true',
  });
  const wetButton = makeStubNode({
    'data-opencanvas-collection-filter-option': 'wet',
    'data-opencanvas-collection-filter-active': 'false',
  });
  const root = makeStubNode({
    'data-opencanvas-collection-filter': 'category',
    'data-opencanvas-collection-filter-reduced-motion': 'instant',
    'data-opencanvas-collection-filter-default': 'road',
  });
  root.querySelectorAll = (selector: string): StubNode[] => {
    if (selector === '[data-opencanvas-collection-gallery],[data-opencanvas-collection-search="true"],[data-opencanvas-collection-filter]') return [];
    if (selector === '[data-opencanvas-collection-entry]') return [firstEntry, secondEntry];
    if (selector === '[data-opencanvas-collection-filter-option]') return [allButton, roadButton, wetButton];
    return [];
  };
  hydrateCollectionGalleries(root);
  assert((roadButton.listeners.click?.length ?? 0) === 1, 'collection filter runtime must wire option clicks');
  assert(stubHidden(firstEntry) === false, 'default collection filter must keep matching entries visible');
  assert(stubHidden(secondEntry) === true, 'default collection filter must hide non-matching entries');
  assert(
    secondEntry.attrs['data-opencanvas-collection-entry-filter-match'] === 'false',
    'collection filter must publish unmatched entry state',
  );
  wetButton.listeners.click![0]!({ preventDefault(): void {} });
  assert(stubHidden(firstEntry) === true, 'filter click must hide previous category entries');
  assert(stubHidden(secondEntry) === false, 'filter click must show selected category entries');
  assert(wetButton.attrs['data-opencanvas-collection-filter-active'] === 'true', 'filter click must activate selected chip');
  allButton.listeners.click![0]!({ preventDefault(): void {} });
  assert(stubHidden(firstEntry) === false && stubHidden(secondEntry) === false, 'all filter chip must restore every entry');
}
{
  const gridButton = makeStubNode({
    'data-opencanvas-collection-view-option': 'grid',
    'data-opencanvas-collection-view-active': 'false',
  });
  const listButton = makeStubNode({
    'data-opencanvas-collection-view-option': 'list',
    'data-opencanvas-collection-view-active': 'true',
  });
  const root = makeStubNode({
    'data-opencanvas-collection-view-toggle': 'true',
    'data-opencanvas-collection-view-default': 'list',
    'data-opencanvas-collection-view-reduced-motion': 'instant',
  });
  root.querySelectorAll = (selector: string): StubNode[] => {
    if (selector === '[data-opencanvas-collection-gallery],[data-opencanvas-collection-search="true"],[data-opencanvas-collection-filter],[data-opencanvas-collection-view-toggle="true"]') return [];
    if (selector === '[data-opencanvas-collection-view-option]') return [gridButton, listButton];
    if (selector === '[data-opencanvas-collection-entry]') return [];
    return [];
  };
  hydrateCollectionGalleries(root);
  assert(stubAttr(root, 'data-opencanvas-collection-view-active') === 'list', 'view toggle runtime must apply default view');
  assert((gridButton.listeners.click?.length ?? 0) === 1, 'view toggle runtime must wire option clicks');
  gridButton.listeners.click![0]!({ preventDefault(): void {} });
  assert(stubAttr(root, 'data-opencanvas-collection-view-active') === 'grid', 'view toggle click must update active view');
  assert(stubAttr(gridButton, 'data-opencanvas-collection-view-active') === 'true', 'view toggle click must activate selected button');
}

const inspectorSource = readFileSync(join(repoSrcDir, 'editor-client', 'element-inspector.ts'), 'utf8');
assert(inspectorSource.includes('Collection gallery'), 'inspector must expose collection gallery controls');
assert(inspectorSource.includes('hover-reveal-detail'), 'inspector must expose hover-reveal-detail mode');
assert(inspectorSource.includes('Gallery reduced motion'), 'inspector must expose reduced-motion authoring');
assert(inspectorSource.includes('Gallery video hover'), 'inspector must expose batch video-hover authoring');
assert(inspectorSource.includes('videoHover'), 'inspector must write collection gallery video hover config');
assert(inspectorSource.includes('Drag slider'), 'inspector must expose drag-slider gallery mode');
assert(inspectorSource.includes('Slider axis'), 'inspector must expose drag-slider axis control');
assert(inspectorSource.includes('sliderAxis'), 'inspector must write drag-slider axis config');
assert(inspectorSource.includes('Slider inertia'), 'inspector must expose drag-slider inertia control');
assert(inspectorSource.includes('sliderInertia'), 'inspector must write drag-slider inertia config');
assert(inspectorSource.includes('Show progress'), 'inspector must expose drag-slider progress controls');
assert(inspectorSource.includes('showProgress'), 'inspector must write drag-slider progress config');
assert(inspectorSource.includes('Collection search'), 'inspector must expose collection search controls');
assert(inspectorSource.includes('Search placeholder'), 'inspector must expose collection search placeholder copy');
assert(inspectorSource.includes('Search empty message'), 'inspector must expose collection search empty-state copy');
assert(inspectorSource.includes('search?.enabled'), 'inspector must read collection search enabled state');
assert(inspectorSource.includes('Collection filter chips'), 'inspector must expose collection filter chip controls');
assert(inspectorSource.includes('Filter options'), 'inspector must expose filter option editing');
assert(inspectorSource.includes('filterChips?.enabled'), 'inspector must read collection filter enabled state');
assert(inspectorSource.includes('Collection view toggle'), 'inspector must expose collection view toggle controls');
assert(inspectorSource.includes('viewToggle?.enabled'), 'inspector must read collection view toggle enabled state');

const publicStyles = readFileSync(join(repoSrcDir, 'canvas', 'public-styles.ts'), 'utf8');
assert(
  publicStyles.includes('data-opencanvas-collection-gallery="hover-reveal-detail"'),
  'public styles must include gallery v2 hover/reveal selectors',
);
assert(
  publicStyles.includes('data-opencanvas-collection-gallery="drag-slider"'),
  'public styles must include gallery drag-slider selectors',
);
assert(
  publicStyles.includes('data-opencanvas-collection-gallery-progress-dot'),
  'public styles must include gallery progress dot selectors',
);
assert(
  publicStyles.includes('data-opencanvas-collection-search-controls'),
  'public styles must include collection search controls',
);
assert(
  publicStyles.includes('data-opencanvas-collection-filter-controls'),
  'public styles must include collection filter controls',
);
assert(
  publicStyles.includes('data-opencanvas-collection-view-controls'),
  'public styles must include collection view-toggle controls',
);

const packageJson = JSON.parse(readFileSync(join(repoSrcDir, '..', 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
assert(
  packageJson.scripts['collection-gallery-v2:smoke'] ===
    'bun run src/canvas/elements/collection-gallery-v2.smoke.ts',
  'package.json must expose collection-gallery-v2:smoke',
);
assert(
  packageJson.scripts['ci:smoke']?.includes('collection-gallery-v2:smoke') === true,
  'ci:smoke must include collection-gallery-v2:smoke',
);

console.log('[collection-gallery-v2:smoke] OK');
