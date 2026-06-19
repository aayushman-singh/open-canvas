import type { PublishedSnapshot } from '../canvas/schema.js';
import { buildBehaviourPayload, serializeBehaviourPayload } from '../canvas/behaviour-payload.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { BEHAVIOUR_RUNTIME_SRC } from './behaviour.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[rive-rich-motion:smoke] ' + message);
}

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
  richMotionAssets: [
    {
      id: 'rive-hero',
      kind: 'rive',
      assetId: 'hero.riv',
      alt: 'Hero Rive animation',
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
              id: 'rive-el',
              type: 'rich-motion',
              box: { x: 80, y: 80, w: 480, h: 360, z: 1 },
              assetRefId: 'rive-hero',
              fit: 'cover',
              label: 'Hero Rive animation',
            },
          ],
        },
      ],
    },
  ],
};

const payload = buildBehaviourPayload(snapshot, '/assets');
assert(payload !== null, 'rive rich motion must build a behaviour payload');
const riveAsset = payload.richMotionAssets[0] as { kind: string; srcUrl?: string; inputs?: unknown[] };
assert(riveAsset.kind === 'rive', 'payload must preserve rive kind');
assert(riveAsset.srcUrl === '/assets/hero.riv', 'payload must resolve rive asset URL');
assert(Array.isArray(riveAsset.inputs) && riveAsset.inputs.length === 3, 'payload must preserve Rive input bindings');

const payloadJson = serializeBehaviourPayload(payload);
assert(payloadJson.includes('"kind":"rive"'), 'serialized payload must include rive kind');
assert(payloadJson.includes('"srcUrl":"/assets/hero.riv"'), 'serialized payload must include rive src URL');
assert(payloadJson.includes('"inputName":"isHovered"'), 'serialized payload must include Rive input names');
assert(payloadJson.includes('"event":"scroll-progress"'), 'serialized payload must include Rive input events');

assert(snapshotNeedsInteractiveRuntime(snapshot), 'rive rich motion must request interactive runtime');
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-rive', {
  turnstileSiteKey: 'test-turnstile-key',
});
assert(html.includes('data-rich-motion-fit="cover"'), 'renderer must emit rich motion fit metadata');
assert(
  injectInteractiveRuntime(html, snapshot).includes('data-opencanvas-behaviour-payload'),
  'injected HTML must include behaviour payload script',
);

assert(BEHAVIOUR_RUNTIME_SRC.includes('@rive-app/canvas@2.38.1'), 'runtime must pin Rive canvas runtime URL');
assert(BEHAVIOUR_RUNTIME_SRC.includes('function behaviourHydrateRive'), 'runtime must include Rive hydrator');
assert(BEHAVIOUR_RUNTIME_SRC.includes('function behaviourBindRiveInputs'), 'runtime must include Rive input binding hydrator');
assert(BEHAVIOUR_RUNTIME_SRC.includes('stateMachineInputs'), 'runtime must call the Rive state machine input API');
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('rich-motion-rive-runtime'),
  'runtime must fail loudly when Rive runtime cannot load',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('rich-motion-rive-init'),
  'runtime must fail loudly when Rive init fails',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('rich-motion-rive-input-missing'),
  'runtime must fail loudly when a Rive input binding cannot resolve',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes("asset.reducedMotion === 'pause'"),
  'runtime must implement explicit reduced-motion pause mode',
);

console.log('[rive-rich-motion:smoke] OK');
