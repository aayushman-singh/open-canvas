import type { PublishedSnapshot } from '../canvas/schema.js';
import { buildBehaviourPayload, serializeBehaviourPayload } from '../canvas/behaviour-payload.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { BEHAVIOUR_RUNTIME_SRC } from './behaviour.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[lottie-rich-motion:smoke] ' + message);
}

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
  richMotionAssets: [
    {
      id: 'lottie-hero',
      kind: 'lottie',
      assetId: 'hero.json',
      alt: 'Hero Lottie animation',
      renderer: 'svg',
      loop: true,
      autoplay: true,
      reducedMotion: 'pause',
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
              id: 'lottie-el',
              type: 'rich-motion',
              box: { x: 80, y: 80, w: 480, h: 360, z: 1 },
              assetRefId: 'lottie-hero',
              fit: 'contain',
              label: 'Hero Lottie animation',
            },
          ],
        },
      ],
    },
  ],
};

const payload = buildBehaviourPayload(snapshot, '/assets');
assert(payload !== null, 'lottie rich motion must build a behaviour payload');
const lottieAsset = payload.richMotionAssets[0] as { kind: string; srcUrl?: string };
assert(lottieAsset.kind === 'lottie', 'payload must preserve lottie kind');
assert(lottieAsset.srcUrl === '/assets/hero.json', 'payload must resolve lottie asset URL');

const payloadJson = serializeBehaviourPayload(payload);
assert(payloadJson.includes('"kind":"lottie"'), 'serialized payload must include lottie kind');
assert(payloadJson.includes('"srcUrl":"/assets/hero.json"'), 'serialized payload must include lottie src URL');

assert(snapshotNeedsInteractiveRuntime(snapshot), 'lottie rich motion must request interactive runtime');
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-lottie', {
  turnstileSiteKey: 'test-turnstile-key',
});
assert(
  injectInteractiveRuntime(html, snapshot).includes('data-opencanvas-behaviour-payload'),
  'injected HTML must include behaviour payload script',
);

assert(BEHAVIOUR_RUNTIME_SRC.includes('lottie-web@5.13.0'), 'runtime must pin Lottie runtime URL');
assert(BEHAVIOUR_RUNTIME_SRC.includes('function behaviourHydrateLottie'), 'runtime must include Lottie hydrator');
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('rich-motion-lottie-runtime'),
  'runtime must fail loudly when Lottie runtime cannot load',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('rich-motion-lottie-init'),
  'runtime must fail loudly when Lottie init fails',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes("asset.reducedMotion === 'pause'"),
  'runtime must implement explicit reduced-motion pause mode',
);

console.log('[lottie-rich-motion:smoke] OK');
