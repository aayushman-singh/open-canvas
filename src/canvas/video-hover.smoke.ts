import { renderCanvasSnapshot } from './render.js';
import type { EditableSite, PublishedSnapshot } from './schema.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[video-hover:smoke] ' + message);
}

function makeSite(): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'home',
        slug: 'home',
        title: 'Home',
        width: 1200,
        sections: [
          {
            id: 'gallery',
            recipeId: 'custom',
            name: 'Gallery',
            height: 640,
            elements: [
              {
                id: 'preview-video',
                type: 'media',
                mediaKind: 'video',
                assetId: 'clip-1',
                posterAssetId: 'poster-1',
                alt: 'Track preview',
                fit: 'cover',
                box: { x: 120, y: 96, w: 420, h: 260, z: 1 },
                playback: { muted: true, loop: true, controls: false },
                hoverPlayback: {
                  enabled: true,
                  mode: 'play-reset',
                  streamAssetId: 'clip-hover',
                  streamPosterAssetId: 'poster-hover',
                  intentDelayMs: 120,
                  reducedMotion: 'disabled',
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

const site = makeSite();
(
  site.pages[0]!.sections[0]!.elements[0]!.type === 'media' &&
  site.pages[0]!.sections[0]!.elements[0]!.mediaKind === 'video'
    ? (site.pages[0]!.sections[0]!.elements[0]!.hoverPlayback as unknown as Record<string, unknown>)
    : {}
).scrubOnHover = true;
const validation = validateEditableSite(site);
assert(validation.valid, validation.valid ? 'valid video-hover site should pass' : validation.errors.join('\n'));

const decoded = decodeYDoc(encodeYDoc(site));
const decodedVideo = decoded.pages[0]?.sections[0]?.elements[0];
assert(
  decodedVideo?.type === 'media' &&
    decodedVideo.mediaKind === 'video' &&
    decodedVideo.hoverPlayback?.mode === 'play-reset' &&
    decodedVideo.hoverPlayback.streamAssetId === 'clip-hover' &&
    decodedVideo.hoverPlayback.streamPosterAssetId === 'poster-hover' &&
    decodedVideo.hoverPlayback.intentDelayMs === 120 &&
    (decodedVideo.hoverPlayback as unknown as Record<string, unknown>).scrubOnHover === true,
  'Yjs projection must preserve video hover config',
);

const snapshot: PublishedSnapshot = {
  ...site,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-video-hover', {
  turnstileSiteKey: 'test-turnstile-key',
});
assert(html.includes('data-opencanvas-video-hover="true"'), 'renderer must emit hover marker');
assert(
  html.includes('data-opencanvas-video-hover-mode="play-reset"'),
  'renderer must emit hover mode',
);
assert(
  html.includes('data-opencanvas-video-hover-reduced-motion="disabled"'),
  'renderer must emit reduced-motion mode',
);
assert(
  html.includes('data-opencanvas-video-hover-scrub="true"'),
  'renderer must emit hover scrub metadata',
);
assert(
  html.includes('data-opencanvas-video-hover-stream-src="/assets/clip-hover"'),
  'renderer must emit alternate hover stream source',
);
assert(
  html.includes('data-opencanvas-video-hover-poster-src="/assets/poster-hover"'),
  'renderer must emit alternate hover poster source',
);
assert(
  html.includes('data-opencanvas-video-hover-intent-delay-ms="120"'),
  'renderer must emit hover intent delay',
);
assert(html.includes(' muted'), 'hover video must render muted for autoplay policy');

const invalid = makeSite() as unknown as Record<string, unknown>;
const invalidElement = (
  (
    (((invalid.pages as unknown[])[0] as Record<string, unknown>).sections as unknown[])[0] as Record<
      string,
      unknown
    >
  ).elements as Record<string, unknown>[]
)[0]!;
invalidElement.mediaKind = 'image';
invalidElement.hoverPlayback = {
  enabled: true,
  mode: 'spin',
  scrubOnHover: 'yes',
  reducedMotion: 'maybe',
};
const invalidResult = validateEditableSite(invalid);
assert(!invalidResult.valid, 'image hover video config must fail validation');
assert(
  invalidResult.errors.some((error) => error.includes('.hoverPlayback is only allowed')),
  'image rejection must name hoverPlayback',
);

const invalidScrub = makeSite() as unknown as Record<string, unknown>;
const invalidScrubElement = (
  (
    (((invalidScrub.pages as unknown[])[0] as Record<string, unknown>).sections as unknown[])[0] as Record<
      string,
      unknown
    >
  ).elements as Record<string, unknown>[]
)[0]!;
invalidScrubElement.hoverPlayback = {
  enabled: true,
  mode: 'play-reset',
  scrubOnHover: 'yes',
  reducedMotion: 'disabled',
};
const invalidScrubResult = validateEditableSite(invalidScrub);
assert(!invalidScrubResult.valid, 'invalid scrub config must fail validation');
assert(
  invalidScrubResult.errors.some((error) => error.includes('.hoverPlayback.scrubOnHover')),
  'invalid scrub config must be named',
);

const invalidStream = makeSite() as unknown as Record<string, unknown>;
const invalidStreamElement = (
  (
    (((invalidStream.pages as unknown[])[0] as Record<string, unknown>).sections as unknown[])[0] as Record<
      string,
      unknown
    >
  ).elements as Record<string, unknown>[]
)[0]!;
invalidStreamElement.hoverPlayback = {
  enabled: true,
  mode: 'play-reset',
  streamAssetId: '',
  streamPosterAssetId: 42,
  reducedMotion: 'disabled',
};
const invalidStreamResult = validateEditableSite(invalidStream);
assert(!invalidStreamResult.valid, 'invalid hover stream assets must fail validation');
assert(
  invalidStreamResult.errors.some((error) => error.includes('.hoverPlayback.streamAssetId')),
  'invalid hover stream asset failure must be named',
);
assert(
  invalidStreamResult.errors.some((error) => error.includes('.hoverPlayback.streamPosterAssetId')),
  'invalid hover poster asset failure must be named',
);

const invalidIntentDelay = makeSite() as unknown as Record<string, unknown>;
const invalidIntentDelayElement = (
  (
    (((invalidIntentDelay.pages as unknown[])[0] as Record<string, unknown>).sections as unknown[])[0] as Record<
      string,
      unknown
    >
  ).elements as Record<string, unknown>[]
)[0]!;
invalidIntentDelayElement.hoverPlayback = {
  enabled: true,
  mode: 'play-reset',
  intentDelayMs: -1,
  reducedMotion: 'disabled',
};
const invalidIntentDelayResult = validateEditableSite(invalidIntentDelay);
assert(!invalidIntentDelayResult.valid, 'invalid hover intent delay must fail validation');
assert(
  invalidIntentDelayResult.errors.some((error) => error.includes('.hoverPlayback.intentDelayMs')),
  'invalid hover intent delay failure must be named',
);

const invalidAutoplay = makeSite();
const autoplayElement = invalidAutoplay.pages[0]!.sections[0]!.elements[0]!;
if (autoplayElement.type !== 'media' || autoplayElement.mediaKind !== 'video') {
  throw new Error('[video-hover:smoke] fixture drift');
}
autoplayElement.playback = { autoplay: true, muted: true };
const autoplayResult = validateEditableSite(invalidAutoplay);
assert(!autoplayResult.valid, 'hover playback must reject autoplay conflict');
assert(
  autoplayResult.errors.some((error) => error.includes('playback.autoplay=true')),
  'autoplay conflict must be named',
);

console.log('[video-hover:smoke] OK');
