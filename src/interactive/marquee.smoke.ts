import type { PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';
import { INTERACTIVE_RUNTIME_SRC } from './build.js';
import { MARQUEE_RUNTIME_SRC, hydrateMarquees, isMarqueeEditorChrome } from './marquee.js';

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
                rows: 3,
                rowGapPx: 6,
                rowOffsetPercent: 40,
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
  isMarqueeEditorChrome({ nodeType: 1, className: 'element-menu-trigger', hasAttribute: () => false }),
  'editor chrome matcher must detect element menu trigger class token',
);
assert(
  isMarqueeEditorChrome({ nodeType: 1, className: 'shell resize-handle active', hasAttribute: () => false }),
  'editor chrome matcher must detect resize handle class token',
);
assert(
  !isMarqueeEditorChrome({ nodeType: 1, className: 'not-an-element-menu-trigger', hasAttribute: () => false }),
  'editor chrome matcher must not match partial class names',
);
assert(
  isMarqueeEditorChrome({ nodeType: 1, className: '', hasAttribute: (name: string) => name === 'data-resize-handle' }),
  'editor chrome matcher must detect resize handle attribute',
);

const hydrateMarqueesSource = hydrateMarquees.toString();
assert(
  MARQUEE_RUNTIME_SRC.includes(hydrateMarqueesSource),
  'visitor runtime source must include the exported marquee hydrator implementation',
);
assert(
  hydrateMarqueesSource.includes('data-opencanvas-marquee-hydrated'),
  'exported marquee hydrator must own the hydration marker logic',
);
assert(
  MARQUEE_RUNTIME_SRC.includes('opencanvas:marquee-failure'),
  'runtime must emit named failure event',
);
assert(
  !MARQUEE_RUNTIME_SRC.includes("typeof laneObj.lane.animate === 'function'") &&
    !MARQUEE_RUNTIME_SRC.includes('typeof laneObj.lane.animate === "function"'),
  'runtime must fail loudly instead of silently skipping lane animation creation',
);
assert(
  MARQUEE_RUNTIME_SRC.includes('data-opencanvas-marquee-belt'),
  'runtime must build marquee belt',
);
assert(
  MARQUEE_RUNTIME_SRC.includes('data-opencanvas-marquee-hover-reverse'),
  'runtime must read hover-reverse metadata',
);
assert(
  MARQUEE_RUNTIME_SRC.includes('data-opencanvas-marquee-rows'),
  'runtime must read marquee row metadata',
);
assert(
  MARQUEE_RUNTIME_SRC.includes('data-opencanvas-marquee-lane'),
  'runtime must build marquee lanes for multi-row marquees',
);
assert(
  MARQUEE_RUNTIME_SRC.includes('currentTime'),
  'runtime must stagger marquee row animation phase',
);
assert(MARQUEE_RUNTIME_SRC.includes('playbackRate'), 'runtime must reverse marquee playback on hover');
assert(
  MARQUEE_RUNTIME_SRC.includes("window.matchMedia('(prefers-reduced-motion: reduce)')") ||
    MARQUEE_RUNTIME_SRC.includes('window.matchMedia("(prefers-reduced-motion: reduce)")'),
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
assert(html.includes('data-opencanvas-marquee-rows="3"'), 'renderer must emit row metadata for runtime');
const withRuntime = injectInteractiveRuntime(html, snapshot);
assert(
  withRuntime.includes('data-opencanvas-interactive-runtime'),
  'injection must append runtime script for marquee',
);
assert(withRuntime.includes('hydrateMarquees(rootScope, options || {})'), 'entrypoint must hydrate marquees');

console.log('[marquee-runtime:smoke] OK');
