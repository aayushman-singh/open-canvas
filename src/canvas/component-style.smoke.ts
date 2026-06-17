// src/canvas/component-style.smoke.ts
//
// ADR 0067 — Component Style objects for interactive components.
// Run with `bun run component-style:smoke`.

import type {
  CanvasElement,
  EditableSite,
  PublishedSnapshot,
  TabsElement,
  TextElement,
} from './schema.js';
import type {
  AccordionElement,
  CarouselElement,
  CollectionElement,
  FormElement,
} from './elements/index.js';
import { renderCanvasSnapshot } from './render.js';
import { canvasPublishedStyles } from './public-styles.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';
import { accordionAgentToolSpec } from './elements/accordion.js';
import { carouselAgentToolSpec } from './elements/carousel.js';
import { collectionAgentToolSpec } from './elements/collection.js';
import { formAgentToolSpec } from './elements/form.js';
import { tabsAgentToolSpec } from './elements/tabs.js';

const TURNSTILE = 'turnstile-test-key';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[component-style:smoke] ${message}`);
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
    slides: [{ id: 's1', assetId: 'asset-1', caption: 'Caption' }],
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

function collection(overrides: Partial<CollectionElement> = {}): CollectionElement {
  return {
    id: 'el-collection',
    type: 'collection',
    box: { x: 0, y: 0, w: 960, h: 520, z: 1 },
    collectionSlug: 'blog',
    display: 'card',
    sort: 'date-desc',
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

function withStyle<T extends CanvasElement>(
  element: T,
  styleKey: string,
  style: Record<string, unknown>,
): T {
  return { ...element, [styleKey]: style } as unknown as T;
}

function siteWith(elements: CanvasElement[]): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'index',
        title: 'Component style smoke',
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
    publishedAt: '2026-06-16T00:00:00.000Z',
    ...state,
  };
  return renderCanvasSnapshot(snapshot, '/assets', 'smoke-site', {
    turnstileSiteKey: TURNSTILE,
  });
}

function expectValid(state: EditableSite, label: string): void {
  const r = validateEditableSite(state);
  assert(r.valid, `${label} must validate; errors: ${r.valid ? '' : r.errors.join(' | ')}`);
}

function expectInvalid(state: EditableSite, needle: string, label: string): void {
  const r = validateEditableSite(state);
  assert(!r.valid, `${label} must be rejected`);
  assert(
    !r.valid && r.errors.some((e) => e.includes(needle)),
    `${label} rejection must mention ${needle}; errors: ${r.valid ? '' : r.errors.join(' | ')}`,
  );
}

function expectRoundTrip(state: EditableSite, label: string): void {
  const decoded = decodeYDoc(encodeYDoc(state));
  assert(
    JSON.stringify(decoded) === JSON.stringify(state),
    `${label} must Yjs round-trip component style objects`,
  );
}

{
  const styled = siteWith([
    withStyle(accordion(), 'accordionStyle', {
      headerBackgroundColor: '#123456',
      bodyFontSize: 17,
    }),
    withStyle(tabs(), 'tabsStyle', {
      activeTabBackgroundColor: '#abcdef',
      activeTabFontWeight: 'bold',
    }),
    withStyle(carousel(), 'carouselStyle', {
      captionFontSize: 21,
      arrowBackgroundColor: '#111111',
    }),
    withStyle(form(), 'formStyle', {
      fieldSurfaceBackgroundColor: '#eeeeee',
      spotlightGlowOpacity: 0.4,
    }),
    withStyle(
      collection({
        entries: [[baseText({ id: 'entry-title', content: [{ text: 'Materialized entry' }] })]],
      }),
      'collectionStyle',
      {
        gridGap: 18,
        cardBackgroundColor: '#ffeeee',
        cardImageRadius: 12,
      },
    ),
  ]);

  expectValid(styled, 'sparse component style objects');
  expectRoundTrip(styled, 'sparse component style objects');

  const html = renderHtml(styled);
  assert(
    html.includes('--opencanvas-accordion-header-bg:#123456'),
    'accordionStyle must emit --opencanvas-accordion-header-bg on the wrapper',
  );
  assert(
    html.includes('--opencanvas-accordion-body-font-size:17px'),
    'accordionStyle must emit body font size as px',
  );
  assert(
    html.includes('--opencanvas-tabs-active-tab-bg:#abcdef'),
    'tabsStyle must emit active tab background on the wrapper',
  );
  assert(
    html.includes('--opencanvas-carousel-caption-font-size:21px'),
    'carouselStyle must emit caption font size as px',
  );
  assert(
    html.includes('--opencanvas-form-field-surface-bg:#eeeeee'),
    'extended formStyle must emit field surface background on the wrapper',
  );
  assert(
    html.includes('--opencanvas-collection-card-bg:#ffeeee'),
    'collectionStyle must emit card background on the wrapper',
  );
  assert(
    html.includes('Materialized entry'),
    'Collection render must include materialized entry children',
  );
  assert(
    html.includes('data-opencanvas-collection-entry="0"'),
    'Collection render must wrap each materialized entry with an entry marker',
  );
}

{
  const customStyled = siteWith([
    withStyle(
      collection({
        id: 'el-custom-collection',
        display: 'custom',
        entries: [[baseText({ id: 'custom-entry-title', content: [{ text: 'Custom card' }] })]],
      }),
      'collectionStyle',
      {
        cardBackgroundColor: '#ffeeee',
        cardImageRadius: 12,
      },
    ),
  ]);

  expectValid(customStyled, 'custom collection with sparse collection style');

  const html = renderHtml(customStyled);
  assert(
    html.includes('data-collection-display="custom"'),
    'custom Collection render must preserve the custom display marker',
  );
  assert(
    html.includes('--opencanvas-collection-card-bg:#ffeeee'),
    'custom Collection style object must still emit sparse host variables',
  );
  assert(
    canvasPublishedStyles.includes('[data-collection-display="card"]'),
    'public stylesheet must still target built-in card Collection chrome',
  );
  assert(
    !canvasPublishedStyles.includes('[data-collection-display="custom"]'),
    'custom Collection templates must not consume built-in card surface or media chrome',
  );
}

expectInvalid(
  siteWith([
    withStyle(accordion(), 'accordionStyle', {
      headerBackgroundColor: '#123456',
      mystery: 'nope',
    }),
  ]),
  '.accordionStyle.mystery',
  'unknown accordionStyle key',
);

expectInvalid(
  siteWith([
    withStyle(
      {
        ...tabs(),
        pinnedStyle: { '--opencanvas-tabs-active-tab-bg': '#000000' },
      },
      'tabsStyle',
      { activeTabBackgroundColor: '#ffffff' },
    ),
  ]),
  'pinnedStyle',
  'modeled tabsStyle key duplicated in pinnedStyle',
);

expectInvalid(
  siteWith([
    withStyle(collection(), 'collectionStyle', {
      gridGap: 12,
      mystery: 'nope',
    }),
  ]),
  '.collectionStyle.mystery',
  'unknown collectionStyle key',
);

expectInvalid(
  siteWith([
    withStyle(
      {
        ...collection(),
        pinnedStyle: { '--opencanvas-collection-card-bg': '#000000' },
      },
      'collectionStyle',
      { cardBackgroundColor: '#ffffff' },
    ),
  ]),
  'pinnedStyle',
  'modeled collectionStyle key duplicated in pinnedStyle',
);

{
  const patch = accordionAgentToolSpec.parsePatch({
    accordionStyle: { headerBackgroundColor: '#123456' },
  });
  assert(
    JSON.stringify(patch) === JSON.stringify({ accordionStyle: { headerBackgroundColor: '#123456' } }),
    'accordion agent patch must preserve accordionStyle',
  );
  let rejected = false;
  try {
    carouselAgentToolSpec.parsePatch({ carouselStyle: { captionFontSize: 'large' } });
  } catch (err) {
    rejected = err instanceof Error && err.message.includes('carouselStyle.captionFontSize');
  }
  assert(rejected, 'carousel agent patch must reject invalid carouselStyle primitive types');

  assert(
    JSON.stringify(
      tabsAgentToolSpec.parsePatch({ tabsStyle: { activeTabFontWeight: 'bold' } }),
    ) === JSON.stringify({ tabsStyle: { activeTabFontWeight: 'bold' } }),
    'tabs agent patch must preserve tabsStyle',
  );
  assert(
    JSON.stringify(
      formAgentToolSpec.parsePatch({ formStyle: { fieldSurfaceShadow: '0 1px 2px #000' } }),
    ) === JSON.stringify({ formStyle: { fieldSurfaceShadow: '0 1px 2px #000' } }),
    'form agent patch must preserve extended formStyle',
  );
  assert(
    JSON.stringify(
      collectionAgentToolSpec.parsePatch({ collectionStyle: { cardImageRadius: 12 } }),
    ) === JSON.stringify({ collectionStyle: { cardImageRadius: 12 } }),
    'collection agent patch must preserve collectionStyle',
  );
}

console.log('[component-style:smoke] OK');
