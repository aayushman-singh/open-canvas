// src/canvas/nav-theme-on-scroll.smoke.ts
//
// Nav theme-on-scroll primitive. Covers the schema/validator/render/Yjs/editor
// boundaries for the section-owned target + nav-owned enablement contract.
//
// Run with `bun run nav-theme-on-scroll:smoke`.

import { navInspectorSpec, type NavElement } from './elements/nav.js';
import { renderCanvasSnapshot } from './render.js';
import type { CanvasSection, EditableSite, PublishedSnapshot, TextElement } from './schema.js';
import { validateEditableSite } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[nav-theme-on-scroll:smoke] ${message}`);
}

const nav: NavElement = {
  id: 'nav-main',
  type: 'nav',
  box: { x: 0, y: 0, w: 1440, h: 80, z: 10 },
  links: [{ label: 'Home', href: '/', kind: 'internal' }],
  layout: 'left-right',
  sticky: true,
  themeOnScroll: {
    enabled: true,
    defaultTheme: 'transparent',
    reducedMotion: 'instant',
  },
};

const text: TextElement = {
  id: 'hero-copy',
  type: 'text',
  box: { x: 80, y: 160, w: 720, h: 120, z: 1 },
  content: [{ text: 'Theme target' }],
  role: 'heading',
  fontSize: 48,
  fontWeight: 700,
  align: 'left',
};

function section(id: string, navThemeTarget?: CanvasSection['navThemeTarget']): CanvasSection {
  const sectionState: CanvasSection = {
    id,
    recipeId: 'custom',
    name: id,
    height: 720,
    elements: [{ ...text, id: `${id}-copy` }],
  };
  if (navThemeTarget !== undefined) sectionState.navThemeTarget = navThemeTarget;
  return sectionState;
}

const state: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Nav Theme',
      width: 1440,
      sections: [
        {
          id: 'header-section',
          recipeId: 'custom',
          name: 'Header',
          height: 240,
          elements: [nav],
        },
        section('dark-story', 'dark'),
        section('light-story', 'light'),
      ],
    },
  ],
};

const validation = validateEditableSite(state);
assert(
  validation.valid,
  `expected valid nav theme state, got ${validation.valid ? '' : validation.errors.join(', ')}`,
);

const invalidSection = structuredClone(state);
invalidSection.pages[0]!.sections[1]!.navThemeTarget = 'neon' as NonNullable<CanvasSection['navThemeTarget']>;
const invalidSectionResult = validateEditableSite(invalidSection);
assert(!invalidSectionResult.valid, 'invalid navThemeTarget must fail validation');
assert(
  invalidSectionResult.errors.some((error) => error.includes('navThemeTarget')),
  `invalid navThemeTarget error must name the field, got ${invalidSectionResult.errors.join(', ')}`,
);

const invalidNav = structuredClone(state);
const invalidNavElement = invalidNav.pages[0]!.sections[0]!.elements[0] as NavElement;
invalidNavElement.themeOnScroll = {
  enabled: true,
  defaultTheme: 'dark',
  reducedMotion: 'animated' as NonNullable<NavElement['themeOnScroll']>['reducedMotion'],
};
const invalidNavResult = validateEditableSite(invalidNav);
assert(!invalidNavResult.valid, 'invalid nav theme reducedMotion must fail validation');
assert(
  invalidNavResult.errors.some((error) => error.includes('themeOnScroll.reducedMotion')),
  `invalid reducedMotion error must name the field, got ${invalidNavResult.errors.join(', ')}`,
);

const roundTripped = decodeYDoc(encodeYDoc(state));
const decodedNav = roundTripped.pages[0]?.sections[0]?.elements[0] as NavElement | undefined;
assert(
  decodedNav?.themeOnScroll?.enabled === true &&
    decodedNav.themeOnScroll.defaultTheme === 'transparent' &&
    decodedNav.themeOnScroll.reducedMotion === 'instant',
  `nav themeOnScroll did not round-trip: ${JSON.stringify(decodedNav?.themeOnScroll)}`,
);
assert(
  roundTripped.pages[0]?.sections[1]?.navThemeTarget === 'dark',
  `section navThemeTarget did not round-trip: ${String(
    roundTripped.pages[0]?.sections[1]?.navThemeTarget,
  )}`,
);

const html = renderCanvasSnapshot(
  {
    version: 1,
    publishedAt: '2026-06-19T00:00:00.000Z',
    ...state,
  } satisfies PublishedSnapshot,
  '/assets',
  'site-nav-theme-smoke',
  { turnstileSiteKey: 'test-key' },
);

assert(
  html.includes('data-opencanvas-nav-theme-root="nav-main"'),
  'rendered nav must expose nav theme root metadata',
);
assert(
  html.includes('data-opencanvas-nav-theme-active="transparent"'),
  'rendered nav must start at its authored default theme',
);
assert(
  html.includes('data-opencanvas-nav-theme-reduced-motion="instant"'),
  'rendered nav must expose reduced-motion mode',
);
assert(
  html.includes('data-opencanvas-nav-theme-target="dark"'),
  'rendered target section must expose nav theme target metadata',
);

const payloadMatch = html.match(
  /<script type="application\/json" data-opencanvas-behaviour-payload>([\s\S]*?)<\/script>/,
);
assert(payloadMatch !== null, 'nav theme state must emit a behaviour payload');
const payload = JSON.parse(payloadMatch[1] ?? '{}') as {
  navThemes?: Array<{
    navElementId: string;
    defaultTheme: string;
    reducedMotion: string;
  }>;
};
assert(payload.navThemes?.length === 1, 'behaviour payload must include one nav theme runtime');
assert(
  payload.navThemes[0]?.navElementId === 'nav-main' &&
    payload.navThemes[0]?.defaultTheme === 'transparent' &&
    payload.navThemes[0]?.reducedMotion === 'instant',
  `unexpected navThemes payload ${JSON.stringify(payload.navThemes)}`,
);

assert(
  navInspectorSpec.fields.some(
    (field) => field.kind === 'custom-mount' && field.name === 'nav-theme-on-scroll',
  ),
  'nav inspector spec must mount nav theme-on-scroll controls',
);

const runtimeHelpersSrc = await Bun.file(
  new URL('../editor-client/runtime-helpers.ts', import.meta.url),
).text();
const sectionInspectorSrc = await Bun.file(
  new URL('../editor-client/section-inspector.ts', import.meta.url),
).text();
const bodyBuildersSrc = await Bun.file(
  new URL('../editor-client/body-builders-data.ts', import.meta.url),
).text();

assert(
  runtimeHelpersSrc.includes("'nav-theme-on-scroll'"),
  'runtime helper mount registry must expose nav-theme-on-scroll',
);
assert(
  sectionInspectorSrc.includes('navThemeTarget'),
  'section inspector must let owners choose nav theme targets',
);
assert(
  bodyBuildersSrc.includes('data-opencanvas-nav-theme-root'),
  'editor nav preview must emit the same nav theme root metadata as published HTML',
);

console.log('[nav-theme-on-scroll:smoke] OK');
