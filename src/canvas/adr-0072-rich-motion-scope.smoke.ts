// ADR 0072 / 0081 consolidation smoke - proves the shipped Rich Motion Asset
// catalog is schema-owned, validator-gated, and dispatched by the Runtime Hydrator.

import { RICH_MOTION_KINDS } from './behaviour-primitives.js';
import { BEHAVIOUR_RUNTIME_SRC } from '../interactive/behaviour.js';
import { validateEditableSite, validatePublishedSnapshot } from './validate.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[adr-0072-rich-motion-scope:smoke] ${message}`);
  }
}

const SHIPPED_RICH_MOTION_KINDS = [
  'image-sequence',
  'rive',
  'lottie',
  'model-3d',
  'shader-scene',
  'particle-field',
  'video-stream',
] as const;

const RUNTIME_HYDRATORS: Record<(typeof SHIPPED_RICH_MOTION_KINDS)[number], string> = {
  'image-sequence': 'behaviourHydrateImageSequence',
  rive: 'behaviourHydrateRive',
  lottie: 'behaviourHydrateLottie',
  'model-3d': 'behaviourHydrateModel3D',
  'shader-scene': 'behaviourHydrateShaderScene',
  'particle-field': 'behaviourHydrateParticleField',
  'video-stream': 'behaviourHydrateVideoStream',
};

function richMotionAsset(kind: string): Record<string, unknown> {
  if (kind === 'image-sequence') {
    return {
      id: 'motion-asset',
      kind,
      frameAssetIds: ['frame-001.webp', 'frame-002.webp'],
      posterAssetId: 'poster-001.webp',
      alt: 'Image sequence motion',
      playback: { driver: 'load', fps: 24, loop: false },
    };
  }
  if (kind === 'rive') {
    return {
      id: 'motion-asset',
      kind,
      assetId: 'controls.riv',
      alt: 'Rive controls',
      stateMachine: 'Controls',
      autoplay: true,
      reducedMotion: 'pause',
      inputs: [],
    };
  }
  if (kind === 'lottie') {
    return {
      id: 'motion-asset',
      kind,
      assetId: 'logo-draw.json',
      alt: 'Logo draw animation',
      renderer: 'svg',
      loop: true,
      autoplay: true,
      reducedMotion: 'pause',
    };
  }
  if (kind === 'model-3d') {
    return {
      id: 'motion-asset',
      kind,
      assetId: 'helmet.glb',
      posterAssetId: 'helmet-poster.webp',
      alt: 'Bounded 3D model',
      cameraControls: true,
      autoRotate: false,
      reducedMotion: 'static',
    };
  }
  if (kind === 'shader-scene') {
    return {
      id: 'motion-asset',
      kind,
      preset: 'racing-lines',
      alt: 'Bounded shader scene',
      colorA: '#C8FF1A',
      colorB: '#111111',
      speed: 0.8,
      density: 0.7,
      reducedMotion: 'static',
    };
  }
  if (kind === 'video-stream') {
    return {
      id: 'motion-asset',
      kind,
      assetId: 'hover-stream.mp4',
      posterAssetId: 'hover-stream-poster.webp',
      alt: 'Hover video stream',
      muted: true,
      loop: true,
      controls: false,
      playback: { trigger: 'hover-focus', resetOnExit: true },
      reducedMotion: 'poster',
    };
  }
  if (kind === 'particle-field') {
    return {
      id: 'motion-asset',
      kind,
      mode: 'ascii-portrait',
      alt: 'ASCII particle portrait',
      color: '#64ffda',
      fontFamily: 'NTR',
      fontSize: 7,
      charset: ' .:-=+*#%@',
      pointSets: [
        {
          breakpoint: 'desktop',
          canvasSize: 400,
          points: [
            { x: 120, y: 120, char: '#', alpha: 0.9 },
            { x: 128, y: 120, char: '%', alpha: 0.9 },
          ],
        },
      ],
      pointer: { radiusRatio: 0.2, force: 4 },
      reducedMotion: 'settled',
    };
  }
  return { id: 'motion-asset', kind, alt: 'Unsupported motion asset' };
}

function richMotionState(kind: string): Record<string, unknown> {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Rich Motion Scope',
        width: 1440,
        sections: [
          {
            id: 'section-hero',
            recipeId: 'custom',
            name: 'Hero',
            height: 640,
            elements: [
              {
                id: 'motion-hero',
                type: 'rich-motion',
                box: { x: 0, y: 0, w: 480, h: 480, z: 1 },
                assetRefId: 'motion-asset',
                fit: 'contain',
                label: 'Hero motion',
              },
            ],
          },
        ],
      },
    ],
    richMotionAssets: [richMotionAsset(kind)],
  };
}

function assertShippedCatalog(): void {
  assert(
    RICH_MOTION_KINDS.length === SHIPPED_RICH_MOTION_KINDS.length &&
      RICH_MOTION_KINDS.every((kind, index) => kind === SHIPPED_RICH_MOTION_KINDS[index]),
    `RICH_MOTION_KINDS must match shipped adapter catalog ${SHIPPED_RICH_MOTION_KINDS.join(', ')}; got ${RICH_MOTION_KINDS.join(', ')}`,
  );
}

function assertRuntimeDispatch(): void {
  for (const kind of SHIPPED_RICH_MOTION_KINDS) {
    assert(
      BEHAVIOUR_RUNTIME_SRC.includes(RUNTIME_HYDRATORS[kind]),
      `runtime must include ${RUNTIME_HYDRATORS[kind]} for rich-motion kind ${kind}`,
    );
    assert(
      BEHAVIOUR_RUNTIME_SRC.includes(`kind === '${kind}'`) ||
        BEHAVIOUR_RUNTIME_SRC.includes(`asset.kind !== '${kind}'`),
      `runtime must dispatch or guard rich-motion kind ${kind}`,
    );
  }
  assert(
    BEHAVIOUR_RUNTIME_SRC.includes('rich-motion-unsupported-kind'),
    'runtime must emit rich-motion-unsupported-kind for adapter mismatches',
  );
}

function assertValidatorAcceptsShippedKinds(): void {
  for (const kind of SHIPPED_RICH_MOTION_KINDS) {
    const editable = richMotionState(kind);
    const editableResult = validateEditableSite(editable);
    assert(
      editableResult.valid,
      `editable validation must accept shipped kind ${kind}; got ${editableResult.valid ? '' : editableResult.errors.join('; ')}`,
    );

    const snapshot = {
      ...editable,
      version: 1 as const,
      publishedAt: '2026-06-19T00:00:00.000Z',
    };
    const publishResult = validatePublishedSnapshot(snapshot);
    assert(
      publishResult.valid,
      `publish validation must accept shipped kind ${kind}; got ${publishResult.valid ? '' : publishResult.errors.join('; ')}`,
    );
  }
}

function assertValidatorRejectsUnknownKind(): void {
  const editable = richMotionState('vector-animation');
  const editableResult = validateEditableSite(editable);
  assert(!editableResult.valid, 'editable validation must reject unknown rich-motion kind vector-animation');
  assert(
    editableResult.errors.some((error) => error.includes('richMotionAssets[0].kind')),
    `editable rejection must name richMotionAssets[0].kind; got ${editableResult.errors.join('; ')}`,
  );

  const publishResult = validatePublishedSnapshot({
    ...editable,
    version: 1 as const,
    publishedAt: '2026-06-19T00:00:00.000Z',
  });
  assert(!publishResult.valid, 'publish validation must reject unknown rich-motion kind vector-animation');
}

assertShippedCatalog();
assertRuntimeDispatch();
assertValidatorAcceptsShippedKinds();
assertValidatorRejectsUnknownKind();

console.log('[adr-0072-rich-motion-scope:smoke] OK');
