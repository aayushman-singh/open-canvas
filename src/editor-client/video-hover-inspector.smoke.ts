export {};

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[video-hover-inspector:smoke] ' + message);
}

const mountsSrc = await Bun.file(new URL('./inspector-media-mounts.ts', import.meta.url)).text();
const hydrateSrc = await Bun.file(new URL('./hydrate-interactives.ts', import.meta.url)).text();

assert(
  mountsSrc.includes('Video Stream Hover'),
  'media inspector must expose video stream hover controls',
);
assert(
  mountsSrc.includes('VIDEO_HOVER_PLAYBACK_MODES'),
  'hover mode select must use schema modes',
);
assert(
  mountsSrc.includes('VIDEO_HOVER_REDUCED_MOTION_MODES'),
  'reduced-motion select must use schema modes',
);
assert(mountsSrc.includes('Scrub by pointer'), 'media inspector must expose pointer scrub control');
assert(mountsSrc.includes('scrubOnHover'), 'media inspector must save pointer scrub config');
assert(
  mountsSrc.includes('Hover stream asset') && mountsSrc.includes('streamAssetId'),
  'media inspector must expose alternate hover stream asset control',
);
assert(
  mountsSrc.includes('Hover poster asset') && mountsSrc.includes('streamPosterAssetId'),
  'media inspector must expose alternate hover poster asset control',
);
assert(
  mountsSrc.includes('Hover intent delay') && mountsSrc.includes('intentDelayMs'),
  'media inspector must expose hover intent delay control',
);
assert(mountsSrc.includes('playback.autoplay = false'), 'enabling hover must clear autoplay conflict');
assert(
  hydrateSrc.includes('function hydrateVideoHoverStreams'),
  'editor runtime must hydrate video hover streams',
);
assert(
  hydrateSrc.includes('opencanvas:video-hover-failure'),
  'editor runtime must emit named video-hover failure event',
);
const marqueeHydrateCall = hydrateSrc.indexOf('hydrateMarquees(root, options)');
const videoHoverHydrateCall = hydrateSrc.indexOf('hydrateVideoHoverStreams(root, options)');
assert(
  marqueeHydrateCall >= 0 && videoHoverHydrateCall > marqueeHydrateCall,
  'editor video-hover hydration must run after marquee hydration',
);

console.log('[video-hover-inspector:smoke] OK');
