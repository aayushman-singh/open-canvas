// src/canvas/elements/nav-render.smoke.ts
//
// Regression smoke for the "published nav header collapses to 0 height,
// links render half above the viewport" bug.
//
// Why this exists: on published sites with `layout=left-center-right` the
// `<nav class="opencanvas-nav">` collapsed to height 0 because its only
// in-flow child was an empty left slot (no logo/siteTitle), and the center
// slot — which holds the links — is absolutely positioned out of flow.
// CSS `.opencanvas-nav-slot[data-slot="center"] { top: 50%; transform:
// translate(-50%, -50%); }` then resolved `top: 50%` against the 0px parent
// and translated the slot up by half its measured height, so the links
// rendered with their top half above the section.
//
// The editor preview (src/editor-client/body-builders-data.ts) didn't show
// the bug because it set `nav.style.height = '100%'` inline. The published
// renderer (src/canvas/elements/nav.ts) did not, and the two paths drifted.
//
// Fix: renderNav() now emits `height: 100%` in the inline style. The
// element wrapper around the nav always has an explicit `height: <box.h>px`
// (see render.ts buildElementWrapperStyle), so `height: 100%` resolves
// against a real number.
//
// This smoke pins the contract on every nav layout, with and without the
// optional logo / siteTitle / primaryAction, so the regression cannot
// silently reappear.
//
// Run with `bun.cmd run nav-render:smoke`.

import { renderNav, type NavElement, type NavLayout } from './nav.js';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[nav-render:smoke] ${message}`);
}

function buildNav(overrides: Partial<NavElement>): NavElement {
  const base: NavElement = {
    type: 'nav',
    id: 'el-nav-1',
    box: { x: 0, y: 0, w: 1440, h: 72, z: 0 },
    links: [
      { label: 'Home', href: '/', kind: 'internal' },
      { label: 'About', href: '/about', kind: 'internal' },
    ],
    layout: 'left-center-right',
    sticky: false,
  };
  return { ...base, ...overrides };
}

const CTX = { styleKit: 'apogee', assetBasePath: '/assets' };

// --- the inline style MUST set display:flex, height:100%, align-items:center,
//     width:100% on every nav, regardless of layout / sticky / optional slots.
//     These are load-bearing: without them the nav collapses to 0 height and
//     the center slot's CSS centering math walks the links off the top of the
//     parent. ---

const LAYOUTS: NavLayout[] = ['left-center-right', 'left-right'];

for (const layout of LAYOUTS) {
  // The empty-left + no-primary case is the exact shape that broke on the
  // test3 published site. Lock it down hardest.
  const bareHtml = renderNav(buildNav({ layout }), CTX);
  assert(
    bareHtml.includes('display:flex'),
    `layout=${layout} bare nav must inline display:flex; got ${bareHtml}`,
  );
  assert(
    bareHtml.includes('height:100%'),
    `layout=${layout} bare nav must inline height:100% so it fills the wrapper; got ${bareHtml}`,
  );
  assert(
    bareHtml.includes('align-items:center'),
    `layout=${layout} bare nav must inline align-items:center; got ${bareHtml}`,
  );
  assert(
    bareHtml.includes('width:100%'),
    `layout=${layout} bare nav must inline width:100%; got ${bareHtml}`,
  );

  // The full case — logo + siteTitle + primary CTA — must hold the same
  // contract; height:100% is not gated on optional slots being present.
  const fullHtml = renderNav(
    buildNav({
      layout,
      logoAssetId: 'asset-logo-1',
      siteTitle: 'Brand',
      primaryAction: { label: 'Sign up', href: '/signup', kind: 'internal' },
    }),
    CTX,
  );
  assert(
    fullHtml.includes('display:flex'),
    `layout=${layout} full nav must inline display:flex; got ${fullHtml}`,
  );
  assert(
    fullHtml.includes('height:100%'),
    `layout=${layout} full nav must inline height:100%; got ${fullHtml}`,
  );
  assert(
    fullHtml.includes('align-items:center'),
    `layout=${layout} full nav must inline align-items:center; got ${fullHtml}`,
  );

  // Sticky variant must also preserve the layout contract. The sticky
  // declarations are pushed first; height:100% / display:flex must still
  // land after them.
  const stickyHtml = renderNav(buildNav({ layout, sticky: true }), CTX);
  assert(
    stickyHtml.includes('position:sticky'),
    `layout=${layout} sticky nav must inline position:sticky; got ${stickyHtml}`,
  );
  assert(
    stickyHtml.includes('height:100%'),
    `layout=${layout} sticky nav must still inline height:100%; got ${stickyHtml}`,
  );
  assert(
    stickyHtml.includes('display:flex'),
    `layout=${layout} sticky nav must still inline display:flex; got ${stickyHtml}`,
  );
}

// --- slot emission still matches the layout enum ---

const leftCenterRight = renderNav(buildNav({ layout: 'left-center-right' }), CTX);
assert(
  leftCenterRight.includes('data-slot="center"'),
  `layout=left-center-right must emit data-slot="center" for the links; got ${leftCenterRight}`,
);
assert(
  !leftCenterRight.includes('data-slot="right"'),
  `layout=left-center-right must NOT emit data-slot="right"; got ${leftCenterRight}`,
);

const leftRight = renderNav(buildNav({ layout: 'left-right' }), CTX);
assert(
  leftRight.includes('data-slot="right"'),
  `layout=left-right must emit data-slot="right" for the links; got ${leftRight}`,
);
assert(
  !leftRight.includes('data-slot="center"'),
  `layout=left-right must NOT emit data-slot="center"; got ${leftRight}`,
);

const activeAbout = renderNav(buildNav({ layout: 'left-right' }), { ...CTX, pageSlug: 'about' });
assert(
  activeAbout.includes('href="/about" data-opencanvas-nav-link-active="true" aria-current="page"'),
  `current page must mark the matching nav link active; got ${activeAbout}`,
);
assert(
  !activeAbout.includes('href="/" data-opencanvas-nav-link-active="true"'),
  `current page must not mark non-matching nav links active; got ${activeAbout}`,
);

const activeHome = renderNav(buildNav({ layout: 'left-right' }), { ...CTX, pageSlug: 'index' });
assert(
  activeHome.includes('href="/" data-opencanvas-nav-link-active="true" aria-current="page"'),
  `index page must mark the root nav link active; got ${activeHome}`,
);

const bodyBuildersSrc = await Bun.file(
  new URL('../../editor-client/body-builders-data.ts', import.meta.url),
).text();
assert(
  bodyBuildersSrc.includes('data-opencanvas-nav-link-active'),
  'editor nav preview must emit the same active-link metadata',
);
assert(
  bodyBuildersSrc.includes('aria-current'),
  'editor nav preview must emit aria-current for the active link',
);

console.log(
  `[nav-render:smoke] OK — both nav layouts emit display:flex + height:100% + align-items:center + width:100%`,
);
