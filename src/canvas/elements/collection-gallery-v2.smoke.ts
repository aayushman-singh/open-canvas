import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasElement, CanvasPage, CanvasSection, EditableSite, PublishedSnapshot } from '../schema.js';
import { validateEditableSite } from '../validate.js';
import { decodeYDoc, encodeYDoc } from '../yjs-projection.js';
import { renderCanvasSnapshot } from '../render.js';
import { renderCollection, type CollectionElement } from './collection.js';
import { INTERACTIVE_RUNTIME_SRC } from '../../interactive/build.js';
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

const inspectorSource = readFileSync(join(repoSrcDir, 'editor-client', 'element-inspector.ts'), 'utf8');
assert(inspectorSource.includes('Collection gallery'), 'inspector must expose collection gallery controls');
assert(inspectorSource.includes('hover-reveal-detail'), 'inspector must expose hover-reveal-detail mode');
assert(inspectorSource.includes('Gallery reduced motion'), 'inspector must expose reduced-motion authoring');
assert(inspectorSource.includes('Gallery video hover'), 'inspector must expose batch video-hover authoring');
assert(inspectorSource.includes('videoHover'), 'inspector must write collection gallery video hover config');

const publicStyles = readFileSync(join(repoSrcDir, 'canvas', 'public-styles.ts'), 'utf8');
assert(
  publicStyles.includes('data-opencanvas-collection-gallery="hover-reveal-detail"'),
  'public styles must include gallery v2 hover/reveal selectors',
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


