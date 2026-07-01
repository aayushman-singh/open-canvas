import assert from 'node:assert/strict';
import {
  buildBehaviourPayload,
  snapshotHasBehaviourPrimitives,
} from './behaviour-payload.js';
import { compileMotionPresetSequences } from './compile-motion-presets.js';
import { renderCanvasSnapshot } from './render.js';
import type { EditableSite, PublishedSnapshot } from './schema.js';
import { validateEditableSite } from './validate.js';
import { snapshotNeedsInteractiveRuntime } from '../interactive/inject.js';

function buildPresetSnapshot(): PublishedSnapshot {
  return {
    version: 1,
    publishedAt: '2026-06-19T00:00:00.000Z',
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Home',
        width: 1440,
        sections: [
          {
            id: 'section-hero',
            recipeId: 'custom',
            name: 'Hero',
            height: 480,
            entrance: 'fade-up',
            elements: [
              {
                id: 'hero-title',
                type: 'text',
                box: { x: 80, y: 120, w: 640, h: 80, z: 1 },
                content: [{ text: 'Motion preset compile' }],
                role: 'heading',
                fontSize: 48,
                fontWeight: 700,
                align: 'left',
                motion: { preset: 'scale-in', delayMs: 120 },
              },
            ],
          },
        ],
      },
    ],
    overlays: [
      {
        id: 'overlay-promo',
        name: 'Promo',
        scope: { type: 'site' },
        trigger: { type: 'load' },
        content: {
          id: 'overlay-promo-content',
          recipeId: 'custom',
          name: 'Promo content',
          height: 360,
          elements: [
            {
              id: 'overlay-cta',
              type: 'text',
              box: { x: 40, y: 80, w: 320, h: 48, z: 1 },
              content: [{ text: 'Claim offer' }],
              role: 'heading',
              fontSize: 24,
              fontWeight: 600,
              align: 'left',
              motion: { preset: 'fade-in', delayMs: 80 },
            },
          ],
        },
        dismissal: {
          closeButton: true,
          escape: true,
          backdropClick: true,
          bodyScrollLock: true,
          focusTrap: true,
          returnFocus: true,
        },
      },
    ],
    motionSequences: [],
  };
}

const snapshot = buildPresetSnapshot();

assert.equal(
  snapshotHasBehaviourPrimitives(snapshot),
  true,
  'snapshotHasBehaviourPrimitives must be true when MotionPreset fields compile to sequences',
);

assert.equal(
  snapshotNeedsInteractiveRuntime(snapshot),
  true,
  'snapshotNeedsInteractiveRuntime must be true when compiled preset sequences are present',
);

const compiled = compileMotionPresetSequences(snapshot);
assert.ok(compiled.length >= 1, 'compiler must emit at least one MotionSequence');

const sectionSequence = compiled.find(
  (sequence) =>
    sequence.trigger.type === 'section-enter' &&
    sequence.trigger.sectionId === 'section-hero',
);
assert.ok(sectionSequence, 'section entrance must compile to a section-enter sequence');
assert.equal(
  sectionSequence.id,
  'preset-compiled-section-enter-section-hero',
  'compiled section sequence id must be deterministic',
);

const sectionStep = sectionSequence.steps.find(
  (step) => step.target.type === 'section' && step.target.sectionId === 'section-hero',
);
assert.ok(sectionStep, 'section entrance must include a section target step');
assert.deepEqual(sectionStep.from, { translateY: 12, opacity: 0 });
assert.deepEqual(sectionStep.to, { translateY: 0, opacity: 1 });

const elementStep = sectionSequence.steps.find(
  (step) => step.target.type === 'element' && step.target.elementId === 'hero-title',
);
assert.ok(elementStep, 'element motion preset must compile into the section-enter sequence');
assert.equal(elementStep.delayMs, 120);
assert.deepEqual(elementStep.from, { scale: 0.96, opacity: 0 });
assert.deepEqual(elementStep.to, { scale: 1, opacity: 1 });

const payload = buildBehaviourPayload(snapshot, '/assets');
assert.ok(payload, 'buildBehaviourPayload must return payload for compiled presets');
assert.ok(
  payload.motionSequences.some((sequence) => sequence.id === sectionSequence.id),
  'behaviour payload must include compiled preset sequences even when snapshot.motionSequences is empty',
);

const html = renderCanvasSnapshot(snapshot, '/assets', 'motion-preset-smoke', {
  turnstileSiteKey: 'turnstile-test-key',
});
assert.ok(
  html.includes('data-opencanvas-behaviour-payload'),
  'rendered HTML must include behaviour payload script',
);
assert.ok(
  !html.includes('data-entrance="fade-up"'),
  'compiled section entrance must not keep legacy data-entrance preset attrs',
);
assert.ok(
  !html.includes('data-motion-preset="scale-in"'),
  'compiled page element motion must not keep legacy data-motion-preset attrs',
);

const overlaySurfaceStart = html.indexOf('data-opencanvas-overlay-surface');
assert.ok(overlaySurfaceStart >= 0, 'rendered HTML must include overlay surface');
const overlaySurfaceEnd = html.indexOf('</div>', overlaySurfaceStart);
assert.ok(overlaySurfaceEnd >= 0, 'overlay surface must close');
const overlaySurfaceHtml = html.slice(overlaySurfaceStart, overlaySurfaceEnd);
assert.ok(
  overlaySurfaceHtml.includes('data-motion-preset="fade-in"'),
  'overlay content element motion must keep legacy data-motion-preset attrs until overlay-content preset compilation exists',
);
assert.ok(
  overlaySurfaceHtml.includes('data-motion-delay-ms="80"'),
  'overlay content element motion delay must keep legacy data-motion-delay-ms attrs',
);

const invalidPresetSite: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-invalid-motion',
      slug: 'invalid-motion',
      title: 'Invalid motion',
      width: 1440,
      entranceAnimation: 'slow-drift',
      sections: [
        {
          id: 'section-invalid-motion',
          recipeId: 'custom',
          name: 'Invalid section motion',
          height: 400,
          entrance: 'flip-in',
          elements: [
            {
              id: 'invalid-motion-element',
              type: 'text',
              box: { x: 40, y: 40, w: 400, h: 80, z: 1 },
              content: [{ text: 'Invalid motion preset' }],
              role: 'body',
              fontSize: 24,
              fontWeight: 500,
              align: 'left',
              motion: { preset: 'bounce-in' },
            },
          ],
        },
      ],
    },
  ],
};
const invalidPresetValidation = validateEditableSite(invalidPresetSite);
assert.equal(invalidPresetValidation.valid, false);
for (const path of [
  'pages[0].entranceAnimation',
  'pages[0].sections[0].entrance',
  'pages[0].sections[0].elements[0].motion.preset',
]) {
  assert.ok(
    invalidPresetValidation.errors.some((error) => error.includes(path)),
    `unrepresentable compiled motion preset validation must mention ${path}; got ${invalidPresetValidation.errors.join('; ')}`,
  );
}

const staticPreviewHtml = renderCanvasSnapshot(
  {
    version: 1,
    publishedAt: '2026-06-19T00:00:00.000Z',
    ...invalidPresetSite,
  } satisfies PublishedSnapshot,
  '/assets',
  'legacy-motion-preview',
  {
    turnstileSiteKey: 'turnstile-test-key',
    includeBehaviourRuntime: false,
  },
);
assert.ok(
  !staticPreviewHtml.includes('data-opencanvas-behaviour-payload'),
  'static previews must not emit the compiled behaviour payload',
);
assert.ok(
  staticPreviewHtml.includes('data-motion-preset="bounce-in"'),
  'static previews must preserve legacy motion preset attrs for CSS-only thumbnail rendering',
);

const inertPreviewHtml = renderCanvasSnapshot(
  {
    version: 1,
    publishedAt: '2026-06-19T00:00:00.000Z',
    styleKit: 'charcoal',
    importAnimationInventory: { sourceUrl: 'https://example.com/source', items: [] },
    pages: [
      {
        id: 'page-inert-preview',
        slug: 'inert-preview',
        title: 'Inert preview',
        width: 1440,
        sections: [
          {
            id: 'section-inert-preview',
            recipeId: 'custom',
            name: 'Inert preview',
            height: 400,
            elements: [
              {
                id: 'embed-preview',
                type: 'embed',
                box: { x: 40, y: 40, w: 640, h: 360, z: 1 },
                url: 'https://www.youtube.com/watch?v=bp4_7T9J6Fg',
                title: 'Preview video',
              },
              {
                id: 'form-preview',
                type: 'form',
                box: { x: 720, y: 40, w: 400, h: 300, z: 2 },
                fields: [
                  {
                    id: 'email',
                    kind: 'email',
                    label: 'Email',
                    required: true,
                  },
                ],
                submitLabel: 'Send',
                successMessage: 'Sent',
              },
            ],
          },
        ],
      },
    ],
  } satisfies PublishedSnapshot,
  '/assets',
  'inert-preview',
  {
    turnstileSiteKey: 'turnstile-test-key',
    includeBehaviourRuntime: false,
  },
);
assert.ok(!inertPreviewHtml.includes('<script'), 'static previews must not emit scripts');
assert.ok(!inertPreviewHtml.includes('<iframe'), 'static previews must not emit nested iframes');
assert.ok(
  inertPreviewHtml.includes('opencanvas-embed-static-preview'),
  'static previews must preserve embed geometry with an inert placeholder',
);

console.log('[motion-preset-compile:smoke] OK');
