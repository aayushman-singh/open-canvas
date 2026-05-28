// src/canvas/elements/nav.ts
//
// Wave 4 #16 — Multi-page nav. See:
//   docs/superpowers/plans/2026-05-23-16-multi-page-nav.md
//
// A NavElement renders a navigation strip that contains an optional logo asset and an
// ordered list of links. The element is dropped onto each Canvas Page so the
// same bar shows up across the site.
//
// ---------------------------------------------------------------------------
// LAYOUT SLOTS
//
// Two layouts, deterministic three-slot grid:
//
//   layout: 'left-center-right'
//     ┌──────────┬──────────────┬──────────┐
//     │  logo    │  nav links   │  cta     │
//     │ (slot 1) │   (slot 2)   │ (slot 3) │
//     └──────────┴──────────────┴──────────┘
//
//   layout: 'left-right'
//     ┌────────────────────────┬──────────────┐
//     │         logo           │  nav links   │
//     │       (slot 1)         │   (slot 2)   │
//     └────────────────────────┴──────────────┘
//
// The CTA slot in `left-center-right` is intentionally present-but-empty in
// the rendered HTML. The current schema has no dedicated CTA field on
// NavElement; the slot is reserved so kit CSS + future schema extension can
// drop a button in without a renderer change. The smoke asserts three slot
// containers exist when the layout is `left-center-right`.
//
// ---------------------------------------------------------------------------
// LINK HREF SHAPE
//
//   kind: 'internal' → renderer prepends '/' if missing, never emits target.
//                      Owner picks from a dropdown of existing page slugs in
//                      the editor (see nav-editor.tsx) so the href is always
//                      `/<slug>` for an internal page.
//   kind: 'external' → renderer emits the raw href and adds
//                      target="_blank" rel="noopener" defensively. The Owner
//                      pastes the full URL (e.g. https://example.com/x).
//   kind: 'anchor'   -> renderer emits the raw fragment href (e.g. #pricing),
//                      never prefixes "/" and never opens a new tab.
//
// We do not attempt to validate that an internal slug resolves to an existing
// page at render time — the editor's link picker is the validator. The
// "all-or-nothing" posture only forbids silent fallbacks; emitting a 404 link
// is the Owner's error, not the renderer's.
//
// ---------------------------------------------------------------------------
// STICKY
//
// `sticky: true` emits `position: sticky; top: 0; z-index: 100;` inline on the
// `<nav>` wrapper. The wrapper's surrounding element box (see render.ts
// `buildElementWrapperStyle`) is `position: absolute` — sticky inside absolute
// works as long as the absolute container's parent (the section) scrolls. The
// public site renders sections vertically, so this is the right knob for the
// POC. We don't override the element-wrapper position; we set position on the
// inner <nav>, which lives inside the absolutely-positioned wrapper.
//
// ---------------------------------------------------------------------------
// LOGO
//
// `logoAssetId` resolves to `<img src="<assetBasePath>/<id>" alt="">`. The
// alt is intentionally empty because the logo is decorative when paired with
// a sibling site title — the SEO + a11y plan (#21, #11) treats the logo as
// decorative whenever the site name is already in the page title. A future
// extension may add a `logoAlt` field; the renderer falls back to empty alt
// for now so screen readers don't double-announce the brand.

import type { BaseElement } from '../schema.js';
import { escapeAttr, escapeHtml, styleFromEntries } from './render-utils.js';

export type NavLinkKind = 'internal' | 'external' | 'anchor';

export interface NavLink {
  label: string;
  href: string;
  kind: NavLinkKind;
}

export type NavLayout = 'left-center-right' | 'left-right';

export interface NavElement extends BaseElement {
  type: 'nav';
  logoAssetId?: string;
  links: NavLink[];
  layout: NavLayout;
  sticky: boolean;
}

export interface NavRenderCtx {
  styleKit: string;
  assetBasePath: string;
}

/**
 * Build the href the renderer emits for a NavLink.
 *
 *   internal → `/<slug>`. If the Owner-stored href already starts with `/`
 *              we pass it through; otherwise we prepend `/`. The editor's
 *              picker writes `/<slug>` directly, so the normalisation here
 *              is defence-in-depth.
 *   external → the raw href as-stored. The Owner pasted a full URL.
 *
 * No protocol validation — the editor's form rejects bad input upstream and
 * the renderer is not the place to silently rewrite a malformed URL.
 */
export function navLinkHref(link: NavLink): string {
  if (link.kind === 'external') return link.href;
  if (link.kind === 'anchor') return link.href;
  // internal
  if (link.href.startsWith('/')) return link.href;
  return `/${link.href}`;
}

/** Build a single `<a>` for one NavLink, fully escaped. */
function renderNavLink(link: NavLink): string {
  const href = navLinkHref(link);
  const target = link.kind === 'external' ? ' target="_blank" rel="noopener"' : '';
  return (
    `<a class="rev01-nav-link" data-rev01-nav-link-kind="${escapeAttr(link.kind)}" ` +
    `href="${escapeAttr(href)}"${target}>` +
    `${escapeHtml(link.label)}` +
    `</a>`
  );
}

/** Build the logo container — empty when no asset id is set. */
function renderNavLogo(logoAssetId: string | undefined, assetBasePath: string): string {
  if (typeof logoAssetId !== 'string' || logoAssetId.length === 0) return '';
  // assetBasePath is canonical site-rooted (e.g. '/assets'); the asset id
  // identifies the upload. Both are escaped on the way out.
  const src = `${assetBasePath}/${logoAssetId}`;
  return `<img class="rev01-nav-logo" src="${escapeAttr(src)}" alt="" />`;
}

export function renderNav(el: NavElement, ctx: NavRenderCtx): string {
  // `ctx.styleKit` is part of the shared render context shape; the nav's
  // typography + spacing are driven by kit CSS via the data-style-kit attribute
  // already on the outer document wrapper. We don't read styleKit here, but the
  // signature stays uniform with every other element renderer.
  void ctx.styleKit;

  const logoHtml = renderNavLogo(el.logoAssetId, ctx.assetBasePath);
  const linksHtml = el.links.map(renderNavLink).join('');

  // The wrapper <nav> carries layout + sticky data-attrs so kit CSS can target
  // them; inline style emits the sticky positioning so it works without a kit.
  const navStyleEntries: Array<[string, string]> = [];
  if (el.sticky) {
    navStyleEntries.push(['position', 'sticky']);
    navStyleEntries.push(['top', '0']);
    navStyleEntries.push(['z-index', '100']);
  }
  // Always present: width 100% so the bar fills the element wrapper box.
  navStyleEntries.push(['width', '100%']);
  navStyleEntries.push(['display', 'flex']);
  navStyleEntries.push(['align-items', 'center']);
  const navStyle = styleFromEntries(navStyleEntries);

  // Slot containers. Three for `left-center-right`, two for `left-right`.
  // Slot 1 holds the logo; slot 2 holds the link list; slot 3 (when present)
  // is the reserved CTA slot — empty in this schema, kept so future schema
  // additions can drop a button in without a renderer change.
  const slot1 = `<div class="rev01-nav-slot" data-slot="left">${logoHtml}</div>`;
  const slot2 = `<div class="rev01-nav-slot" data-slot="${el.layout === 'left-right' ? 'right' : 'center'}">${linksHtml}</div>`;
  const slot3 =
    el.layout === 'left-center-right' ? `<div class="rev01-nav-slot" data-slot="right"></div>` : '';

  return (
    `<nav class="rev01-nav" data-rev01-nav-layout="${escapeAttr(el.layout)}" ` +
    `data-rev01-nav-sticky="${el.sticky ? 'true' : 'false'}" ` +
    `style="${navStyle}">` +
    `${slot1}${slot2}${slot3}` +
    `</nav>`
  );
}

/**
 * Recipe id reserved for nav sections. Re-exported through
 * `src/canvas/elements/index.ts` for callers that need to identify nav
 * sections by recipe id.
 */
export const NAV_RECIPE_ID = 'site-nav' as const;
