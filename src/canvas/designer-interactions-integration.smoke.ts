import { renderCanvasSnapshot } from './render.js';
import type { PublishedSnapshot } from './schema.js';
import {
  validateEditableSite,
  validatePublishedSnapshot,
  type ValidationResult,
} from './validate.js';

const TURNSTILE_TEST_KEY = 'turnstile-test-key';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[designer-interactions-integration:smoke] ${message}`);
}

function validationErrors(result: ValidationResult): string {
  return result.valid ? '' : result.errors.join('; ');
}

function expectInvalid(label: string, snapshot: unknown): void {
  const result = validatePublishedSnapshot(snapshot);
  assert(!result.valid, `expected ${label} to be invalid`);
  assert(
    result.errors.some((error) => error.includes(label)),
    `expected error list to mention ${label}; got ${result.errors.join('; ')}`,
  );
}

const baseSnapshot = {
  version: 1,
  publishedAt: '2026-06-16T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1200,
      sections: [
        {
          id: 'section-hero',
          recipeId: 'hero-split',
          name: 'Hero',
          height: 560,
          elements: [
            {
              id: 'hero-title',
              type: 'text',
              box: { x: 80, y: 90, w: 560, h: 120, z: 1 },
              content: [{ text: 'Designer motion' }],
              role: 'heading',
              fontSize: 56,
              fontWeight: 700,
              align: 'left',
            },
            {
              id: 'open-project',
              type: 'action',
              box: { x: 80, y: 240, w: 180, h: 48, z: 2 },
              label: [{ text: 'Open project' }],
              href: { type: 'external', url: 'https://example.com/project' },
              variant: 'solid',
            },
            {
              id: 'hero-lottie-owner',
              type: 'media',
              box: { x: 720, y: 72, w: 320, h: 320, z: 1 },
              mediaKind: 'image',
              assetId: 'asset-lottie',
              alt: '',
              fit: 'cover',
              richMotionAssetId: 'hero-lottie',
            },
          ],
        },
      ],
    },
  ],
  overlaySections: [
    {
      id: 'overlay-project-detail-section',
      recipeId: 'custom',
      name: 'Project Detail Overlay',
      height: 420,
      elements: [
        {
          id: 'overlay-title',
          type: 'text',
          box: { x: 48, y: 48, w: 640, h: 72, z: 1 },
          content: [{ text: 'Project detail' }],
          role: 'heading',
          fontSize: 36,
          fontWeight: 700,
          align: 'left',
        },
      ],
    },
  ],
  motionSequences: [
    {
      id: 'hero-intro',
      trigger: { type: 'load' },
      steps: [
        {
          id: 'headline-in',
          target: { type: 'element', elementId: 'hero-title' },
          properties: { opacity: [0, 1], y: [24, 0] },
          durationMs: 500,
          easing: 'out-cubic',
        },
      ],
    },
    {
      id: 'overlay-open',
      trigger: { type: 'click', elementId: 'open-project' },
      steps: [
        {
          id: 'overlay-panel-in',
          target: { type: 'overlay', overlayId: 'project-detail' },
          properties: { opacity: [0, 1], scale: [0.96, 1] },
          durationMs: 240,
          easing: 'out-cubic',
        },
      ],
    },
  ],
  scrollScenes: [
    {
      id: 'hero-scroll',
      trigger: { type: 'scroll-progress', sectionId: 'section-hero' },
      start: 'top bottom',
      end: 'bottom top',
      axis: 'y',
      scrub: true,
      sequence: {
        id: 'hero-scroll-sequence',
        trigger: { type: 'scroll-progress', sectionId: 'section-hero' },
        steps: [
          {
            id: 'hero-scroll-title',
            target: { type: 'element', elementId: 'hero-title' },
            properties: { y: [0, -80], opacity: [1, 0.4] },
            durationMs: 1,
          },
        ],
      },
    },
  ],
  overlays: [
    {
      id: 'project-detail',
      contentSectionId: 'overlay-project-detail-section',
      trigger: { type: 'click', elementId: 'open-project' },
      modality: 'modal',
      placement: { type: 'center' },
      dismissal: {
        closeButton: true,
        escapeKey: true,
        backdropClick: true,
        routeChange: true,
      },
      focus: {
        initial: { type: 'overlay' },
        returnTo: { type: 'trigger' },
        trap: true,
      },
      bodyScroll: 'lock',
      openSequenceId: 'overlay-open',
    },
  ],
  richMotionAssets: [
    {
      id: 'hero-lottie',
      ownerAssetId: 'asset-lottie',
      family: 'vector-animation',
      source: { kind: 'lottie-json' },
      playback: {
        trigger: { type: 'viewport-enter', elementId: 'hero-lottie-owner' },
        loop: false,
        speed: 1,
        reducedMotion: 'poster',
      },
    },
  ],
  loadExperience: {
    id: 'brand-load',
    run: 'once-per-session',
    gates: [{ type: 'document-ready' }, { type: 'asset-ready', assetId: 'asset-lottie' }],
    timeoutMs: 2500,
    introSequenceId: 'hero-intro',
    failureEvent: 'brand-load-failed',
  },
  routeTransition: {
    id: 'default-route',
    trigger: { type: 'same-site-navigation' },
    outgoingSequenceId: 'hero-intro',
    incomingSequenceId: 'hero-intro',
    swapAt: 'after-outgoing',
    scrollRestoration: 'top',
    hydrate: true,
    failureEvent: 'route-transition-failed',
  },
} as unknown as PublishedSnapshot;

const editableResult = validateEditableSite(baseSnapshot);
assert(
  editableResult.valid,
  `valid interaction fields should pass editable validation: ${validationErrors(editableResult)}`,
);
const publishedResult = validatePublishedSnapshot(baseSnapshot);
assert(
  publishedResult.valid,
  `valid interaction fields should pass published validation: ${validationErrors(publishedResult)}`,
);

const basePage = baseSnapshot.pages[0]!;
const baseSection = basePage.sections[0]!;
const baseElements = baseSection.elements;
const baseOverlay = baseSnapshot.overlays![0]!;
const baseMotionSequence = baseSnapshot.motionSequences![0]!;

const html = renderCanvasSnapshot(baseSnapshot, '/assets', 'smoke-site', {
  turnstileSiteKey: TURNSTILE_TEST_KEY,
});

assert(
  html.includes('data-opencanvas-designer-interactions'),
  'rendered HTML should include designer interaction JSON payload',
);
assert(
  html.includes('data-opencanvas-motion-sequence-count="2"'),
  'rendered HTML should expose the motion sequence count',
);
assert(
  html.includes('data-opencanvas-scroll-scene-count="1"'),
  'rendered HTML should expose the scroll scene count',
);
assert(
  html.includes('data-opencanvas-overlay="project-detail"'),
  'rendered HTML should include the overlay shell',
);
assert(
  html.includes('data-opencanvas-overlay-content-section="overlay-project-detail-section"'),
  'overlay shell should identify its content section',
);
assert(
  html.includes('data-opencanvas-rich-motion="hero-lottie"'),
  'rich motion owner element should carry a runtime marker',
);

expectInvalid('contentSectionId', {
  ...baseSnapshot,
  overlays: [{ ...baseOverlay, contentSectionId: 'missing-section' }],
});

expectInvalid('elementId', {
  ...baseSnapshot,
  overlays: [{ ...baseOverlay, trigger: { type: 'click', elementId: 'missing' } }],
});

expectInvalid('openSequenceId', {
  ...baseSnapshot,
  overlays: [{ ...baseOverlay, openSequenceId: 'missing-sequence' }],
});

expectInvalid('anchorElementId', {
  ...baseSnapshot,
  overlays: [
    {
      ...baseOverlay,
      placement: { type: 'anchored', anchorElementId: 'missing-anchor', side: 'bottom' },
    },
  ],
});

expectInvalid('richMotionAssetId', {
  ...baseSnapshot,
  pages: [
    {
      ...basePage,
      sections: [
        {
          ...baseSection,
          elements: [
            baseElements[0],
            baseElements[1],
            {
              ...baseElements[2],
              richMotionAssetId: 'missing-rich-motion',
            },
          ],
        },
      ],
    },
  ],
});

expectInvalid('motionSequences', {
  ...baseSnapshot,
  motionSequences: [baseMotionSequence, baseMotionSequence],
});

expectInvalid('hydrate', {
  ...baseSnapshot,
  routeTransition: { ...baseSnapshot.routeTransition, hydrate: false },
});

console.log('[designer-interactions-integration:smoke] OK');
