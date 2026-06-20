// src/canvas/component-style.smoke.ts
//
// ADR 0067 — Component Style objects for interactive components.
// Run with `bun run component-style:smoke`.

import type {
  ActionElement,
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
  NavElement,
} from './elements/index.js';
import { renderCanvasSnapshot } from './render.js';
import { canvasPublishedStyles } from './public-styles.js';
import { canvasEditorStyles } from '../editor-client/styles-build.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';
import { accordionAgentToolSpec } from './elements/accordion.js';
import { actionAgentToolSpec } from './elements/action.js';
import { carouselAgentToolSpec } from './elements/carousel.js';
import { collectionAgentToolSpec } from './elements/collection.js';
import { formAgentToolSpec } from './elements/form.js';
import { navAgentToolSpec } from './elements/nav.js';
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

function action(overrides: Partial<ActionElement> = {}): ActionElement {
  return {
    id: 'el-action',
    type: 'action',
    box: { x: 0, y: 0, w: 220, h: 64, z: 1 },
    label: [{ text: 'Race' }],
    variant: 'solid',
    href: { type: 'external', url: '#' },
    ...overrides,
  } as ActionElement;
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

function nav(overrides: Partial<NavElement> = {}): NavElement {
  return {
    id: 'el-nav',
    type: 'nav',
    box: { x: 0, y: 0, w: 960, h: 72, z: 1 },
    links: [{ label: 'Home', href: '/', kind: 'internal' }],
    layout: 'left-right',
    sticky: false,
    siteTitle: 'Velocity',
    primaryAction: { label: 'Shop', href: '/shop', kind: 'internal' },
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
    withStyle(action(), 'actionStyle', {
      borderColor: '#ffcc00',
      borderWidth: 3,
      paddingX: 24,
      paddingY: 12,
    }),
    withStyle(nav(), 'navStyle', {
      backgroundColor: '#101820',
      color: '#f7f1df',
      slotGap: 18,
      linkColor: '#f7f1df',
      linkHoverColor: '#c8ff1a',
      activeLinkColor: '#101820',
      activeLinkBackgroundColor: '#c8ff1a',
      linkPaddingX: 16,
      linkPaddingY: 7,
      siteTitleFontSize: 22,
      siteTitleFontWeight: 'bold',
      primaryBackgroundColor: '#c8ff1a',
      primaryColor: '#101820',
      primaryBorderRadius: 999,
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
        titleColor: '#101010',
        titleFontSize: 24,
        titleFontWeight: 'bold',
        excerptFontSize: 15,
        excerptLineHeight: 1.55,
        ctaFontSize: 13,
        ctaFontWeight: 'medium',
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
    html.includes('--opencanvas-action-border-color:#ffcc00'),
    'actionStyle must emit modeled border color on the wrapper',
  );
  assert(
    html.includes('--opencanvas-action-border-width:3px'),
    'actionStyle must emit modeled border width on the wrapper',
  );
  assert(
    html.includes('--opencanvas-action-padding-x:24px'),
    'actionStyle must emit modeled horizontal padding on the wrapper',
  );
  assert(
    html.includes('--opencanvas-action-padding-y:12px'),
    'actionStyle must emit modeled vertical padding on the wrapper',
  );
  assert(
    canvasPublishedStyles.includes('border-color: var(--opencanvas-action-border-color'),
    'public styles must consume modeled action border color',
  );
  assert(
    canvasPublishedStyles.includes('border-width: var(--opencanvas-action-border-width'),
    'public styles must consume modeled action border width',
  );
  assert(
    canvasPublishedStyles.includes('padding-left: var(--opencanvas-action-padding-x'),
    'public styles must consume modeled action horizontal padding',
  );
  assert(
    canvasPublishedStyles.includes('padding-top: var(--opencanvas-action-padding-y'),
    'public styles must consume modeled action vertical padding',
  );
  assert(
    canvasEditorStyles.includes('border-color: var(--opencanvas-action-border-color'),
    'editor styles must consume modeled action border color',
  );
  assert(
    canvasEditorStyles.includes('border-width: var(--opencanvas-action-border-width'),
    'editor styles must consume modeled action border width',
  );
  assert(
    canvasEditorStyles.includes('padding-left: var(--opencanvas-action-padding-x'),
    'editor styles must consume modeled action horizontal padding',
  );
  assert(
    canvasEditorStyles.includes('padding-top: var(--opencanvas-action-padding-y'),
    'editor styles must consume modeled action vertical padding',
  );
  assert(
    html.includes('--opencanvas-nav-bg:#101820'),
    'navStyle must emit modeled nav background on the wrapper',
  );
  assert(
    html.includes('--opencanvas-nav-slot-gap:18px'),
    'navStyle must emit modeled slot gap on the wrapper',
  );
  assert(
    html.includes('--opencanvas-nav-link-pad-x:16px'),
    'navStyle must emit modeled link horizontal padding on the wrapper',
  );
  assert(
    html.includes('--opencanvas-nav-link-active-color:#101820'),
    'navStyle must emit modeled active link color on the wrapper',
  );
  assert(
    html.includes('--opencanvas-nav-link-active-bg:#c8ff1a'),
    'navStyle must emit modeled active link background on the wrapper',
  );
  assert(
    html.includes('--opencanvas-nav-primary-radius:999px'),
    'navStyle must emit modeled primary CTA radius on the wrapper',
  );
  assert(
    canvasPublishedStyles.includes('background: var(--opencanvas-nav-bg'),
    'public styles must consume modeled nav background',
  );
  assert(
    canvasPublishedStyles.includes('padding: var(--opencanvas-nav-link-pad-y'),
    'public styles must consume modeled nav link padding',
  );
  assert(
    canvasPublishedStyles.includes('[data-opencanvas-nav-link-active="true"]'),
    'public styles must consume active nav link metadata',
  );
  assert(
    canvasEditorStyles.includes('background: var(--opencanvas-nav-bg'),
    'editor styles must consume modeled nav background',
  );
  assert(
    canvasEditorStyles.includes('padding: var(--opencanvas-nav-link-pad-y'),
    'editor styles must consume modeled nav link padding',
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
    html.includes('--opencanvas-collection-title-font-size:24px'),
    'collectionStyle must emit title font size on the wrapper',
  );
  assert(
    html.includes('--opencanvas-collection-title-font-weight:700'),
    'collectionStyle must emit title font weight on the wrapper',
  );
  assert(
    html.includes('--opencanvas-collection-excerpt-line-height:1.55'),
    'collectionStyle must emit excerpt line height on the wrapper',
  );
  assert(
    html.includes('--opencanvas-collection-cta-font-weight:500'),
    'collectionStyle must emit CTA font weight on the wrapper',
  );
  assert(
    canvasPublishedStyles.includes('--opencanvas-collection-title-font-size'),
    'public styles must consume collection title typography variables',
  );
  assert(
    canvasPublishedStyles.includes('--opencanvas-collection-excerpt-line-height'),
    'public styles must consume collection excerpt typography variables',
  );
  assert(
    canvasPublishedStyles.includes('--opencanvas-collection-cta-font-weight'),
    'public styles must consume collection CTA typography variables',
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
expectInvalid(
  siteWith([
    withStyle(
      {
        ...action(),
        pinnedStyle: { '--opencanvas-action-bg': '#000000' },
      },
      'actionStyle',
      { backgroundColor: '#ffffff' },
    ),
  ]),
  'pinnedStyle',
  'modeled actionStyle key duplicated in pinnedStyle',
);
expectInvalid(
  siteWith([
    withStyle(
      {
        ...action(),
        pinnedStyle: { '--opencanvas-action-border-color': '#000000' },
      },
      'actionStyle',
      { borderColor: '#ffffff' },
    ),
  ]),
  'pinnedStyle',
  'modeled actionStyle border key duplicated in pinnedStyle',
);
expectInvalid(
  siteWith([
    withStyle(
      {
        ...action(),
        pinnedStyle: { '--opencanvas-action-padding-x': '16px' },
      },
      'actionStyle',
      { paddingX: 20 },
    ),
  ]),
  'pinnedStyle',
  'modeled actionStyle padding key duplicated in pinnedStyle',
);
expectInvalid(
  siteWith([
    withStyle(nav(), 'navStyle', {
      mystery: 'nope',
    }),
  ]),
  '.navStyle.mystery',
  'unknown navStyle key',
);
expectInvalid(
  siteWith([
    withStyle(
      {
        ...nav(),
        pinnedStyle: { '--opencanvas-nav-bg': '#000000' },
      },
      'navStyle',
      { backgroundColor: '#ffffff' },
    ),
  ]),
  'pinnedStyle',
  'modeled navStyle key duplicated in pinnedStyle',
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
  assert(
    JSON.stringify(actionAgentToolSpec.parsePatch({ actionStyle: { borderWidth: 2 } })) ===
      JSON.stringify({ actionStyle: { borderWidth: 2 } }),
    'action agent patch must preserve modeled border width',
  );
  assert(
    JSON.stringify(actionAgentToolSpec.parsePatch({ actionStyle: { paddingX: 18 } })) ===
      JSON.stringify({ actionStyle: { paddingX: 18 } }),
    'action agent patch must preserve modeled padding',
  );
  assert(
    JSON.stringify(navAgentToolSpec.parsePatch({ navStyle: { slotGap: 14 } })) ===
      JSON.stringify({ navStyle: { slotGap: 14 } }),
    'nav agent patch must preserve navStyle',
  );
}

console.log('[component-style:smoke] OK');
