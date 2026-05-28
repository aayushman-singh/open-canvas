// src/canvas/smoke.ts
//
// Manual smoke: validate the canonical home fixture as an Editable Site and
// as a Published Snapshot, render it, and assert the rendered HTML contains
// the expected stable markers. Run with `bun.cmd run canvas:smoke`.

import fixture from './fixtures/home.json';
import { renderCanvasSnapshot } from './render.js';
import type {
  BuiltInStyleKit,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  CanvasSiteState,
  PublishedSnapshot,
  StyleKit,
  TextElement,
} from './schema.js';
import { BUILT_IN_STYLE_KITS } from './schema.js';
import { STYLE_KIT_PRESETS, buildAllStyleKitsCss, getStyleKitPreset } from './style-kits.js';
import {
  validateCanvasSiteState,
  validatePublishedSnapshot,
  validateSeedFixture,
} from './validate.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const editable = fixture as CanvasSiteState;
const editableResult = validateCanvasSiteState(editable);
assert(editableResult.valid, editableResult.valid ? '' : editableResult.errors.join('; '));

const snapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-22T00:00:00.000Z',
  styleKit: editable.styleKit,
  pages: editable.pages,
};
const publishedResult = validatePublishedSnapshot(snapshot);
assert(publishedResult.valid, publishedResult.valid ? '' : publishedResult.errors.join('; '));

const html = renderCanvasSnapshot(snapshot, '/assets');
assert(html.includes('data-rev01-page="page-home"'), 'expected rendered home page marker');
assert(html.includes('data-rev01-section="section-hero"'), 'expected rendered hero section marker');
assert(html.includes('data-rev01-element="hero-heading"'), 'expected rendered heading marker');
assert(html.includes('data-rev01-media-kind="image"'), 'expected rendered image media marker');

const pageMotionLayoutState: CanvasSiteState = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-motion-layout',
      slug: 'motion-layout',
      title: 'Motion Layout',
      width: 1440,
      entranceAnimation: 'fade-up',
      scrollTriggerMode: 'on-load',
      pageBackground: '#123456',
      defaultMotionPreset: 'scale-in',
      sectionGap: 24,
      maxWidth: 960,
      sections: [
        {
          id: 'section-motion-layout',
          recipeId: 'feature-grid',
          name: 'Motion Layout',
          height: 240,
          elements: [],
        },
      ],
    },
  ],
};
const pageMotionLayoutValidation = validateCanvasSiteState(pageMotionLayoutState);
assert(
  pageMotionLayoutValidation.valid,
  pageMotionLayoutValidation.valid
    ? ''
    : `expected valid page-level motion/layout fields: ${pageMotionLayoutValidation.errors.join('; ')}`,
);
const pageMotionLayoutHtml = renderCanvasSnapshot(
  {
    version: 1,
    publishedAt: '2026-05-27T00:00:00.000Z',
    styleKit: pageMotionLayoutState.styleKit,
    pages: pageMotionLayoutState.pages,
  },
  '/assets',
);
assert(
  pageMotionLayoutHtml.includes(
    'data-rev01-page="page-motion-layout" data-motion-preset="fade-up" data-scroll-trigger="on-load"',
  ),
  'expected on-load page entrance animation to reuse data-motion-preset so style-kit motion CSS runs',
);
assert(
  pageMotionLayoutHtml.includes(
    'style="width:960px;margin:0 auto;background:#123456;display:flex;flex-direction:column;gap:24px;max-width:960px"',
  ),
  'expected page background, section gap, and max-width to render as sanitized inline styles',
);
assert(
  pageMotionLayoutHtml.includes(
    'data-rev01-section="section-motion-layout" data-recipe="feature-grid" data-bg-effect="none" data-entrance="none" style="position:relative;width:960px;height:240px"',
  ),
  'expected maxWidth to constrain rendered section width inside the page',
);

const badPageMotionLayoutResult = validateCanvasSiteState({
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-bad-motion-layout',
      slug: 'bad-motion-layout',
      title: 'Bad Motion Layout',
      width: 1440,
      entranceAnimation: 'not-real',
      scrollTriggerMode: 'sometimes',
      pageBackground: '#fff;background:red',
      defaultMotionPreset: 'also-not-real',
      sectionGap: 121,
      maxWidth: 599,
      sections: [
        {
          id: 'section-bad-motion-layout',
          recipeId: 'feature-grid',
          name: 'Bad Motion Layout',
          height: 240,
          elements: [],
        },
      ],
    },
  ],
});
assert(!badPageMotionLayoutResult.valid, 'expected invalid page motion/layout fields to be rejected');
assert(
  !badPageMotionLayoutResult.valid &&
    badPageMotionLayoutResult.errors.some((m) => m.includes('pageBackground')) &&
    badPageMotionLayoutResult.errors.some((m) => m.includes('sectionGap')) &&
    badPageMotionLayoutResult.errors.some((m) => m.includes('maxWidth')) &&
    badPageMotionLayoutResult.errors.some((m) => m.includes('scrollTriggerMode')) &&
    badPageMotionLayoutResult.errors.some((m) => m.includes('entranceAnimation')) &&
    badPageMotionLayoutResult.errors.some((m) => m.includes('defaultMotionPreset')),
  'expected page motion/layout validation errors to name every invalid field',
);

// Rich text: the hero heading must contain a <strong> tag (the "lived-in" run
// in the fixture carries a `bold` mark). Anchor the search to the heading's
// element wrapper so we don't accept a stray <strong> elsewhere.
const headingMarker = 'data-rev01-element="hero-heading"';
const headingIdx = html.indexOf(headingMarker);
assert(headingIdx >= 0, 'expected hero-heading marker present in rendered HTML');
const headingEnd = html.indexOf('</h1>', headingIdx);
assert(headingEnd > headingIdx, 'expected hero-heading h1 to close after its marker');
const headingBlock = html.slice(headingIdx, headingEnd);
assert(
  headingBlock.includes('<strong>'),
  'expected <strong> inside the hero-heading block (bold mark must render)',
);

// Rich text: somewhere in the page a link mark must render as
// <a class="rev01-inline-link" href="https://...">. The fixture wires this
// onto the hero-body element pointing at rev01.aayushman.dev.
assert(
  /<a class="rev01-inline-link" href="https:\/\/[^"]+"/.test(html),
  'expected at least one rev01-inline-link with an https href in rendered HTML',
);

// Validator: a hand-built text element whose link mark uses a javascript:
// scheme must be rejected. The smoke wraps it in a minimum CanvasSiteState.
const javascriptLinkText: TextElement = {
  id: 'hero-heading-evil',
  type: 'text',
  box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
  content: [{ text: 'go', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }],
  role: 'body',
  fontSize: 16,
  fontWeight: 400,
  align: 'left',
};
const javascriptLinkState: CanvasSiteState = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-evil',
      slug: 'evil',
      title: 'Evil',
      width: 1440,
      sections: [
        {
          id: 'section-evil',
          recipeId: 'hero-split',
          name: 'Evil',
          height: 400,
          elements: [javascriptLinkText],
        },
      ],
    },
  ],
};
const javascriptLinkResult = validateCanvasSiteState(javascriptLinkState);
assert(
  !javascriptLinkResult.valid,
  'expected validator to reject a link mark with href "javascript:alert(1)"',
);
assert(
  !javascriptLinkResult.valid &&
    javascriptLinkResult.errors.some((m) => m.includes('javascript:alert(1)')),
  'expected javascript: link rejection to mention the offending href',
);

// Link mark with target: '_blank' must be accepted by the validator.
const blankTargetText: TextElement = {
  id: 'link-blank-target',
  type: 'text',
  box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
  content: [
    {
      text: 'external',
      marks: [{ type: 'link', href: 'https://example.com', target: '_blank' }],
    },
  ],
  role: 'body',
  fontSize: 16,
  fontWeight: 400,
  align: 'left',
};
const blankTargetState: CanvasSiteState = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-blank-target',
      slug: 'blank-target',
      title: 'Blank Target',
      width: 1440,
      sections: [
        {
          id: 'section-blank-target',
          recipeId: 'hero-split',
          name: 'Blank Target',
          height: 400,
          elements: [blankTargetText],
        },
      ],
    },
  ],
};
const blankTargetResult = validateCanvasSiteState(blankTargetState);
assert(
  blankTargetResult.valid,
  blankTargetResult.valid
    ? ''
    : 'expected validator to accept link mark with target="_blank": ' +
        blankTargetResult.errors.join('; '),
);

// Link mark with an invalid target value must be rejected.
const badTargetText: TextElement = {
  id: 'link-bad-target',
  type: 'text',
  box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
  content: [
    {
      text: 'bad',
      marks: [
        {
          type: 'link',
          href: 'https://example.com',
          target: '_self' as '_blank',
        },
      ],
    },
  ],
  role: 'body',
  fontSize: 16,
  fontWeight: 400,
  align: 'left',
};
const badTargetState: CanvasSiteState = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-bad-target',
      slug: 'bad-target',
      title: 'Bad Target',
      width: 1440,
      sections: [
        {
          id: 'section-bad-target',
          recipeId: 'hero-split',
          name: 'Bad Target',
          height: 400,
          elements: [badTargetText],
        },
      ],
    },
  ],
};
const badTargetResult = validateCanvasSiteState(badTargetState);
assert(!badTargetResult.valid, 'expected validator to reject link mark with target="_self"');
assert(
  !badTargetResult.valid && badTargetResult.errors.some((m) => m.includes('target')),
  'expected bad-target rejection error to mention "target"',
);

// Link mark without target (existing data) must still pass — backward compat.
const noTargetText: TextElement = {
  id: 'link-no-target',
  type: 'text',
  box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
  content: [{ text: 'old link', marks: [{ type: 'link', href: 'https://example.com' }] }],
  role: 'body',
  fontSize: 16,
  fontWeight: 400,
  align: 'left',
};
const noTargetState: CanvasSiteState = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-no-target',
      slug: 'no-target',
      title: 'No Target',
      width: 1440,
      sections: [
        {
          id: 'section-no-target',
          recipeId: 'hero-split',
          name: 'No Target',
          height: 400,
          elements: [noTargetText],
        },
      ],
    },
  ],
};
const noTargetResult = validateCanvasSiteState(noTargetState);
assert(
  noTargetResult.valid,
  noTargetResult.valid
    ? ''
    : 'expected validator to accept link mark without target (backward compat): ' +
        noTargetResult.errors.join('; '),
);

// Public render: link with target="_blank" must emit target and rel attributes.
const blankTargetSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-24T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: blankTargetState.pages,
};
const blankTargetHtml = renderCanvasSnapshot(blankTargetSnapshot, '/assets');
assert(
  blankTargetHtml.includes('target="_blank"'),
  'expected rendered HTML to include target="_blank" for link mark with target set',
);
assert(
  blankTargetHtml.includes('rel="noopener noreferrer"'),
  'expected rendered HTML to include rel="noopener noreferrer" for target="_blank" links',
);

// Public render: link WITHOUT target must NOT emit target or rel attributes.
const noTargetSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-24T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: noTargetState.pages,
};
const noTargetHtml = renderCanvasSnapshot(noTargetSnapshot, '/assets');
assert(
  !noTargetHtml.includes('target='),
  'expected rendered HTML to NOT include target= for link mark without target',
);
assert(
  !noTargetHtml.includes('rel='),
  'expected rendered HTML to NOT include rel= for link mark without target',
);

// -- Task 5.6: single-page invariant + accessibility -----------------------
// The hero section contains a shape (`hero-orb`) and a surface (`hero-card`),
// both decorative-by-default. The rendered HTML for the hero section must
// include at least one element wrapper with `aria-hidden="true"`. Anchor the
// search to the hero section so we do not accept an aria-hidden somewhere
// further down the page.
// Skip past any <style> block so we search in the actual DOM output, not the
// responsive CSS selectors which also reference section/element ids.
const styleCloseIdx = html.lastIndexOf('</style>');
const htmlBodyStart = styleCloseIdx >= 0 ? styleCloseIdx : 0;
const heroSectionMarker = 'data-rev01-section="section-hero"';
const heroSectionIdx = html.indexOf(heroSectionMarker, htmlBodyStart);
assert(heroSectionIdx >= 0, 'expected section-hero marker present in rendered HTML');
const heroSectionEnd = html.indexOf('</section>', heroSectionIdx);
assert(heroSectionEnd > heroSectionIdx, 'expected section-hero to close after its marker');
const heroSectionBlock = html.slice(heroSectionIdx, heroSectionEnd);
assert(
  heroSectionBlock.includes('aria-hidden="true"'),
  'expected at least one aria-hidden="true" inside section-hero (shape or surface)',
);

// The hero heading text element must NOT carry aria-hidden — text speaks for
// itself. Find the hero-heading wrapper opening tag and check it.
const headingWrapperIdx = html.indexOf('data-rev01-element="hero-heading"', htmlBodyStart);
assert(headingWrapperIdx >= 0, 'expected hero-heading element wrapper in rendered HTML');
const headingWrapperOpenEnd = html.indexOf('>', headingWrapperIdx);
assert(
  headingWrapperOpenEnd > headingWrapperIdx,
  'expected hero-heading wrapper opening tag to close with >',
);
const headingWrapperOpenTag = html.slice(headingWrapperIdx, headingWrapperOpenEnd);
assert(
  !headingWrapperOpenTag.includes('aria-hidden'),
  'expected hero-heading wrapper NOT to carry aria-hidden (text is semantic content)',
);

// Validator: a two-page state is valid when page ids/slugs are unique.
// Build it from the fixture so the second page is otherwise valid.
const fixtureClone = structuredClone(editable);
const secondPage: CanvasPage = structuredClone(fixtureClone.pages[0] as CanvasPage);
secondPage.id = 'page-second';
secondPage.slug = 'second';
secondPage.title = 'Second';
const twoPageState: CanvasSiteState = {
  ...fixtureClone,
  pages: [fixtureClone.pages[0] as CanvasPage, secondPage],
};
const twoPageResult = validateCanvasSiteState(twoPageState);
assert(
  twoPageResult.valid,
  twoPageResult.valid
    ? ''
    : 'expected validator to accept a two-page state: ' + twoPageResult.errors.join('; '),
);

const duplicatePageState: CanvasSiteState = structuredClone(twoPageState);
duplicatePageState.pages[1]!.id = duplicatePageState.pages[0]!.id;
duplicatePageState.pages[1]!.slug = duplicatePageState.pages[0]!.slug;
const duplicatePageResult = validateCanvasSiteState(duplicatePageState);
assert(
  !duplicatePageResult.valid,
  'expected validator to reject duplicate page ids/slugs',
);
assert(
  !duplicatePageResult.valid &&
    duplicatePageResult.errors.some((m) => m.includes('duplicated across pages')),
  'expected duplicate-page rejection to mention cross-page duplication',
);

// Validator: the existing empty-pages case must still reject (the new length
// rule does not displace the non-empty-array check).
const noPagesResult = validateCanvasSiteState({ styleKit: 'charcoal', pages: [] });
assert(
  !noPagesResult.valid,
  'expected validator to still reject pages: [] (non-empty array required)',
);

const pageLinkState: CanvasSiteState = structuredClone(twoPageState);
const linkSection = pageLinkState.pages[0]!.sections[0]!;
const linkElement = linkSection.elements.find((el) => el.id === 'header-cta');
if (!linkElement || linkElement.type !== 'action') {
  throw new Error('fixture header must contain action element header-cta');
}
linkElement.href = { type: 'page', pageId: 'page-second', anchor: 'pricing' };
const pageLinkResult = validateCanvasSiteState(pageLinkState);
assert(
  pageLinkResult.valid,
  pageLinkResult.valid
    ? ''
    : 'expected validator to accept an internal page link: ' + pageLinkResult.errors.join('; '),
);
const pageLinkHtml = renderCanvasSnapshot(
  {
    version: 1,
    publishedAt: '2026-05-25T00:00:00.000Z',
    styleKit: pageLinkState.styleKit,
    pages: pageLinkState.pages,
  },
  '/assets',
);
assert(
  pageLinkHtml.includes('href="/second#pricing"'),
  'expected internal page action href to resolve to the target page slug and anchor',
);

linkElement.href = { type: 'page', pageId: 'missing-page' };
const brokenPageLinkResult = validateCanvasSiteState(pageLinkState);
assert(
  !brokenPageLinkResult.valid &&
    brokenPageLinkResult.errors.some((m) => m.includes('must reference an existing page')),
  'expected validator to reject internal page links to missing pages',
);
assert(
  (() => {
    try {
      renderCanvasSnapshot(
        {
          version: 1,
          publishedAt: '2026-05-25T00:00:00.000Z',
          styleKit: pageLinkState.styleKit,
          pages: pageLinkState.pages,
        },
        '/assets',
      );
      return false;
    } catch {
      return true;
    }
  })(),
  'expected renderer to fail loudly for an internal page link to a missing page',
);

const headerMediaSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-25T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-media-header',
      slug: 'media-header',
      title: 'Media Header',
      width: 1440,
      sections: [
        {
          id: 'body',
          recipeId: 'custom',
          name: 'Body',
          height: 240,
          elements: [],
        },
      ],
    },
  ],
  header: {
    id: 'header-media',
    recipeId: 'custom',
    name: 'Header Media',
    role: 'header',
    height: 72,
    elements: [
      {
        id: 'header-media-el',
        type: 'media',
        mediaKind: 'image',
        assetId: '',
        alt: '',
        fit: 'cover',
        box: { x: 0, y: 0, w: 80, h: 60, z: 1 },
      },
    ],
  },
};
const headerMediaResult = validatePublishedSnapshot(headerMediaSnapshot);
assert(
  !headerMediaResult.valid &&
    headerMediaResult.errors.some((m) => m.includes('header.elements[0].assetId')),
  'expected published header media with an empty assetId to be rejected',
);

const headerFormPages: CanvasPage[] = [
  {
    id: 'page-form-a',
    slug: 'form-a',
    title: 'Form A',
    width: 960,
    sections: [{ id: 'body-a', recipeId: 'custom', name: 'Body A', height: 240, elements: [] }],
  },
  {
    id: 'page-form-b',
    slug: 'form-b',
    title: 'Form B',
    width: 1280,
    sections: [{ id: 'body-b', recipeId: 'custom', name: 'Body B', height: 240, elements: [] }],
  },
];
const headerFormHtml = renderCanvasSnapshot(
  {
    version: 1,
    publishedAt: '2026-05-25T00:00:00.000Z',
    styleKit: 'charcoal',
    pages: headerFormPages,
    header: {
      id: 'header-form',
      recipeId: 'custom',
      name: 'Header Form',
      role: 'header',
      height: 120,
      elements: [
        {
          id: 'header-form-el',
          type: 'form',
          box: { x: 0, y: 0, w: 400, h: 100, z: 1 },
          fields: [],
          submitLabel: 'Send',
          successMessage: 'Thanks',
        },
      ],
    },
  },
  '/assets',
  'site-form',
);
assert(
  headerFormHtml.includes('name="pageSlug" value="form-a"') &&
    headerFormHtml.includes('name="pageSlug" value="form-b"'),
  'expected site-wide header forms to render with each page slug, not a shared blank slug',
);

function roleTestSection(
  id: string,
  role?: CanvasSection['role'],
  height: number = 240,
): CanvasSection {
  return {
    id,
    recipeId: 'custom',
    name: id,
    height,
    ...(role ? { role } : {}),
    elements: [],
  };
}

function roleTestState(sections: CanvasSection[]): CanvasSiteState {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-role-test',
        slug: 'role-test',
        title: 'Role Test',
        width: 1440,
        sections,
      },
    ],
  };
}

const shortFrameRoleState = roleTestState([
  roleTestSection('section-header-short', 'header', 72),
  roleTestSection('section-body-ok'),
  roleTestSection('section-footer-short', 'footer', 120),
]);
const shortFrameRoleResult = validateCanvasSiteState(shortFrameRoleState);
assert(
  shortFrameRoleResult.valid,
  shortFrameRoleResult.valid
    ? ''
    : 'expected short header/footer sections to validate: ' +
        shortFrameRoleResult.errors.join('; '),
);

const duplicateHeaderResult = validateCanvasSiteState(
  roleTestState([
    roleTestSection('section-header-a', 'header', 72),
    roleTestSection('section-header-b', 'header', 72),
    roleTestSection('section-body-after-duplicate'),
  ]),
);
assert(!duplicateHeaderResult.valid, 'expected validator to reject duplicate header sections');
assert(
  !duplicateHeaderResult.valid &&
    duplicateHeaderResult.errors.some((m) => m.includes('at most one Header Section')),
  'expected duplicate-header rejection to mention at most one Header Section',
);

const misplacedHeaderResult = validateCanvasSiteState(
  roleTestState([
    roleTestSection('section-body-before-header'),
    roleTestSection('section-header-misplaced', 'header', 72),
  ]),
);
assert(!misplacedHeaderResult.valid, 'expected validator to reject a header after index 0');
assert(
  !misplacedHeaderResult.valid &&
    misplacedHeaderResult.errors.some((m) => m.includes('header role must be at sections[0]')),
  'expected misplaced-header rejection to mention sections[0]',
);

const misplacedFooterResult = validateCanvasSiteState(
  roleTestState([
    roleTestSection('section-footer-misplaced', 'footer', 120),
    roleTestSection('section-body-after-footer'),
  ]),
);
assert(!misplacedFooterResult.valid, 'expected validator to reject a footer before the last slot');
assert(
  !misplacedFooterResult.valid &&
    misplacedFooterResult.errors.some((m) => m.includes('footer role must be at sections[last]')),
  'expected misplaced-footer rejection to mention sections[last]',
);

const badSectionRoleState = roleTestState([roleTestSection('section-bad-role')]);
(badSectionRoleState.pages[0]!.sections[0]! as unknown as { role: string }).role = 'sidebar';
const badSectionRoleResult = validateCanvasSiteState(badSectionRoleState);
assert(!badSectionRoleResult.valid, 'expected validator to reject an unknown section role');
assert(
  !badSectionRoleResult.valid &&
    badSectionRoleResult.errors.some((m) => m.includes('role must be header|footer|body')),
  'expected bad-section-role rejection to mention the allowed roles',
);

// -- Task 6: seed-asset registry gating -----------------------------------
// The bundled fixture's media `assetId` and `posterAssetId` values must all
// resolve in SEED_ASSET_REGISTRY. Production validators stay registry-free;
// only validateSeedFixture consults the registry.
const seedResult = validateSeedFixture(editable);
assert(
  seedResult.valid,
  seedResult.valid
    ? ''
    : `expected validateSeedFixture(starterTemplate.state) to pass: ${seedResult.errors.join('; ')}`,
);

// And a hand-built fixture whose media references an unregistered assetId
// must be rejected, with the rejection message mentioning the offending id.
const bogusAssetId = 'not-a-real-seed-id-xyz';
const fixtureWithBogusAsset: CanvasSiteState = structuredClone(editable);
const firstPage = fixtureWithBogusAsset.pages[0];
if (!firstPage) throw new Error('fixture must have at least one page');
const heroSection = firstPage.sections.find((s) => s.id === 'section-hero');
if (!heroSection) throw new Error('fixture must have a hero section');
const heroMedia = heroSection.elements.find((el) => el.id === 'hero-media');
if (!heroMedia || heroMedia.type !== 'media') {
  throw new Error('fixture hero section must contain a media element with id hero-media');
}
heroMedia.assetId = bogusAssetId;
const bogusSeedResult = validateSeedFixture(fixtureWithBogusAsset);
assert(
  !bogusSeedResult.valid,
  'expected validateSeedFixture to reject a fixture with an unregistered assetId',
);
assert(
  !bogusSeedResult.valid && bogusSeedResult.errors.some((m) => m.includes(bogusAssetId)),
  `expected validateSeedFixture rejection to mention the offending id ${bogusAssetId}`,
);

// -- Task 8: deterministic style kits + variants + motion ----------------
//
// The shared kit CSS produced by `buildAllStyleKitsCss()` is consumed by both
// the editor preview (src/editor/canvas-styles.ts) and the public renderer
// (src/canvas/public-styles.ts). These assertions verify the FOUR kits emit
// distinctly different blocks — different accent colour, different action
// solid background, different surface raised radius/shadow, different motion
// duration/easing — so switching kits visibly changes the page.

const allKitsCss = buildAllStyleKitsCss();

// Every kit emits its own `[data-style-kit="<kit>"] {` block with the kit
// accent token set. We extract per-kit blocks by simple anchor + slice.
function extractKitTokenBlock(css: string, kit: BuiltInStyleKit): string {
  const anchor = `[data-style-kit="${kit}"] {`;
  const start = css.indexOf(anchor);
  if (start < 0) {
    throw new Error(`[canvas:smoke] kit token block not found for ${kit}`);
  }
  const end = css.indexOf('}', start);
  if (end < 0) {
    throw new Error(`[canvas:smoke] kit token block did not close for ${kit}`);
  }
  return css.slice(start, end + 1);
}

const accentByKit = new Map<BuiltInStyleKit, string>();
const motionByKit = new Map<BuiltInStyleKit, string>();
for (const kit of BUILT_IN_STYLE_KITS) {
  const block = extractKitTokenBlock(allKitsCss, kit);
  // Token block must declare the kit-namespaced accent.
  assert(
    block.includes('--rev01-kit-accent:'),
    `expected kit ${kit} token block to include --rev01-kit-accent declaration`,
  );
  const preset = getStyleKitPreset(kit);
  assert(
    block.includes(preset.accent),
    `expected kit ${kit} token block to reference its preset accent ${preset.accent}`,
  );
  accentByKit.set(kit, preset.accent);
  // Motion duration must match the preset's motionDurationMs.
  assert(
    block.includes(`--rev01-kit-motion-duration: ${String(preset.motionDurationMs)}ms`),
    `expected kit ${kit} token block to include motion duration ${String(preset.motionDurationMs)}ms`,
  );
  motionByKit.set(kit, `${String(preset.motionDurationMs)}ms`);
}

// The four kits must produce four DISTINCT accent values.
const distinctAccents = new Set(accentByKit.values());
assert(
  distinctAccents.size === BUILT_IN_STYLE_KITS.length,
  `expected ${String(BUILT_IN_STYLE_KITS.length)} distinct kit accents, got ${String(distinctAccents.size)} (${[...accentByKit.entries()].map(([k, v]) => `${k}=${v}`).join(', ')})`,
);

// Four DISTINCT motion durations (or at least 3+ distinct ones — but the plan
// asks each kit to feel different so we enforce all four are unique).
const distinctMotion = new Set(motionByKit.values());
assert(
  distinctMotion.size === BUILT_IN_STYLE_KITS.length,
  `expected ${String(BUILT_IN_STYLE_KITS.length)} distinct motion durations, got ${String(distinctMotion.size)}`,
);

// Each kit must emit its actionVariants.solid block — distinct background per
// kit. The block selector is
//   [data-style-kit="<kit>"] [data-element-type="action"][data-variant="solid"] .rev01-action
const solidBackgrounds = new Map<BuiltInStyleKit, string>();
for (const kit of BUILT_IN_STYLE_KITS) {
  const anchor = `[data-style-kit="${kit}"] [data-element-type="action"][data-variant="solid"] .rev01-action {`;
  const start = allKitsCss.indexOf(anchor);
  assert(start >= 0, `expected solid action block for kit ${kit}`);
  const end = allKitsCss.indexOf('}', start);
  assert(end > start, `expected solid action block for kit ${kit} to close`);
  const block = allKitsCss.slice(start, end + 1);
  // Pull the background declaration value.
  const match = block.match(/background:\s*([^;]+);/);
  assert(match !== null, `expected solid action block for kit ${kit} to declare a background`);
  const matched = (match as RegExpMatchArray)[1];
  assert(
    typeof matched === 'string',
    `expected background capture group for kit ${kit} to be a string`,
  );
  // Pull preset value out for comparison.
  const preset = getStyleKitPreset(kit);
  const expected = preset.actionVariants.solid.background;
  assert(
    expected !== undefined,
    `expected kit ${kit}'s solid action variant to declare background`,
  );
  assert(
    (matched as string).includes(expected as string),
    `expected solid action block for kit ${kit} to reference ${String(expected)}`,
  );
  solidBackgrounds.set(kit, (matched as string).trim());
}
const distinctSolidBackgrounds = new Set(solidBackgrounds.values());
assert(
  distinctSolidBackgrounds.size === BUILT_IN_STYLE_KITS.length,
  `expected ${String(BUILT_IN_STYLE_KITS.length)} distinct solid action backgrounds across kits`,
);

// Each kit must emit a surfaceVariants.raised block.
for (const kit of BUILT_IN_STYLE_KITS) {
  const anchor = `[data-style-kit="${kit}"] [data-element-type="container"][data-variant="raised"] .rev01-surface {`;
  const start = allKitsCss.indexOf(anchor);
  assert(start >= 0, `expected raised surface block for kit ${kit}`);
}

// getStyleKitPreset throws on unknown kit name.
let getThrew = false;
try {
  getStyleKitPreset('not-a-kit');
} catch (err) {
  getThrew = true;
  assert(
    err instanceof Error && err.message.includes('not-a-kit'),
    `expected getStyleKitPreset error to mention the offending kit name (got ${err instanceof Error ? err.message : String(err)})`,
  );
}
assert(getThrew, 'expected getStyleKitPreset("not-a-kit") to throw');

// Every kit defines every action variant, every surface variant, every
// motion preset — the Record<X, ...> types are belt-and-braces here so we
// add a runtime check for clarity.
for (const kit of BUILT_IN_STYLE_KITS) {
  const preset = STYLE_KIT_PRESETS[kit];
  const actionKeys = Object.keys(preset.actionVariants).sort().join(',');
  assert(
    actionKeys === 'brutalist,ghost,glass,outline,pill,solid,underline',
    `expected kit ${kit} to cover every action variant (got ${actionKeys})`,
  );
  const surfaceKeys = Object.keys(preset.surfaceVariants).sort().join(',');
  assert(
    surfaceKeys === 'editorial-frame,flat,glass,outlined,raised,soft-panel,sticker',
    `expected kit ${kit} to cover every surface variant (got ${surfaceKeys})`,
  );
  const motionKeys = Object.keys(preset.motionPresets).sort().join(',');
  assert(
    motionKeys ===
      'blur-in,bounce-in,fade-down,fade-in,fade-right,fade-up,flip-in,none,parallax-soft,rotate-in,scale-in,slide-left,slide-right,slide-up,slow-drift,stagger-children,zoom-out',
    `expected kit ${kit} to cover every motion preset (got ${motionKeys})`,
  );
}

// Renderer must stamp data-variant on action / shape / container wrappers and
// data-role on text wrappers, so the kit CSS variant selectors match.
const rendered = renderCanvasSnapshot(snapshot, '/assets');
assert(
  rendered.includes('data-element-type="action"'),
  'expected rendered HTML to contain at least one [data-element-type="action"] wrapper',
);
// The fixture has hero-cta as a solid action — verify it lands a data-variant.
assert(
  /data-element-type="action"[^>]*data-variant="[a-z-]+"/.test(rendered) ||
    /data-variant="[a-z-]+"[^>]*data-element-type="action"/.test(rendered),
  'expected at least one action wrapper to carry both data-element-type and data-variant',
);

// Renderer must throw on an unknown kit. Build a snapshot with a hand-poked
// kit name that the validator (which already rejects unknown kits at the API
// boundary) would normally have stopped — defence in depth.
let rendererThrew = false;
try {
  renderCanvasSnapshot({ ...snapshot, styleKit: 'not-a-kit' as unknown as StyleKit }, '/assets');
} catch (err) {
  rendererThrew = true;
  assert(
    err instanceof Error && err.message.includes('not-a-kit'),
    'expected renderer error to mention the offending kit name',
  );
}
assert(rendererThrew, 'expected renderer to throw on unknown style kit (no silent fallback)');

function assertRenderDispatchFailure(
  badSnapshot: PublishedSnapshot,
  expectedMessagePart: string,
  message: string,
): void {
  let threw = false;
  try {
    renderCanvasSnapshot(badSnapshot, '/assets');
  } catch (err) {
    threw = true;
    assert(
      err instanceof Error && err.message.includes(expectedMessagePart),
      `${message}: expected error to include ${expectedMessagePart}, got ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  assert(threw, message);
}

const prototypeTopLevelElement = {
  id: 'el-prototype-to-string',
  type: 'toString',
  box: { x: 0, y: 0, w: 100, h: 40, z: 1 },
} as unknown as CanvasElement;
assertRenderDispatchFailure(
  {
    version: 1,
    publishedAt: '2026-05-28T00:00:00.000Z',
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-prototype-top-level',
        slug: 'prototype-top-level',
        title: 'Prototype Top Level',
        width: 960,
        sections: [
          {
            id: 'section-prototype-top-level',
            recipeId: 'custom',
            name: 'Prototype Top Level',
            height: 120,
            elements: [prototypeTopLevelElement],
          },
        ],
      },
    ],
  },
  'type="toString" id="el-prototype-to-string"',
  'expected renderer to reject inherited Object.prototype dispatch keys at top level',
);

const prototypeCollectionChild = {
  id: 'el-prototype-constructor',
  type: 'constructor',
  box: { x: 0, y: 0, w: 100, h: 40, z: 1 },
} as unknown as CanvasElement;
assertRenderDispatchFailure(
  {
    version: 1,
    publishedAt: '2026-05-28T00:00:00.000Z',
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-prototype-collection',
        slug: 'prototype-collection',
        title: 'Prototype Collection',
        width: 960,
        sections: [
          {
            id: 'section-prototype-collection',
            recipeId: 'custom',
            name: 'Prototype Collection',
            height: 240,
            elements: [
              {
                id: 'el-collection-prototype-child',
                type: 'collection',
                box: { x: 0, y: 0, w: 400, h: 160, z: 1 },
                mode: 'manual',
                entryTemplate: [],
                entries: [[prototypeCollectionChild]],
                layout: { columns: 1, gap: 0 },
              } as unknown as CanvasElement,
            ],
          },
        ],
      },
    ],
  },
  'renderElementBody (collection child): no RENDER_DISPATCH entry for element type="constructor" id="el-prototype-constructor"',
  'expected renderer to reject inherited Object.prototype dispatch keys in collection children',
);

console.log('[canvas:smoke] OK');
