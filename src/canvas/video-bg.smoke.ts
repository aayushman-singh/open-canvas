// src/canvas/video-bg.smoke.ts
//
// Manual smoke: verify that section-level backgroundVideo renders a <video>
// element as the first child of the section with correct attributes and styles,
// and that sections without backgroundVideo do not emit a video tag.
// Run with `bun.cmd run video-bg:smoke`.

import { renderCanvasSnapshot } from './render.js';
import type { CanvasSection, CanvasSiteState, PublishedSnapshot, TextElement } from './schema.js';
import { validateCanvasSiteState } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- Fixture: a section WITH backgroundVideo ---

const textElement: TextElement = {
  id: 'el-text-1',
  type: 'text',
  box: { x: 0, y: 0, w: 400, h: 60, z: 2 },
  content: [{ text: 'Hello world' }],
  role: 'heading',
  fontSize: 32,
  fontWeight: 700,
  align: 'left',
};

const sectionWithVideo: CanvasSection = {
  id: 'section-video',
  recipeId: 'hero-split',
  name: 'Video Hero',
  height: 600,
  backgroundVideo: 'asset-123',
  elements: [textElement],
};

const sectionWithoutVideo: CanvasSection = {
  id: 'section-no-video',
  recipeId: 'hero-split',
  name: 'Plain Section',
  height: 400,
  elements: [{ ...textElement, id: 'el-text-2' }],
};

const snapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-25T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-test',
      slug: 'test',
      title: 'Test',
      width: 1440,
      sections: [sectionWithVideo, sectionWithoutVideo],
    },
  ],
};

const html = renderCanvasSnapshot(snapshot, '/assets');

const validation = validateCanvasSiteState(snapshot);
assert(validation.valid, 'expected video background snapshot to pass validation');

// 1. Section with backgroundVideo renders a <video> tag
assert(html.includes('<video'), 'expected a <video> tag in rendered HTML');

// 2. Video has autoplay, loop, muted, playsinline attributes
const videoTagMatch = html.match(/<video[^>]*>/);
assert(videoTagMatch !== null, 'expected to match <video> opening tag');
if (videoTagMatch === null) throw new Error('expected to match <video> opening tag');
const videoTag = videoTagMatch[0];
assert(videoTag.includes('autoplay'), 'expected autoplay attribute on video');
assert(videoTag.includes('loop'), 'expected loop attribute on video');
assert(videoTag.includes('muted'), 'expected muted attribute on video');
assert(videoTag.includes('playsinline'), 'expected playsinline attribute on video');

// 3. Video has aria-hidden="true" (decorative)
assert(videoTag.includes('aria-hidden="true"'), 'expected aria-hidden="true" on video');

// 4. Video has correct inline styles
assert(videoTag.includes('position:absolute'), 'expected position:absolute in video style');
assert(videoTag.includes('inset:0'), 'expected inset:0 in video style');
assert(videoTag.includes('width:100%'), 'expected width:100% in video style');
assert(videoTag.includes('height:100%'), 'expected height:100% in video style');
assert(videoTag.includes('object-fit:cover'), 'expected object-fit:cover in video style');
assert(videoTag.includes('z-index:0'), 'expected z-index:0 in video style');
assert(videoTag.includes('pointer-events:none'), 'expected pointer-events:none in video style');

// 5. Video source has correct src with assetBasePath
assert(
  html.includes('src="/assets/asset-123"'),
  'expected video source src to be /assets/asset-123',
);
assert(html.includes('type="video/mp4"'), 'expected type="video/mp4" on source element');

// 6. Section WITHOUT backgroundVideo does NOT render a video tag
const noVideoSectionTag = '<section class="rev01-section" data-rev01-section="section-no-video"';
const noVideoIdx = html.indexOf(noVideoSectionTag);
assert(noVideoIdx >= 0, 'expected section-no-video element in rendered HTML');
const noVideoSectionEnd = html.indexOf('</section>', noVideoIdx);
const noVideoBlock = html.slice(noVideoIdx, noVideoSectionEnd);
assert(
  !noVideoBlock.includes('<video'),
  'expected no <video> tag in section without backgroundVideo',
);

// 7. Video appears BEFORE element divs (first child of section)
const videoSectionTag = '<section class="rev01-section" data-rev01-section="section-video"';
const videoSectionIdx = html.indexOf(videoSectionTag);
assert(videoSectionIdx >= 0, 'expected section-video element in rendered HTML');
// Find the closing > of the <section> opening tag
const sectionTagClose = html.indexOf('>', videoSectionIdx);
const afterSectionTag = html.slice(sectionTagClose + 1);
// The very first child should be <video, not <div
assert(
  afterSectionTag.trimStart().startsWith('<video'),
  'expected <video> to be the first child of the section (before element divs)',
);

// 8. Validator rejects path/URL-shaped backgroundVideo values
const invalidVideoSnapshot: PublishedSnapshot = {
  ...snapshot,
  pages: [
    {
      ...snapshot.pages[0]!,
      sections: [{ ...sectionWithVideo, backgroundVideo: '../asset-123' }],
    },
  ],
};
const invalidVideo = validateCanvasSiteState(invalidVideoSnapshot);
assert(
  !invalidVideo.valid && invalidVideo.errors.some((error) => error.includes('backgroundVideo')),
  'expected path-shaped backgroundVideo to fail validation',
);

// 9. Yjs projection preserves section backgroundVideo
const state: CanvasSiteState = {
  styleKit: snapshot.styleKit,
  pages: snapshot.pages,
};
const roundTrip = decodeYDoc(encodeYDoc(state));
assert(
  roundTrip.pages[0]?.sections[0]?.backgroundVideo === 'asset-123',
  'expected Yjs round-trip to preserve backgroundVideo',
);

console.log('video-bg.smoke.ts: all assertions passed');
