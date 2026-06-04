// src/canvas/layout-primitives.smoke.ts
//
// Smoke test for the three primitives landed by ADR 0050:
//   - TextElement.fluidSize  → renderer emits font-size: clamp(...)
//   - BaseElement.anchorId / CanvasSection.anchorId → renderer emits id="..."
//   - EditableSite.scrollBehavior → renderer emits a global <style> block
//
// Each contract pins:
//   1. Renderer output contains the expected token.
//   2. Renderer output contains NOTHING when the field is absent.
//   3. Validator accepts well-formed input.
//   4. Validator rejects every shape called out as invalid in the ADR.
//
// Run with `bun.cmd run layout-primitives:smoke`.

import type { EditableSite, PublishedSnapshot, TextElement } from './schema.js';
import type { CarouselElement } from './elements/carousel.js';
import { renderCanvasSnapshot } from './render.js';
import { validateEditableSite } from './validate.js';
import { canvasPublishedStyles } from './public-styles.js';

const TURNSTILE = 'turnstile-test-key';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function baseText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'el-text',
    type: 'text',
    box: { x: 0, y: 0, w: 320, h: 80, z: 1 },
    content: [{ text: 'hello' }],
    role: 'heading',
    fontSize: 32,
    fontWeight: 700,
    align: 'left',
    ...overrides,
  };
}

function siteWith(text: TextElement, opts: Partial<EditableSite> = {}): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'index',
        title: 'Layout primitives smoke',
        width: 1440,
        sections: [
          {
            id: 'section-smoke',
            recipeId: 'feature-grid',
            name: 'Smoke',
            height: 240,
            elements: [text],
          },
        ],
      },
    ],
    ...opts,
  };
}

function siteWithElements(
  elements: EditableSite['pages'][number]['sections'][number]['elements'],
): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'index',
        title: 'Layout primitives smoke',
        width: 1440,
        sections: [
          {
            id: 'section-smoke',
            recipeId: 'feature-grid',
            name: 'Smoke',
            height: 640,
            elements,
          },
        ],
      },
    ],
  };
}

function baseCarousel(overrides: Partial<CarouselElement> = {}): CarouselElement {
  return {
    id: 'el-carousel',
    type: 'carousel',
    box: { x: 0, y: 0, w: 640, h: 360, z: 1 },
    slides: [
      { id: 'one', assetId: 'asset-one', caption: 'One' },
      { id: 'two', assetId: 'asset-two', caption: 'Two' },
    ],
    showArrows: true,
    showDots: true,
    ...overrides,
  };
}

function renderHtml(state: EditableSite): string {
  const snapshot: PublishedSnapshot = {
    version: 1,
    publishedAt: '2026-06-01T00:00:00.000Z',
    ...state,
  };
  return renderCanvasSnapshot(snapshot, '/assets', 'smoke-site', {
    turnstileSiteKey: TURNSTILE,
  });
}

// ============================================================================
// fluidSize (ADR 0050 dec 1)
// ============================================================================

// Renderer emits clamp() when fluidSize is set.
const fluidHtml = renderHtml(
  siteWith(baseText({ fluidSize: { min: 64, max: 132, vw: 9 }, fontSize: 96 })),
);
assert(
  fluidHtml.includes('font-size:clamp(64px,9vw,132px)'),
  `expected clamp(64px,9vw,132px); got ${fluidHtml}`,
);
assert(
  !fluidHtml.includes('font-size:96px'),
  'static fontSize must not be emitted when fluidSize is set',
);

// Absence of fluidSize → static fontSize emitted as before.
const staticHtml = renderHtml(siteWith(baseText({ fontSize: 48 })));
assert(
  staticHtml.includes('font-size:48px'),
  `expected static font-size:48px when fluidSize absent; got ${staticHtml}`,
);
assert(!staticHtml.includes('clamp('), 'absent fluidSize must not emit clamp()');

// Negative cases — min <= 0
{
  const r = validateEditableSite(siteWith(baseText({ fluidSize: { min: 0, max: 100, vw: 9 } })));
  assert(
    !r.valid && r.errors.some((e) => e.includes('fluidSize.min')),
    `expected min<=0 error; got ${JSON.stringify(r)}`,
  );
}
// Negative cases — max <= min
{
  const r = validateEditableSite(siteWith(baseText({ fluidSize: { min: 80, max: 80, vw: 9 } })));
  assert(
    !r.valid && r.errors.some((e) => e.includes('fluidSize.max')),
    `expected max<=min error; got ${JSON.stringify(r)}`,
  );
}
// Negative cases — vw out of bounds (0)
{
  const r = validateEditableSite(siteWith(baseText({ fluidSize: { min: 32, max: 96, vw: 0 } })));
  assert(
    !r.valid && r.errors.some((e) => e.includes('fluidSize.vw')),
    `expected vw<1 error; got ${JSON.stringify(r)}`,
  );
}
// Negative cases — vw out of bounds (31)
{
  const r = validateEditableSite(siteWith(baseText({ fluidSize: { min: 32, max: 96, vw: 31 } })));
  assert(
    !r.valid && r.errors.some((e) => e.includes('fluidSize.vw')),
    `expected vw>30 error; got ${JSON.stringify(r)}`,
  );
}
// Negative cases — non-object fluidSize
{
  const bad = { ...baseText(), fluidSize: 'big' } as unknown as TextElement;
  const r = validateEditableSite(siteWith(bad));
  assert(
    !r.valid && r.errors.some((e) => e.includes('fluidSize')),
    `expected non-object error; got ${JSON.stringify(r)}`,
  );
}

// ============================================================================
// anchorId (ADR 0050 dec 2)
// ============================================================================

// Renderer emits id="..." on the element wrapper.
const anchorEl = baseText({ anchorId: 'hero', id: 'el-hero' });
const anchorElHtml = renderHtml(siteWith(anchorEl));
assert(anchorElHtml.includes(' id="hero"'), `expected element id="hero"; got ${anchorElHtml}`);

// Renderer emits id on the section wrapper.
const sectionAnchorState: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-section-anchor',
      slug: 'index',
      title: 'Section anchor',
      width: 1440,
      sections: [
        {
          id: 'sec-1',
          recipeId: 'feature-grid',
          name: 'Anchored',
          height: 240,
          anchorId: 'about',
          elements: [baseText()],
        },
      ],
    },
  ],
};
const sectionAnchorHtml = renderHtml(sectionAnchorState);
assert(
  sectionAnchorHtml.includes(' id="about"'),
  `expected section id="about"; got ${sectionAnchorHtml}`,
);

// Negative — uppercase rejected.
{
  const r = validateEditableSite(siteWith(baseText({ anchorId: 'Hero' })));
  assert(
    !r.valid && r.errors.some((e) => e.includes('anchorId')),
    `expected uppercase rejection; got ${JSON.stringify(r)}`,
  );
}
// Negative — leading digit rejected.
{
  const r = validateEditableSite(siteWith(baseText({ anchorId: '1about' })));
  assert(
    !r.valid && r.errors.some((e) => e.includes('anchorId')),
    `expected leading-digit rejection; got ${JSON.stringify(r)}`,
  );
}
// Negative — space rejected.
{
  const r = validateEditableSite(siteWith(baseText({ anchorId: 'my section' })));
  assert(
    !r.valid && r.errors.some((e) => e.includes('anchorId')),
    `expected space rejection; got ${JSON.stringify(r)}`,
  );
}

// Negative — duplicate anchor ids within one page (across an element + a section).
{
  const dupeState: EditableSite = {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-dup',
        slug: 'index',
        title: 'Duplicate anchor',
        width: 1440,
        sections: [
          {
            id: 'sec-1',
            recipeId: 'feature-grid',
            name: 'A',
            height: 240,
            anchorId: 'about',
            elements: [baseText({ id: 'el-a', anchorId: 'about' })],
          },
        ],
      },
    ],
  };
  const r = validateEditableSite(dupeState);
  assert(
    !r.valid && r.errors.some((e) => e.includes('anchorId "about"') && e.includes('already used')),
    `expected duplicate-anchor error; got ${JSON.stringify(r)}`,
  );
}

// Cross-page duplicate anchor ids ARE allowed (ADR 0050 dec 2 rationale).
{
  const crossPageState: EditableSite = {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-1',
        slug: 'index',
        title: 'Page 1',
        width: 1440,
        sections: [
          {
            id: 'sec-1a',
            recipeId: 'feature-grid',
            name: 'A',
            height: 240,
            anchorId: 'top',
            elements: [baseText({ id: 'el-1a' })],
          },
        ],
      },
      {
        id: 'page-2',
        slug: 'other',
        title: 'Page 2',
        width: 1440,
        sections: [
          {
            id: 'sec-2a',
            recipeId: 'feature-grid',
            name: 'B',
            height: 240,
            anchorId: 'top',
            elements: [baseText({ id: 'el-2a' })],
          },
        ],
      },
    ],
  };
  const r = validateEditableSite(crossPageState);
  assert(r.valid, `expected cross-page anchor reuse to validate; got ${JSON.stringify(r)}`);
}

// Shared header/footer anchors render into every page, so they must also be
// unique against each page's section + element anchors.
{
  const headerCollisionState: EditableSite = {
    styleKit: 'charcoal',
    header: {
      id: 'shared-header',
      recipeId: 'custom',
      name: 'Shared header',
      height: 80,
      anchorId: 'top',
      elements: [baseText({ id: 'header-copy' })],
    },
    pages: [
      {
        id: 'page-header-collision',
        slug: 'index',
        title: 'Header collision',
        width: 1440,
        sections: [
          {
            id: 'page-section',
            recipeId: 'feature-grid',
            name: 'Page section',
            height: 240,
            anchorId: 'top',
            elements: [baseText({ id: 'page-copy' })],
          },
        ],
      },
    ],
  };
  const r = validateEditableSite(headerCollisionState);
  assert(
    !r.valid && r.errors.some((e) => e.includes('anchorId "top"') && e.includes('state.header')),
    `expected shared-header anchor collision; got ${JSON.stringify(r)}`,
  );
}

{
  const footerInternalCollisionState: EditableSite = {
    styleKit: 'charcoal',
    footer: {
      id: 'shared-footer',
      recipeId: 'custom',
      name: 'Shared footer',
      height: 80,
      anchorId: 'contact',
      elements: [baseText({ id: 'footer-copy', anchorId: 'contact' })],
    },
    pages: [
      {
        id: 'page-footer-collision',
        slug: 'index',
        title: 'Footer collision',
        width: 1440,
        sections: [
          {
            id: 'body-section',
            recipeId: 'feature-grid',
            name: 'Body',
            height: 240,
            elements: [baseText({ id: 'body-copy' })],
          },
        ],
      },
    ],
  };
  const r = validateEditableSite(footerInternalCollisionState);
  assert(
    !r.valid &&
      r.errors.some((e) => e.includes('anchorId "contact"') && e.includes('state.footer')),
    `expected shared-footer internal anchor collision; got ${JSON.stringify(r)}`,
  );
}

// ============================================================================
// scrollBehavior (ADR 0050 dec 3)
// ============================================================================

// Renderer emits a global <style> block when smooth + paddingTop both set.
{
  const html = renderHtml(
    siteWith(baseText(), { scrollBehavior: { smooth: true, paddingTop: 80 } }),
  );
  assert(
    html.includes('data-opencanvas-scroll-behavior') &&
      html.includes('html{scroll-behavior:smooth;scroll-padding-top:80px}'),
    `expected scroll-behavior style block; got ${html}`,
  );
}

// Only smooth → emits scroll-behavior alone, no padding rule.
{
  const html = renderHtml(siteWith(baseText(), { scrollBehavior: { smooth: true } }));
  assert(
    html.includes('html{scroll-behavior:smooth}'),
    `expected scroll-behavior:smooth alone; got ${html}`,
  );
  assert(!html.includes('scroll-padding-top'), 'must not emit padding rule when only smooth set');
}

// Only paddingTop → emits padding alone.
{
  const html = renderHtml(siteWith(baseText(), { scrollBehavior: { paddingTop: 64 } }));
  assert(
    html.includes('html{scroll-padding-top:64px}'),
    `expected scroll-padding-top:64px alone; got ${html}`,
  );
  assert(
    !html.includes('scroll-behavior:smooth'),
    'must not emit smooth rule when only padding set',
  );
}

// scrollBehavior absent OR all-fields-absent → no <style data-opencanvas-scroll-behavior>.
{
  const html1 = renderHtml(siteWith(baseText()));
  assert(
    !html1.includes('data-opencanvas-scroll-behavior'),
    'absent scrollBehavior must emit nothing',
  );
  const html2 = renderHtml(siteWith(baseText(), { scrollBehavior: {} }));
  assert(
    !html2.includes('data-opencanvas-scroll-behavior'),
    'empty scrollBehavior must emit nothing',
  );
}

// Negative — paddingTop < 0.
{
  const r = validateEditableSite(siteWith(baseText(), { scrollBehavior: { paddingTop: -10 } }));
  assert(
    !r.valid && r.errors.some((e) => e.includes('scrollBehavior.paddingTop')),
    `expected paddingTop<0 error; got ${JSON.stringify(r)}`,
  );
}

// Negative — smooth is not a boolean.
{
  const r = validateEditableSite(
    siteWith(baseText(), {
      scrollBehavior: { smooth: 'yes' as unknown as boolean },
    }),
  );
  assert(
    !r.valid && r.errors.some((e) => e.includes('scrollBehavior.smooth')),
    `expected non-boolean smooth error; got ${JSON.stringify(r)}`,
  );
}

// Negative — scrollBehavior is not an object.
{
  const bad = { ...siteWith(baseText()), scrollBehavior: 'smooth' } as unknown as EditableSite;
  const r = validateEditableSite(bad);
  assert(
    !r.valid && r.errors.some((e) => e.includes('scrollBehavior')),
    `expected non-object error; got ${JSON.stringify(r)}`,
  );
}

// ============================================================================
// layout-v2 scroll-snap carousel mode (ADR 0054 dec 2)
// ============================================================================

{
  const html = renderHtml(siteWithElements([baseCarousel({ mode: 'scroll-snap' })]));
  assert(
    html.includes('data-opencanvas-carousel-mode="scroll-snap"'),
    `expected scroll-snap carousel mode attribute; got ${html}`,
  );
  assert(
    !html.includes('data-opencanvas-carousel-prev') &&
      !html.includes('data-opencanvas-carousel-dot'),
    `scroll-snap carousel must suppress paginate controls; got ${html}`,
  );
  assert(
    canvasPublishedStyles.includes(
      '.opencanvas-carousel[data-opencanvas-carousel-mode="scroll-snap"]',
    ) && canvasPublishedStyles.includes('scroll-snap-type:x mandatory'),
    'published CSS must make scroll-snap carousels a horizontal snap rail',
  );
}

{
  const bad = { ...baseCarousel(), mode: 'deck' } as unknown as CarouselElement;
  const r = validateEditableSite(siteWithElements([bad]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('mode') && e.includes('scroll-snap')),
    `expected invalid carousel mode rejection; got ${JSON.stringify(r)}`,
  );
}

console.log('[layout-primitives:smoke] OK');
