import type { PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';
import { INTERACTIVE_RUNTIME_SRC } from './build.js';
import { VIDEO_HOVER_RUNTIME_SRC } from './video-hover.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[video-hover-runtime:smoke] ' + message);
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
          id: 'cards',
          recipeId: 'custom',
          name: 'Cards',
          height: 480,
          elements: [
            {
              id: 'card-video',
              type: 'media',
              mediaKind: 'video',
              assetId: 'clip-1',
              alt: 'Hover preview',
              fit: 'cover',
              box: { x: 80, y: 80, w: 360, h: 220, z: 1 },
              playback: { muted: true, loop: true },
              hoverPlayback: {
                enabled: true,
                mode: 'play-pause',
                streamAssetId: 'hover-clip',
                streamPosterAssetId: 'hover-poster',
                reducedMotion: 'allow',
              },
            },
          ],
        },
      ],
    },
  ],
};

const hover = snapshot.pages[0]!.sections[0]!.elements[0]!;
if (hover.type !== 'media' || hover.mediaKind !== 'video') {
  throw new Error('[video-hover-runtime:smoke] fixture drift');
}
(hover.hoverPlayback as unknown as Record<string, unknown>).scrubOnHover = true;

assert(snapshotNeedsInteractiveRuntime(snapshot), 'video hover must request interactive runtime');
assert(
  VIDEO_HOVER_RUNTIME_SRC.includes('opencanvas:video-hover-failure'),
  'runtime must emit named failure event',
);
assert(
  VIDEO_HOVER_RUNTIME_SRC.includes('pointerenter'),
  'runtime must listen for hover enter',
);
assert(
  VIDEO_HOVER_RUNTIME_SRC.includes('data-opencanvas-video-hover-scrub'),
  'runtime must read hover scrub metadata',
);
assert(
  VIDEO_HOVER_RUNTIME_SRC.includes('data-opencanvas-video-hover-stream-src'),
  'runtime must read alternate hover stream source',
);
assert(
  VIDEO_HOVER_RUNTIME_SRC.includes('stream-src-empty'),
  'runtime must fail loudly when alternate hover stream source is empty',
);
assert(
  VIDEO_HOVER_RUNTIME_SRC.includes('currentTime') && VIDEO_HOVER_RUNTIME_SRC.includes('duration'),
  'runtime must scrub video currentTime from pointer position',
);
assert(
  VIDEO_HOVER_RUNTIME_SRC.includes("window.matchMedia('(prefers-reduced-motion: reduce)')"),
  'runtime must branch on reduced-motion explicitly',
);
assert(
  INTERACTIVE_RUNTIME_SRC.includes('function hydrateVideoHoverStreams'),
  'bundle must include video-hover hydrator',
);
assert(
  INTERACTIVE_RUNTIME_SRC.indexOf('function hydrateVideoHoverStreams') <
    INTERACTIVE_RUNTIME_SRC.indexOf('function hydrateAll'),
  'video-hover hydrator must be defined before runtime entry',
);
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-video-hover', {
  turnstileSiteKey: 'test-turnstile-key',
});
assert(
  html.includes('data-opencanvas-video-hover-scrub="true"'),
  'renderer must emit hover scrub metadata',
);
assert(
  html.includes('data-opencanvas-video-hover-stream-src="/assets/hover-clip"'),
  'renderer must emit alternate hover stream source',
);
const withRuntime = injectInteractiveRuntime(html, snapshot);
assert(
  withRuntime.includes('data-opencanvas-interactive-runtime'),
  'injection must append runtime script for video hover',
);
assert(
  withRuntime.includes('hydrateVideoHoverStreams(rootScope, options || {})'),
  'entrypoint must hydrate video hover streams',
);

console.log('[video-hover-runtime:smoke] OK');
