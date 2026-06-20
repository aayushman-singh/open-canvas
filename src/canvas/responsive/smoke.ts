// src/canvas/responsive/smoke.ts
//
// Wave 1 #1 smoke. Loads the canonical home fixture, augments it with a
// synthetic `responsive` override on one element so the responsive CSS path
// gets exercised, renders the full snapshot, and asserts the emitted
// `<style data-opencanvas-responsive>` block carries the expected shape.
//
// Run with `bun.cmd run responsive:smoke`.

import fixture from '../fixtures/home.json' with { type: 'json' };
import { renderCanvasSnapshot } from '../render.js';
import { pickStyleKitField } from '../schema.js';
import type { CanvasSection, EditableSite, PublishedSnapshot } from '../schema.js';
import { validateEditableSite } from '../validate.js';

import { renderResponsiveCss } from './index.js';
import { PHONE_DESIGN_WIDTH, scaleFactor } from './translate.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const editable = structuredClone(fixture) as EditableSite;

// The bundled home fixture has no `responsive` overrides. To exercise the
// hidden + override paths the smoke synthesises one: hide the decorative
// `hero-orb` shape on phone, and pin the `hero-action` button to a fixed
// width override at phone too.
const page = editable.pages[0];
if (!page) throw new Error('[responsive:smoke] fixture must have a page');
const heroSection = page.sections.find((s) => s.id === 'section-hero');
if (!heroSection) throw new Error('[responsive:smoke] fixture must have section-hero');
const heroOrb = heroSection.elements.find((el) => el.id === 'hero-orb');
if (!heroOrb) throw new Error('[responsive:smoke] fixture must have hero-orb');
heroOrb.responsive = { phone: { hidden: true } };

const heroAction = heroSection.elements.find((el) => el.id === 'hero-action');
if (!heroAction) throw new Error('[responsive:smoke] fixture must have hero-action');
const HERO_ACTION_PHONE_W = 160;
heroAction.responsive = { phone: { w: HERO_ACTION_PHONE_W } };

const snapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  ...pickStyleKitField(editable),
  pages: editable.pages,
};

const html = renderCanvasSnapshot(snapshot, '/assets', 'smoke-site', {
  turnstileSiteKey: 'turnstile-test-key',
});

// --- Assertion 1: exactly one <style data-opencanvas-responsive> block ----------
const styleOpenRegex = /<style data-opencanvas-responsive>/g;
const styleOpenMatches = html.match(styleOpenRegex);
assert(
  styleOpenMatches !== null && styleOpenMatches.length === 1,
  `expected exactly one <style data-opencanvas-responsive> opening tag, got ${String(styleOpenMatches?.length ?? 0)}`,
);
const styleCloseMatches = html.match(/<\/style>/g);
assert(
  styleCloseMatches !== null && styleCloseMatches.length === 1,
  `expected exactly one </style> closing tag, got ${String(styleCloseMatches?.length ?? 0)}`,
);

// Extract the style block contents for further assertions.
const styleOpenIdx = html.indexOf('<style data-opencanvas-responsive>');
const styleCloseIdx = html.indexOf('</style>', styleOpenIdx);
assert(styleOpenIdx >= 0 && styleCloseIdx > styleOpenIdx, 'expected a closed style block');
const styleBody = html.slice(styleOpenIdx + '<style data-opencanvas-responsive>'.length, styleCloseIdx);

// --- Assertion 2: tablet + phone breakpoint markers ------------------------
assert(
  styleBody.includes('@media (max-width: 1023px)'),
  'expected tablet @media breakpoint marker in style block',
);
assert(
  styleBody.includes('@media (max-width: 767px)'),
  'expected phone @media breakpoint marker in style block',
);

// --- Assertion 3: hidden override emits display: none in phone block -------
const phoneBlockStart = styleBody.indexOf('@media (max-width: 767px)');
assert(phoneBlockStart >= 0, 'expected phone block start');
// The phone block extends from its @media line to the matching closing
// brace. The block contains only flat rules (no nested @rules) so we can
// scan forward to the FIRST `\n}` line — which `buildBreakpointBlock`
// always emits on its own line.
const phoneBlockBraceClose = styleBody.indexOf('\n}', phoneBlockStart);
assert(phoneBlockBraceClose > phoneBlockStart, 'expected phone block to close');
const phoneBlock = styleBody.slice(phoneBlockStart, phoneBlockBraceClose);
assert(
  phoneBlock.includes('[data-opencanvas-element="hero-orb"] { display: none !important; }'),
  'expected hero-orb to be display:none in phone block (synthetic responsive.phone.hidden)',
);

// --- Assertion 4: a box without overrides scales width proportionally ------
// hero-heading has no responsive override. Its desktop box is w=600.
// Phone scale = 375 / 1440 → expected phone width ≈ 156px.
const heroHeading = heroSection.elements.find((el) => el.id === 'hero-heading');
if (!heroHeading) throw new Error('[responsive:smoke] fixture must have hero-heading');
const desktopWidth = heroHeading.box.w;
const expectedPhoneWidth = Math.round(desktopWidth * scaleFactor(page.width, 'phone'));
const phoneHeadingRule = phoneBlock.match(
  /\[data-opencanvas-element="hero-heading"\] \{[^}]*width: (\d+)px !important;[^}]*\}/,
);
assert(phoneHeadingRule !== null, 'expected hero-heading phone rule in style block');
const matchedWidthStr = phoneHeadingRule?.[1];
assert(
  typeof matchedWidthStr === 'string',
  'expected width capture group on hero-heading phone rule',
);
const matchedWidth = Number(matchedWidthStr);
assert(
  Math.abs(matchedWidth - expectedPhoneWidth) <= 1,
  `expected hero-heading phone width within ±1px of ${String(expectedPhoneWidth)} (got ${String(matchedWidth)})`,
);

// Belt-and-braces: page.width is 1440, phone design width is 375, so the
// scaling formula gives 375/1440 = 0.2604... → 600 * 0.2604 ≈ 156.25 → 156.
assert(
  PHONE_DESIGN_WIDTH === 375,
  'phone design width changed — update this smoke if the constant changes',
);
assert(
  Math.abs(matchedWidth - 156) <= 1,
  `sanity check: hero-heading phone width should be ≈156px (got ${String(matchedWidth)})`,
);

// --- Assertion 5: no responsive runtime without layout variants -------------
assert(
  !renderResponsiveCss(snapshot).toLowerCase().includes('<script'),
  'expected responsive box overrides to stay pure CSS when no layout variants are present',
);

// --- Assertion 6: empty-snapshot path returns '' ---------------------------
// A snapshot with no responsive overrides AND a page that already fits a
// phone viewport (width ≤ 767) must produce no <style> block at all. Build
// a tiny synthetic snapshot to exercise the empty-string return path.
const emptySnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-tiny',
      slug: 'tiny',
      title: 'Tiny',
      width: 320,
      sections: [
        {
          id: 'section-tiny',
          recipeId: 'hero-split',
          name: 'Tiny',
          height: 200,
          elements: [],
        },
      ],
    },
  ],
};
const emptyResult = renderResponsiveCss(emptySnapshot);
assert(
  emptyResult === '',
  `expected empty string from renderResponsiveCss when no overrides AND page fits phone (got ${JSON.stringify(emptyResult)})`,
);

// --- Assertion 7: explicit override forces a block even on a small page ---
// Same tiny page, but with an explicit (empty) responsive override on a
// synthetic element — proves the override-detection branch fires.
const tinyWithOverride: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-tiny',
      slug: 'tiny',
      title: 'Tiny',
      width: 320,
      sections: [
        {
          id: 'section-tiny',
          recipeId: 'hero-split',
          name: 'Tiny',
          height: 200,
          elements: [
            {
              id: 'tiny-shape',
              type: 'shape',
              box: { x: 10, y: 10, w: 50, h: 50, z: 1 },
              variant: 'circle',
              responsive: { phone: { hidden: true } },
            },
          ],
        },
      ],
    },
  ],
};
const tinyResult = renderResponsiveCss(tinyWithOverride);
assert(
  tinyResult.startsWith('<style data-opencanvas-responsive>') && tinyResult.endsWith('</style>'),
  'expected a <style data-opencanvas-responsive> block when an override is present, even on a tiny page',
);

// --- Assertion 8: header-only override on a tiny page still emits a block --
// Regression for the bug where `snapshotHasResponsiveOverride` only scanned
// `page.sections` and ignored the site-wide header / footer. A header-only
// override on a phone-fitting page must still trip the gate; otherwise the
// emitted CSS body would be empty even though the resolver merges header +
// footer into every page's layout.
const headerOnlyOverride: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  styleKit: 'charcoal',
  header: {
    id: 'site-header',
    recipeId: 'hero-split',
    name: 'Header',
    height: 80,
    elements: [
      {
        id: 'header-logo',
        type: 'shape',
        box: { x: 10, y: 10, w: 100, h: 40, z: 1 },
        variant: 'rect',
        responsive: { phone: { hidden: true } },
      },
    ],
  },
  pages: [
    {
      id: 'page-tiny',
      slug: 'tiny',
      title: 'Tiny',
      width: 320,
      sections: [
        {
          id: 'section-tiny',
          recipeId: 'hero-split',
          name: 'Tiny',
          height: 200,
          elements: [],
        },
      ],
    },
  ],
};
const headerOnlyResult = renderResponsiveCss(headerOnlyOverride);
assert(
  headerOnlyResult.startsWith('<style data-opencanvas-responsive>') &&
    headerOnlyResult.endsWith('</style>'),
  'expected a <style data-opencanvas-responsive> block when only the site-wide header carries a responsive override',
);
assert(
  headerOnlyResult.includes('[data-opencanvas-element="header-logo"] { display: none !important; }'),
  'expected header-logo display:none rule to appear in the emitted CSS when override lives in snapshot.header',
);

// --- Assertion 9: footer-only override on a tiny page still emits a block --
const footerOnlyOverride: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  styleKit: 'charcoal',
  footer: {
    id: 'site-footer',
    recipeId: 'hero-split',
    name: 'Footer',
    height: 80,
    elements: [
      {
        id: 'footer-credit',
        type: 'shape',
        box: { x: 10, y: 10, w: 100, h: 40, z: 1 },
        variant: 'rect',
        responsive: { phone: { hidden: true } },
      },
    ],
  },
  pages: [
    {
      id: 'page-tiny',
      slug: 'tiny',
      title: 'Tiny',
      width: 320,
      sections: [
        {
          id: 'section-tiny',
          recipeId: 'hero-split',
          name: 'Tiny',
          height: 200,
          elements: [],
        },
      ],
    },
  ],
};
const footerOnlyResult = renderResponsiveCss(footerOnlyOverride);
assert(
  footerOnlyResult.startsWith('<style data-opencanvas-responsive>') &&
    footerOnlyResult.endsWith('</style>'),
  'expected a <style data-opencanvas-responsive> block when only the site-wide footer carries a responsive override',
);
assert(
  footerOnlyResult.includes('[data-opencanvas-element="footer-credit"] { display: none !important; }'),
  'expected footer-credit display:none rule to appear in the emitted CSS when override lives in snapshot.footer',
);

// --- Assertion 10: section responsive variants select alternate child trees ---
function makeVariantSection(): CanvasSection {
  return {
    id: 'raydotsh-projects-section',
    recipeId: 'feature-grid',
    name: 'Projects',
    height: 720,
    responsiveVariants: [
      {
        id: 'raydotsh-projects-desktop',
        breakpoint: 'desktop',
        contentSourceId: 'raydotsh-projects',
        elementIds: ['raydotsh-spotlight-card', 'raydotsh-project-grid'],
      },
      {
        id: 'raydotsh-projects-phone',
        breakpoint: 'phone',
        contentSourceId: 'raydotsh-projects',
        elementIds: ['raydotsh-mobile-project-list'],
      },
    ],
    elements: [
      {
        id: 'raydotsh-spotlight-card',
        type: 'shape',
        box: { x: 80, y: 80, w: 520, h: 260, z: 1 },
        variant: 'rect',
      },
      {
        id: 'raydotsh-project-grid',
        type: 'shape',
        box: { x: 640, y: 80, w: 620, h: 420, z: 1 },
        variant: 'rect',
      },
      {
        id: 'raydotsh-mobile-project-list',
        type: 'shape',
        box: { x: 24, y: 80, w: 327, h: 520, z: 1 },
        variant: 'rect',
      },
    ],
  } as unknown as CanvasSection;
}

function makeVariantEditable(section: CanvasSection = makeVariantSection()): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'raydotsh-responsive-page',
        slug: 'responsive-variants',
        title: 'Responsive Variants',
        width: 1440,
        sections: [section],
      },
    ],
  };
}

const variantEditable = makeVariantEditable();
const variantValidation = validateEditableSite(variantEditable);
const variantErrors = variantValidation.valid ? [] : variantValidation.errors;
assert(
  variantValidation.valid,
  `expected responsive variant fixture to validate: ${variantErrors.join('; ')}`,
);
const variantSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-06-20T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: variantEditable.pages,
};
const variantHtml = renderCanvasSnapshot(variantSnapshot, '/assets', 'variant-site', {
  turnstileSiteKey: 'turnstile-test-key',
});
assert(
  variantHtml.includes('data-opencanvas-responsive-variant="raydotsh-projects-desktop"'),
  'expected desktop variant elements to carry variant metadata',
);
assert(
  variantHtml.includes('data-opencanvas-responsive-active="desktop tablet"'),
  'expected desktop variant to remain active at tablet when no tablet variant exists',
);
assert(
  /data-opencanvas-element="raydotsh-mobile-project-list"[^>]*data-opencanvas-responsive-active="phone"[^>]*hidden[^>]*aria-hidden="true"[^>]*inert/.test(
    variantHtml,
  ),
  'expected phone-only variant element to render inert on desktop',
);
assert(
  variantHtml.includes('[data-opencanvas-responsive-active] { display: none !important; }'),
  'expected responsive variant CSS to hide inactive variant elements',
);
assert(
  variantHtml.includes(
    '[data-opencanvas-responsive-active~="phone"] { display: block !important; }',
  ),
  'expected responsive variant CSS to show phone-active variant elements at the phone breakpoint',
);
assert(
  variantHtml.includes('data-opencanvas-responsive-variant-runtime'),
  'expected responsive variant runtime to update hidden/aria-hidden/inert on breakpoint changes',
);

function expectVariantInvalid(section: CanvasSection, fragment: string, label: string): void {
  const result = validateEditableSite(makeVariantEditable(section));
  if (result.valid) {
    throw new Error(`${label}: expected validation failure`);
  }
  assert(
    result.errors.some((error: string) => error.includes(fragment)),
    `${label}: expected error containing ${fragment}, got ${JSON.stringify(result.errors)}`,
  );
}

const duplicateVariantId = structuredClone(makeVariantSection());
(
  duplicateVariantId as CanvasSection & {
    responsiveVariants: Array<{ id: string }>;
  }
).responsiveVariants[1]!.id = 'raydotsh-projects-desktop';
expectVariantInvalid(duplicateVariantId, 'responsiveVariants[1].id', 'duplicate variant id');

const duplicateBreakpoint = structuredClone(makeVariantSection());
(
  duplicateBreakpoint as CanvasSection & {
    responsiveVariants: Array<{ breakpoint: string }>;
  }
).responsiveVariants[1]!.breakpoint = 'desktop';
expectVariantInvalid(
  duplicateBreakpoint,
  'responsiveVariants[1].breakpoint',
  'duplicate breakpoint per content source',
);

const missingElement = structuredClone(makeVariantSection());
(
  missingElement as CanvasSection & {
    responsiveVariants: Array<{ elementIds: string[] }>;
  }
).responsiveVariants[1]!.elementIds = ['missing-mobile-list'];
expectVariantInvalid(missingElement, 'responsiveVariants[1].elementIds[0]', 'missing element id');

const missingDesktop = structuredClone(makeVariantSection());
(
  missingDesktop as CanvasSection & {
    responsiveVariants: Array<{ breakpoint: string }>;
  }
).responsiveVariants[0]!.breakpoint = 'tablet';
expectVariantInvalid(missingDesktop, 'contentSourceId "raydotsh-projects"', 'missing desktop variant');

const emptyPhoneVariant = structuredClone(makeVariantSection());
(
  emptyPhoneVariant as CanvasSection & {
    responsiveVariants: Array<{ elementIds: string[] }>;
  }
).responsiveVariants[1]!.elementIds = [];
expectVariantInvalid(emptyPhoneVariant, 'phone', 'all variants hidden at phone');

console.log('[responsive:smoke] OK');
