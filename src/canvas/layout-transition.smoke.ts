import type { EditableSite, PublishedSnapshot } from './schema.js';
import { buildBehaviourPayload } from './behaviour-payload.js';
import { renderCanvasSnapshot } from './render.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

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
            {
              id: 'detail-close',
              type: 'text',
              box: { x: 360, y: 240, w: 180, h: 48, z: 3 },
              content: [{ text: 'Close detail' }],
              role: 'body',
              fontSize: 16,
              fontWeight: 500,
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
      reverseTriggerElementId: 'detail-close',
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
assert(
  roundTrip.layoutTransitions?.[0]?.reverseTriggerElementId === 'detail-close',
  'Yjs round-trip must preserve layout transition reverse trigger',
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
assert(
  payload.layoutTransitions?.[0]?.reverseTriggerElementId === 'detail-close',
  'behaviour payload must include layout transition reverse trigger',
);

const html = renderCanvasSnapshot(snapshot, '/assets', 'site-layout-transition', {
  turnstileSiteKey: 'test-key',
});
assert(html.includes('data-opencanvas-behaviour-payload'), 'renderer must emit behaviour payload');
assert(html.includes('layout-card-detail'), 'rendered payload must include layout transition id');
assert(
  html.includes('detail-close'),
  'rendered payload must include layout transition reverse trigger id',
);

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

const invalidReverseTrigger = validateEditableSite({
  ...site,
  layoutTransitions: [
    {
      id: 'layout-card-detail',
      name: 'Card detail',
      triggerElementId: 'card-trigger',
      reverseTriggerElementId: 'missing-close',
      sourceElementId: 'card-trigger',
      targetElementId: 'detail-panel',
      viewTransitionName: 'cardDetail',
      initialState: 'source',
      reducedMotion: 'instant',
    },
  ],
});
assert(!invalidReverseTrigger.valid, 'missing reverse trigger must fail validation');
assert(
  !invalidReverseTrigger.valid &&
    invalidReverseTrigger.errors.some((error) => error.includes('reverseTriggerElementId')),
  'missing reverse trigger must report reverseTriggerElementId path',
);

const behaviourSrc = await Bun.file(new URL('../interactive/behaviour.ts', import.meta.url)).text();
assert(
  behaviourSrc.includes('reverseTriggerElementId'),
  'behaviour runtime must read layout transition reverse trigger ids',
);

console.log('[layout-transition:smoke] OK');
