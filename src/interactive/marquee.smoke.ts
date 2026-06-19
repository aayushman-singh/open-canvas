import type { PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';
import { INTERACTIVE_RUNTIME_SRC } from './build.js';
import { MARQUEE_RUNTIME_SRC } from './marquee.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[marquee-runtime:smoke] ' + message);
}

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
  pages: [
    {
      id: 'home',
      slug: 'home',
      title: 'Home',
      width: 1200,
      sections: [
        {
          id: 'logo-row',
          recipeId: 'custom',
          name: 'Logo row',
          height: 220,
          elements: [
            {
              id: 'loop',
              type: 'text',
              box: { x: 0, y: 64, w: 1200, h: 80, z: 1 },
              content: [{ text: 'Driver / Team / Track / Repeat' }],
              role: 'label',
              fontSize: 48,
              fontWeight: 700,
              align: 'left',
              marquee: {
                enabled: true,
                direction: 'right',
                speedPxPerSecond: 120,
                pauseOnHover: false,
                hoverReverse: true,
                reducedMotion: 'slow',
              },
            },
          ],
        },
      ],
    },
  ],
};

assert(snapshotNeedsInteractiveRuntime(snapshot), 'marquee must request interactive runtime');
assert(
  MARQUEE_RUNTIME_SRC.includes('opencanvas:marquee-failure'),
  'runtime must emit named failure event',
);
assert(
  MARQUEE_RUNTIME_SRC.includes('data-opencanvas-marquee-belt'),
  'runtime must build marquee belt',
);
assert(
  MARQUEE_RUNTIME_SRC.includes('data-opencanvas-marquee-hover-reverse'),
  'runtime must read hover-reverse metadata',
);
assert(MARQUEE_RUNTIME_SRC.includes('playbackRate'), 'runtime must reverse marquee playback on hover');
assert(
  MARQUEE_RUNTIME_SRC.includes("window.matchMedia('(prefers-reduced-motion: reduce)')"),
  'runtime must branch on reduced-motion explicitly',
);
assert(INTERACTIVE_RUNTIME_SRC.includes('function hydrateMarquees'), 'bundle must include marquee hydrator');
assert(
  INTERACTIVE_RUNTIME_SRC.indexOf('function hydrateMarquees') <
    INTERACTIVE_RUNTIME_SRC.indexOf('function hydrateAll'),
  'marquee hydrator must be defined before runtime entry',
);
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-marquee', {
  turnstileSiteKey: 'test-turnstile-key',
});
assert(
  html.includes('data-opencanvas-marquee-hover-reverse="true"'),
  'renderer must emit hover-reverse metadata for runtime',
);
const withRuntime = injectInteractiveRuntime(html, snapshot);
assert(
  withRuntime.includes('data-opencanvas-interactive-runtime'),
  'injection must append runtime script for marquee',
);
assert(withRuntime.includes('hydrateMarquees(rootScope, options || {})'), 'entrypoint must hydrate marquees');

console.log('[marquee-runtime:smoke] OK');
