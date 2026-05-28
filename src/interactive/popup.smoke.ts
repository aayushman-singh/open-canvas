// src/interactive/popup.smoke.ts
//
// `bun run popup:smoke` — Smoke test for the popup trigger feature.
//
// Assertions:
//   1. A section with `trigger` renders with `display:none` and the correct
//      data attributes (`data-rev01-popup`, `data-rev01-trigger-type`,
//      `data-rev01-trigger-value`).
//   2. A section WITHOUT `trigger` renders normally (no `display:none`, no
//      popup data attributes).
//   3. The runtime source string contains the expected function name.
//   4. `snapshotNeedsInteractiveRuntime` returns true for a snapshot that has
//      ONLY a triggered section (no accordion/carousel elements).
//
// All assertions are pure-CPU; no network, no jsdom, no Workers globals.

import type { CanvasSection, EditableSite, PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { validateEditableSite } from '../canvas/validate.js';
import { decodeYDoc, encodeYDoc } from '../canvas/yjs-projection.js';
import { INTERACTIVE_RUNTIME_SRC } from './build.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[popup:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// (1) Section with trigger renders with display:none and popup data attrs.
// ---------------------------------------------------------------------------

const popupSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-25T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'sec-popup',
          recipeId: 'hero-split',
          name: 'Popup section',
          height: 400,
          trigger: { type: 'exit-intent' },
          elements: [
            {
              id: 'txt-1',
              type: 'text',
              box: { x: 0, y: 0, w: 300, h: 40, z: 1 },
              content: [{ text: 'Subscribe!' }],
              role: 'body',
              fontSize: 16,
              fontWeight: 400,
              align: 'left',
            },
          ],
        },
      ],
    },
  ],
};

const popupHtml = renderCanvasSnapshot(popupSnapshot, '/assets', '', { turnstileSiteKey: 'turnstile-test-key' });

assert(
  popupHtml.includes('data-rev01-popup="true"'),
  'popup section must have data-rev01-popup="true" attribute',
);
assert(
  popupHtml.includes('data-rev01-trigger-type="exit-intent"'),
  'popup section must have data-rev01-trigger-type attribute',
);
assert(
  popupHtml.includes('data-rev01-trigger-value=""'),
  'popup section must have data-rev01-trigger-value attribute (empty for exit-intent)',
);
assert(popupHtml.includes('display:none'), 'popup section must render with display:none in style');

// ---------------------------------------------------------------------------
// (2) Section WITHOUT trigger renders normally — no popup attrs, no hide.
// ---------------------------------------------------------------------------

const normalSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-25T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'sec-normal',
          recipeId: 'hero-split',
          name: 'Normal section',
          height: 400,
          elements: [
            {
              id: 'txt-2',
              type: 'text',
              box: { x: 0, y: 0, w: 300, h: 40, z: 1 },
              content: [{ text: 'Hello' }],
              role: 'body',
              fontSize: 16,
              fontWeight: 400,
              align: 'left',
            },
          ],
        },
      ],
    },
  ],
};

const normalHtml = renderCanvasSnapshot(normalSnapshot, '/assets', '', { turnstileSiteKey: 'turnstile-test-key' });

assert(
  !normalHtml.includes('data-rev01-popup'),
  'normal section must NOT have data-rev01-popup attribute',
);
assert(
  !normalHtml.includes('data-rev01-trigger-type'),
  'normal section must NOT have data-rev01-trigger-type attribute',
);
assert(!normalHtml.includes('display:none'), 'normal section must NOT have display:none');

// ---------------------------------------------------------------------------
// (3) The popup runtime source string contains the expected function name.
// ---------------------------------------------------------------------------

assert(
  INTERACTIVE_RUNTIME_SRC.includes('initPopups'),
  'assembled runtime must contain initPopups function',
);
assert(
  INTERACTIVE_RUNTIME_SRC.includes("sec.style.display='block'"),
  'popup runtime must reveal the section without replacing the rendered section style',
);
assert(
  !INTERACTIVE_RUNTIME_SRC.includes("sec.style.cssText='display:block"),
  'popup runtime must not overwrite the rendered section dimensions',
);

// ---------------------------------------------------------------------------
// (4) snapshotNeedsInteractiveRuntime returns true for trigger-only snapshot.
// ---------------------------------------------------------------------------

assert(
  snapshotNeedsInteractiveRuntime(popupSnapshot) === true,
  'snapshotNeedsInteractiveRuntime must return true for a snapshot with triggered sections',
);

assert(
  snapshotNeedsInteractiveRuntime(normalSnapshot) === false,
  'snapshotNeedsInteractiveRuntime must return false for a snapshot with no triggers and no interactives',
);

// ---------------------------------------------------------------------------
// (5) Trigger with a numeric value renders correctly.
// ---------------------------------------------------------------------------

const delaySnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-25T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'sec-delay',
          recipeId: 'hero-split',
          name: 'Delay popup',
          height: 300,
          trigger: { type: 'delay', value: 5000 },
          elements: [
            {
              id: 'txt-3',
              type: 'text',
              box: { x: 0, y: 0, w: 300, h: 40, z: 1 },
              content: [{ text: 'Wait!' }],
              role: 'body',
              fontSize: 16,
              fontWeight: 400,
              align: 'left',
            },
          ],
        },
      ],
    },
  ],
};

const delayHtml = renderCanvasSnapshot(delaySnapshot, '/assets', '', { turnstileSiteKey: 'turnstile-test-key' });

assert(
  delayHtml.includes('data-rev01-trigger-type="delay"'),
  'delay popup must have trigger-type="delay"',
);
assert(
  delayHtml.includes('data-rev01-trigger-value="5000"'),
  'delay popup must have trigger-value="5000"',
);
assert(delayHtml.includes('display:none'), 'delay popup must have display:none');

// ---------------------------------------------------------------------------
// (6) Runtime injection works for popup-only snapshot.
// ---------------------------------------------------------------------------

const injected = injectInteractiveRuntime(popupHtml, popupSnapshot);

assert(
  injected.includes('<script data-rev01-interactive-runtime>'),
  'popup-only snapshot must get the runtime <script> tag injected',
);
assert(injected.includes('initPopups'), 'injected runtime must contain initPopups');

// ---------------------------------------------------------------------------
// (7) Validator rejects malformed trigger configs.
// ---------------------------------------------------------------------------

const validPopup = validateEditableSite(popupSnapshot);
assert(validPopup.valid, 'valid popup trigger snapshot must pass validation');

const invalidDelaySnapshot: PublishedSnapshot = {
  ...popupSnapshot,
  pages: [
    {
      ...popupSnapshot.pages[0]!,
      sections: [
        {
          ...popupSnapshot.pages[0]!.sections[0]!,
          // Intentionally invalid: delay arm requires `value`. The cast bypasses
          // the discriminated union so we can test that the runtime validator
          // catches what the type system normally prevents.
          trigger: { type: 'delay' } as unknown as NonNullable<CanvasSection['trigger']>,
        },
      ],
    },
  ],
};
const invalidDelay = validateEditableSite(invalidDelaySnapshot);
assert(
  !invalidDelay.valid && invalidDelay.errors.some((error) => error.includes('trigger.value')),
  'delay trigger without numeric value must fail validation',
);

const invalidScrollSnapshot: PublishedSnapshot = {
  ...popupSnapshot,
  pages: [
    {
      ...popupSnapshot.pages[0]!,
      sections: [
        {
          ...popupSnapshot.pages[0]!.sections[0]!,
          trigger: { type: 'scroll', value: 120 },
        },
      ],
    },
  ],
};
const invalidScroll = validateEditableSite(invalidScrollSnapshot);
assert(
  !invalidScroll.valid && invalidScroll.errors.some((error) => error.includes('[0, 100]')),
  'scroll trigger beyond 100 must fail validation',
);

// ---------------------------------------------------------------------------
// (8) Yjs projection preserves section triggers.
// ---------------------------------------------------------------------------

const popupState: EditableSite = {
  styleKit: popupSnapshot.styleKit,
  pages: popupSnapshot.pages,
};
const popupRoundTrip = decodeYDoc(encodeYDoc(popupState));
assert(
  popupRoundTrip.pages[0]?.sections[0]?.trigger?.type === 'exit-intent',
  'Yjs round-trip must preserve exit-intent trigger type',
);

// ---------------------------------------------------------------------------
// All assertions passed.
// ---------------------------------------------------------------------------

console.log('[popup:smoke] OK');
