import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';

import { renderElementBody, RENDER_DISPATCH, INSPECTOR_DISPATCH, AGENT_TOOL_DISPATCH, SIDEBAR_DISPATCH } from './index.js';
import { decodeYDoc, encodeYDoc, Y_DECODE_DISPATCH, Y_ENCODE_DISPATCH } from '../yjs-projection.js';
import { ELEMENT_TYPES, type EditableSite } from '../schema.js';
import { validateEditableSite, validatePublishedSnapshot } from '../validate.js';
import { SIDEBAR_FACTORIES } from '../../editor-client/sidebar-factories.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[rich-motion:smoke] ${message}`);
}

const richMotionElement = {
  id: 'motion-hero',
  type: 'rich-motion',
  box: { x: 24, y: 32, w: 520, h: 520, z: 1 },
  assetRefId: 'motion-seq-hero',
  fit: 'contain',
  label: 'Hero motion frames',
} as const;

const validState = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Rich Motion',
      width: 1440,
      sections: [
        {
          id: 'section-hero',
          recipeId: 'custom',
          name: 'Hero',
          height: 720,
          elements: [richMotionElement],
        },
      ],
    },
  ],
  richMotionAssets: [
    {
      id: 'motion-seq-hero',
      kind: 'image-sequence',
      frameAssetIds: ['frame-001', 'frame-002'],
      posterAssetId: 'poster-001',
      alt: 'Hero motion frames',
      playback: { driver: 'load', fps: 24, loop: true },
    },
  ],
} satisfies EditableSite;

assert(
  ELEMENT_TYPES.includes('rich-motion'),
  `ELEMENT_TYPES must include "rich-motion" (got ${ELEMENT_TYPES.join(', ')})`,
);

const html = renderElementBody(
  richMotionElement,
  {
    assetBasePath: '/assets',
    styleKit: 'charcoal',
    siteId: 'site-1',
    pageSlug: 'home',
    pages: validState.pages,
    turnstileSiteKey: 'test-turnstile-key',
    renderElement: () => '',
    renderHostedElement: () => '',
  },
);
assert(
  html.includes('data-opencanvas-rich-motion="motion-hero"'),
  'render output must stamp the rich-motion element id',
);
assert(
  html.includes('data-rich-motion-asset-ref="motion-seq-hero"'),
  'render output must stamp the asset ref id',
);
assert(html.includes('data-rich-motion-fit="contain"'), 'render output must stamp fit metadata');
assert(
  html.includes('data-opencanvas-rich-motion-canvas="motion-hero"'),
  'render output must include the canvas mount',
);

const editValidation = validateEditableSite(validState);
assert(
  editValidation.valid,
  `valid rich-motion state must pass validateEditableSite: ${editValidation.valid ? '' : editValidation.errors.join('; ')}`,
);

const goodSnapshot = {
  ...validState,
  version: 1,
  publishedAt: '2026-06-17T00:00:00.000Z',
};
const publishValidation = validatePublishedSnapshot(goodSnapshot);
assert(
  publishValidation.valid,
  `valid rich-motion snapshot must publish: ${publishValidation.valid ? '' : publishValidation.errors.join('; ')}`,
);

const placeholderState = structuredClone(goodSnapshot);
placeholderState.pages[0]!.sections[0]!.elements[0] = {
  ...placeholderState.pages[0]!.sections[0]!.elements[0],
  assetRefId: '__placeholder__',
} as unknown as typeof richMotionElement;
const placeholderValidation = validatePublishedSnapshot(placeholderState);
assert(!placeholderValidation.valid, 'placeholder rich-motion assetRefId must fail publish validation');
assert(
  placeholderValidation.errors.some((error) => error.includes('richMotion.assetRefId-resolves')),
  `placeholder publish failure must mention richMotion.assetRefId-resolves, got ${placeholderValidation.valid ? '' : placeholderValidation.errors.join('; ')}`,
);

const missingAssetState = structuredClone(goodSnapshot);
missingAssetState.richMotionAssets = [];
const missingAssetValidation = validatePublishedSnapshot(missingAssetState);
assert(!missingAssetValidation.valid, 'missing richMotionAssets entry must fail publish validation');
assert(
  missingAssetValidation.errors.some((error) => error.includes('richMotion.assetRefId-resolves')),
  `missing asset publish failure must mention richMotion.assetRefId-resolves, got ${missingAssetValidation.valid ? '' : missingAssetValidation.errors.join('; ')}`,
);

const unsupportedKindState = structuredClone(goodSnapshot);
unsupportedKindState.richMotionAssets[0] = {
  ...unsupportedKindState.richMotionAssets[0]!,
  kind: 'video-loop',
} as unknown as (typeof unsupportedKindState.richMotionAssets)[number];
const unsupportedKindValidation = validatePublishedSnapshot(unsupportedKindState);
assert(!unsupportedKindValidation.valid, 'unsupported rich motion asset kind must fail publish validation');
assert(
  unsupportedKindValidation.errors.some((error) => error.includes('richMotion.assetRefId-resolves')),
  `unsupported kind publish failure must mention richMotion.assetRefId-resolves, got ${unsupportedKindValidation.valid ? '' : unsupportedKindValidation.errors.join('; ')}`,
);

const riveState = structuredClone(goodSnapshot);
riveState.pages[0]!.sections[0]!.elements[0] = {
  ...riveState.pages[0]!.sections[0]!.elements[0],
  assetRefId: 'motion-rive-hero',
} as unknown as typeof richMotionElement;
(riveState as { richMotionAssets: unknown[] }).richMotionAssets = [
  {
    id: 'motion-rive-hero',
    kind: 'rive',
    assetId: 'hero.riv',
    alt: 'Hero Rive state machine',
    artboard: 'Hero',
    stateMachine: 'HeroMachine',
    autoplay: true,
    reducedMotion: 'pause',
    inputs: [
      {
        id: 'hover-on',
        inputName: 'isHovered',
        inputType: 'boolean',
        event: 'pointer-enter',
        value: true,
      },
      {
        id: 'scroll-progress',
        inputName: 'scrollProgress',
        inputType: 'number',
        event: 'scroll-progress',
        scrollSceneId: 'hero-scroll',
      },
      {
        id: 'activate',
        inputName: 'activate',
        inputType: 'trigger',
        event: 'click',
      },
    ],
  },
];
(riveState as unknown as { motionSequences: unknown[] }).motionSequences = [
  {
    id: 'hero-scroll-sequence',
    trigger: { type: 'scroll-scene', scrollSceneId: 'hero-scroll' },
    steps: [
      {
        id: 'hero-scroll-step',
        target: { type: 'element', elementId: 'motion-hero' },
        to: { opacity: 1 },
        durationMs: 1,
      },
    ],
  },
];
(riveState as unknown as { scrollScenes: unknown[] }).scrollScenes = [
  {
    id: 'hero-scroll',
    sectionId: 'section-hero',
    sequenceId: 'hero-scroll-sequence',
    pinTarget: { type: 'section', sectionId: 'section-hero' },
    startOffsetPx: 0,
    endOffsetPx: 720,
  },
];
const riveValidation = validatePublishedSnapshot(riveState);
assert(
  riveValidation.valid,
  `rive rich-motion snapshot must publish: ${riveValidation.valid ? '' : riveValidation.errors.join('; ')}`,
);

const invalidRiveInputState = structuredClone(riveState);
(
  (
    invalidRiveInputState as unknown as {
      richMotionAssets: Array<{ inputs: Array<Record<string, unknown>> }>;
    }
  )
    .richMotionAssets[0]!.inputs[1]!
).inputType = 'boolean';
const invalidRiveInputValidation = validatePublishedSnapshot(invalidRiveInputState);
assert(!invalidRiveInputValidation.valid, 'scroll-progress Rive input binding must reject non-number inputs');
assert(
  invalidRiveInputValidation.errors.some((error) => error.includes('richMotionAssets[0].inputs[1].inputType')),
  `invalid Rive input failure must mention inputType, got ${invalidRiveInputValidation.valid ? '' : invalidRiveInputValidation.errors.join('; ')}`,
);

const lottieState = structuredClone(goodSnapshot);
lottieState.pages[0]!.sections[0]!.elements[0] = {
  ...lottieState.pages[0]!.sections[0]!.elements[0],
  assetRefId: 'motion-lottie-hero',
} as unknown as typeof richMotionElement;
(lottieState as { richMotionAssets: unknown[] }).richMotionAssets = [
  {
    id: 'motion-lottie-hero',
    kind: 'lottie',
    assetId: 'hero.json',
    alt: 'Hero Lottie animation',
    renderer: 'svg',
    loop: true,
    autoplay: true,
    reducedMotion: 'pause',
  },
];
const lottieValidation = validatePublishedSnapshot(lottieState);
assert(
  lottieValidation.valid,
  `lottie rich-motion snapshot must publish: ${lottieValidation.valid ? '' : lottieValidation.errors.join('; ')}`,
);

const model3dState = structuredClone(goodSnapshot);
model3dState.pages[0]!.sections[0]!.elements[0] = {
  ...model3dState.pages[0]!.sections[0]!.elements[0],
  assetRefId: 'motion-model-helmet',
} as unknown as typeof richMotionElement;
(model3dState as { richMotionAssets: unknown[] }).richMotionAssets = [
  {
    id: 'motion-model-helmet',
    kind: 'model-3d',
    assetId: 'helmet.glb',
    posterAssetId: 'helmet-poster.webp',
    alt: 'Interactive helmet model',
    cameraControls: true,
    autoRotate: true,
    reducedMotion: 'static',
  },
];
const model3dValidation = validatePublishedSnapshot(model3dState);
assert(
  model3dValidation.valid,
  `model-3d rich-motion snapshot must publish: ${model3dValidation.valid ? '' : model3dValidation.errors.join('; ')}`,
);

const shaderSceneState = structuredClone(goodSnapshot);
shaderSceneState.pages[0]!.sections[0]!.elements[0] = {
  ...shaderSceneState.pages[0]!.sections[0]!.elements[0],
  assetRefId: 'motion-shader-field',
} as unknown as typeof richMotionElement;
(shaderSceneState as { richMotionAssets: unknown[] }).richMotionAssets = [
  {
    id: 'motion-shader-field',
    kind: 'shader-scene',
    preset: 'racing-lines',
    alt: 'Abstract racing lines shader field',
    colorA: '#C8FF1A',
    colorB: '#111112',
    speed: 0.8,
    density: 0.7,
    reducedMotion: 'static',
  },
];
const shaderSceneValidation = validatePublishedSnapshot(shaderSceneState);
assert(
  shaderSceneValidation.valid,
  `shader-scene rich-motion snapshot must publish: ${shaderSceneValidation.valid ? '' : shaderSceneValidation.errors.join('; ')}`,
);

const invalidShaderSceneState = structuredClone(shaderSceneState);
(
  (invalidShaderSceneState as { richMotionAssets: Array<Record<string, unknown>> })
    .richMotionAssets[0]!
).preset = 'owner-shader-code';
(
  (invalidShaderSceneState as { richMotionAssets: Array<Record<string, unknown>> })
    .richMotionAssets[0]!
).colorA = 'javascript:alert(1)';
const invalidShaderSceneValidation = validatePublishedSnapshot(invalidShaderSceneState);
assert(!invalidShaderSceneValidation.valid, 'invalid shader-scene metadata must fail publish validation');
assert(
  invalidShaderSceneValidation.errors.some((error) => error.includes('richMotionAssets[0].preset')),
  `invalid shader scene failure must mention preset, got ${invalidShaderSceneValidation.valid ? '' : invalidShaderSceneValidation.errors.join('; ')}`,
);
assert(
  invalidShaderSceneValidation.errors.some((error) => error.includes('richMotionAssets[0].colorA')),
  `invalid shader scene failure must mention colorA, got ${invalidShaderSceneValidation.valid ? '' : invalidShaderSceneValidation.errors.join('; ')}`,
);

assert(
  typeof (RENDER_DISPATCH as Record<string, unknown>)['rich-motion'] === 'function',
  'RENDER_DISPATCH must register rich-motion',
);
assert(
  Object.hasOwn(INSPECTOR_DISPATCH, 'rich-motion'),
  'INSPECTOR_DISPATCH must register rich-motion',
);
assert(
  Object.hasOwn(AGENT_TOOL_DISPATCH, 'rich-motion'),
  'AGENT_TOOL_DISPATCH must register rich-motion',
);
assert(
  Object.hasOwn(SIDEBAR_DISPATCH, 'rich-motion'),
  'SIDEBAR_DISPATCH must register rich-motion',
);
assert(
  typeof (Y_ENCODE_DISPATCH as Record<string, unknown>)['rich-motion'] === 'function',
  'Y_ENCODE_DISPATCH must register rich-motion',
);
assert(
  typeof (Y_DECODE_DISPATCH as Record<string, unknown>)['rich-motion'] === 'function',
  'Y_DECODE_DISPATCH must register rich-motion',
);

const richMotionFactory = SIDEBAR_FACTORIES['rich-motion']();
assert(
  richMotionFactory.payload.type === 'rich-motion',
  'sidebar factory must create a rich-motion payload',
);
assert(
  'assetRefId' in richMotionFactory.payload &&
    richMotionFactory.payload.assetRefId === '__placeholder__',
  'sidebar factory must seed the placeholder asset ref id',
);

const bodyBuilderSource = readFileSync(
  join(process.cwd(), 'src', 'editor-client', 'body-builders-data.ts'),
  'utf8',
);
assert(
  bodyBuilderSource.includes("case 'rich-motion':"),
  'editor body builder switch must handle rich-motion',
);
assert(
  bodyBuilderSource.includes("data-rich-motion-fit', element.fit"),
  'editor rich-motion body must stamp fit metadata',
);

const yjsState = {
  styleKit: validState.styleKit,
  pages: validState.pages,
} satisfies EditableSite;
const doc = encodeYDoc(yjsState);
const decoded = decodeYDoc(doc);
assert(
  JSON.stringify(decoded) === JSON.stringify(yjsState),
  'rich-motion element state must survive Yjs round-trip',
);

const docMap = doc.getMap<unknown>('state');
assert(docMap.has('pages'), 'encoded Y.Doc must include pages');
assert(Y.encodeStateAsUpdate(doc) instanceof Uint8Array, 'encoded Y.Doc must produce update bytes');

console.log('[rich-motion:smoke] OK');
