import type { PublishedSnapshot } from '../canvas/schema.js';
import { buildBehaviourPayload, serializeBehaviourPayload } from '../canvas/behaviour-payload.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { BEHAVIOUR_RUNTIME_SRC } from './behaviour.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[model-3d-rich-motion:smoke] ' + message);
}

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
  richMotionAssets: [
    {
      id: 'helmet-3d',
      kind: 'model-3d',
      assetId: 'helmet.glb',
      posterAssetId: 'helmet-poster.webp',
      alt: 'Interactive helmet model',
      cameraControls: true,
      autoRotate: true,
      reducedMotion: 'static',
    },
  ],
  pages: [
    {
      id: 'home',
      slug: 'home',
      title: 'Home',
      width: 1200,
      sections: [
        {
          id: 'hero',
          recipeId: 'custom',
          name: 'Hero',
          height: 720,
          elements: [
            {
              id: 'helmet-el',
              type: 'rich-motion',
              box: { x: 80, y: 80, w: 480, h: 360, z: 1 },
              assetRefId: 'helmet-3d',
              fit: 'contain',
              label: 'Interactive helmet model',
            },
          ],
        },
      ],
    },
  ],
};

const payload = buildBehaviourPayload(snapshot, '/assets');
assert(payload !== null, 'model-3d rich motion must build a behaviour payload');
const modelAsset = payload.richMotionAssets[0] as { kind: string; srcUrl?: string; posterUrl?: string };
assert(modelAsset.kind === 'model-3d', 'payload must preserve model-3d kind');
assert(modelAsset.srcUrl === '/assets/helmet.glb', 'payload must resolve model URL');
assert(modelAsset.posterUrl === '/assets/helmet-poster.webp', 'payload must resolve poster URL');

const payloadJson = serializeBehaviourPayload(payload);
assert(payloadJson.includes('"kind":"model-3d"'), 'serialized payload must include model-3d kind');
assert(payloadJson.includes('"srcUrl":"/assets/helmet.glb"'), 'serialized payload must include model src URL');

assert(snapshotNeedsInteractiveRuntime(snapshot), 'model-3d rich motion must request interactive runtime');
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-model-3d', {
  turnstileSiteKey: 'test-turnstile-key',
});
assert(
  injectInteractiveRuntime(html, snapshot).includes('data-opencanvas-behaviour-payload'),
  'injected HTML must include behaviour payload script',
);

assert(
  BEHAVIOUR_RUNTIME_SRC.includes('@google/model-viewer@4.3.1'),
  'runtime must pin model-viewer runtime URL',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('function behaviourHydrateModel3D'),
  'runtime must include model-3d hydrator',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('rich-motion-model-3d-runtime'),
  'runtime must fail loudly when model-viewer runtime cannot load',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('rich-motion-model-3d-init'),
  'runtime must fail loudly when model-3d init fails',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes("asset.reducedMotion === 'static'"),
  'runtime must implement explicit reduced-motion static mode',
);

console.log('[model-3d-rich-motion:smoke] OK');
