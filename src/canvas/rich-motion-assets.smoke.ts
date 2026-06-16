import { validateRichMotionAsset, type RichMotionAsset } from './rich-motion-assets';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[rich-motion-assets:smoke] ${message}`);
}

function expectInvalid(label: string, fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    assert(
      err instanceof Error && err.message.includes(label),
      `expected error to mention ${label}`,
    );
  }
  assert(threw, `expected ${label} to fail`);
}

const lottie: RichMotionAsset = {
  id: 'asset-lottie',
  ownerAssetId: 'owner-asset-lottie',
  family: 'vector-animation',
  source: { kind: 'lottie-json' },
  playback: {
    trigger: { type: 'viewport-enter' },
    loop: false,
    speed: 1,
    reducedMotion: 'poster',
  },
};

validateRichMotionAsset(lottie);

const rive: RichMotionAsset = {
  id: 'asset-rive',
  ownerAssetId: 'owner-asset-rive',
  family: 'interactive-vector',
  source: { kind: 'rive', stateMachine: 'Hero' },
  playback: {
    trigger: { type: 'hover', elementId: 'hero-card' },
    loop: true,
    speed: 1,
    reducedMotion: 'pause',
  },
};

validateRichMotionAsset(rive);

expectInvalid('RichMotionAsset', () => validateRichMotionAsset(null as unknown as RichMotionAsset));
expectInvalid('source', () =>
  validateRichMotionAsset({ ...lottie, source: null as unknown as RichMotionAsset['source'] }),
);
expectInvalid('ownerAssetId', () => validateRichMotionAsset({ ...lottie, ownerAssetId: '' }));
expectInvalid('speed', () =>
  validateRichMotionAsset({ ...lottie, playback: { ...lottie.playback, speed: 0 } }),
);
expectInvalid('loop', () =>
  validateRichMotionAsset({
    ...lottie,
    playback: { ...lottie.playback, loop: 'yes' as unknown as boolean },
  }),
);
expectInvalid('reducedMotion', () =>
  validateRichMotionAsset({
    ...lottie,
    playback: {
      ...lottie.playback,
      reducedMotion: 'mute' as unknown as RichMotionAsset['playback']['reducedMotion'],
    },
  }),
);
expectInvalid('trigger.elementId', () =>
  validateRichMotionAsset({
    ...lottie,
    playback: {
      ...lottie.playback,
      trigger: { type: 'hover', elementId: '' },
    },
  }),
);
expectInvalid('trigger.elementId', () =>
  validateRichMotionAsset({
    ...lottie,
    playback: {
      ...lottie.playback,
      trigger: { type: 'click', elementId: '' },
    },
  }),
);
expectInvalid('trigger.assetId', () =>
  validateRichMotionAsset({
    ...lottie,
    playback: {
      ...lottie.playback,
      trigger: { type: 'media-ready', assetId: '' },
    },
  }),
);
expectInvalid('trigger.elementId', () =>
  validateRichMotionAsset({
    ...lottie,
    playback: {
      ...lottie.playback,
      trigger: { type: 'hover', elementId: '' },
    },
  }),
);
expectInvalid('trigger.type', () =>
  validateRichMotionAsset({
    ...lottie,
    playback: {
      ...lottie.playback,
      trigger: { type: 'unsupported' } as unknown as RichMotionAsset['playback']['trigger'],
    },
  }),
);
expectInvalid('frames', () =>
  validateRichMotionAsset({
    id: 'seq',
    ownerAssetId: 'seq-manifest',
    family: 'image-sequence',
    source: { kind: 'image-sequence', frameAssetIds: [] },
    playback: {
      trigger: { type: 'scroll-progress' },
      loop: false,
      speed: 1,
      reducedMotion: 'poster',
    },
  }),
);
expectInvalid('sceneDescriptorAssetId', () =>
  validateRichMotionAsset({
    id: 'scene',
    ownerAssetId: 'scene-manifest',
    family: 'bounded-3d',
    source: { kind: 'bounded-3d', sceneDescriptorAssetId: '' },
    playback: {
      trigger: { type: 'viewport-enter' },
      loop: false,
      speed: 1,
      reducedMotion: 'hide',
    },
  }),
);
expectInvalid('family', () =>
  validateRichMotionAsset({
    ...lottie,
    family: 'interactive-vector',
  }),
);

console.log('[rich-motion-assets:smoke] OK');
