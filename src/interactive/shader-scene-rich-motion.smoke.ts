import type { PublishedSnapshot } from '../canvas/schema.js';
import { buildBehaviourPayload, serializeBehaviourPayload } from '../canvas/behaviour-payload.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { BEHAVIOUR_RUNTIME_SRC } from './behaviour.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[shader-scene-rich-motion:smoke] ' + message);
}

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
  richMotionAssets: [
    {
      id: 'signal-field',
      kind: 'shader-scene',
      preset: 'racing-lines',
      alt: 'Abstract racing lines shader field',
      colorA: '#C8FF1A',
      colorB: '#111112',
      speed: 0.8,
      density: 0.7,
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
              id: 'shader-el',
              type: 'rich-motion',
              box: { x: 80, y: 80, w: 640, h: 420, z: 1 },
              assetRefId: 'signal-field',
              fit: 'cover',
              label: 'Abstract racing lines shader field',
            },
          ],
        },
      ],
    },
  ],
};

const payload = buildBehaviourPayload(snapshot, '/assets');
assert(payload !== null, 'shader-scene rich motion must build a behaviour payload');
const shaderAsset = payload.richMotionAssets[0] as { kind: string; preset?: string; colorA?: string };
assert(shaderAsset.kind === 'shader-scene', 'payload must preserve shader-scene kind');
assert(shaderAsset.preset === 'racing-lines', 'payload must preserve shader preset');
assert(shaderAsset.colorA === '#C8FF1A', 'payload must preserve shader colors');

const payloadJson = serializeBehaviourPayload(payload);
assert(payloadJson.includes('"kind":"shader-scene"'), 'serialized payload must include shader-scene kind');
assert(payloadJson.includes('"preset":"racing-lines"'), 'serialized payload must include shader preset');

assert(snapshotNeedsInteractiveRuntime(snapshot), 'shader-scene rich motion must request interactive runtime');
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-shader-scene', {
  turnstileSiteKey: 'test-turnstile-key',
});
assert(
  injectInteractiveRuntime(html, snapshot).includes('data-opencanvas-behaviour-payload'),
  'injected HTML must include behaviour payload script',
);

assert(BEHAVIOUR_RUNTIME_SRC.includes('function behaviourHydrateShaderScene'), 'runtime must include shader-scene hydrator');
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('rich-motion-shader-context'),
  'runtime must fail loudly when WebGL is unavailable',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('rich-motion-shader-program'),
  'runtime must fail loudly when shader compilation/linking fails',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes("asset.reducedMotion === 'static'"),
  'runtime must implement explicit reduced-motion static mode',
);

console.log('[shader-scene-rich-motion:smoke] OK');
