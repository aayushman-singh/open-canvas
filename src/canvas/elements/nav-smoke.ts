// src/canvas/elements/nav-smoke.ts
//
// `bun run nav:smoke` — Wave 4 #16 smoke. Verifies the multi-page nav
// integration: bootstrap idempotency, NavElement render slots, internal vs
// external link href shape + target attrs, sticky inline style, and logo
// asset emission. Pure-CPU; no DB, no Workers globals.
//
// Assertions follow the brief's 5-point list:
//   1. `ensureSiteNavSymbol` on a state with no nav creates a "Site Nav"
//      master + instances on every page; running it again is idempotent.
//   2. NavElement render with `layout: 'left-center-right'` emits THREE
//      slot containers.
//   3. Internal link emits `<a href="/<slug>">`; external link emits
//      `target="_blank" rel="noopener"`.
//   4. `sticky: true` emits `position: sticky` inline on the <nav> wrapper.
//   5. Logo with `logoAssetId` emits `<img src="<assetBasePath>/<id>">`.

import type {
  CanvasPage,
  CanvasSection,
  CanvasSiteState,
} from '../schema.js';
import {
  renderNav,
  SITE_NAV_SYMBOL_ID,
  SITE_NAV_SYMBOL_NAME,
  type NavElement,
} from './nav.js';
import {
  ensureSiteNavSymbol,
  removeSiteNavFromPage,
  SITE_NAV_INNER_ELEMENT_ID,
} from '../../symbols/nav-bootstrap.js';
import { findInstancesOfSymbol, findSymbolMaster } from '../../symbols/master.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[nav:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeEmptySection(id: string): CanvasSection {
  return {
    id,
    recipeId: 'hero-split',
    name: 'Body',
    height: 480,
    elements: [],
  };
}

function makePage(slug: string): CanvasPage {
  return {
    id: `page-${slug}`,
    slug,
    title: `Page ${slug}`,
    width: 1200,
    sections: [makeEmptySection(`sec-body-${slug}`)],
  };
}

function makeMultiPageState(pageSlugs: string[]): CanvasSiteState {
  // The validator pins state.pages to length 1, but bootstrap and pure
  // resolvers operate on the in-memory state directly without invoking the
  // validator (the public renderer's API boundary does). The brief asks
  // bootstrap to add an instance to EVERY page, so the smoke uses two pages
  // to exercise the loop. The validator-bypass is acceptable because this
  // is a pure-CPU smoke; nothing crosses the validator surface here.
  return {
    styleKit: 'charcoal',
    pages: pageSlugs.map((slug) => makePage(slug)),
    symbols: [],
  };
}

const RENDER_CTX = { styleKit: 'charcoal', assetBasePath: '/assets' };

// ---------------------------------------------------------------------------
// (1) Bootstrap idempotency: master + instance on every page, second call no-op.
// ---------------------------------------------------------------------------

{
  const state = makeMultiPageState(['home', 'about', 'contact']);
  // Pre-condition: no nav anywhere.
  // Capture lengths via local variables so the `asserts condition` narrowing
  // on `state.symbols.length` doesn't pin the type to a literal `0` for the
  // rest of the block (TypeScript can't tell `ensureSiteNavSymbol` mutates
  // the array).
  const preSymbolsLen: number = state.symbols.length;
  assert(preSymbolsLen === 0, '(1) pre: symbols array starts empty');
  const preInstancesLen: number = findInstancesOfSymbol(state, SITE_NAV_SYMBOL_ID).length;
  assert(preInstancesLen === 0, '(1) pre: no site-nav instances anywhere');

  // First call — creates master + instances on all 3 pages.
  ensureSiteNavSymbol(state);
  const master = findSymbolMaster(state, SITE_NAV_SYMBOL_ID);
  assert(master !== undefined, '(1) bootstrap creates the Site Nav master');
  assert(
    master.name === SITE_NAV_SYMBOL_NAME,
    `(1) master name is "${SITE_NAV_SYMBOL_NAME}" (got ${JSON.stringify(master.name)})`,
  );
  const postSymbolsLen: number = state.symbols.length;
  assert(postSymbolsLen === 1, '(1) exactly one symbol after first bootstrap');

  const innerEl = master.section.elements[0];
  assert(innerEl !== undefined, '(1) master section has one inner element');
  assert(
    innerEl.type === 'nav',
    `(1) master inner element is a NavElement (got ${innerEl.type})`,
  );
  assert(
    innerEl.id === SITE_NAV_INNER_ELEMENT_ID,
    `(1) master inner element id is "${SITE_NAV_INNER_ELEMENT_ID}"`,
  );

  const instances1 = findInstancesOfSymbol(state, SITE_NAV_SYMBOL_ID);
  assert(
    instances1.length === 3,
    `(1) bootstrap creates one instance per page (got ${String(instances1.length)})`,
  );
  // Each page now has the host section as its first section.
  for (const page of state.pages) {
    const first = page.sections[0];
    assert(first !== undefined, `(1) page ${page.id} has at least one section`);
    const el = first.elements[0];
    assert(
      el !== undefined && el.type === 'symbol-instance' && el.symbolId === SITE_NAV_SYMBOL_ID,
      `(1) page ${page.id} first section's first element is the site-nav instance`,
    );
  }

  // Second call — idempotent. Master still single; instance count unchanged.
  ensureSiteNavSymbol(state);
  const reSymbolsLen: number = state.symbols.length;
  assert(reSymbolsLen === 1, '(1) second bootstrap does NOT duplicate the master');
  const instances2 = findInstancesOfSymbol(state, SITE_NAV_SYMBOL_ID);
  const instances2Len: number = instances2.length;
  assert(
    instances2Len === 3,
    `(1) second bootstrap does NOT add extra instances (got ${String(instances2Len)})`,
  );

  // Add a brand-new page; bootstrap auto-adds its instance.
  state.pages.push(makePage('pricing'));
  ensureSiteNavSymbol(state);
  const instances3 = findInstancesOfSymbol(state, SITE_NAV_SYMBOL_ID);
  assert(
    instances3.length === 4,
    `(1) bootstrap auto-adds nav to a newly added page (got ${String(instances3.length)})`,
  );

  // Suppression path: removeSiteNavFromPage drops the host section.
  const aboutPage = state.pages.find((p) => p.slug === 'about')!;
  const removed = removeSiteNavFromPage(aboutPage);
  assert(removed === 1, '(1) removeSiteNavFromPage drops exactly one host section');
  const instancesAfterSuppress = findInstancesOfSymbol(state, SITE_NAV_SYMBOL_ID);
  assert(
    instancesAfterSuppress.length === 3,
    `(1) suppressing on one page drops the instance (got ${String(instancesAfterSuppress.length)})`,
  );
  // Calling removeSiteNavFromPage again on the suppressed page is a no-op.
  const removedAgain = removeSiteNavFromPage(aboutPage);
  assert(removedAgain === 0, '(1) removeSiteNavFromPage is idempotent on a suppressed page');
}

// ---------------------------------------------------------------------------
// (2) NavElement render with `layout: 'left-center-right'` emits three slots.
// ---------------------------------------------------------------------------

{
  const el: NavElement = {
    id: 'el-nav-1',
    type: 'nav',
    box: { x: 0, y: 0, w: 1200, h: 96, z: 1 },
    links: [
      { label: 'Home', href: '/home', kind: 'internal' },
      { label: 'About', href: '/about', kind: 'internal' },
    ],
    layout: 'left-center-right',
    sticky: false,
  };
  const html = renderNav(el, RENDER_CTX);

  // Count the three slot containers via data-slot markers.
  const slotMatches = html.match(/data-slot="(left|center|right)"/g) ?? [];
  assert(
    slotMatches.length === 3,
    `(2) left-center-right layout emits three slot containers (got ${String(slotMatches.length)} — ${JSON.stringify(slotMatches)})`,
  );
  assert(html.includes('data-slot="left"'), '(2) left slot present');
  assert(html.includes('data-slot="center"'), '(2) center slot present');
  assert(html.includes('data-slot="right"'), '(2) right (cta) slot present');
  // Layout marker on the nav wrapper.
  assert(
    html.includes('data-rev01-nav-layout="left-center-right"'),
    '(2) nav wrapper carries the layout attr',
  );

  // left-right layout: two slots only.
  const elTwo: NavElement = {
    id: 'el-nav-2',
    type: 'nav',
    box: { x: 0, y: 0, w: 1200, h: 96, z: 1 },
    links: [],
    layout: 'left-right',
    sticky: false,
  };
  const htmlTwo = renderNav(elTwo, RENDER_CTX);
  const slotMatchesTwo = htmlTwo.match(/data-slot="(left|center|right)"/g) ?? [];
  assert(
    slotMatchesTwo.length === 2,
    `(2) left-right layout emits two slot containers (got ${String(slotMatchesTwo.length)})`,
  );
  assert(htmlTwo.includes('data-slot="left"'), '(2) left-right: left slot present');
  assert(htmlTwo.includes('data-slot="right"'), '(2) left-right: right slot present');
  assert(!htmlTwo.includes('data-slot="center"'), '(2) left-right: no center slot');
}

// ---------------------------------------------------------------------------
// (3) Internal vs external link href + target attrs.
// ---------------------------------------------------------------------------

{
  const el: NavElement = {
    id: 'el-nav-3',
    type: 'nav',
    box: { x: 0, y: 0, w: 1200, h: 96, z: 1 },
    links: [
      // Internal links — leading slash present.
      { label: 'Home', href: '/home', kind: 'internal' },
      // Internal link without leading slash — renderer should add it.
      { label: 'Pricing', href: 'pricing', kind: 'internal' },
      // External link with full URL.
      { label: 'Docs', href: 'https://docs.example.com/start', kind: 'external' },
    ],
    layout: 'left-right',
    sticky: false,
  };
  const html = renderNav(el, RENDER_CTX);

  // Internal: href="/home", no target attr.
  assert(html.includes('href="/home"'), '(3) internal link with leading slash emits href="/home"');
  // The internal link must NOT carry target="_blank".
  const homeIndex = html.indexOf('href="/home"');
  // Slice forward a bit and check no target before the closing tag of this <a>.
  const homeSegment = html.slice(homeIndex, homeIndex + 200);
  const homeCloseIdx = homeSegment.indexOf('</a>');
  assert(homeCloseIdx > 0, '(3) internal link emits a closing </a>');
  const homeAnchor = homeSegment.slice(0, homeCloseIdx);
  assert(
    !homeAnchor.includes('target='),
    `(3) internal link must not carry target="_blank" (got: ${JSON.stringify(homeAnchor)})`,
  );

  // Internal link without leading slash is normalised to /pricing.
  assert(
    html.includes('href="/pricing"'),
    '(3) internal link without leading slash is normalised to /pricing',
  );

  // External: href + target="_blank" rel="noopener".
  assert(
    html.includes('href="https://docs.example.com/start"'),
    '(3) external link href passes through verbatim',
  );
  const docsIdx = html.indexOf('href="https://docs.example.com/start"');
  const docsSegment = html.slice(docsIdx, docsIdx + 300);
  assert(
    docsSegment.includes('target="_blank"'),
    `(3) external link emits target="_blank" (segment: ${JSON.stringify(docsSegment)})`,
  );
  assert(
    docsSegment.includes('rel="noopener"'),
    '(3) external link emits rel="noopener"',
  );

  // data-rev01-nav-link-kind reflects the kind for both.
  assert(
    html.includes('data-rev01-nav-link-kind="internal"'),
    '(3) internal link carries data-rev01-nav-link-kind="internal"',
  );
  assert(
    html.includes('data-rev01-nav-link-kind="external"'),
    '(3) external link carries data-rev01-nav-link-kind="external"',
  );
}

// ---------------------------------------------------------------------------
// (4) Sticky inline style.
// ---------------------------------------------------------------------------

{
  const stickyEl: NavElement = {
    id: 'el-nav-sticky',
    type: 'nav',
    box: { x: 0, y: 0, w: 1200, h: 96, z: 1 },
    links: [],
    layout: 'left-right',
    sticky: true,
  };
  const stickyHtml = renderNav(stickyEl, RENDER_CTX);
  assert(
    stickyHtml.includes('position:sticky'),
    `(4) sticky=true emits position:sticky inline (got ${JSON.stringify(stickyHtml)})`,
  );
  assert(stickyHtml.includes('top:0'), '(4) sticky=true emits top:0 inline');
  assert(stickyHtml.includes('z-index:100'), '(4) sticky=true emits z-index:100 inline');
  assert(
    stickyHtml.includes('data-rev01-nav-sticky="true"'),
    '(4) sticky=true emits data-rev01-nav-sticky="true"',
  );

  // Non-sticky: no position:sticky, no top:0, no z-index:100.
  const flatEl: NavElement = { ...stickyEl, id: 'el-nav-flat', sticky: false };
  const flatHtml = renderNav(flatEl, RENDER_CTX);
  assert(
    !flatHtml.includes('position:sticky'),
    '(4) sticky=false does NOT emit position:sticky',
  );
  assert(
    flatHtml.includes('data-rev01-nav-sticky="false"'),
    '(4) sticky=false emits data-rev01-nav-sticky="false"',
  );
}

// ---------------------------------------------------------------------------
// (5) Logo with `logoAssetId` emits an <img> with the resolved src.
// ---------------------------------------------------------------------------

{
  const logoEl: NavElement = {
    id: 'el-nav-logo',
    type: 'nav',
    box: { x: 0, y: 0, w: 1200, h: 96, z: 1 },
    logoAssetId: 'logo-abc123',
    links: [],
    layout: 'left-center-right',
    sticky: false,
  };
  const html = renderNav(logoEl, RENDER_CTX);
  assert(
    html.includes('<img class="rev01-nav-logo" src="/assets/logo-abc123"'),
    `(5) logoAssetId emits <img src="<assetBasePath>/<id>"> (got ${JSON.stringify(html)})`,
  );
  // alt attr is present (currently empty for decorative pairing).
  assert(html.includes('alt=""'), '(5) logo img carries an alt attr');

  // No logo: no <img> emitted.
  const noLogoEl: NavElement = { ...logoEl, id: 'el-nav-no-logo' };
  delete (noLogoEl as { logoAssetId?: string }).logoAssetId;
  const noLogoHtml = renderNav(noLogoEl, RENDER_CTX);
  assert(
    !noLogoHtml.includes('<img'),
    `(5) no logoAssetId means no <img> in the rendered HTML`,
  );
}

console.log('[nav:smoke] OK');
