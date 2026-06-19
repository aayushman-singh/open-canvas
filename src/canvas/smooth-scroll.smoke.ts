// src/canvas/smooth-scroll.smoke.ts
//
// Schema-owned Smooth Scroll primitive smoke. Proves the site-level
// scrollBehavior node can author native/inertial scroll, survives Yjs, emits
// explicit Runtime Hydrator payload, exposes editor controls, and fails loudly
// for unsupported values.

import type { EditableSite, PublishedSnapshot, TextElement } from './schema.js';
import { buildBehaviourPayload } from './behaviour-payload.js';
import { renderCanvasSnapshot } from './render.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';
import { BEHAVIOUR_RUNTIME_SRC } from '../interactive/behaviour.js';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[smooth-scroll:smoke] ' + message);
}

function baseText(): TextElement {
  return {
    id: 'copy',
    type: 'text',
    box: { x: 0, y: 0, w: 600, h: 96, z: 1 },
    content: [{ text: 'Smooth scroll story' }],
    role: 'heading',
    fontSize: 42,
    fontWeight: 700,
    align: 'left',
  };
}

function siteWithScroll(scrollBehavior: unknown): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'index',
        title: 'Smooth Scroll Smoke',
        width: 1440,
        sections: [
          {
            id: 'hero',
            recipeId: 'custom',
            name: 'Hero',
            height: 1200,
            elements: [baseText()],
          },
        ],
      },
    ],
    scrollBehavior: scrollBehavior as NonNullable<EditableSite['scrollBehavior']>,
  };
}

function snapshot(site: EditableSite): PublishedSnapshot {
  return {
    version: 1,
    publishedAt: '2026-06-19T00:00:00.000Z',
    ...site,
  };
}

const inertialScroll = {
  mode: 'inertial',
  durationMs: 900,
  reducedMotion: 'native',
  paddingTop: 96,
};
const inertialSite = siteWithScroll(inertialScroll);
const validation = validateEditableSite(inertialSite);
assert(validation.valid, 'inertial scrollBehavior must validate: ' + JSON.stringify(validation));

const html = renderCanvasSnapshot(snapshot(inertialSite), '/assets', 'smooth-scroll-site', {
  turnstileSiteKey: 'test-key',
});
assert(
  html.includes('data-opencanvas-smooth-scroll="inertial"'),
  'renderer must emit explicit smooth-scroll metadata on the site root',
);
assert(
  html.includes('data-opencanvas-behaviour-payload') && html.includes('"smoothScroll"'),
  'renderer must emit behaviour payload for inertial Smooth Scroll',
);
assert(html.includes('scroll-padding-top:96px'), 'renderer must keep authored scroll padding');

const payload = buildBehaviourPayload(snapshot(inertialSite), '/assets');
assert(payload !== null, 'inertial Smooth Scroll must force behaviour payload creation');
assert(payload.smoothScroll?.mode === 'inertial', 'payload must carry inertial mode');
assert(payload.smoothScroll.durationMs === 900, 'payload must carry durationMs');
assert(payload.smoothScroll.reducedMotion === 'native', 'payload must carry reduced-motion policy');

const decoded = decodeYDoc(encodeYDoc(inertialSite));
assert(decoded.scrollBehavior?.mode === 'inertial', 'Yjs must round-trip scrollBehavior.mode');
assert(decoded.scrollBehavior?.durationMs === 900, 'Yjs must round-trip scrollBehavior.durationMs');
assert(
  decoded.scrollBehavior?.reducedMotion === 'native',
  'Yjs must round-trip scrollBehavior.reducedMotion',
);

for (const [label, value, expected] of [
  ['mode', { mode: 'spring', durationMs: 900, reducedMotion: 'native' }, 'scrollBehavior.mode'],
  ['durationMs', { mode: 'inertial', durationMs: 0, reducedMotion: 'native' }, 'scrollBehavior.durationMs'],
  [
    'reducedMotion',
    { mode: 'inertial', durationMs: 900, reducedMotion: 'maybe' },
    'scrollBehavior.reducedMotion',
  ],
] as const) {
  const result = validateEditableSite(siteWithScroll(value));
  assert(
    !result.valid && result.errors.some((error) => error.includes(expected)),
    'invalid ' + label + ' must fail validation with ' + expected + ': ' + JSON.stringify(result),
  );
}

assert(
  BEHAVIOUR_RUNTIME_SRC.includes('behaviourHydrateSmoothScroll'),
  'visitor runtime must dispatch Smooth Scroll through the Behaviour Runtime Hydrator',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('smooth-scroll-api-missing'),
  'visitor runtime must emit a named failure when inertial scroll APIs are unavailable',
);
assert(
  BEHAVIOUR_RUNTIME_SRC.includes('data-opencanvas-smooth-scroll-reduced'),
  'visitor runtime must mark explicit reduced-motion handling',
);

const panelSrc = await Bun.file(new URL('../editor-client/interactions-panel.ts', import.meta.url)).text();
assert(panelSrc.includes('renderSmoothScrollControls'), 'Interactions panel must render Smooth Scroll controls');
assert(panelSrc.includes('Smooth Scroll'), 'Interactions panel must label the Smooth Scroll controls');
assert(
  panelSrc.includes('SCROLL_BEHAVIOR_MODES') && panelSrc.includes('SCROLL_BEHAVIOR_REDUCED_MOTION_MODES'),
  'Interactions panel must use schema-owned Smooth Scroll enums',
);

console.log('[smooth-scroll:smoke] OK');