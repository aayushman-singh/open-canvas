// src/canvas/variant-presets.smoke.ts
//
// ADR 0066 — variant-preset layer. `bun run variant-presets:smoke`.
//
// Asserts, for each of the four interactive components (form, carousel,
// accordion, tabs):
//   1. The render fn emits `data-variant="<arm>"` on the component root for a
//      chosen non-default arm.
//   2. With NO variant set, the root carries `data-variant="<first arm>"` — the
//      default that reproduces the current look (purely additive, no migration).
//   3. The validator REJECTS an unknown variant with a `.variant` error (loud,
//      per the write-gate rule) and ACCEPTS every catalogued arm.
//   4. Form `spotlight` emits `data-opencanvas-pointer-fx="spotlight"`; a
//      non-pointer-fx arm (`classic`) emits no pointer-fx attribute.

import type {
  CanvasElement,
  EditableSite,
  PublishedSnapshot,
  TabsElement,
  TextElement,
} from './schema.js';
import type { AccordionElement, CarouselElement, FormElement } from './elements/index.js';
import { renderCanvasSnapshot } from './render.js';
import { validateEditableSite } from './validate.js';
import { ACCORDION_VARIANTS } from './elements/accordion.js';
import { TABS_VARIANTS } from './elements/tabs.js';
import { CAROUSEL_VARIANTS } from './elements/carousel.js';
import { FORM_VARIANTS } from './elements/form.js';

const TURNSTILE = 'turnstile-test-key';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[variant-presets:smoke] ${message}`);
}

function baseText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'el-text',
    type: 'text',
    box: { x: 0, y: 0, w: 320, h: 60, z: 1 },
    content: [{ text: 'hello' }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
    ...overrides,
  };
}

function siteWith(elements: CanvasElement[]): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'index',
        title: 'Variant smoke',
        width: 1440,
        sections: [
          {
            id: 'section-smoke',
            recipeId: 'feature-grid',
            name: 'Smoke',
            height: 1200,
            elements,
          },
        ],
      },
    ],
  };
}

function renderHtml(state: EditableSite): string {
  const snapshot: PublishedSnapshot = {
    version: 1,
    publishedAt: '2026-06-02T00:00:00.000Z',
    ...state,
  };
  return renderCanvasSnapshot(snapshot, '/assets', 'smoke-site', {
    turnstileSiteKey: TURNSTILE,
  });
}

// -- Element builders (minimal valid shapes) --------------------------------

function accordion(overrides: Partial<AccordionElement> = {}): AccordionElement {
  return {
    id: 'el-acc',
    type: 'accordion',
    box: { x: 0, y: 0, w: 600, h: 300, z: 1 },
    items: [{ id: 'i1', title: 'Q', body: [{ text: 'A' }] }],
    allowMultipleOpen: false,
    ...overrides,
  };
}

function carousel(overrides: Partial<CarouselElement> = {}): CarouselElement {
  return {
    id: 'el-car',
    type: 'carousel',
    box: { x: 0, y: 0, w: 600, h: 360, z: 1 },
    slides: [{ id: 's1', assetId: 'asset-1' }],
    showArrows: true,
    showDots: true,
    ...overrides,
  };
}

function form(overrides: Partial<FormElement> = {}): FormElement {
  return {
    id: 'el-form',
    type: 'form',
    box: { x: 0, y: 0, w: 600, h: 400, z: 1 },
    fields: [{ id: 'name', label: 'Name', kind: 'text', required: true }],
    submitLabel: 'Send',
    successMessage: 'Thanks',
    ...overrides,
  };
}

function tabs(overrides: Partial<TabsElement> = {}): TabsElement {
  return {
    id: 'el-tabs',
    type: 'tabs',
    box: { x: 0, y: 0, w: 1280, h: 600, z: 1 },
    tabs: [
      { id: 'one', label: [{ text: 'One' }], elements: [baseText({ id: 'p1' })] },
      { id: 'two', label: [{ text: 'Two' }], elements: [baseText({ id: 'p2' })] },
    ],
    activeTabId: 'one',
    ...overrides,
  };
}

// ============================================================================
// 1 + 2 — render emits data-variant; default is the first arm
// ============================================================================

{
  // Accordion
  assert(
    renderHtml(siteWith([accordion({ variant: 'cards' })])).includes('data-variant="cards"'),
    'accordion cards arm must emit data-variant="cards"',
  );
  assert(
    renderHtml(siteWith([accordion()])).includes('data-variant="list"'),
    'accordion with no variant must default to data-variant="list"',
  );

  // Tabs
  assert(
    renderHtml(siteWith([tabs({ variant: 'pill' })])).includes('data-variant="pill"'),
    'tabs pill arm must emit data-variant="pill"',
  );
  assert(
    renderHtml(siteWith([tabs()])).includes('data-variant="classic"'),
    'tabs with no variant must default to data-variant="classic"',
  );

  // Carousel
  assert(
    renderHtml(siteWith([carousel({ variant: 'coverflow' })])).includes('data-variant="coverflow"'),
    'carousel coverflow arm must emit data-variant="coverflow"',
  );
  assert(
    renderHtml(siteWith([carousel()])).includes('data-variant="classic"'),
    'carousel with no variant must default to data-variant="classic"',
  );

  // Form
  assert(
    renderHtml(siteWith([form({ variant: 'brutalist' })])).includes('data-variant="brutalist"'),
    'form brutalist arm must emit data-variant="brutalist"',
  );
  assert(
    renderHtml(siteWith([form()])).includes('data-variant="classic"'),
    'form with no variant must default to data-variant="classic"',
  );
}

// ============================================================================
// 4 — pointer-fx attribute only for the pointer-fx arm
// ============================================================================

{
  const spotlightHtml = renderHtml(siteWith([form({ variant: 'spotlight' })]));
  assert(
    spotlightHtml.includes('data-opencanvas-pointer-fx="spotlight"'),
    'form spotlight must emit data-opencanvas-pointer-fx="spotlight"',
  );
  const classicHtml = renderHtml(siteWith([form({ variant: 'classic' })]));
  assert(
    !classicHtml.includes('data-opencanvas-pointer-fx'),
    'form classic must NOT emit a pointer-fx attribute',
  );
}

// ============================================================================
// 3 — validator accepts every arm, rejects unknown
// ============================================================================

function expectValid(state: EditableSite, label: string): void {
  const r = validateEditableSite(state);
  assert(r.valid, `${label} must validate; errors: ${r.valid ? '' : r.errors.join(' | ')}`);
}

function expectVariantRejected(state: EditableSite, label: string): void {
  const r = validateEditableSite(state);
  assert(!r.valid, `${label} must be rejected`);
  assert(
    !r.valid && r.errors.some((e) => e.includes('.variant')),
    `${label} rejection must cite .variant; errors: ${r.valid ? '' : r.errors.join(' | ')}`,
  );
}

// Every catalogued arm validates for each component.
for (const v of ACCORDION_VARIANTS) expectValid(siteWith([accordion({ variant: v })]), `accordion ${v}`);
for (const v of TABS_VARIANTS) expectValid(siteWith([tabs({ variant: v })]), `tabs ${v}`);
for (const v of CAROUSEL_VARIANTS) expectValid(siteWith([carousel({ variant: v })]), `carousel ${v}`);
for (const v of FORM_VARIANTS) expectValid(siteWith([form({ variant: v })]), `form ${v}`);

// An unknown variant on each component is rejected with a .variant error.
// (Cast through unknown — the bad value is intentionally outside the union.)
expectVariantRejected(
  siteWith([{ ...accordion(), variant: 'bogus' } as unknown as CanvasElement]),
  'accordion bogus variant',
);
expectVariantRejected(
  siteWith([{ ...tabs(), variant: 'bogus' } as unknown as CanvasElement]),
  'tabs bogus variant',
);
expectVariantRejected(
  siteWith([{ ...carousel(), variant: 'bogus' } as unknown as CanvasElement]),
  'carousel bogus variant',
);
expectVariantRejected(
  siteWith([{ ...form(), variant: 'bogus' } as unknown as CanvasElement]),
  'form bogus variant',
);

console.log('[variant-presets:smoke] OK');
