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
    sharedElements: [
      {
        id: 'shared-route-card',
        sourceElementId: 'home-card',
        targetElementId: 'detail-hero',
        viewTransitionName: 'cardHero',
      },
    ],
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
assert.equal(roundTrip.routeTransition?.sharedElements?.[0]?.viewTransitionName, 'cardHero');

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

const invalidSharedElement = validateEditableSite({
  ...premiumSite,
  routeTransition: {
    ...premiumSite.routeTransition!,
    sharedElements: [
      {
        id: 'bad-shared-route',
        sourceElementId: 'home-card',
        targetElementId: 'detail-hero',
        viewTransitionName: 'bad shared name',
      },
    ],
  },
});
assert.equal(invalidSharedElement.valid, false);
assert.ok(invalidSharedElement.errors.some((error) => error.includes('routeTransition.sharedElements')));

const overlayDismissal = {
  closeButton: true,
  escape: true,
  backdropClick: true,
  bodyScrollLock: true,
  focusTrap: true,
  returnFocus: true,
} as const;

const overlayContent = {
  id: 'overlay-newsletter-content',
  recipeId: 'custom' as const,
  name: 'Newsletter content',
  height: 420,
  elements: [],
};

const siteWithTriggerElement = {
  ...baseSite,
  pages: [
    {
      ...baseSite.pages[0]!,
      sections: [
        {
          ...baseSite.pages[0]!.sections[0]!,
          elements: [
            {
              id: 'cta-open-overlay',
              type: 'shape' as const,
              box: { x: 0, y: 0, w: 120, h: 48, z: 1 },
              variant: 'rect' as const,
            },
          ],
        },
      ],
    },
  ],
};

const missingTriggerTarget = validateEditableSite({
  ...siteWithTriggerElement,
  overlays: [
    {
      id: 'overlay-missing-target',
      name: 'Missing target',
      scope: { type: 'site' as const },
      trigger: { type: 'element-click' as const, targetElementId: 'missing' },
      content: overlayContent,
      dismissal: overlayDismissal,
    },
  ],
});
assert.equal(missingTriggerTarget.valid, false);
assert.ok(
  missingTriggerTarget.errors.some(
    (error) =>
      error.includes('overlays[0].trigger.targetElementId') && error.includes('missing'),
  ),
  missingTriggerTarget.errors.join('\n'),
);

const validElementClickTrigger = validateEditableSite({
  ...siteWithTriggerElement,
  overlays: [
    {
      id: 'overlay-valid-target',
      name: 'Valid target',
      scope: { type: 'site' as const },
      trigger: { type: 'element-click' as const, targetElementId: 'cta-open-overlay' },
      content: overlayContent,
      dismissal: overlayDismissal,
    },
  ],
});
assert.equal(
  validElementClickTrigger.valid,
  true,
  validElementClickTrigger.valid ? undefined : validElementClickTrigger.errors.join('\n'),
);

const overlaySectionAnchor = validateEditableSite({
  ...premiumSite,
  overlays: [
    {
      ...premiumSite.overlays![0]!,
      content: {
        ...overlayContent,
        anchorId: 'modal-panel',
      },
    },
  ],
});
assert.equal(overlaySectionAnchor.valid, false);
assert.ok(
  overlaySectionAnchor.errors.some((error) => error.includes('overlays[0].content.anchorId')),
  overlaySectionAnchor.errors.join('\n'),
);

const overlayElementAnchor = validateEditableSite({
  ...premiumSite,
  overlays: [
    {
      ...premiumSite.overlays![0]!,
      content: {
        ...overlayContent,
        elements: [
          {
            id: 'overlay-copy',
            type: 'text' as const,
            box: { x: 0, y: 0, w: 320, h: 80, z: 1 },
            content: [{ text: 'Subscribe' }],
            role: 'body' as const,
            fontSize: 18,
            fontWeight: 400,
            align: 'left' as const,
            anchorId: 'subscribe-copy',
          },
        ],
      },
    },
  ],
});
assert.equal(overlayElementAnchor.valid, false);
assert.ok(
  overlayElementAnchor.errors.some((error) =>
    error.includes('overlays[0].content.elements[0].anchorId'),
  ),
  overlayElementAnchor.errors.join('\n'),
);

console.log('[premium-interactions:smoke] OK');
