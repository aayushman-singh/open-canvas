import type { EditableSite, PublishedSnapshot } from './schema.js';
import { buildBehaviourPayload } from './behaviour-payload.js';
import { renderCanvasSnapshot } from './render.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[layout-transition:smoke] ' + message);
}

const site: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Layout transition',
      width: 1200,
      sections: [
        {
          id: 'section-body',
          recipeId: 'custom',
          name: 'Body',
          height: 600,
          elements: [
            {
              id: 'card-trigger',
              type: 'text',
              box: { x: 40, y: 40, w: 260, h: 80, z: 1 },
              content: [{ text: 'Open detail' }],
              role: 'body',
              fontSize: 18,
              fontWeight: 500,
              align: 'left',
            },
            {
              id: 'detail-panel',
              type: 'text',
              box: { x: 360, y: 40, w: 520, h: 180, z: 2 },
              content: [{ text: 'Detail view' }],
              role: 'body',
              fontSize: 24,
              fontWeight: 700,
              align: 'left',
            },
          ],
        },
      ],
    },
  ],
  layoutTransitions: [
    {
      id: 'layout-card-detail',
      name: 'Card detail',
      triggerElementId: 'card-trigger',
      sourceElementId: 'card-trigger',
      targetElementId: 'detail-panel',
      viewTransitionName: 'cardDetail',
      initialState: 'source',
      reducedMotion: 'instant',
    },
  ],
};

const valid = validateEditableSite(site);
assert(valid.valid, valid.valid ? 'site validates' : valid.errors.join('\n'));

const roundTrip = decodeYDoc(encodeYDoc(site));
assert(
  roundTrip.layoutTransitions?.[0]?.viewTransitionName === 'cardDetail',
  'Yjs round-trip must preserve layout transitions',
);

const snapshot: PublishedSnapshot = {
  ...site,
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
};
const payload = buildBehaviourPayload(snapshot, '/assets');
assert(payload !== null, 'layout transitions must require a behaviour payload');
assert(
  payload.layoutTransitions?.[0]?.viewTransitionName === 'cardDetail',
  'behaviour payload must include layout transitions',
);

const html = renderCanvasSnapshot(snapshot, '/assets', 'site-layout-transition', {
  turnstileSiteKey: 'test-key',
});
assert(html.includes('data-opencanvas-behaviour-payload'), 'renderer must emit behaviour payload');
assert(html.includes('layout-card-detail'), 'rendered payload must include layout transition id');

const invalid = validateEditableSite({
  ...site,
  layoutTransitions: [
    {
      id: 'layout-card-detail',
      name: 'Card detail',
      triggerElementId: 'card-trigger',
      sourceElementId: 'card-trigger',
      targetElementId: 'detail-panel',
      viewTransitionName: 'bad shared name',
      initialState: 'source',
      reducedMotion: 'instant',
    },
  ],
});
assert(!invalid.valid, 'invalid layout transition viewTransitionName must fail validation');
assert(
  !invalid.valid && invalid.errors.some((error) => error.includes('layoutTransitions')),
  'invalid layout transition must report layoutTransitions path',
);

console.log('[layout-transition:smoke] OK');
