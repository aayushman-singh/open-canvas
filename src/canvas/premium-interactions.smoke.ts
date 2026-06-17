import assert from 'node:assert/strict';
import type { EditableSite } from './schema.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';
import { migratePopupTriggersToOverlays } from './premium-interactions-migration.js';

const baseSite: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1200,
      sections: [
        {
          id: 'section-body',
          recipeId: 'custom',
          name: 'Body',
          height: 400,
          elements: [],
        },
      ],
    },
  ],
};

const premiumSite: EditableSite = {
  ...baseSite,
  overlays: [
    {
      id: 'overlay-newsletter',
      name: 'Newsletter',
      scope: { type: 'site' },
      trigger: { type: 'load' },
      content: {
        id: 'overlay-newsletter-content',
        recipeId: 'custom',
        name: 'Newsletter content',
        height: 420,
        elements: [],
      },
      dismissal: {
        closeButton: true,
        escape: true,
        backdropClick: true,
        bodyScrollLock: true,
        focusTrap: true,
        returnFocus: true,
      },
      openSequence: {
        id: 'seq-overlay-open',
        steps: [
          {
            id: 'step-overlay-fade',
            target: { type: 'overlay-surface' },
            effect: 'fade',
            delayMs: 0,
            durationMs: 220,
            easing: 'ease-out',
          },
        ],
      },
    },
  ],
  loadExperience: {
    id: 'load-main',
    enabled: true,
    preset: 'progress-bar',
    runPolicy: 'once-per-session',
    gates: ['document-ready', 'fonts-ready'],
    timeoutMs: 4000,
    handoffSequence: {
      id: 'seq-load-handoff',
      steps: [
        {
          id: 'step-load-fade',
          target: { type: 'load-screen-part', part: 'shell' },
          effect: 'fade',
          delayMs: 0,
          durationMs: 180,
          easing: 'ease-in',
        },
      ],
    },
  },
  routeTransition: {
    id: 'route-main',
    enabled: true,
    mode: 'fade',
    durationMs: 220,
    easing: 'ease-in-out',
  },
};

const valid = validateEditableSite(premiumSite);
assert.equal(valid.valid, true, valid.valid ? undefined : valid.errors.join('\n'));

const roundTrip = decodeYDoc(encodeYDoc(premiumSite));
assert.equal(roundTrip.overlays?.[0]?.trigger.type, 'load');
assert.equal(
  roundTrip.loadExperience && 'preset' in roundTrip.loadExperience
    ? roundTrip.loadExperience.preset
    : undefined,
  'progress-bar',
);
assert.equal(roundTrip.routeTransition?.mode, 'fade');

const legacy: EditableSite = {
  ...baseSite,
  pages: [
    {
      ...baseSite.pages[0]!,
      sections: [
        {
          id: 'legacy-popup',
          recipeId: 'custom',
          name: 'Legacy Popup',
          height: 320,
          trigger: { type: 'delay', value: 5000 },
          elements: [],
        },
      ],
    },
  ],
};

const migrated = migratePopupTriggersToOverlays(legacy);
assert.equal(migrated.changed, true);
assert.equal(migrated.site.pages[0]?.sections.length, 0);
assert.equal(migrated.site.overlays?.[0]?.trigger.type, 'delay');
assert.equal(migrated.site.overlays?.[0]?.trigger.value, 5000);
assert.equal(migrated.site.overlays?.[0]?.content.id, 'legacy-popup');

const invalid = validateEditableSite({
  ...premiumSite,
  routeTransition: { id: 'route-main', enabled: true, mode: 'spin', durationMs: 200, easing: 'ease' },
});
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.some((error) => error.includes('routeTransition.mode')));

console.log('[premium-interactions:smoke] OK');
