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
  },
});
const dragSliderState = makeSite(dragSliderCollection);
const dragSliderValidation = validateEditableSite(dragSliderState);
assert(
  dragSliderValidation.valid,
  dragSliderValidation.valid ? 'valid drag-slider gallery should pass' : dragSliderValidation.errors.join('; '),
);

const invalidDragSlider = makeSite(
  makeCollection({
    gallery: {
      mode: 'drag-slider',
      detailMode: 'inline-panel',
      reducedMotion: 'allow',
      sliderAxis: 'diagonal',
      sliderInertia: 'yes',
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
    decodedDragSlider.gallery?.sliderInertia === true,
  'Yjs projection must preserve collection gallery drag-slider policy',
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

interface StubNode {
  attrs: Record<string, string>;
  listeners: Record<string, Array<(ev: Record<string, unknown>) => void>>;
  props: Record<string, string>;
  getAttribute(key: string): string | null;
  setAttribute(key: string, value: string): void;
  addEventListener(type: string, handler: (ev: Record<string, unknown>) => void): void;
  querySelectorAll(selector: string): StubNode[];
  getBoundingClientRect(): { width: number; height: number };
  style: { setProperty(key: string, value: string): void };
}

function makeStubNode(attrs: Record<string, string>, width = 100): StubNode {
  const listeners: StubNode['listeners'] = {};
  const props: Record<string, string> = {};
  return {
    attrs,
    listeners,
    props,
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
  const root = makeStubNode({
    'data-opencanvas-collection-gallery': 'drag-slider',
    'data-opencanvas-collection-gallery-detail': 'inline-panel',
    'data-opencanvas-collection-gallery-reduced-motion': 'allow',
    'data-opencanvas-collection-gallery-slider-axis': 'x',
    'data-opencanvas-collection-gallery-slider-inertia': 'false',
  });
  root.querySelectorAll = (selector: string): StubNode[] => {
    if (selector === '[data-opencanvas-collection-gallery]') return [];
    if (selector === '[data-opencanvas-collection-entry]') return [firstEntry, secondEntry];
    return [];
  };
  hydrateCollectionGalleries(root);
  assert((root.listeners.pointerdown?.length ?? 0) === 1, 'drag-slider runtime must wire pointerdown');
  assert((root.listeners.pointermove?.length ?? 0) === 1, 'drag-slider runtime must wire pointermove');
  assert((root.listeners.pointerup?.length ?? 0) === 1, 'drag-slider runtime must wire pointerup');
  root.listeners.pointerdown![0]!({ clientX: 0, clientY: 0, preventDefault(): void {} });
  root.listeners.pointermove![0]!({ clientX: -120, clientY: 0, preventDefault(): void {} });
  root.listeners.pointerup![0]!({ clientX: -120, clientY: 0 });
  assert(
    root.props['--opencanvas-collection-slider-x'] === '-100.00px',
    `drag-slider runtime must clamp slider x to the second entry; got ${root.props['--opencanvas-collection-slider-x']}`,
  );
  assert(secondEntry.attrs['data-opencanvas-collection-entry-active'] === 'true', 'drag-slider must activate nearest entry');
  assert(root.attrs['data-opencanvas-collection-active-entry'] === '1', 'drag-slider must publish active entry index');
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

const publicStyles = readFileSync(join(repoSrcDir, 'canvas', 'public-styles.ts'), 'utf8');
assert(
  publicStyles.includes('data-opencanvas-collection-gallery="hover-reveal-detail"'),
  'public styles must include gallery v2 hover/reveal selectors',
);
assert(
  publicStyles.includes('data-opencanvas-collection-gallery="drag-slider"'),
  'public styles must include gallery drag-slider selectors',
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


